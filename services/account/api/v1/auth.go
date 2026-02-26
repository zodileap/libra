package api

import (
	"context"

	service "git.zodileap.com/gemini/zodileap_account/service/v1"
	specs "git.zodileap.com/gemini/zodileap_account/specs/v1"
	zapi "git.zodileap.com/taurus/zodileap_go_zapi"
	zlog "git.zodileap.com/taurus/zodileap_go_zlog"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"github.com/gin-gonic/gin"
)

// 描述：账号鉴权 API。
type AuthAPI struct{}

// 描述：设置账号鉴权 API 的 CORS。
func (i AuthAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

// 描述：设置账号鉴权 API 的中间件。
func (i AuthAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("auth")
}

// 描述：注册账号鉴权 API 路由。
func (i AuthAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseAuth()
	protected := group.Group("")
	protected.Use(authRequiredMiddleware())
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/login", base.login),
		protected.GET("/me", base.me),
		protected.POST("/logout", base.logout),
		protected.GET("/identities", base.identities),
		protected.GET("/permission-templates", base.permissionTemplates),
		protected.GET("/permission-grants", base.permissionGrants),
		protected.POST("/permission-grant", base.grantPermission),
		protected.DELETE("/permission-grant", base.revokePermission),
		protected.GET("/user-agent-accesses", base.userAgentAccessList),
		protected.POST("/user-agent-access", base.grantUserAgentAccess),
		protected.DELETE("/user-agent-access", base.revokeUserAgentAccess),
		protected.GET("/available-agents", base.availableAgents),
	}
}

// 描述：账号鉴权基础 API 实现。
type BaseAuth struct {
	Auth *service.AuthService
}

// 描述：创建账号鉴权基础 API 实例。
func NewBaseAuth() *BaseAuth {
	return &BaseAuth{
		Auth: service.NewAuthService(),
	}
}

// 描述：账号密码登录。
func (api *BaseAuth) login(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "login")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthLoginReq) zapi.Result {
			resp, err := api.Auth.Login(req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：获取当前登录用户信息。
func (api *BaseAuth) me(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "me")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req struct{}) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.GetCurrentUser(userID)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：登出并使当前令牌失效。
func (api *BaseAuth) logout(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "logout")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		[]zapi.Feature{
			{Name: zspecs.API_ALLOW_EMPTY_JSON},
		},
		zstatuscode.Global_API_DeleteFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthLogoutReq) zapi.Result {
			_, token, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.Logout(token)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：获取当前用户身份列表。
func (api *BaseAuth) identities(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "identities")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req struct{}) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.ListUserIdentities(userID)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：获取权限模板列表。
func (api *BaseAuth) permissionTemplates(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "permissionTemplates")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req struct{}) zapi.Result {
			resp, err := api.Auth.ListPermissionTemplates()
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：获取权限授权记录列表。
func (api *BaseAuth) permissionGrants(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "permissionGrants")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthPermissionGrantListReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.ListPermissionGrants(userID, req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：新增权限授权记录。
func (api *BaseAuth) grantPermission(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "grantPermission")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthGrantPermissionReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.GrantPermission(userID, req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：撤销权限授权记录。
func (api *BaseAuth) revokePermission(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "revokePermission")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithDelete(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_DeleteFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthRevokePermissionReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.RevokePermission(userID, req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：获取当前用户智能体授权关系列表。
func (api *BaseAuth) userAgentAccessList(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "userAgentAccessList")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthUserAgentAccessListReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.GetUserAgentAccessList(userID, req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：新增或更新当前用户智能体授权关系。
func (api *BaseAuth) grantUserAgentAccess(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "grantUserAgentAccess")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthGrantUserAgentAccessReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.GrantUserAgentAccess(userID, req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：删除当前用户智能体授权关系。
func (api *BaseAuth) revokeUserAgentAccess(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "revokeUserAgentAccess")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithDelete(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_DeleteFailed,
		func(headerParam zapi.HeaderParam, req specs.AuthRevokeUserAgentAccessReq) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.RevokeUserAgentAccess(userID, req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：获取当前用户可用智能体列表。
func (api *BaseAuth) availableAgents(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseAuth", "availableAgents")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req struct{}) zapi.Result {
			userID, _, err := readAuthContext(c)
			if err != nil {
				return zapi.Result{Err: err}
			}
			resp, err := api.Auth.GetAvailableAgents(userID)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}
