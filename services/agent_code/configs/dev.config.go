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
			Tag:        "agent_code",
			Host:       "localhost",
			Port:       5432,
			User:       "postgres",
			Password:   "",
			DBName:     "libra_agent_code",
			IsVerifyCa: false,
		},
	},
	RedisEnable:    false,
	RouterEnable:   true,
	RouterConfig: []zspecs.RouterConfig{
		{
			Name: "libra_agent_code",
			Port: ":10003",
		},
	},
	RPCEnable:     false,
	WebHookEnable: false,
}
