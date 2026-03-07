package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	account "git.zodileap.com/entity/account_v1/instance"
	specs "git.zodileap.com/gemini/libra_account/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"golang.org/x/crypto/bcrypt"
)

const (
	// 描述：账号服务内置身份令牌默认有效期。
	defaultAuthTokenTTL = 24 * time.Hour
	// 描述：系统内置超级管理员用户ID，用于控制台权限管理引导。
	bootstrapAdminUserID = "123e4567-e89b-12d3-a456-426614174000"
)

var (
	// 描述：账号服务内置身份令牌存储，当前阶段使用内存实现。
	globalAuthTokenStore = newAuthTokenStore()
	// 描述：账号服务内置权限模板，用于控制台授权。
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
			Description:  "允许目标用户向他人继续授予模型权限",
			ResourceType: "model",
		},
		{
			Code:         "console.permission.manage",
			Name:         "控制台权限管理",
			Description:  "允许目标用户在控制台执行权限管理操作",
			ResourceType: "console",
		},
	}
)

// 描述：鉴权会话信息。
type AuthSessionInfo struct {
	Token    zspecs.IdentityToken // 当前会话令牌
	UserId   zspecs.UserId        // 当前会话用户ID
	ExpireAt zspecs.ExpireAt      // 当前会话过期时间
}

// 描述：账号与鉴权服务，负责登录、会话校验、授权关系与可用智能体查询。
type AuthService struct {
	User            *account.User
	Agent           *account.Agent
	AgentAccess     *account.AgentAccess
	UserIdentity    *account.UserIdentity
	PermissionGrant *account.PermissionGrant
	tokenStore      *authTokenStore
	tokenTTL        time.Duration
}

// 描述：创建账号与鉴权服务实例。
//
// Returns:
//
//   - 0: 鉴权服务实例。
func NewAuthService() *AuthService {
	return &AuthService{
		User:            account.NewUser(),
		Agent:           account.NewAgent(),
		AgentAccess:     account.NewAgentAccess(),
		UserIdentity:    account.NewUserIdentity(),
		PermissionGrant: account.NewPermissionGrant(),
		tokenStore:      globalAuthTokenStore,
		tokenTTL:        defaultAuthTokenTTL,
	}
}

// 描述：登录并签发身份令牌。
//
// Params:
//
//   - req: 登录请求。
//
// Returns:
//
//   - 0: 登录响应。
//   - 1: 错误。
func (s *AuthService) Login(req specs.AuthLoginReq) (specs.AuthLoginResp, error) {
	return WithService(
		specs.AuthLoginResp{},
		func(resp specs.AuthLoginResp) (specs.AuthLoginResp, error) {
			if ok, msg := req.Email.Validate(); !ok {
				return resp, newAuthBizError("1010011001", zstatuscode.Global_App_ParamInvalid.New().Sprintf("email无效: %s", msg), "email无效")
			}
			if ok, msg := req.Password.Validate(); !ok {
				return resp, newAuthBizError("1010011002", zstatuscode.Global_App_ParamInvalid.New().Sprintf("password无效: %s", msg), "password无效")
			}

			userQuery := account.UserQuery{
				Email: &req.Email,
			}
			userDTO, err := s.User.GetList(account.NewDBOpCfg(), userQuery, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if userDTO == nil || len(userDTO.Users) == 0 || userDTO.Users[0] == nil {
				return resp, newAuthBizError("1010011003", zstatuscode.User_Auth_NotExist.New(), "用户不存在")
			}

			user := userDTO.Users[0]
			storedPassword := user.Password()
			if storedPassword == nil || !matchPassword(storedPassword.String(), req.Password.String()) {
				return resp, newAuthBizError("1010011004", zstatuscode.User_Auth_InfoError.New(), "用户名或密码错误")
			}

			session, err := s.tokenStore.issue(user.Id(), s.tokenTTL)
			if err != nil {
				return resp, zerr.Must(err)
			}

			logAccountAuditEvent(
				"auth.login.success",
				map[string]string{
					"userId":    user.Id().String(),
					"expiresAt": session.ExpireAt.Format(time.RFC3339Nano),
				},
			)

			resp.Token = session.Token
			resp.ExpiresAt = *zspecs.NewExpireAt(session.ExpireAt)
			resp.User = buildAuthUserInfo(user)
			return resp, nil
		},
	)
}

// 描述：校验身份令牌并返回会话信息。
//
// Params:
//
//   - rawToken: 原始身份令牌，支持 Bearer 前缀。
//
// Returns:
//
//   - 0: 会话信息。
//   - 1: 错误。
func (s *AuthService) VerifyToken(rawToken string) (AuthSessionInfo, error) {
	return WithService(
		AuthSessionInfo{},
		func(resp AuthSessionInfo) (AuthSessionInfo, error) {
			token, err := normalizeIdentityToken(rawToken)
			if err != nil {
				return resp, err
			}
			session, ok := s.tokenStore.get(token)
			if !ok {
				logAccountAuditEvent(
					"auth.verify.failed",
					map[string]string{
						"reason": "token_not_found_or_expired",
					},
				)
				return resp, newAuthBizError("1010011005", zstatuscode.Global_Info_IdentityTokenInvalid.New(), "身份令牌无效或已过期")
			}
			logAccountAuditEvent(
				"auth.verify.success",
				map[string]string{
					"userId": session.UserId.String(),
				},
			)
			resp.Token = session.Token
			resp.UserId = session.UserId
			resp.ExpireAt = *zspecs.NewExpireAt(session.ExpireAt)
			return resp, nil
		},
	)
}

// 描述：获取当前登录用户信息。
//
// Params:
//
//   - userId: 当前登录用户ID。
//
// Returns:
//
//   - 0: 当前用户信息。
//   - 1: 错误。
func (s *AuthService) GetCurrentUser(userId zspecs.UserId) (specs.AuthMeResp, error) {
	return WithService(
		specs.AuthMeResp{},
		func(resp specs.AuthMeResp) (specs.AuthMeResp, error) {
			userQuery := account.UserQuery{
				Id: &userId,
			}
			userDTO, err := s.User.Get(account.NewDBOpCfg(), userQuery, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if userDTO == nil || userDTO.User == nil {
				return resp, newAuthBizError("1010011006", zstatuscode.User_Auth_NotExist.New(), "用户不存在")
			}
			resp.User = buildAuthUserInfo(userDTO.User)
			return resp, nil
		},
	)
}

// 描述：当前会话登出并让令牌失效。
//
// Params:
//
//   - token: 当前身份令牌。
//
// Returns:
//
//   - 0: 登出结果。
//   - 1: 错误。
func (s *AuthService) Logout(token zspecs.IdentityToken) (specs.AuthLogoutResp, error) {
	return WithService(
		specs.AuthLogoutResp{},
		func(resp specs.AuthLogoutResp) (specs.AuthLogoutResp, error) {
			s.tokenStore.revoke(token)
			logAccountAuditEvent(
				"auth.logout",
				map[string]string{
					"tokenPrefix": token.String()[:min(12, len(token.String()))],
				},
			)
			resp.Success = true
			return resp, nil
		},
	)
}

// 描述：查询当前用户的智能体授权关系。
//
// Params:
//
//   - userId: 当前登录用户ID。
//   - req: 查询条件。
//
// Returns:
//
//   - 0: 授权关系列表。
//   - 1: 错误。
func (s *AuthService) GetUserAgentAccessList(userId zspecs.UserId, req specs.AuthUserAgentAccessListReq) (specs.AuthUserAgentAccessListResp, error) {
	return WithService(
		specs.AuthUserAgentAccessListResp{},
		func(resp specs.AuthUserAgentAccessListResp) (specs.AuthUserAgentAccessListResp, error) {
			if req.AgentId != nil {
				if ok, msg := req.AgentId.Validate(); !ok {
					return resp, newAuthBizError("1010011007", zstatuscode.Global_App_ParamInvalid.New().Sprintf("agentId无效: %s", msg), "agentId无效")
				}
			}
			if req.Status != nil {
				if ok, msg := req.Status.Validate(); !ok {
					return resp, newAuthBizError("1010011008", zstatuscode.Global_App_ParamInvalid.New().Sprintf("status无效: %s", msg), "status无效")
				}
			}

			query := account.AgentAccessQuery{
				UserId:  &userId,
				AgentId: req.AgentId,
				Status:  req.Status,
			}
			accessDTO, err := s.AgentAccess.GetList(account.NewDBOpCfg(), query, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if accessDTO == nil || len(accessDTO.AgentAccesss) == 0 {
				return resp, nil
			}
			for _, access := range accessDTO.AgentAccesss {
				if access == nil {
					continue
				}
				resp.List = append(resp.List, buildAuthUserAgentAccessItem(access))
			}
			return resp, nil
		},
	)
}

// 描述：新增或更新当前用户的智能体授权关系（最小管理能力）。
//
// Params:
//
//   - userId: 当前登录用户ID。
//   - req: 授权关系变更请求。
//
// Returns:
//
//   - 0: 授权关系详情。
//   - 1: 错误。
func (s *AuthService) GrantUserAgentAccess(userId zspecs.UserId, req specs.AuthGrantUserAgentAccessReq) (specs.AuthUserAgentAccessResp, error) {
	return WithService(
		specs.AuthUserAgentAccessResp{},
		func(resp specs.AuthUserAgentAccessResp) (specs.AuthUserAgentAccessResp, error) {
			if ok, msg := req.AgentId.Validate(); !ok {
				return resp, newAuthBizError("1010011009", zstatuscode.Global_App_ParamInvalid.New().Sprintf("agentId无效: %s", msg), "agentId无效")
			}
			if req.AccessType != nil {
				if ok, msg := req.AccessType.Validate(); !ok {
					return resp, newAuthBizError("1010011010", zstatuscode.Global_App_ParamInvalid.New().Sprintf("accessType无效: %s", msg), "accessType无效")
				}
			}
			if req.Duration != nil {
				if ok, msg := req.Duration.Validate(); !ok {
					return resp, newAuthBizError("1010011011", zstatuscode.Global_App_ParamInvalid.New().Sprintf("duration无效: %s", msg), "duration无效")
				}
			}
			if req.Status != nil {
				if ok, msg := req.Status.Validate(); !ok {
					return resp, newAuthBizError("1010011012", zstatuscode.Global_App_ParamInvalid.New().Sprintf("status无效: %s", msg), "status无效")
				}
			}

			agentQuery := account.AgentQuery{
				Id: &req.AgentId,
			}
			agentDTO, err := s.Agent.Get(account.NewDBOpCfg(), agentQuery, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if agentDTO == nil || agentDTO.Agent == nil {
				return resp, newAuthBizError("1010011013", zstatuscode.Global_App_ParamInvalid.New().Sprintf("agentId=%s不存在", req.AgentId.String()), "智能体不存在")
			}

			query := account.AgentAccessQuery{
				UserId:  &userId,
				AgentId: &req.AgentId,
			}
			existsDTO, err := s.AgentAccess.GetList(account.NewDBOpCfg(), query, false)
			if err != nil {
				return resp, zerr.Must(err)
			}

			if existsDTO == nil || len(existsDTO.AgentAccesss) == 0 || existsDTO.AgentAccesss[0] == nil {
				createReq := account.AgentAccessCreate{
					UserId:     userId,
					AgentId:    req.AgentId,
					AccessType: req.AccessType,
					Duration:   req.Duration,
					Status:     req.Status,
				}
				createDTO, createErr := s.AgentAccess.Create(account.NewDBOpCfg(), createReq)
				if createErr != nil {
					return resp, zerr.Must(createErr)
				}
				if createDTO == nil || createDTO.AgentAccess == nil {
					return resp, zerr.Err_1003002002.New("AgentAccess")
				}
				resp.Item = buildAuthUserAgentAccessItem(createDTO.AgentAccess)
				logAccountAuditEvent(
					"auth.agent_access.grant",
					map[string]string{
						"userId":  userId.String(),
						"agentId": req.AgentId.String(),
						"mode":    "create",
					},
				)
				return resp, nil
			}

			item := existsDTO.AgentAccesss[0]
			if req.AccessType == nil && req.Duration == nil && req.Status == nil {
				resp.Item = buildAuthUserAgentAccessItem(item)
				logAccountAuditEvent(
					"auth.agent_access.grant",
					map[string]string{
						"userId":  userId.String(),
						"agentId": req.AgentId.String(),
						"mode":    "noop",
					},
				)
				return resp, nil
			}

			cfg := account.NewDBOpCfg()
			cfg.KeepOpen = true
			id := item.Id()
			entityDTO, err := s.AgentAccess.Get(
				cfg,
				account.AgentAccessQuery{Id: &id},
				false,
			)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if entityDTO == nil || entityDTO.AgentAccess == nil {
				return resp, zerr.Err_1003002002.New("AgentAccess")
			}

			updateReq := account.AgentAccessUpdate{
				AccessType: req.AccessType,
				Duration:   req.Duration,
				Status:     req.Status,
			}
			if err = s.AgentAccess.Update(cfg, entityDTO.AgentAccess, updateReq); err != nil {
				return resp, zerr.Must(err)
			}
			if err = s.AgentAccess.Save(cfg); err != nil {
				return resp, zerr.Must(err)
			}

			resp.Item = buildAuthUserAgentAccessItem(entityDTO.AgentAccess)
			logAccountAuditEvent(
				"auth.agent_access.grant",
				map[string]string{
					"userId":  userId.String(),
					"agentId": req.AgentId.String(),
					"mode":    "update",
				},
			)
			return resp, nil
		},
	)
}

// 描述：删除当前用户的智能体授权关系（最小管理能力）。
//
// Params:
//
//   - userId: 当前登录用户ID。
//   - req: 删除请求。
//
// Returns:
//
//   - 0: 删除结果。
//   - 1: 错误。
func (s *AuthService) RevokeUserAgentAccess(userId zspecs.UserId, req specs.AuthRevokeUserAgentAccessReq) (specs.AuthRevokeUserAgentAccessResp, error) {
	return WithService(
		specs.AuthRevokeUserAgentAccessResp{},
		func(resp specs.AuthRevokeUserAgentAccessResp) (specs.AuthRevokeUserAgentAccessResp, error) {
			if ok, msg := req.AgentId.Validate(); !ok {
				return resp, newAuthBizError("1010011014", zstatuscode.Global_App_ParamInvalid.New().Sprintf("agentId无效: %s", msg), "agentId无效")
			}

			cfg := account.NewDBOpCfg()
			cfg.KeepOpen = true
			query := account.AgentAccessQuery{
				UserId:  &userId,
				AgentId: &req.AgentId,
			}
			accessDTO, err := s.AgentAccess.GetList(cfg, query, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if accessDTO == nil || len(accessDTO.AgentAccesss) == 0 {
				logAccountAuditEvent(
					"auth.agent_access.revoke",
					map[string]string{
						"userId":  userId.String(),
						"agentId": req.AgentId.String(),
						"result":  "not_found",
					},
				)
				resp.Success = true
				return resp, nil
			}

			for _, access := range accessDTO.AgentAccesss {
				if access == nil {
					continue
				}
				if err = s.AgentAccess.Delete(cfg, access); err != nil {
					return resp, zerr.Must(err)
				}
			}
			if err = s.AgentAccess.Save(cfg); err != nil {
				return resp, zerr.Must(err)
			}

			logAccountAuditEvent(
				"auth.agent_access.revoke",
				map[string]string{
					"userId":  userId.String(),
					"agentId": req.AgentId.String(),
					"result":  "deleted",
				},
			)
			resp.Success = true
			return resp, nil
		},
	)
}

// 描述：查询当前用户可用智能体列表。
//
// Params:
//
//   - userId: 当前登录用户ID。
//
// Returns:
//
//   - 0: 可用智能体列表。
//   - 1: 错误。
func (s *AuthService) GetAvailableAgents(userId zspecs.UserId) (specs.AuthAvailableAgentListResp, error) {
	return WithService(
		specs.AuthAvailableAgentListResp{},
		func(resp specs.AuthAvailableAgentListResp) (specs.AuthAvailableAgentListResp, error) {
			accessQuery := account.AgentAccessQuery{
				UserId: &userId,
			}
			accessDTO, err := s.AgentAccess.GetList(account.NewDBOpCfg(), accessQuery, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if accessDTO == nil || len(accessDTO.AgentAccesss) == 0 {
				return resp, nil
			}

			agentIDSet := map[int64]struct{}{}
			agentIDs := make([]zspecs.Id, 0, len(accessDTO.AgentAccesss))
			for _, access := range accessDTO.AgentAccesss {
				if access == nil {
					continue
				}
				agentID := access.AgentId().Int64()
				if _, exists := agentIDSet[agentID]; exists {
					continue
				}
				agentIDSet[agentID] = struct{}{}
				agentIDs = append(agentIDs, access.AgentId())
			}
			if len(agentIDs) == 0 {
				return resp, nil
			}

			agentQuery := account.AgentQuery{
				Ids: agentIDs,
			}
			agentDTO, err := s.Agent.GetList(account.NewDBOpCfg(), agentQuery, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			agentMap := map[int64]*account.AgentEntity{}
			if agentDTO != nil {
				for _, agent := range agentDTO.Agents {
					if agent == nil {
						continue
					}
					agentMap[agent.Id().Int64()] = agent
				}
			}

			for _, access := range accessDTO.AgentAccesss {
				if access == nil {
					continue
				}
				agent, exists := agentMap[access.AgentId().Int64()]
				if !exists || agent == nil {
					continue
				}
				resp.List = append(resp.List, buildAuthAvailableAgentItem(access, agent))
			}
			return resp, nil
		},
	)
}

// 描述：查询当前用户的多身份信息，覆盖公司、部门与独立用户场景。
//
// Params:
//
//   - userId: 当前登录用户ID。
//
// Returns:
//
//   - 0: 身份列表。
//   - 1: 错误。
func (s *AuthService) ListUserIdentities(userId zspecs.UserId) (specs.AuthIdentityListResp, error) {
	return WithService(
		specs.AuthIdentityListResp{},
		func(resp specs.AuthIdentityListResp) (specs.AuthIdentityListResp, error) {
			if ok, msg := userId.Validate(); !ok {
				return resp, newAuthBizError("1010011017", zstatuscode.Global_App_ParamInvalid.New().Sprintf("userId无效: %s", msg), "userId无效")
			}
			identities, err := s.ensureUserIdentities(userId)
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.List = identities
			return resp, nil
		},
	)
}

// 描述：查询当前系统支持的权限模板。
//
// Returns:
//
//   - 0: 权限模板列表。
//   - 1: 错误。
func (s *AuthService) ListPermissionTemplates() (specs.AuthPermissionTemplateListResp, error) {
	return WithService(
		specs.AuthPermissionTemplateListResp{},
		func(resp specs.AuthPermissionTemplateListResp) (specs.AuthPermissionTemplateListResp, error) {
			resp.List = append(resp.List, defaultPermissionTemplates...)
			return resp, nil
		},
	)
}

// 描述：查询权限授权记录，可按目标用户、权限编码与资源类型筛选。
//
// Params:
//
//   - actorUserId: 当前操作用户ID。
//   - req: 查询请求。
//
// Returns:
//
//   - 0: 权限授权记录列表。
//   - 1: 错误。
func (s *AuthService) ListPermissionGrants(actorUserId zspecs.UserId, req specs.AuthPermissionGrantListReq) (specs.AuthPermissionGrantListResp, error) {
	return WithService(
		specs.AuthPermissionGrantListResp{},
		func(resp specs.AuthPermissionGrantListResp) (specs.AuthPermissionGrantListResp, error) {
			if ok, msg := actorUserId.Validate(); !ok {
				return resp, newAuthBizError("1010011018", zstatuscode.Global_App_ParamInvalid.New().Sprintf("actorUserId无效: %s", msg), "actorUserId无效")
			}

			identities, err := s.ensureUserIdentities(actorUserId)
			if err != nil {
				return resp, zerr.Must(err)
			}

			queryReq := req
			if !hasGrantManageRole(identities) {
				if queryReq.TargetUserId == "" {
					queryReq.TargetUserId = actorUserId.String()
				}
				if queryReq.TargetUserId != actorUserId.String() {
					return resp, newAuthBizError("1010011027", zstatuscode.Global_App_ParamInvalid.New().Sprintf("无权查看其他用户授权记录"), "无权查看其他用户授权记录")
				}
			}

			query, err := buildPermissionGrantQuery(queryReq)
			if err != nil {
				return resp, err
			}
			grantDTO, err := s.PermissionGrant.GetList(account.NewDBOpCfg(), query, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if grantDTO == nil || len(grantDTO.PermissionGrants) == 0 {
				return resp, nil
			}

			for _, grant := range grantDTO.PermissionGrants {
				if grant == nil {
					continue
				}
				resp.List = append(resp.List, buildAuthPermissionGrantItem(grant))
			}
			sort.SliceStable(resp.List, func(i int, j int) bool {
				leftID, leftErr := strconv.ParseInt(resp.List[i].GrantId, 10, 64)
				rightID, rightErr := strconv.ParseInt(resp.List[j].GrantId, 10, 64)
				if leftErr != nil || rightErr != nil {
					return resp.List[i].GrantId < resp.List[j].GrantId
				}
				return leftID < rightID
			})
			return resp, nil
		},
	)
}

// 描述：新增权限授权记录，用于模型等资源的授权管理。
//
// Params:
//
//   - actorUserId: 当前操作用户ID。
//   - req: 授权请求。
//
// Returns:
//
//   - 0: 授权结果。
//   - 1: 错误。
func (s *AuthService) GrantPermission(actorUserId zspecs.UserId, req specs.AuthGrantPermissionReq) (specs.AuthGrantPermissionResp, error) {
	return WithService(
		specs.AuthGrantPermissionResp{},
		func(resp specs.AuthGrantPermissionResp) (specs.AuthGrantPermissionResp, error) {
			if ok, msg := actorUserId.Validate(); !ok {
				return resp, newAuthBizError("1010011019", zstatuscode.Global_App_ParamInvalid.New().Sprintf("actorUserId无效: %s", msg), "actorUserId无效")
			}

			identities, err := s.ensureUserIdentities(actorUserId)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if !hasGrantManageRole(identities) {
				return resp, newAuthBizError("1010011028", zstatuscode.Global_App_ParamInvalid.New().Sprintf("当前身份无授权管理权限"), "当前身份无授权管理权限")
			}

			targetSpec := zspecs.NewUserId(req.TargetUserId)
			if ok, msg := targetSpec.Validate(); !ok {
				return resp, newAuthBizError("1010011020", zstatuscode.Global_App_ParamInvalid.New().Sprintf("targetUserId无效: %s", msg), "targetUserId无效")
			}
			if strings.TrimSpace(req.TargetUserName) == "" {
				return resp, newAuthBizError("1010011021", zstatuscode.Global_App_ParamInvalid.New().Sprintf("targetUserName不能为空"), "targetUserName不能为空")
			}
			if strings.TrimSpace(req.PermissionCode) == "" {
				return resp, newAuthBizError("1010011022", zstatuscode.Global_App_ParamInvalid.New().Sprintf("permissionCode不能为空"), "permissionCode不能为空")
			}
			if strings.TrimSpace(req.ResourceType) == "" {
				return resp, newAuthBizError("1010011023", zstatuscode.Global_App_ParamInvalid.New().Sprintf("resourceType不能为空"), "resourceType不能为空")
			}
			if strings.TrimSpace(req.ResourceName) == "" {
				return resp, newAuthBizError("1010011024", zstatuscode.Global_App_ParamInvalid.New().Sprintf("resourceName不能为空"), "resourceName不能为空")
			}

			targetUserNameSpec := zspecs.NewUserName(strings.TrimSpace(req.TargetUserName))
			if ok, msg := targetUserNameSpec.Validate(); !ok {
				return resp, newAuthBizError("1010011030", zstatuscode.Global_App_ParamInvalid.New().Sprintf("targetUserName无效: %s", msg), "targetUserName无效")
			}
			permissionCodeSpec := zspecs.NewCode(strings.TrimSpace(req.PermissionCode))
			if ok, msg := permissionCodeSpec.Validate(); !ok {
				return resp, newAuthBizError("1010011031", zstatuscode.Global_App_ParamInvalid.New().Sprintf("permissionCode无效: %s", msg), "permissionCode无效")
			}
			resourceTypeSpec := zspecs.NewCode(strings.TrimSpace(req.ResourceType))
			if ok, msg := resourceTypeSpec.Validate(); !ok {
				return resp, newAuthBizError("1010011032", zstatuscode.Global_App_ParamInvalid.New().Sprintf("resourceType无效: %s", msg), "resourceType无效")
			}
			resourceNameSpec := zspecs.NewName(strings.TrimSpace(req.ResourceName))
			if ok, msg := resourceNameSpec.Validate(); !ok {
				return resp, newAuthBizError("1010011033", zstatuscode.Global_App_ParamInvalid.New().Sprintf("resourceName无效: %s", msg), "resourceName无效")
			}

			grantedBy := actorUserId
			statusActive := zspecs.NewStatus(1)
			var expiresAtRemark *zspecs.Remark
			if strings.TrimSpace(req.ExpiresAt) != "" {
				expiresAtRemark = zspecs.NewRemark(strings.TrimSpace(req.ExpiresAt))
				if ok, msg := expiresAtRemark.Validate(); !ok {
					return resp, newAuthBizError("1010011034", zstatuscode.Global_App_ParamInvalid.New().Sprintf("expiresAt无效: %s", msg), "expiresAt无效")
				}
			}

			createReq := account.PermissionGrantCreate{
				ActorUserId:    actorUserId,
				TargetUserId:   *targetSpec,
				TargetUserName: *targetUserNameSpec,
				PermissionCode: *permissionCodeSpec,
				ResourceType:   *resourceTypeSpec,
				ResourceName:   *resourceNameSpec,
				GrantedBy:      &grantedBy,
				Status:         statusActive,
				ExpiresAt:      expiresAtRemark,
			}
			createDTO, err := s.PermissionGrant.Create(account.NewDBOpCfg(), createReq)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if createDTO == nil || createDTO.PermissionGrant == nil {
				return resp, zerr.Err_1003002002.New("PermissionGrant")
			}

			resp.Item = buildAuthPermissionGrantItem(createDTO.PermissionGrant)
			logAccountAuditEvent(
				"auth.permission.grant",
				map[string]string{
					"actorUserId":  actorUserId.String(),
					"targetUserId": req.TargetUserId,
					"permission":   req.PermissionCode,
					"resourceType": req.ResourceType,
				},
			)
			return resp, nil
		},
	)
}

// 描述：撤销权限授权记录。
//
// Params:
//
//   - actorUserId: 当前操作用户ID。
//   - req: 撤销请求。
//
// Returns:
//
//   - 0: 撤销结果。
//   - 1: 错误。
func (s *AuthService) RevokePermission(actorUserId zspecs.UserId, req specs.AuthRevokePermissionReq) (specs.AuthRevokePermissionResp, error) {
	return WithService(
		specs.AuthRevokePermissionResp{},
		func(resp specs.AuthRevokePermissionResp) (specs.AuthRevokePermissionResp, error) {
			if ok, msg := actorUserId.Validate(); !ok {
				return resp, newAuthBizError("1010011025", zstatuscode.Global_App_ParamInvalid.New().Sprintf("actorUserId无效: %s", msg), "actorUserId无效")
			}

			identities, err := s.ensureUserIdentities(actorUserId)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if !hasGrantManageRole(identities) {
				return resp, newAuthBizError("1010011029", zstatuscode.Global_App_ParamInvalid.New().Sprintf("当前身份无授权管理权限"), "当前身份无授权管理权限")
			}
			if strings.TrimSpace(req.GrantId) == "" {
				return resp, newAuthBizError("1010011026", zstatuscode.Global_App_ParamInvalid.New().Sprintf("grantId不能为空"), "grantId不能为空")
			}
			grantIDValue, parseErr := strconv.ParseInt(strings.TrimSpace(req.GrantId), 10, 64)
			if parseErr != nil {
				return resp, newAuthBizError("1010011035", zstatuscode.Global_App_ParamInvalid.New().Sprintf("grantId无效"), "grantId无效")
			}
			grantID := zspecs.NewId(grantIDValue)

			cfg := account.NewDBOpCfg()
			cfg.KeepOpen = true
			query := account.PermissionGrantQuery{Id: grantID}
			grantDTO, err := s.PermissionGrant.GetList(cfg, query, false)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if grantDTO == nil || len(grantDTO.PermissionGrants) == 0 || grantDTO.PermissionGrants[0] == nil {
				resp.Success = false
				return resp, nil
			}

			if err = s.PermissionGrant.Delete(cfg, grantDTO.PermissionGrants[0]); err != nil {
				return resp, zerr.Must(err)
			}
			if err = s.PermissionGrant.Save(cfg); err != nil {
				return resp, zerr.Must(err)
			}

			resp.Success = true
			logAccountAuditEvent(
				"auth.permission.revoke",
				map[string]string{
					"actorUserId": actorUserId.String(),
					"grantId":     req.GrantId,
					"success":     strconv.FormatBool(resp.Success),
				},
			)
			return resp, nil
		},
	)
}

// 描述：构建业务错误并绑定状态码。
func newAuthBizError(code string, statusCode *zstatuscode.StatusCode, msg string) error {
	err := zerr.New(code, msg, 4, msg)
	err.StatuCode = statusCode
	return err
}

// 描述：确保指定用户至少存在一组默认身份，如果不存在则自动初始化。
func (s *AuthService) ensureUserIdentities(userId zspecs.UserId) ([]specs.AuthIdentityItem, error) {
	query := account.UserIdentityQuery{UserId: &userId}
	identityDTO, err := s.UserIdentity.GetList(account.NewDBOpCfg(), query, false)
	if err != nil {
		if shouldFallbackIdentity(err) {
			return buildDefaultIdentityItems(userId), nil
		}
		return nil, zerr.Must(err)
	}
	if identityDTO != nil && len(identityDTO.UserIdentitys) > 0 {
		return buildAuthIdentityItems(identityDTO.UserIdentitys), nil
	}

	defaultCreates := buildDefaultUserIdentityCreates(userId)
	if len(defaultCreates) == 0 {
		return []specs.AuthIdentityItem{}, nil
	}
	if _, err = s.UserIdentity.CreateList(account.NewDBOpCfg(), defaultCreates); err != nil {
		if shouldFallbackIdentity(err) {
			return buildDefaultIdentityItems(userId), nil
		}
		return nil, zerr.Must(err)
	}

	identityDTO, err = s.UserIdentity.GetList(account.NewDBOpCfg(), query, false)
	if err != nil {
		if shouldFallbackIdentity(err) {
			return buildDefaultIdentityItems(userId), nil
		}
		return nil, zerr.Must(err)
	}
	if identityDTO == nil {
		return []specs.AuthIdentityItem{}, nil
	}
	return buildAuthIdentityItems(identityDTO.UserIdentitys), nil
}

// 描述：在数据库连接未初始化场景下允许回退默认身份，避免基础接口不可用。
func shouldFallbackIdentity(err error) bool {
	if err == nil {
		return false
	}
	errText := strings.ToLower(err.Error())
	return strings.Contains(errText, "connection tag 'account' does not exist")
}

// 描述：构建默认身份返回结构，用于数据库不可用时的降级。
func buildDefaultIdentityItems(userId zspecs.UserId) []specs.AuthIdentityItem {
	creates := buildDefaultUserIdentityCreates(userId)
	items := make([]specs.AuthIdentityItem, 0, len(creates))
	for _, createReq := range creates {
		roleCodes := []string{}
		if createReq.RoleCodes != nil {
			roleCodes = splitCommaValues(createReq.RoleCodes.String())
		}
		items = append(items, specs.AuthIdentityItem{
			IdentityId:   createReq.ScopeCode.String() + "-" + userId.String(),
			IdentityType: createReq.IdentityType.String(),
			ScopeName:    createReq.ScopeName.String(),
			RoleCodes:    roleCodes,
			Status:       "active",
		})
	}
	return items
}

// 描述：构建用户默认身份写入参数。
func buildDefaultUserIdentityCreates(userId zspecs.UserId) []account.UserIdentityCreate {
	organizationRoles := []string{"org_member", "model_operator"}
	departmentRoles := []string{"department_member"}
	if userId.String() == bootstrapAdminUserID {
		organizationRoles = append(organizationRoles, "org_admin", "permission_admin")
		departmentRoles = append(departmentRoles, "department_admin")
	}

	identityStatus := zspecs.NewStatus(1)
	organizationRolesRemark := zspecs.NewRemark(strings.Join(organizationRoles, ","))
	departmentRolesRemark := zspecs.NewRemark(strings.Join(departmentRoles, ","))
	individualRolesRemark := zspecs.NewRemark("individual_user")

	return []account.UserIdentityCreate{
		{
			UserId:       userId,
			IdentityType: *zspecs.NewCode("organization_member"),
			ScopeCode:    *zspecs.NewCode("org"),
			ScopeName:    *zspecs.NewName("Zodileap"),
			RoleCodes:    organizationRolesRemark,
			Status:       identityStatus,
		},
		{
			UserId:       userId,
			IdentityType: *zspecs.NewCode("department_member"),
			ScopeCode:    *zspecs.NewCode("dept"),
			ScopeName:    *zspecs.NewName("Agent Platform"),
			RoleCodes:    departmentRolesRemark,
			Status:       identityStatus,
		},
		{
			UserId:       userId,
			IdentityType: *zspecs.NewCode("individual"),
			ScopeCode:    *zspecs.NewCode("ind"),
			ScopeName:    *zspecs.NewName("Personal Workspace"),
			RoleCodes:    individualRolesRemark,
			Status:       identityStatus,
		},
	}
}

// 描述：将用户身份实体集合转换为接口返回结构。
func buildAuthIdentityItems(entities []*account.UserIdentityEntity) []specs.AuthIdentityItem {
	items := make([]specs.AuthIdentityItem, 0, len(entities))
	for _, entityItem := range entities {
		if entityItem == nil {
			continue
		}
		items = append(items, buildAuthIdentityItem(entityItem))
	}
	return items
}

// 描述：将用户身份实体转换为接口返回结构。
func buildAuthIdentityItem(entityItem *account.UserIdentityEntity) specs.AuthIdentityItem {
	roleCodes := []string{}
	if entityItem.RoleCodes() != nil {
		roleCodes = splitCommaValues(entityItem.RoleCodes().String())
	}
	statusText := "active"
	if entityItem.Status() != nil && entityItem.Status().Int16() != 1 {
		statusText = "inactive"
	}

	return specs.AuthIdentityItem{
		IdentityId:   fmt.Sprintf("%s-%d", entityItem.ScopeCode().String(), entityItem.Id().Int64()),
		IdentityType: entityItem.IdentityType().String(),
		ScopeName:    entityItem.ScopeName().String(),
		RoleCodes:    roleCodes,
		Status:       statusText,
	}
}

// 描述：构建权限授权查询条件。
func buildPermissionGrantQuery(req specs.AuthPermissionGrantListReq) (account.PermissionGrantQuery, error) {
	query := account.PermissionGrantQuery{}
	if strings.TrimSpace(req.TargetUserId) != "" {
		targetUserId := zspecs.NewUserId(strings.TrimSpace(req.TargetUserId))
		if ok, msg := targetUserId.Validate(); !ok {
			return query, newAuthBizError("1010011036", zstatuscode.Global_App_ParamInvalid.New().Sprintf("targetUserId无效: %s", msg), "targetUserId无效")
		}
		query.TargetUserId = targetUserId
	}
	if strings.TrimSpace(req.PermissionCode) != "" {
		permissionCode := zspecs.NewCode(strings.TrimSpace(req.PermissionCode))
		if ok, msg := permissionCode.Validate(); !ok {
			return query, newAuthBizError("1010011037", zstatuscode.Global_App_ParamInvalid.New().Sprintf("permissionCode无效: %s", msg), "permissionCode无效")
		}
		query.PermissionCode = permissionCode
	}
	if strings.TrimSpace(req.ResourceType) != "" {
		resourceType := zspecs.NewCode(strings.TrimSpace(req.ResourceType))
		if ok, msg := resourceType.Validate(); !ok {
			return query, newAuthBizError("1010011038", zstatuscode.Global_App_ParamInvalid.New().Sprintf("resourceType无效: %s", msg), "resourceType无效")
		}
		query.ResourceType = resourceType
	}
	return query, nil
}

// 描述：将权限授权实体转换为接口返回结构。
func buildAuthPermissionGrantItem(entityItem *account.PermissionGrantEntity) specs.AuthPermissionGrantItem {
	createdAt := ""
	if entityItem.CreatedAt() != nil {
		createdAt = entityItem.CreatedAt().Time().Format(time.RFC3339Nano)
	}
	lastAt := ""
	if entityItem.LastAt() != nil {
		lastAt = entityItem.LastAt().Time().Format(time.RFC3339Nano)
	}
	expiresAt := ""
	if entityItem.ExpiresAt() != nil {
		expiresAt = entityItem.ExpiresAt().String()
	}
	grantedBy := ""
	if entityItem.GrantedBy() != nil {
		grantedBy = entityItem.GrantedBy().String()
	}
	statusText := "active"
	if entityItem.Status() != nil && entityItem.Status().Int16() != 1 {
		statusText = "inactive"
	}

	return specs.AuthPermissionGrantItem{
		GrantId:        strconv.FormatInt(entityItem.Id().Int64(), 10),
		ActorUserId:    entityItem.ActorUserId().String(),
		TargetUserId:   entityItem.TargetUserId().String(),
		TargetUserName: entityItem.TargetUserName().String(),
		PermissionCode: entityItem.PermissionCode().String(),
		ResourceType:   entityItem.ResourceType().String(),
		ResourceName:   entityItem.ResourceName().String(),
		GrantedBy:      grantedBy,
		Status:         statusText,
		ExpiresAt:      expiresAt,
		CreatedAt:      createdAt,
		LastAt:         lastAt,
	}
}

// 描述：将逗号分隔的编码字符串拆分为数组。
func splitCommaValues(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

// 描述：判断身份集合是否具备权限管理能力。
func hasGrantManageRole(identities []specs.AuthIdentityItem) bool {
	for _, identity := range identities {
		for _, roleCode := range identity.RoleCodes {
			if roleCode == "org_admin" || roleCode == "department_admin" || roleCode == "permission_admin" {
				return true
			}
		}
	}
	return false
}

// 描述：校验密码是否匹配，优先兼容 bcrypt，兼容历史明文数据。
func matchPassword(storedPassword string, inputPassword string) bool {
	if storedPassword == "" || inputPassword == "" {
		return false
	}
	// 先尝试按 bcrypt 校验，兼容后续迁移到密文密码。
	if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(inputPassword)); err == nil {
		return true
	}
	// 兼容历史明文密码存储。
	return subtle.ConstantTimeCompare([]byte(storedPassword), []byte(inputPassword)) == 1
}

// 描述：将用户实体转换为鉴权用户信息。
func buildAuthUserInfo(user *account.UserEntity) specs.AuthUserInfo {
	return specs.AuthUserInfo{
		Id:     user.Id(),
		Name:   user.Name(),
		Email:  user.Email(),
		Phone:  user.Phone(),
		Status: user.Status(),
	}
}

// 描述：将授权实体转换为授权响应数据。
func buildAuthUserAgentAccessItem(access *account.AgentAccessEntity) specs.AuthUserAgentAccessItem {
	return specs.AuthUserAgentAccessItem{
		Id:         access.Id(),
		UserId:     access.UserId(),
		AgentId:    access.AgentId(),
		AccessType: access.AccessType(),
		Duration:   access.Duration(),
		Status:     access.Status(),
		CreatedAt:  access.CreatedAt(),
		LastAt:     access.LastAt(),
	}
}

// 描述：将授权实体与智能体实体组合为可用智能体响应数据。
func buildAuthAvailableAgentItem(access *account.AgentAccessEntity, agent *account.AgentEntity) specs.AuthAvailableAgentItem {
	return specs.AuthAvailableAgentItem{
		AgentId:      agent.Id(),
		Code:         agent.Code(),
		Name:         agent.Name(),
		Version:      agent.Version(),
		AgentStatus:  agent.Status(),
		Remark:       agent.Remark(),
		AccessId:     access.Id(),
		AccessType:   access.AccessType(),
		Duration:     access.Duration(),
		AccessStatus: access.Status(),
	}
}

// 描述：标准化身份令牌，支持 Bearer 前缀。
func normalizeIdentityToken(rawToken string) (zspecs.IdentityToken, error) {
	token := strings.TrimSpace(rawToken)
	if token == "" {
		return "", newAuthBizError("1010011015", zstatuscode.Global_Info_IdentityTokenInvalid.New(), "身份令牌为空")
	}

	if strings.HasPrefix(strings.ToLower(token), "bearer ") {
		token = strings.TrimSpace(token[7:])
	}
	specToken := zspecs.NewIdentityToken(token)
	if ok, msg := specToken.Validate(); !ok {
		return "", newAuthBizError("1010011016", zstatuscode.Global_Info_IdentityTokenInvalid.New(), "身份令牌无效: "+msg)
	}
	return *specToken, nil
}

// 描述：生成新的身份令牌字符串。
func generateIdentityToken() (zspecs.IdentityToken, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", zerr.Must(err)
	}
	token := "atk_" + base64.RawURLEncoding.EncodeToString(buf)
	return *zspecs.NewIdentityToken(token), nil
}

// 描述：内存身份令牌会话。
type authTokenSession struct {
	Token    zspecs.IdentityToken
	UserId   zspecs.UserId
	ExpireAt time.Time
}

// 描述：内存身份令牌存储。
type authTokenStore struct {
	lock     sync.RWMutex
	sessions map[string]authTokenSession
}

// 描述：创建内存身份令牌存储。
func newAuthTokenStore() *authTokenStore {
	return &authTokenStore{
		sessions: map[string]authTokenSession{},
	}
}

// 描述：签发身份令牌并写入会话。
func (s *authTokenStore) issue(userId zspecs.UserId, ttl time.Duration) (authTokenSession, error) {
	token, err := generateIdentityToken()
	if err != nil {
		return authTokenSession{}, zerr.Must(err)
	}

	session := authTokenSession{
		Token:    token,
		UserId:   userId,
		ExpireAt: time.Now().Add(ttl),
	}
	s.lock.Lock()
	s.sessions[token.String()] = session
	s.lock.Unlock()
	return session, nil
}

// 描述：根据身份令牌获取会话，如果已过期则自动删除。
func (s *authTokenStore) get(token zspecs.IdentityToken) (authTokenSession, bool) {
	s.lock.RLock()
	session, exists := s.sessions[token.String()]
	s.lock.RUnlock()
	if !exists {
		return authTokenSession{}, false
	}

	if time.Now().After(session.ExpireAt) {
		s.lock.Lock()
		delete(s.sessions, token.String())
		s.lock.Unlock()
		return authTokenSession{}, false
	}
	return session, true
}

// 描述：删除身份令牌会话。
func (s *authTokenStore) revoke(token zspecs.IdentityToken) {
	s.lock.Lock()
	delete(s.sessions, token.String())
	s.lock.Unlock()
}

// 描述：返回两个整数中的较小值。
func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
