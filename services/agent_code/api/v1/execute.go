package api

import (
	"context"

	service "git.zodileap.com/gemini/libra_agent_code/service/v1"
	specs "git.zodileap.com/gemini/libra_agent_code/specs/v1"
	zapi "git.zodileap.com/taurus/zodileap_go_zapi"
	zlog "git.zodileap.com/taurus/zodileap_go_zlog"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"github.com/gin-gonic/gin"
)

// 描述：代码智能体执行入口 API。
type ExecuteAPI struct{}

// 描述：设置执行入口 API 的 CORS。
func (i ExecuteAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

// 描述：设置执行入口 API 的中间件。
func (i ExecuteAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("execute")
}

// 描述：注册执行入口 API 路由。
func (i ExecuteAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseExecute()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/execute", base.execute),
		group.GET("/execute", base.getExecuteResult),
	}
}

// 描述：代码智能体执行入口基础 API。
type BaseExecute struct {
	Execute *service.ExecuteService
}

// 描述：创建代码智能体执行入口基础 API 实例。
func NewBaseExecute() *BaseExecute {
	return &BaseExecute{
		Execute: service.NewExecuteService(),
	}
}

// 描述：执行代码智能体任务。
func (api *BaseExecute) execute(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseExecute", "execute")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithPost(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_CreateFailed,
		func(headerParam zapi.HeaderParam, req specs.CodeExecuteReq) zapi.Result {
			resp, err := api.Execute.Execute(req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}

// 描述：查询代码智能体执行结果。
func (api *BaseExecute) getExecuteResult(c *gin.Context) {
	processName := zlog.NewProcessName("api", "BaseExecute", "getExecuteResult")
	ctx := zlog.WithLogProcess(context.Background(), processName)
	zapi.WithGet(
		c,
		ctx,
		nil,
		zstatuscode.Global_API_GetFailed,
		func(headerParam zapi.HeaderParam, req specs.CodeExecuteGetReq) zapi.Result {
			resp, err := api.Execute.GetExecuteResult(req)
			return zapi.Result{
				Resp: resp,
				Err:  err,
			}
		},
	)
}
