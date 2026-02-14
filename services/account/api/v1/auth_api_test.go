package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	"github.com/gin-gonic/gin"
)

type apiResponse struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// 描述：解码通用 API 响应结构。
func decodeAPIResponse(t *testing.T, body []byte) apiResponse {
	t.Helper()
	var resp apiResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("响应反序列化失败: %v, body=%s", err, string(body))
	}
	return resp
}

// 描述：校验鉴权上下文读取逻辑。
func TestReadAuthContext(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	t.Run("缺少用户ID", func(t *testing.T) {
		t.Parallel()
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		_, _, err := readAuthContext(c)
		if err == nil {
			t.Fatalf("缺少用户ID时应返回错误")
		}
	})

	t.Run("读取成功", func(t *testing.T) {
		t.Parallel()
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set(authContextUserIDKey, "123e4567-e89b-12d3-a456-426614174000")
		c.Set(authContextTokenKey, "atk_test_token")

		userID, token, err := readAuthContext(c)
		if err != nil {
			t.Fatalf("读取鉴权上下文失败: %v", err)
		}
		if userID.String() != "123e4567-e89b-12d3-a456-426614174000" {
			t.Fatalf("userId 不匹配: %s", userID.String())
		}
		if token.String() != "atk_test_token" {
			t.Fatalf("token 不匹配: %s", token.String())
		}
	})
}

// 描述：校验鉴权中间件在缺少 token 时的拒绝行为。
func TestAuthRequiredMiddlewareWithoutToken(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.GET("/guard", authRequiredMiddleware(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/guard", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("缺少 token 时应返回 200 业务错误响应，got=%d", rec.Code)
	}
	resp := decodeAPIResponse(t, rec.Body.Bytes())
	if resp.Code != 100001001 {
		t.Fatalf("业务状态码应为 100001001，got=%d", resp.Code)
	}
}

// 描述：校验登录接口在非法邮箱场景下返回参数错误。
func TestBaseAuthLoginInvalidEmail(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	base := NewBaseAuth()
	router := gin.New()
	router.POST("/login", base.login)

	body := []byte(`{"email":"invalid_email","password":"123456"}`)
	req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("登录非法邮箱应返回 200 业务错误响应，got=%d", rec.Code)
	}
	resp := decodeAPIResponse(t, rec.Body.Bytes())
	if resp.Code != 100002001 {
		t.Fatalf("业务状态码应为 100002001，got=%d, body=%s", resp.Code, rec.Body.String())
	}
}

// 描述：校验登出接口在鉴权上下文完整时可以成功返回。
func TestBaseAuthLogoutSuccess(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	base := NewBaseAuth()
	router := gin.New()
	router.POST("/logout", func(c *gin.Context) {
		c.Set(authContextUserIDKey, "123e4567-e89b-12d3-a456-426614174000")
		c.Set(authContextTokenKey, "atk_logout_token")
		base.logout(c)
	})

	req := httptest.NewRequest(http.MethodPost, "/logout", bytes.NewBuffer([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("登出应返回 200，got=%d", rec.Code)
	}
	resp := decodeAPIResponse(t, rec.Body.Bytes())
	if resp.Code != 200 {
		t.Fatalf("业务状态码应为 200，got=%d", resp.Code)
	}

	var data struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		t.Fatalf("登出 data 反序列化失败: %v", err)
	}
	if !data.Success {
		t.Fatalf("登出成功标记应为 true")
	}
}

// 描述：校验 me 接口在缺失鉴权上下文时返回鉴权错误。
func TestBaseAuthMeWithoutAuthContext(t *testing.T) {
	t.Parallel()
	gin.SetMode(gin.TestMode)

	base := NewBaseAuth()
	router := gin.New()
	router.GET("/me", base.me)

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("缺失鉴权上下文时应返回 200 业务错误响应，got=%d", rec.Code)
	}
	resp := decodeAPIResponse(t, rec.Body.Bytes())
	if resp.Code != 100001001 {
		t.Fatalf("业务状态码应为 100001001，got=%d", resp.Code)
	}
}

// 描述：校验 Authorization 头名保持与 zspecs 常量一致。
func TestAuthorizationHeaderName(t *testing.T) {
	t.Parallel()
	if zspecs.API_H_IDENTITYTOKEN.String() != "Authorization" {
		t.Fatalf("Authorization 头常量不匹配")
	}
}
