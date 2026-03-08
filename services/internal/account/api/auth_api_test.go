package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	configs "github.com/zodileap/libra/services/internal/account/configs"
)

// 描述：测试用统一响应包结构，用于反序列化业务响应。
type apiResponse[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：启动测试用账号服务，统一使用临时数据目录保证隔离。
func newTestServer(t *testing.T, bootstrapToken string) *httptest.Server {
	t.Helper()
	handler, err := NewHandler(configs.Config{
		DataDir:        t.TempDir(),
		AllowedOrigins: []string{"*"},
		TokenTTL:       time.Hour,
		BootstrapToken: bootstrapToken,
	})
	if err != nil {
		t.Fatalf("创建测试 handler 失败: %v", err)
	}
	return httptest.NewServer(handler)
}

// 描述：发送 JSON 请求并返回 HTTP 响应，统一处理 Content-Type 与附加请求头。
func doJSONRequest(t *testing.T, client *http.Client, method string, url string, body string, headers map[string]string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("创建请求失败: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("发送请求失败: %v", err)
	}
	return response
}

// 描述：解码 API 响应并在失败时输出原始响应体，方便排查断言错误。
func decodeResponse[T any](t *testing.T, response *http.Response) apiResponse[T] {
	t.Helper()
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("读取响应体失败: %v", err)
	}
	var resp apiResponse[T]
	if err := json.Unmarshal(payload, &resp); err != nil {
		t.Fatalf("响应反序列化失败: %v, body=%s", err, string(payload))
	}
	return resp
}

// 描述：校验 bootstrap 状态和管理员创建接口行为。
func TestBootstrapFlow(t *testing.T) {
	t.Parallel()

	server := newTestServer(t, "setup-token")
	defer server.Close()
	client := server.Client()

	statusResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/bootstrap-status", "", nil)
	if statusResp.StatusCode != http.StatusOK {
		t.Fatalf("bootstrap-status 应返回 200，got=%d", statusResp.StatusCode)
	}
	statusPayload := decodeResponse[struct {
		Initialized bool   `json:"initialized"`
		AdminUserID string `json:"adminUserId"`
	}](t, statusResp)
	if statusPayload.Code != 200 || statusPayload.Data.Initialized {
		t.Fatalf("初始化前 bootstrap 状态应为 false")
	}

	forbiddenResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/bootstrap-admin",
		`{"name":"Admin","email":"admin@example.com","password":"secret123"}`,
		nil,
	)
	if forbiddenResp.StatusCode != http.StatusForbidden {
		t.Fatalf("缺少 bootstrap token 时应返回 403，got=%d", forbiddenResp.StatusCode)
	}

	createResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/bootstrap-admin",
		`{"name":"Admin","email":"admin@example.com","password":"secret123"}`,
		map[string]string{bootstrapTokenHeader: "setup-token"},
	)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("创建管理员应返回 200，got=%d", createResp.StatusCode)
	}
	createPayload := decodeResponse[struct {
		Created bool `json:"created"`
		User    struct {
			Email string `json:"email"`
		} `json:"user"`
	}](t, createResp)
	if createPayload.Code != 200 || !createPayload.Data.Created {
		t.Fatalf("创建管理员后应返回成功")
	}
	if createPayload.Data.User.Email != "admin@example.com" {
		t.Fatalf("管理员邮箱不匹配: %s", createPayload.Data.User.Email)
	}
}

// 描述：校验登录、当前用户、可用智能体和登出链路。
func TestLoginMeAvailableAgentsAndLogout(t *testing.T) {
	t.Parallel()

	server := newTestServer(t, "")
	defer server.Close()
	client := server.Client()

	invalidResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/login",
		`{"email":"invalid","password":"secret123"}`,
		nil,
	)
	if invalidResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("非法邮箱应返回 400，got=%d", invalidResp.StatusCode)
	}
	invalidPayload := decodeResponse[map[string]any](t, invalidResp)
	if invalidPayload.Code != 100002001 {
		t.Fatalf("非法邮箱业务码应为 100002001，got=%d", invalidPayload.Code)
	}

	_ = doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/bootstrap-admin",
		`{"name":"Admin","email":"admin@example.com","password":"secret123"}`,
		nil,
	)

	loginResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/login",
		`{"email":"admin@example.com","password":"secret123"}`,
		nil,
	)
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("登录应返回 200，got=%d", loginResp.StatusCode)
	}
	loginPayload := decodeResponse[struct {
		Token string `json:"token"`
		User  struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}](t, loginResp)
	if loginPayload.Code != 200 || loginPayload.Data.Token == "" {
		t.Fatalf("登录成功后应返回有效 token")
	}

	headers := map[string]string{"Authorization": "Bearer " + loginPayload.Data.Token}
	meResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/me", "", headers)
	if meResp.StatusCode != http.StatusOK {
		t.Fatalf("me 接口应返回 200，got=%d", meResp.StatusCode)
	}
	mePayload := decodeResponse[struct {
		User struct {
			Email string `json:"email"`
		} `json:"user"`
	}](t, meResp)
	if mePayload.Data.User.Email != "admin@example.com" {
		t.Fatalf("me 返回邮箱不匹配: %s", mePayload.Data.User.Email)
	}

	manageableUsersResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/manageable-users", "", headers)
	if manageableUsersResp.StatusCode != http.StatusOK {
		t.Fatalf("manageable-users 应返回 200，got=%d", manageableUsersResp.StatusCode)
	}
	manageableUsersPayload := decodeResponse[struct {
		List []struct {
			UserID string `json:"userId"`
			Self   bool   `json:"self"`
		} `json:"list"`
	}](t, manageableUsersResp)
	if len(manageableUsersPayload.Data.List) != 2 {
		t.Fatalf("可管理用户数量应为 2，got=%d", len(manageableUsersPayload.Data.List))
	}
	if manageableUsersPayload.Data.List[0].Self {
		t.Fatalf("可管理用户列表应优先返回非当前账号用户")
	}

	agentsResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/available-agents", "", headers)
	if agentsResp.StatusCode != http.StatusOK {
		t.Fatalf("available-agents 应返回 200，got=%d", agentsResp.StatusCode)
	}
	agentsPayload := decodeResponse[struct {
		List []struct {
			Code string `json:"code"`
		} `json:"list"`
	}](t, agentsResp)
	if len(agentsPayload.Data.List) != 2 {
		t.Fatalf("默认可用智能体数量应为 2，got=%d", len(agentsPayload.Data.List))
	}

	logoutResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/auth/v1/logout", `{}`, headers)
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("logout 应返回 200，got=%d", logoutResp.StatusCode)
	}

	meAfterLogoutResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/me", "", headers)
	if meAfterLogoutResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("登出后 me 应返回 401，got=%d", meAfterLogoutResp.StatusCode)
	}
	meAfterLogoutPayload := decodeResponse[map[string]any](t, meAfterLogoutResp)
	if meAfterLogoutPayload.Code != 100001001 {
		t.Fatalf("未授权业务码应为 100001001，got=%d", meAfterLogoutPayload.Code)
	}
}

// 描述：校验权限授权新增、查询和撤销流程。
func TestPermissionGrantFlow(t *testing.T) {
	t.Parallel()

	server := newTestServer(t, "")
	defer server.Close()
	client := server.Client()

	_ = doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/bootstrap-admin",
		`{"name":"Admin","email":"admin@example.com","password":"secret123"}`,
		nil,
	)
	loginResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/login",
		`{"email":"admin@example.com","password":"secret123"}`,
		nil,
	)
	loginPayload := decodeResponse[struct {
		Token string `json:"token"`
	}](t, loginResp)
	headers := map[string]string{"Authorization": "Bearer " + loginPayload.Data.Token}

	grantResp := doJSONRequest(
		t,
		client,
		http.MethodPost,
		server.URL+"/auth/v1/permission-grant",
		`{"targetUserId":"123e4567-e89b-12d3-a456-426614174001","targetUserName":"Demo User","permissionCode":"model.access.grant","resourceType":"model","resourceName":"基础模型池"}`,
		headers,
	)
	if grantResp.StatusCode != http.StatusOK {
		t.Fatalf("新增授权应返回 200，got=%d", grantResp.StatusCode)
	}
	grantPayload := decodeResponse[struct {
		Item struct {
			GrantID string `json:"grantId"`
		} `json:"item"`
	}](t, grantResp)
	if grantPayload.Data.Item.GrantID == "" {
		t.Fatalf("新增授权后 grantId 不能为空")
	}

	listResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/auth/v1/permission-grants", "", headers)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("查询授权列表应返回 200，got=%d", listResp.StatusCode)
	}
	listPayload := decodeResponse[struct {
		List []struct {
			GrantID string `json:"grantId"`
		} `json:"list"`
	}](t, listResp)
	if len(listPayload.Data.List) != 1 {
		t.Fatalf("授权列表数量应为 1，got=%d", len(listPayload.Data.List))
	}

	revokeResp := doJSONRequest(
		t,
		client,
		http.MethodDelete,
		server.URL+"/auth/v1/permission-grant",
		`{"grantId":"`+grantPayload.Data.Item.GrantID+`"}`,
		headers,
	)
	if revokeResp.StatusCode != http.StatusOK {
		t.Fatalf("撤销授权应返回 200，got=%d", revokeResp.StatusCode)
	}
	revokePayload := decodeResponse[struct {
		Success bool `json:"success"`
	}](t, revokeResp)
	if !revokePayload.Data.Success {
		t.Fatalf("撤销授权应返回 success=true")
	}
}
