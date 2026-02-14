package api

import (
	"time"

	zapi "git.zodileap.com/taurus/zodileap_go_zapi"
	zlog "git.zodileap.com/taurus/zodileap_go_zlog"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func init() {
	zapi.Register("zodileap_enterprise", "enterprise-role", "v1", &EnterpriseRoleAPI{})
	zapi.Register("zodileap_enterprise", "enterprise-member", "v1", &EnterpriseMemberAPI{})
	zapi.Register("zodileap_enterprise", "enterprise", "v1", &EnterpriseAPI{})
}

func defaultCors() gin.HandlerFunc {
	config := cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}
	return cors.New(config)
}

func defaultMiddleware(module string) []gin.HandlerFunc {
	log := zlog.NewLog(zlog.NewProcessName("api", module))
	return []gin.HandlerFunc{zapi.InfoLoggerMiddleware(log)}
}

func handleOptions(c *gin.Context) {
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
	c.Header("Access-Control-Allow-Headers", "authorization, origin, content-type, accept")
	c.Header("Allow", "HEAD,GET,POST,PUT,PATCH,DELETE,OPTIONS")
	c.Header("Content-Type", "application/json")
	c.AbortWithStatus(204)
}
