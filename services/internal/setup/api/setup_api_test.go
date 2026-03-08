package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	configs "github.com/zodileap/libra/services/internal/setup/configs"
	service "github.com/zodileap/libra/services/internal/setup/service"
	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

// 描述：测试用统一响应包结构，用于反序列化 setup API 响应。
type apiResponse[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：测试用 account 客户端桩，实现初始化状态和管理员创建能力。
type fakeAccountClient struct {
	status service.AccountBootstrapStatus
	admin  specs.SetupAdminSummary
}

// 描述：返回测试用的 account bootstrap 状态。
func (f *fakeAccountClient) BootstrapStatus() (service.AccountBootstrapStatus, error) {
	return f.status, nil
}

// 描述：返回测试用的管理员创建结果。
func (f *fakeAccountClient) BootstrapAdmin(specs.SetupAdminReq) (specs.SetupAdminSummary, bool, error) {
	return f.admin, true, nil
}

// 描述：创建测试用 setup handler，并通过依赖注入绕开真实数据库和真实 account 服务。
func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	setupService, err := service.NewSetupService(service.SetupServiceOptions{
		DataDir: t.TempDir(),
		Version: "0.1.0",
		AccountClient: &fakeAccountClient{
			status: service.AccountBootstrapStatus{Available: true, Initialized: false},
			admin:  specs.SetupAdminSummary{AdminUserID: "usr_admin", Name: "Admin", Email: "admin@example.com"},
		},
		DatabasePinger: func(specs.SetupDatabaseConfigReq) error { return nil },
		MigrationRunner: func(specs.SetupDatabaseConfigReq) ([]string, error) {
			return []string{"CREATE TABLE test"}, nil
		},
		MetadataWriter: func(specs.SetupDatabaseConfigReq, specs.SetupStatusResp) error { return nil },
	})
	if err != nil {
		t.Fatalf("创建测试用 setup 服务失败: %v", err)
	}
	return NewHandlerWithService(configs.Config{AllowedOrigins: []string{"*"}}, setupService)
}

// 描述：发送 JSON 请求并返回 HTTP 响应，统一处理 Content-Type。
func doJSONRequest(t *testing.T, client *http.Client, method string, url string, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("创建请求失败: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
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

// 描述：校验 setup HTTP 接口的完整初始化流程。
func TestSetupApiLifecycle(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(newTestHandler(t))
	defer server.Close()
	client := server.Client()

	statusResp := doJSONRequest(t, client, http.MethodGet, server.URL+"/setup/v1/status", "")
	if statusResp.StatusCode != http.StatusOK {
		t.Fatalf("status 应返回 200，got=%d", statusResp.StatusCode)
	}

	validateResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/database/validate", `{"type":"postgres","host":"127.0.0.1","port":5432,"user":"postgres","password":"secret","database":"libra"}`)
	if validateResp.StatusCode != http.StatusOK {
		t.Fatalf("database validate 应返回 200，got=%d", validateResp.StatusCode)
	}

	migrateResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/database/migrate", `{}`)
	if migrateResp.StatusCode != http.StatusOK {
		t.Fatalf("database migrate 应返回 200，got=%d", migrateResp.StatusCode)
	}

	systemResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/system-config", `{"systemName":"Libra","baseUrl":"http://127.0.0.1:5173","defaultLanguage":"zh-CN","timezone":"Asia/Shanghai","allowPublicSignup":false}`)
	if systemResp.StatusCode != http.StatusOK {
		t.Fatalf("system-config 应返回 200，got=%d", systemResp.StatusCode)
	}

	adminResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/admin", `{"name":"Admin","email":"admin@example.com","password":"secret123","organizationName":"Libra"}`)
	if adminResp.StatusCode != http.StatusOK {
		t.Fatalf("admin 应返回 200，got=%d", adminResp.StatusCode)
	}

	finalizeResp := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/finalize", `{}`)
	if finalizeResp.StatusCode != http.StatusOK {
		t.Fatalf("finalize 应返回 200，got=%d", finalizeResp.StatusCode)
	}
	finalizePayload := decodeResponse[struct {
		Completed bool `json:"completed"`
		Status    struct {
			Installed   bool   `json:"installed"`
			CurrentStep string `json:"currentStep"`
		} `json:"status"`
	}](t, finalizeResp)
	if !finalizePayload.Data.Completed || !finalizePayload.Data.Status.Installed || finalizePayload.Data.Status.CurrentStep != "completed" {
		t.Fatalf("finalize 返回状态不正确: %+v", finalizePayload.Data)
	}
}

// 描述：校验 setup 接口会对非法参数返回用户友好的业务错误。
func TestSetupApiShouldRejectInvalidDatabaseConfig(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(newTestHandler(t))
	defer server.Close()
	client := server.Client()

	response := doJSONRequest(t, client, http.MethodPost, server.URL+"/setup/v1/database/validate", `{"type":"mysql"}`)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("非法数据库配置应返回 400，got=%d", response.StatusCode)
	}
	payload := decodeResponse[map[string]any](t, response)
	if payload.Code != 100002002 {
		t.Fatalf("非法参数业务码应为 100002002，got=%d", payload.Code)
	}
}

// 描述：校验 setup 服务会直接托管初始化 HTML 页面，避免首装时再依赖独立 Web 前端。
func TestSetupPageShouldServeHtml(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(newTestHandler(t))
	defer server.Close()

	response, err := server.Client().Get(server.URL + "/setup")
	if err != nil {
		t.Fatalf("请求 /setup 失败: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("/setup 应返回 200，got=%d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "text/html; charset=utf-8" {
		t.Fatalf("/setup Content-Type 不正确: %s", contentType)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("读取 /setup 响应体失败: %v", err)
	}
	if !bytes.Contains(body, []byte("Libra 初始化")) {
		t.Fatalf("/setup 页面缺少标题文案")
	}
}

// 描述：校验根路径会跳转到后端托管的 `/setup` 页面，简化开源部署的入口地址。
func TestRootShouldRedirectToSetupPage(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(newTestHandler(t))
	defer server.Close()

	client := server.Client()
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}

	response, err := client.Get(server.URL + "/")
	if err != nil {
		t.Fatalf("请求根路径失败: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("根路径应返回 307，got=%d", response.StatusCode)
	}
	if location := response.Header.Get("Location"); location != "/setup" {
		t.Fatalf("根路径应跳转到 /setup，got=%s", location)
	}
}
