package api

import (
	"context"

	service "git.zodileap.com/gemini/zodileap_runtime/service/v1"
	specs "git.zodileap.com/gemini/zodileap_runtime/specs/v1"
	zapi "git.zodileap.com/taurus/zodileap_go_zapi"
	zlog "git.zodileap.com/taurus/zodileap_go_zlog"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"github.com/gin-gonic/gin"
)

// 描述：Runtime 业务工作流 API。
type WorkflowAPI struct{}

// 描述：设置 Runtime 业务工作流 API 的 CORS。
func (i WorkflowAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

// 描述：设置 Runtime 业务工作流 API 的中间件。
func (i WorkflowAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("workflow")
}

// 描述：注册 Runtime 业务工作流路由。
func (i WorkflowAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseWorkflow()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),

		group.POST("/session", base.createSession),
		group.GET("/session", base.getSession),
		group.GET("/sessions", base.listSession),
		group.PUT("/session/status", base.updateSessionStatus),

		group.POST("/session/message", base.createSessionMessage),
		group.GET("/session/messages", base.listSessionMessage),

		group.POST("/sandbox", base.createSandbox),
		group.GET("/sandbox", base.getSandbox),
		group.DELETE("/sandbox", base.recycleSandbox),

		group.POST("/preview", base.createPreview),
		group.GET("/preview", base.getPreview),
		group.DELETE("/preview", base.expirePreview),
	}
}

// 描述：Runtime 业务工作流基础 API。
type BaseWorkflow struct {
	Workflow *service.WorkflowService
}

// 描述：创建 Runtime 业务工作流基础 API 实例。
func NewBaseWorkflow() *BaseWorkflow {
	return &BaseWorkflow{
		Workflow: service.NewWorkflowService(),
	}
}

// 描述：创建会话。
func (api *BaseWorkflow) createSession(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "createSession")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionCreateReq) zapi.Result {
			resp, err := api.Workflow.CreateSession(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：查询会话详情。
func (api *BaseWorkflow) getSession(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "getSession")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionGetReq) zapi.Result {
			resp, err := api.Workflow.GetSession(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：查询会话列表。
func (api *BaseWorkflow) listSession(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "listSession")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionListReq) zapi.Result {
			resp, err := api.Workflow.ListSession(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：更新会话状态。
func (api *BaseWorkflow) updateSessionStatus(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "updateSessionStatus")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPut(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_UpdateFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionStatusUpdateReq) zapi.Result {
			resp, err := api.Workflow.UpdateSessionStatus(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：写入会话消息。
func (api *BaseWorkflow) createSessionMessage(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "createSessionMessage")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionMessageCreateReq) zapi.Result {
			resp, err := api.Workflow.CreateSessionMessage(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：查询会话消息。
func (api *BaseWorkflow) listSessionMessage(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "listSessionMessage")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSessionMessageListReq) zapi.Result {
			resp, err := api.Workflow.ListSessionMessage(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：创建 Sandbox。
func (api *BaseWorkflow) createSandbox(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "createSandbox")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSandboxCreateReq) zapi.Result {
			resp, err := api.Workflow.CreateSandbox(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：查询 Sandbox。
func (api *BaseWorkflow) getSandbox(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "getSandbox")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSandboxGetReq) zapi.Result {
			resp, err := api.Workflow.GetSandbox(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：回收 Sandbox。
func (api *BaseWorkflow) recycleSandbox(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "recycleSandbox")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithDelete(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_DeleteFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowSandboxRecycleReq) zapi.Result {
			resp, err := api.Workflow.RecycleSandbox(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：创建预览地址。
func (api *BaseWorkflow) createPreview(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "createPreview")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowPreviewCreateReq) zapi.Result {
			resp, err := api.Workflow.CreatePreview(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：查询预览地址。
func (api *BaseWorkflow) getPreview(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "getPreview")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowPreviewGetReq) zapi.Result {
			resp, err := api.Workflow.GetPreview(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}

// 描述：让预览地址失效。
func (api *BaseWorkflow) expirePreview(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseWorkflow", "expirePreview")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithDelete(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_DeleteFailed,
		func(headerParam zapi.HeaderParam, req specs.WorkflowPreviewExpireReq) zapi.Result {
			resp, err := api.Workflow.ExpirePreview(req)
			return zapi.Result{Resp: resp, Err: err}
		},
	)
}
