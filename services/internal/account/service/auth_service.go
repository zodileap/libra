package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/mail"
	"sort"
	"strings"
	"sync"
	"time"

	specs "github.com/zodileap/libra/services/internal/account/specs"
	"golang.org/x/crypto/bcrypt"
)

const (
	// 描述：默认演示用户 ID，用于开源控制台权限管理界面的默认授权目标。
	defaultDemoUserID = "123e4567-e89b-12d3-a456-426614174001"
)

var (
	// 描述：账号服务内置权限模板，用于控制台授权和初始化后的基础能力展示。
	defaultPermissionTemplates = []specs.AuthPermissionTemplateItem{
		{
			Code:         "model.access.grant",
			Name:         "模型访问授权",
			Description:  "允许目标用户访问指定模型资源",
			ResourceType: "model",
		},
		{
			Code:         "model.access.delegate",
			Name:         "模型权限转授权",
			Description:  "允许目标用户继续向他人授予模型权限",
			ResourceType: "model",
		},
		{
			Code:         "console.permission.manage",
			Name:         "控制台权限管理",
			Description:  "允许目标用户执行权限授权和撤销操作",
			ResourceType: "console",
		},
	}
)

// 描述：鉴权会话信息，记录令牌对应的用户和过期时间。
type AuthSessionInfo struct {
	Token    string
	UserID   string
	ExpireAt time.Time
}

// 描述：账号与鉴权服务，负责管理员创建、登录、身份校验和基础授权管理。
type AuthService struct {
	store      *stateStore
	tokenStore *authTokenStore
	tokenTTL   time.Duration
}

// 描述：创建账号与鉴权服务实例，并从指定数据目录加载状态。
func NewAuthService(dataDir string, tokenTTL time.Duration) (*AuthService, error) {
	store, err := newStateStore(dataDir)
	if err != nil {
		return nil, err
	}
	return &AuthService{
		store:      store,
		tokenStore: newAuthTokenStore(),
		tokenTTL:   tokenTTL,
	}, nil
}

// 描述：返回当前系统是否已存在管理员，用于首次初始化流程判断。
func (s *AuthService) BootstrapStatus() (specs.AuthBootstrapStatusResp, error) {
	return withRead(s.store, func(state *accountState) (specs.AuthBootstrapStatusResp, error) {
		resp := specs.AuthBootstrapStatusResp{
			Initialized: len(state.Users) > 0,
			HasUsers:    len(state.Users) > 0,
		}
		for _, user := range state.Users {
			if hasGrantManageRole(user.Identities) {
				resp.AdminUserID = user.ID
				break
			}
		}
		return resp, nil
	})
}

// 描述：创建首个管理员，并补齐默认演示用户和基础智能体授权。
func (s *AuthService) BootstrapAdmin(req specs.AuthBootstrapAdminReq) (specs.AuthBootstrapAdminResp, error) {
	if err := validateEmail(req.Email); err != nil {
		return specs.AuthBootstrapAdminResp{}, err
	}
	if err := validatePassword(req.Password); err != nil {
		return specs.AuthBootstrapAdminResp{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return specs.AuthBootstrapAdminResp{}, NewInvalidParamError("管理员名称不能为空")
	}
	organizationName := strings.TrimSpace(req.OrganizationName)
	if organizationName == "" {
		organizationName = "Libra"
	}

	passwordHash, err := hashPassword(req.Password)
	if err != nil {
		return specs.AuthBootstrapAdminResp{}, newInternalError("生成管理员密码失败", err)
	}

	return withWrite(s.store, func(state *accountState) (specs.AuthBootstrapAdminResp, error) {
		if len(state.Users) > 0 {
			return specs.AuthBootstrapAdminResp{}, NewConflictError("系统已完成初始化，不能重复创建管理员。")
		}

		now := nowRFC3339()
		adminID, err := generateID("usr")
		if err != nil {
			return specs.AuthBootstrapAdminResp{}, newInternalError("生成管理员 ID 失败", err)
		}
		admin := userRecord{
			ID:           adminID,
			Name:         name,
			Email:        normalizeEmail(req.Email),
			Status:       1,
			PasswordHash: passwordHash,
			Identities:   buildAdminIdentities(organizationName),
			CreatedAt:    now,
			LastAt:       now,
		}
		state.Users[admin.ID] = admin
		seedAgentAccesses(state, admin.ID)
		seedDemoUser(state, organizationName)

		return specs.AuthBootstrapAdminResp{
			Created: true,
			User:    buildAuthUserInfo(admin),
		}, nil
	})
}

// 描述：登录并签发身份令牌，仅支持已存在账号的邮箱密码登录。
func (s *AuthService) Login(req specs.AuthLoginReq) (specs.AuthLoginResp, error) {
	if err := validateEmail(req.Email); err != nil {
		return specs.AuthLoginResp{}, err
	}
	if err := validatePassword(req.Password); err != nil {
		return specs.AuthLoginResp{}, err
	}

	user, err := s.findUserByEmail(req.Email)
	if err != nil {
		return specs.AuthLoginResp{}, err
	}
	if !matchPassword(user.PasswordHash, req.Password) {
		return specs.AuthLoginResp{}, NewInvalidCredentialError()
	}

	session, err := s.tokenStore.issue(user.ID, s.tokenTTL)
	if err != nil {
		return specs.AuthLoginResp{}, newInternalError("签发身份令牌失败", err)
	}
	return specs.AuthLoginResp{
		Token:     session.Token,
		ExpiresAt: session.ExpireAt.Format(time.RFC3339Nano),
		User:      buildAuthUserInfo(user),
	}, nil
}

// 描述：校验身份令牌并返回会话信息，支持裸 token 和 Bearer token 两种形式。
func (s *AuthService) VerifyToken(rawToken string) (AuthSessionInfo, error) {
	token, err := normalizeIdentityToken(rawToken)
	if err != nil {
		return AuthSessionInfo{}, err
	}
	session, ok := s.tokenStore.get(token)
	if !ok {
		return AuthSessionInfo{}, NewUnauthorizedError("身份令牌无效或已过期，请重新登录。")
	}
	return session, nil
}

// 描述：获取当前登录用户信息，用于登录态恢复和桌面端启动校验。
func (s *AuthService) GetCurrentUser(userID string) (specs.AuthMeResp, error) {
	user, err := s.getUserByID(userID)
	if err != nil {
		return specs.AuthMeResp{}, err
	}
	return specs.AuthMeResp{User: buildAuthUserInfo(user)}, nil
}

// 描述：当前会话登出并让身份令牌失效。
func (s *AuthService) Logout(token string) (specs.AuthLogoutResp, error) {
	normalized, err := normalizeIdentityToken(token)
	if err != nil {
		return specs.AuthLogoutResp{}, err
	}
	s.tokenStore.revoke(normalized)
	return specs.AuthLogoutResp{Success: true}, nil
}

// 描述：获取用户身份列表，供 Web 控制台身份选择与权限视图使用。
func (s *AuthService) ListUserIdentities(userID string) (specs.AuthIdentityListResp, error) {
	user, err := s.getUserByID(userID)
	if err != nil {
		return specs.AuthIdentityListResp{}, err
	}
	list := append([]specs.AuthIdentityItem(nil), user.Identities...)
	sort.SliceStable(list, func(i int, j int) bool {
		return list[i].IdentityID < list[j].IdentityID
	})
	return specs.AuthIdentityListResp{List: list}, nil
}

// 描述：返回当前管理员可管理的用户列表，供 Desktop 权限页直接选择授权目标。
func (s *AuthService) ListManageableUsers(actorUserID string) (specs.AuthManageableUserListResp, error) {
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthManageableUserListResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthManageableUserListResp{}, NewForbiddenError("当前无权限查看可管理用户列表。")
	}

	return withRead(s.store, func(state *accountState) (specs.AuthManageableUserListResp, error) {
		list := make([]specs.AuthManageableUserItem, 0, len(state.Users))
		for _, item := range state.Users {
			list = append(list, buildManageableUserItem(item, actorUserID))
		}
		sort.SliceStable(list, func(i int, j int) bool {
			if list[i].Self != list[j].Self {
				return !list[i].Self && list[j].Self
			}
			return list[i].Name < list[j].Name
		})
		return specs.AuthManageableUserListResp{List: list}, nil
	})
}

// 描述：返回内置权限模板，供控制台授权界面渲染下拉和说明。
func (s *AuthService) ListPermissionTemplates() (specs.AuthPermissionTemplateListResp, error) {
	list := append([]specs.AuthPermissionTemplateItem(nil), defaultPermissionTemplates...)
	return specs.AuthPermissionTemplateListResp{List: list}, nil
}

// 描述：查询权限授权记录，仅管理员可查看完整列表。
func (s *AuthService) ListPermissionGrants(actorUserID string, req specs.AuthPermissionGrantListReq) (specs.AuthPermissionGrantListResp, error) {
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthPermissionGrantListResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthPermissionGrantListResp{}, NewForbiddenError("当前无权限查看授权记录。")
	}

	return withRead(s.store, func(state *accountState) (specs.AuthPermissionGrantListResp, error) {
		list := make([]specs.AuthPermissionGrantItem, 0, len(state.PermissionGrants))
		for _, item := range state.PermissionGrants {
			if req.TargetUserID != "" && item.TargetUserID != req.TargetUserID {
				continue
			}
			if req.PermissionCode != "" && item.PermissionCode != req.PermissionCode {
				continue
			}
			if req.ResourceType != "" && item.ResourceType != req.ResourceType {
				continue
			}
			list = append(list, buildPermissionGrantItem(item))
		}
		sort.SliceStable(list, func(i int, j int) bool {
			return list[i].CreatedAt > list[j].CreatedAt
		})
		return specs.AuthPermissionGrantListResp{List: list}, nil
	})
}

// 描述：新增权限授权记录，仅管理员可执行。
func (s *AuthService) GrantPermission(actorUserID string, req specs.AuthGrantPermissionReq) (specs.AuthGrantPermissionResp, error) {
	if strings.TrimSpace(req.TargetUserID) == "" || strings.TrimSpace(req.TargetUserName) == "" {
		return specs.AuthGrantPermissionResp{}, NewInvalidParamError("目标用户信息不能为空")
	}
	if strings.TrimSpace(req.PermissionCode) == "" || strings.TrimSpace(req.ResourceType) == "" || strings.TrimSpace(req.ResourceName) == "" {
		return specs.AuthGrantPermissionResp{}, NewInvalidParamError("授权信息不完整，请检查后重试。")
	}
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthGrantPermissionResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthGrantPermissionResp{}, NewForbiddenError("当前无权限执行授权操作。")
	}
	if _, err := s.getUserByID(req.TargetUserID); err != nil {
		return specs.AuthGrantPermissionResp{}, err
	}

	return withWrite(s.store, func(state *accountState) (specs.AuthGrantPermissionResp, error) {
		now := nowRFC3339()
		grantID, err := generateID("grant")
		if err != nil {
			return specs.AuthGrantPermissionResp{}, newInternalError("生成授权记录 ID 失败", err)
		}
		record := permissionGrantRecord{
			GrantID:        grantID,
			ActorUserID:    actorUserID,
			TargetUserID:   req.TargetUserID,
			TargetUserName: strings.TrimSpace(req.TargetUserName),
			PermissionCode: strings.TrimSpace(req.PermissionCode),
			ResourceType:   strings.TrimSpace(req.ResourceType),
			ResourceName:   strings.TrimSpace(req.ResourceName),
			GrantedBy:      actorUserID,
			Status:         "active",
			ExpiresAt:      strings.TrimSpace(req.ExpiresAt),
			CreatedAt:      now,
			LastAt:         now,
		}
		state.PermissionGrants[record.GrantID] = record
		return specs.AuthGrantPermissionResp{Item: buildPermissionGrantItem(record)}, nil
	})
}

// 描述：撤销权限授权记录，仅管理员可执行。
func (s *AuthService) RevokePermission(actorUserID string, req specs.AuthRevokePermissionReq) (specs.AuthRevokePermissionResp, error) {
	if strings.TrimSpace(req.GrantID) == "" {
		return specs.AuthRevokePermissionResp{}, NewInvalidParamError("授权记录 ID 不能为空")
	}
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthRevokePermissionResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthRevokePermissionResp{}, NewForbiddenError("当前无权限执行撤销操作。")
	}

	return withWrite(s.store, func(state *accountState) (specs.AuthRevokePermissionResp, error) {
		if _, ok := state.PermissionGrants[req.GrantID]; !ok {
			return specs.AuthRevokePermissionResp{}, NewNotFoundError("授权记录不存在")
		}
		delete(state.PermissionGrants, req.GrantID)
		return specs.AuthRevokePermissionResp{Success: true}, nil
	})
}

// 描述：查询当前用户的智能体授权关系，供后续授权设置和调试界面使用。
func (s *AuthService) GetUserAgentAccessList(userID string, req specs.AuthUserAgentAccessListReq) (specs.AuthUserAgentAccessListResp, error) {
	if _, err := s.getUserByID(userID); err != nil {
		return specs.AuthUserAgentAccessListResp{}, err
	}
	return withRead(s.store, func(state *accountState) (specs.AuthUserAgentAccessListResp, error) {
		list := make([]specs.AuthUserAgentAccessItem, 0, len(state.AgentAccesses))
		for _, item := range state.AgentAccesses {
			if item.UserID != userID {
				continue
			}
			if req.AgentID != "" && item.AgentID != req.AgentID {
				continue
			}
			if req.Status != nil && item.Status != *req.Status {
				continue
			}
			list = append(list, buildAgentAccessItem(item))
		}
		sort.SliceStable(list, func(i int, j int) bool {
			return list[i].CreatedAt < list[j].CreatedAt
		})
		return specs.AuthUserAgentAccessListResp{List: list}, nil
	})
}

// 描述：新增或更新当前用户的智能体授权关系，当前阶段仅管理员可执行。
func (s *AuthService) GrantUserAgentAccess(actorUserID string, req specs.AuthGrantUserAgentAccessReq) (specs.AuthUserAgentAccessResp, error) {
	if strings.TrimSpace(req.AgentID) == "" {
		return specs.AuthUserAgentAccessResp{}, NewInvalidParamError("智能体 ID 不能为空")
	}
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthUserAgentAccessResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthUserAgentAccessResp{}, NewForbiddenError("当前无权限更新智能体授权。")
	}

	return withWrite(s.store, func(state *accountState) (specs.AuthUserAgentAccessResp, error) {
		if _, ok := state.Agents[req.AgentID]; !ok {
			return specs.AuthUserAgentAccessResp{}, NewNotFoundError("智能体不存在")
		}
		for _, item := range state.AgentAccesses {
			if item.UserID == actorUserID && item.AgentID == req.AgentID {
				updated := item
				if req.AccessType != nil {
					updated.AccessType = *req.AccessType
				}
				if req.Duration != nil {
					updated.Duration = *req.Duration
				}
				if req.Status != nil {
					updated.Status = *req.Status
				}
				updated.LastAt = nowRFC3339()
				state.AgentAccesses[updated.ID] = updated
				return specs.AuthUserAgentAccessResp{Item: buildAgentAccessItem(updated)}, nil
			}
		}

		now := nowRFC3339()
		accessID, err := generateID("access")
		if err != nil {
			return specs.AuthUserAgentAccessResp{}, newInternalError("生成智能体授权 ID 失败", err)
		}
		record := agentAccessRecord{
			ID:         accessID,
			UserID:     actorUserID,
			AgentID:    req.AgentID,
			AccessType: valueOrDefaultInt(req.AccessType, 1),
			Duration:   valueOrDefaultInt64(req.Duration, 0),
			Status:     valueOrDefaultInt(req.Status, 1),
			CreatedAt:  now,
			LastAt:     now,
		}
		state.AgentAccesses[record.ID] = record
		return specs.AuthUserAgentAccessResp{Item: buildAgentAccessItem(record)}, nil
	})
}

// 描述：撤销当前用户的智能体授权关系，当前阶段仅管理员可执行。
func (s *AuthService) RevokeUserAgentAccess(actorUserID string, req specs.AuthRevokeUserAgentAccessReq) (specs.AuthRevokeUserAgentAccessResp, error) {
	if strings.TrimSpace(req.AgentID) == "" {
		return specs.AuthRevokeUserAgentAccessResp{}, NewInvalidParamError("智能体 ID 不能为空")
	}
	actor, err := s.getUserByID(actorUserID)
	if err != nil {
		return specs.AuthRevokeUserAgentAccessResp{}, err
	}
	if !hasGrantManageRole(actor.Identities) {
		return specs.AuthRevokeUserAgentAccessResp{}, NewForbiddenError("当前无权限移除智能体授权。")
	}

	return withWrite(s.store, func(state *accountState) (specs.AuthRevokeUserAgentAccessResp, error) {
		for id, item := range state.AgentAccesses {
			if item.UserID == actorUserID && item.AgentID == req.AgentID {
				delete(state.AgentAccesses, id)
				return specs.AuthRevokeUserAgentAccessResp{Success: true}, nil
			}
		}
		return specs.AuthRevokeUserAgentAccessResp{}, NewNotFoundError("智能体授权不存在")
	})
}

// 描述：返回当前用户可用智能体列表，供 Desktop 首页和路由授权判断使用。
func (s *AuthService) ListAvailableAgents(userID string) (specs.AuthAvailableAgentListResp, error) {
	if _, err := s.getUserByID(userID); err != nil {
		return specs.AuthAvailableAgentListResp{}, err
	}
	return withRead(s.store, func(state *accountState) (specs.AuthAvailableAgentListResp, error) {
		list := make([]specs.AuthAvailableAgentItem, 0, len(state.AgentAccesses))
		for _, access := range state.AgentAccesses {
			if access.UserID != userID || access.Status == 0 {
				continue
			}
			agent, ok := state.Agents[access.AgentID]
			if !ok {
				continue
			}
			list = append(list, specs.AuthAvailableAgentItem{
				AgentID:      agent.ID,
				Code:         agent.Code,
				Name:         agent.Name,
				Version:      agent.Version,
				AgentStatus:  agent.AgentStatus,
				Remark:       agent.Remark,
				AccessID:     access.ID,
				AccessType:   access.AccessType,
				Duration:     access.Duration,
				AccessStatus: access.Status,
			})
		}
		sort.SliceStable(list, func(i int, j int) bool {
			return list[i].Code < list[j].Code
		})
		return specs.AuthAvailableAgentListResp{List: list}, nil
	})
}

// 描述：按用户 ID 读取用户记录，不存在时返回统一错误。
func (s *AuthService) getUserByID(userID string) (userRecord, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return userRecord{}, NewUnauthorizedError("身份令牌无效或已过期，请重新登录。")
	}
	return withRead(s.store, func(state *accountState) (userRecord, error) {
		user, ok := state.Users[userID]
		if !ok {
			return userRecord{}, NewNotFoundError("用户不存在")
		}
		return user, nil
	})
}

// 描述：按邮箱查找用户记录，用于登录时读取密码哈希。
func (s *AuthService) findUserByEmail(email string) (userRecord, error) {
	normalized := normalizeEmail(email)
	return withRead(s.store, func(state *accountState) (userRecord, error) {
		for _, user := range state.Users {
			if normalizeEmail(user.Email) == normalized {
				return user, nil
			}
		}
		return userRecord{}, NewInvalidCredentialError()
	})
}

// 描述：构建前端可消费的用户基础信息，避免暴露密码等敏感字段。
func buildAuthUserInfo(user userRecord) specs.AuthUserInfo {
	return specs.AuthUserInfo{
		ID:     user.ID,
		Name:   user.Name,
		Email:  user.Email,
		Phone:  user.Phone,
		Status: user.Status,
	}
}

// 描述：将用户记录转换为前端权限页可直接消费的可管理用户结构。
func buildManageableUserItem(user userRecord, actorUserID string) specs.AuthManageableUserItem {
	identityScopes := make([]string, 0, len(user.Identities))
	for _, identity := range user.Identities {
		if strings.TrimSpace(identity.ScopeName) == "" {
			continue
		}
		identityScopes = append(identityScopes, identity.ScopeName)
	}
	sort.Strings(identityScopes)
	return specs.AuthManageableUserItem{
		UserID:         user.ID,
		Name:           user.Name,
		Email:          user.Email,
		Status:         resolveUserStatusText(user.Status),
		IdentityScopes: identityScopes,
		Self:           user.ID == actorUserID,
	}
}

// 描述：将权限授权持久化记录转换为对外返回结构。
func buildPermissionGrantItem(record permissionGrantRecord) specs.AuthPermissionGrantItem {
	return specs.AuthPermissionGrantItem{
		GrantID:        record.GrantID,
		ActorUserID:    record.ActorUserID,
		TargetUserID:   record.TargetUserID,
		TargetUserName: record.TargetUserName,
		PermissionCode: record.PermissionCode,
		ResourceType:   record.ResourceType,
		ResourceName:   record.ResourceName,
		GrantedBy:      record.GrantedBy,
		Status:         record.Status,
		ExpiresAt:      record.ExpiresAt,
		CreatedAt:      record.CreatedAt,
		LastAt:         record.LastAt,
	}
}

// 描述：将智能体授权持久化记录转换为对外返回结构。
func buildAgentAccessItem(record agentAccessRecord) specs.AuthUserAgentAccessItem {
	return specs.AuthUserAgentAccessItem{
		ID:         record.ID,
		UserID:     record.UserID,
		AgentID:    record.AgentID,
		AccessType: record.AccessType,
		Duration:   record.Duration,
		Status:     record.Status,
		CreatedAt:  record.CreatedAt,
		LastAt:     record.LastAt,
	}
}

// 描述：构建管理员默认身份集合，确保控制台与授权能力开箱可用。
func buildAdminIdentities(organizationName string) []specs.AuthIdentityItem {
	orgName := strings.TrimSpace(organizationName)
	if orgName == "" {
		orgName = "Libra"
	}
	return []specs.AuthIdentityItem{
		{
			IdentityID:   "org-admin",
			IdentityType: "organization_member",
			ScopeName:    orgName,
			RoleCodes:    []string{"org_member", "permission_admin"},
			Status:       "active",
		},
		{
			IdentityID:   "dept-admin",
			IdentityType: "department_member",
			ScopeName:    "Platform",
			RoleCodes:    []string{"dept_member", "permission_admin"},
			Status:       "active",
		},
		{
			IdentityID:   "workspace-admin",
			IdentityType: "personal_workspace",
			ScopeName:    "My Workspace",
			RoleCodes:    []string{"workspace_owner", "permission_admin"},
			Status:       "active",
		},
	}
}

// 描述：构建演示用户默认身份集合，方便开源控制台直接演示授权流。
func buildDemoIdentities(organizationName string) []specs.AuthIdentityItem {
	orgName := strings.TrimSpace(organizationName)
	if orgName == "" {
		orgName = "Libra"
	}
	return []specs.AuthIdentityItem{
		{
			IdentityID:   "org-demo",
			IdentityType: "organization_member",
			ScopeName:    orgName,
			RoleCodes:    []string{"org_member", "model_operator"},
			Status:       "active",
		},
		{
			IdentityID:   "workspace-demo",
			IdentityType: "personal_workspace",
			ScopeName:    "Demo Workspace",
			RoleCodes:    []string{"workspace_member"},
			Status:       "active",
		},
	}
}

// 描述：为管理员补齐默认智能体授权，确保 Desktop 登录后可直接进入两个智能体模块。
func seedAgentAccesses(state *accountState, userID string) {
	now := nowRFC3339()
	for _, agentID := range []string{defaultCodeAgentID, defaultModelAgentID} {
		accessID, err := generateID("access")
		if err != nil {
			continue
		}
		state.AgentAccesses[accessID] = agentAccessRecord{
			ID:         accessID,
			UserID:     userID,
			AgentID:    agentID,
			AccessType: 1,
			Duration:   0,
			Status:     1,
			CreatedAt:  now,
			LastAt:     now,
		}
	}
}

// 描述：在创建管理员时同步写入一个演示用户，避免权限管理界面首次打开后没有可授权目标。
func seedDemoUser(state *accountState, organizationName string) {
	if _, ok := state.Users[defaultDemoUserID]; ok {
		return
	}
	now := nowRFC3339()
	state.Users[defaultDemoUserID] = userRecord{
		ID:           defaultDemoUserID,
		Name:         "Demo User",
		Email:        "demo@libra.local",
		Status:       1,
		PasswordHash: "!bootstrap-only!",
		Identities:   buildDemoIdentities(organizationName),
		CreatedAt:    now,
		LastAt:       now,
	}
}

// 描述：判断身份集合中是否包含权限管理角色，用于授权相关接口的准入控制。
func hasGrantManageRole(identities []specs.AuthIdentityItem) bool {
	for _, identity := range identities {
		for _, code := range identity.RoleCodes {
			if code == "permission_admin" {
				return true
			}
		}
	}
	return false
}

// 描述：将内部用户状态码转换为面向前端的可读状态文本。
func resolveUserStatusText(status int) string {
	if status == 1 {
		return "active"
	}
	return "inactive"
}

// 描述：校验邮箱格式，失败时返回前端可识别的业务状态码。
func validateEmail(email string) error {
	if _, err := mail.ParseAddress(strings.TrimSpace(email)); err != nil {
		return NewInvalidEmailError("邮箱格式不正确，请检查后重试。")
	}
	return nil
}

// 描述：校验密码长度，当前首期要求至少 6 位。
func validatePassword(password string) error {
	if len(strings.TrimSpace(password)) < 6 {
		return NewInvalidParamError("密码长度至少为 6 位。")
	}
	return nil
}

// 描述：将邮箱标准化为小写并移除前后空白，保证登录查找一致性。
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// 描述：使用 bcrypt 对密码进行哈希，避免在本地状态文件中保存明文密码。
func hashPassword(password string) (string, error) {
	payload, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

// 描述：兼容 bcrypt 哈希与固定占位值，供登录和测试场景统一复用。
func matchPassword(storedPassword string, rawPassword string) bool {
	if storedPassword == "" || storedPassword == "!bootstrap-only!" {
		return false
	}
	if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(rawPassword)); err == nil {
		return true
	}
	return storedPassword == rawPassword
}

// 描述：标准化 Authorization 头中的 token，支持 `Bearer` 前缀。
func normalizeIdentityToken(rawToken string) (string, error) {
	token := strings.TrimSpace(rawToken)
	if token == "" {
		return "", NewUnauthorizedError("身份令牌无效或已过期，请重新登录。")
	}
	if len(token) > 7 && strings.EqualFold(token[:7], "Bearer ") {
		token = strings.TrimSpace(token[7:])
	}
	if token == "" {
		return "", NewUnauthorizedError("身份令牌无效或已过期，请重新登录。")
	}
	return token, nil
}

// 描述：生成前缀化随机 ID，用于用户、授权和其他资源标识。
func generateID(prefix string) (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%s", prefix, base64.RawURLEncoding.EncodeToString(buffer)), nil
}

// 描述：生成统一的当前时间字符串，保证持久化和响应字段格式一致。
func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// 描述：读取可选整数指针，未提供时回退为默认值。
func valueOrDefaultInt(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

// 描述：读取可选整型秒数指针，未提供时回退为默认值。
func valueOrDefaultInt64(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}

// 描述：鉴权令牌内存存储，负责签发、查询与失效处理。
type authTokenStore struct {
	mu       sync.RWMutex
	sessions map[string]AuthSessionInfo
}

// 描述：创建内存令牌存储。
func newAuthTokenStore() *authTokenStore {
	return &authTokenStore{sessions: map[string]AuthSessionInfo{}}
}

// 描述：为指定用户签发新令牌，并写入过期时间。
func (s *authTokenStore) issue(userID string, ttl time.Duration) (AuthSessionInfo, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return AuthSessionInfo{}, err
	}
	token := "atk_" + base64.RawURLEncoding.EncodeToString(buffer)
	session := AuthSessionInfo{
		Token:    token,
		UserID:   userID,
		ExpireAt: time.Now().UTC().Add(ttl),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = session
	return session, nil
}

// 描述：根据 token 获取会话信息，并在会话过期时自动清理。
func (s *authTokenStore) get(token string) (AuthSessionInfo, bool) {
	s.mu.RLock()
	session, ok := s.sessions[token]
	s.mu.RUnlock()
	if !ok {
		return AuthSessionInfo{}, false
	}
	if time.Now().UTC().After(session.ExpireAt) {
		s.revoke(token)
		return AuthSessionInfo{}, false
	}
	return session, true
}

// 描述：撤销指定 token 对应的会话。
func (s *authTokenStore) revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

// 描述：比较 bootstrap 令牌时使用常量时间判断，避免明显的时间侧信道。
func MatchBootstrapToken(expected string, actual string) bool {
	if expected == "" {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.TrimSpace(actual))) == 1
}
