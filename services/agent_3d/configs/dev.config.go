//go:build dev

package configs

import (
	"github.com/gin-gonic/gin"

	zbootstrap "git.zodileap.com/taurus/zodileap_go_zbootstrap"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	tsql "github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"
)

func init() {
	gin.SetMode(gin.DebugMode)
}

var Config = zbootstrap.Config{
	PostgresEnable: true,
	PostgresConfig: []tsql.ConnectionConfig{
		{
			Driver:     dialect.PostgreSQL,
			Tag:        "agent_3d",
			Host:       "localhost",
			Port:       5432,
			User:       "postgres",
			Password:   "",
			DBName:     "zodileap_agent_3d",
			IsVerifyCa: false,
		},
	},
	RedisEnable:    false,
	RouterEnable:   true,
	RouterConfig: []zspecs.RouterConfig{
		{
			Name: "zodileap_agent_3d",
			Port: ":18083",
		},
	},
	RPCEnable:     false,
	WebHookEnable: false,
}
