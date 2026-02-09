//go:build internal

package configs

import (
	"github.com/gin-gonic/gin"

	zbootstrap "git.zodileap.com/taurus/zodileap_go_zbootstrap"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
)

func init() {
	gin.SetMode(gin.ReleaseMode)
}

var Config = zbootstrap.Config{
	PostgresEnable: false,
	RedisEnable:    false,
	RouterEnable:   true,
	RouterConfig: []zspecs.RouterConfig{
		{
			Name: "zodileap_license",
			Port: ":18080",
		},
	},
	RPCEnable:     false,
	WebHookEnable: false,
}
