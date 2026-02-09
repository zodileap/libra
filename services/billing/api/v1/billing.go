package api

import (
	"github.com/gin-gonic/gin"
)

type OrderInfoAPI struct{}

func (i OrderInfoAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i OrderInfoAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("order-info")
}

func (i OrderInfoAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseOrderInfo()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/order-info", base.create),
		group.GET("/order-info", base.get),
		group.GET("/order-infos", base.getList),
		group.PUT("/order-info", base.update),
		group.DELETE("/order-info", base.delete),
	}
}

type OrderItemAPI struct{}

func (i OrderItemAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i OrderItemAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("order-item")
}

func (i OrderItemAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseOrderItem()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/order-item", base.create),
		group.GET("/order-item", base.get),
		group.GET("/order-items", base.getList),
		group.PUT("/order-item", base.update),
		group.DELETE("/order-item", base.delete),
	}
}

type SubscriptionAPI struct{}

func (i SubscriptionAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i SubscriptionAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("subscription")
}

func (i SubscriptionAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseSubscription()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/subscription", base.create),
		group.GET("/subscription", base.get),
		group.GET("/subscriptions", base.getList),
		group.PUT("/subscription", base.update),
		group.DELETE("/subscription", base.delete),
	}
}
