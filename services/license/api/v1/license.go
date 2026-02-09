package api

import (
	"github.com/gin-gonic/gin"
)

type ActivationRecordAPI struct{}

func (i ActivationRecordAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ActivationRecordAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("activation-record")
}

func (i ActivationRecordAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseActivationRecord()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/activation-record", base.create),
		group.GET("/activation-record", base.get),
		group.GET("/activation-records", base.getList),
		group.PUT("/activation-record", base.update),
		group.DELETE("/activation-record", base.delete),
	}
}

type ActivationCodeAPI struct{}

func (i ActivationCodeAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i ActivationCodeAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("activation-code")
}

func (i ActivationCodeAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseActivationCode()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/activation-code", base.create),
		group.GET("/activation-code", base.get),
		group.GET("/activation-codes", base.getList),
		group.PUT("/activation-code", base.update),
		group.DELETE("/activation-code", base.delete),
	}
}
