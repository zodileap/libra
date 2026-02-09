package api

import (
	"github.com/gin-gonic/gin"
)

type FrameworkAssetAPI struct{}

func (i FrameworkAssetAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i FrameworkAssetAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("framework-asset")
}

func (i FrameworkAssetAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseFrameworkAsset()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/framework-asset", base.create),
		group.GET("/framework-asset", base.get),
		group.GET("/framework-assets", base.getList),
		group.PUT("/framework-asset", base.update),
		group.DELETE("/framework-asset", base.delete),
	}
}

type ComponentAssetAPI struct{}

func (i ComponentAssetAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ComponentAssetAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("component-asset")
}

func (i ComponentAssetAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseComponentAsset()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/component-asset", base.create),
		group.GET("/component-asset", base.get),
		group.GET("/component-assets", base.getList),
		group.PUT("/component-asset", base.update),
		group.DELETE("/component-asset", base.delete),
	}
}

type ModuleAssetAPI struct{}

func (i ModuleAssetAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ModuleAssetAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("module-asset")
}

func (i ModuleAssetAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseModuleAsset()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/module-asset", base.create),
		group.GET("/module-asset", base.get),
		group.GET("/module-assets", base.getList),
		group.PUT("/module-asset", base.update),
		group.DELETE("/module-asset", base.delete),
	}
}
