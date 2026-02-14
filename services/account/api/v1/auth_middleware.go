package api

import (
	"context"

	service "git.zodileap.com/gemini/zodileap_account/service/v1"
	zapi "git.zodileap.com/taurus/zodileap_go_zapi"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zlog "git.zodileap.com/taurus/zodileap_go_zlog"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"github.com/gin-gonic/gin"
)

const (
	// 描述：鉴权中间件写入 gin 上下文的用户ID键。
	authContextUserIDKey = "auth.userId"
	// 描述：鉴权中间件写入 gin 上下文的令牌键。
	authContextTokenKey = "auth.token"
)

// 描述：受保护路由鉴权中间件。
func authRequiredMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		processName := zlog.NewProcessName("api", "auth", "authRequiredMiddleware")
		ctx := zlog.WithLogProcess(context.Background(), processName)

		authService := service.NewAuthService()
		session, err := authService.VerifyToken(c.GetHeader(zspecs.API_H_IDENTITYTOKEN.String()))
		if err != nil {
			zapi.SanitizeForMiddleware(c, ctx, err, zstatuscode.Global_Info_IdentityTokenInvalid)
			return
		}

		c.Set(authContextUserIDKey, session.UserId.String())
		c.Set(authContextTokenKey, session.Token.String())
		c.Next()
	}
}

// 描述：从 gin 上下文读取鉴权后的用户与令牌信息。
func readAuthContext(c *gin.Context) (zspecs.UserId, zspecs.IdentityToken, error) {
	userIDRaw, exists := c.Get(authContextUserIDKey)
	if !exists {
		return "", "", newAuthContextError("鉴权上下文缺少用户ID")
	}
	tokenRaw, exists := c.Get(authContextTokenKey)
	if !exists {
		return "", "", newAuthContextError("鉴权上下文缺少身份令牌")
	}

	userID, ok := userIDRaw.(string)
	if !ok {
		return "", "", newAuthContextError("鉴权上下文用户ID类型错误")
	}
	token, ok := tokenRaw.(string)
	if !ok {
		return "", "", newAuthContextError("鉴权上下文令牌类型错误")
	}

	userSpec := zspecs.NewUserId(userID)
	if valid, msg := userSpec.Validate(); !valid {
		return "", "", newAuthContextError("鉴权上下文用户ID无效: " + msg)
	}
	tokenSpec := zspecs.NewIdentityToken(token)
	if valid, msg := tokenSpec.Validate(); !valid {
		return "", "", newAuthContextError("鉴权上下文令牌无效: " + msg)
	}
	return *userSpec, *tokenSpec, nil
}

// 描述：构建鉴权上下文相关错误。
func newAuthContextError(msg string) error {
	err := zerr.New("1010011017", msg, 4, msg)
	err.StatuCode = zstatuscode.Global_Info_IdentityTokenInvalid.New()
	return err
}
