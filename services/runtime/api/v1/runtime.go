package api

import (
	"github.com/gin-gonic/gin"
)

type AgentSessionAPI struct{}

func (i AgentSessionAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i AgentSessionAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("agent-session")
}

func (i AgentSessionAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseAgentSession()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/agent-session", base.create),
		group.GET("/agent-session", base.get),
		group.GET("/agent-sessions", base.getList),
		group.PUT("/agent-session", base.update),
		group.DELETE("/agent-session", base.delete),
	}
}

type PreviewEndpointAPI struct{}

func (i PreviewEndpointAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i PreviewEndpointAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("preview-endpoint")
}

func (i PreviewEndpointAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBasePreviewEndpoint()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/preview-endpoint", base.create),
		group.GET("/preview-endpoint", base.get),
		group.GET("/preview-endpoints", base.getList),
		group.PUT("/preview-endpoint", base.update),
		group.DELETE("/preview-endpoint", base.delete),
	}
}

type SandboxInstanceAPI struct{}

func (i SandboxInstanceAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i SandboxInstanceAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("sandbox-instance")
}

func (i SandboxInstanceAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseSandboxInstance()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/sandbox-instance", base.create),
		group.GET("/sandbox-instance", base.get),
		group.GET("/sandbox-instances", base.getList),
		group.PUT("/sandbox-instance", base.update),
		group.DELETE("/sandbox-instance", base.delete),
	}
}
