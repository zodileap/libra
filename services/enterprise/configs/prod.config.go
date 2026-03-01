//go:build prod

package configs

import (
	"github.com/gin-gonic/gin"

	zbootstrap "git.zodileap.com/taurus/zodileap_go_zbootstrap"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	tsql "github.com/zodileap/taurus_go/entity"
	"github.com/zodileap/taurus_go/entity/dialect"
)

func init() {
	gin.SetMode(gin.ReleaseMode)
}

var Config = zbootstrap.Config{
	PostgresEnable: true,
	PostgresConfig: []tsql.ConnectionConfig{
		{
			Driver:     dialect.PostgreSQL,
			Tag:        "enterprise",
			Host:       "localhost",
			Port:       5432,
			User:       "postgres",
			Password:   "",
			DBName:     "zodileap_enterprise",
			IsVerifyCa: false,
		},
	},
	RedisEnable:    false,
	RouterEnable:   true,
	RouterConfig: []zspecs.RouterConfig{
		{
			Name: "zodileap_enterprise",
			Port: ":10007",
		},
	},
	RPCEnable:     false,
	WebHookEnable: false,
}
