package api

import (
	"github.com/gin-gonic/gin"
)

type AgentAccessAPI struct{}

func (i AgentAccessAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i AgentAccessAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("agent-access")
}

func (i AgentAccessAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseAgentAccess()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/agent-access", base.create),
		group.GET("/agent-access", base.get),
		group.GET("/agent-accesses", base.getList),
		group.PUT("/agent-access", base.update),
		group.DELETE("/agent-access", base.delete),
	}
}

type AgentAPI struct{}

func (i AgentAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i AgentAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("agent")
}

func (i AgentAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseAgent()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/agent", base.create),
		group.GET("/agent", base.get),
		group.GET("/agents", base.getList),
		group.PUT("/agent", base.update),
		group.DELETE("/agent", base.delete),
	}
}

type UserAPI struct{}

func (i UserAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i UserAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("user")
}

func (i UserAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseUser()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/user", base.create),
		group.GET("/user", base.get),
		group.GET("/users", base.getList),
		group.PUT("/user", base.update),
		group.DELETE("/user", base.delete),
	}
}
