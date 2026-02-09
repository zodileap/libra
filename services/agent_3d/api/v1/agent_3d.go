package api

import (
	"github.com/gin-gonic/gin"
)

type DccBindingAPI struct{}

func (i DccBindingAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i DccBindingAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("dcc-binding")
}

func (i DccBindingAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseDccBinding()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/dcc-binding", base.create),
		group.GET("/dcc-binding", base.get),
		group.GET("/dcc-bindings", base.getList),
		group.PUT("/dcc-binding", base.update),
		group.DELETE("/dcc-binding", base.delete),
	}
}

type ModelResultAPI struct{}

func (i ModelResultAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ModelResultAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("model-result")
}

func (i ModelResultAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseModelResult()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/model-result", base.create),
		group.GET("/model-result", base.get),
		group.GET("/model-results", base.getList),
		group.PUT("/model-result", base.update),
		group.DELETE("/model-result", base.delete),
	}
}

type ModelTaskAPI struct{}

func (i ModelTaskAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ModelTaskAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("model-task")
}

func (i ModelTaskAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseModelTask()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/model-task", base.create),
		group.GET("/model-task", base.get),
		group.GET("/model-tasks", base.getList),
		group.PUT("/model-task", base.update),
		group.DELETE("/model-task", base.delete),
	}
}
