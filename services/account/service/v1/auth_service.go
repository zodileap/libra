package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"
	"sync"
	"time"

	account "git.zodileap.com/entity/account_v1/instance"
	specs "git.zodileap.com/gemini/zodileap_account/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"golang.org/x/crypto/bcrypt"
)

const (
	// 描述：账号服务内置身份令牌默认有效期。
	defaultAuthTokenTTL = 24 * time.Hour
)

var (
	// 描述：账号服务内置身份令牌存储，当前阶段使用内存实现。
	globalAuthTokenStore = newAuthTokenStore()
)

// 描述：鉴权会话信息。
type AuthSessionInfo struct {
	Token    zspecs.IdentityToken // 当前会话令牌
	UserId   zspecs.UserId        // 当前会话用户ID
	ExpireAt zspecs.ExpireAt      // 当前会话过期时间
}

// 描述：账号与鉴权服务，负责登录、会话校验、授权关系与可用智能体查询。
type AuthService struct {
	User        *account.User
	Agent       *account.Agent
	AgentAccess *account.AgentAccess
	tokenStore  *authTokenStore
	tokenTTL    time.Duration
}

// 描述：创建账号与鉴权服务实例。
//
// Returns:
//
//   - 0: 鉴权服务实例。
func NewAuthService() *AuthService {
	return &AuthService{
		User:        account.NewUser(),
		Agent:       account.NewAgent(),
		AgentAccess: account.NewAgentAccess(),
		tokenStore:  globalAuthTokenStore,
		tokenTTL:    defaultAuthTokenTTL,
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

// 描述：构建业务错误并绑定状态码。
func newAuthBizError(code string, statusCode *zstatuscode.StatusCode, msg string) error {
	err := zerr.New(code, msg, 4, msg)
	err.StatuCode = statusCode
	return err
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
