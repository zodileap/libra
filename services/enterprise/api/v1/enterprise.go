package api

import (
	"github.com/gin-gonic/gin"
)

type EnterpriseRoleAPI struct{}

func (i EnterpriseRoleAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i EnterpriseRoleAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("enterprise-role")
}

func (i EnterpriseRoleAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseEnterpriseRole()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/enterprise-role", base.create),
		group.GET("/enterprise-role", base.get),
		group.GET("/enterprise-roles", base.getList),
		group.PUT("/enterprise-role", base.update),
		group.DELETE("/enterprise-role", base.delete),
	}
}

type EnterpriseMemberAPI struct{}

func (i EnterpriseMemberAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i EnterpriseMemberAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("enterprise-member")
}

func (i EnterpriseMemberAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseEnterpriseMember()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/enterprise-member", base.create),
		group.GET("/enterprise-member", base.get),
		group.GET("/enterprise-members", base.getList),
		group.PUT("/enterprise-member", base.update),
		group.DELETE("/enterprise-member", base.delete),
	}
}

type EnterpriseAPI struct{}

func (i EnterpriseAPI) SetCors() gin.HandlerFunc {
	return defaultCors()
}

func (i EnterpriseAPI) SetMiddleware() []gin.HandlerFunc {
	return defaultMiddleware("enterprise")
}

func (i EnterpriseAPI) SetRouter(group *gin.RouterGroup) []gin.IRoutes {
	base := NewBaseEnterprise()
	return []gin.IRoutes{
		group.OPTIONS("/*path", handleOptions),
		group.POST("/enterprise", base.create),
		group.GET("/enterprise", base.get),
		group.GET("/enterprises", base.getList),
		group.PUT("/enterprise", base.update),
		group.DELETE("/enterprise", base.delete),
	}
}
