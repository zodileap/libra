package backend

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 描述：统一后端测试响应包结构，用于断言 account/runtime/setup 三类接口都挂到同一地址。
type backendEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：校验统一后端会在同一地址上暴露 setup 页面、account 初始化状态和 runtime 会话接口。
func TestUnifiedBackendShouldServeAllDomainsOnSingleAddress(t *testing.T) {
	t.Parallel()

	handler := &dispatchHandler{
		account: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(backendEnvelope[map[string]any]{
				Code:    200,
				Message: "ok",
				Data:    map[string]any{"initialized": false},
			})
		}),
		runtime: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(backendEnvelope[map[string]any]{
				Code:    200,
				Message: "ok",
				Data: map[string]any{
					"session": map[string]any{"id": "sess-1"},
				},
			})
		}),
		setup: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html><body>setup</body></html>"))
		}),
	}

	server := httptest.NewServer(handler)
	defer server.Close()

	setupResp, err := server.Client().Get(server.URL + "/setup")
	if err != nil {
		t.Fatalf("请求 /setup 失败: %v", err)
	}
	defer setupResp.Body.Close()
	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("/setup 应返回 200，got=%d", setupResp.StatusCode)
	}

	accountResp, err := server.Client().Get(server.URL + "/auth/v1/bootstrap-status")
	if err != nil {
		t.Fatalf("请求 /auth/v1/bootstrap-status 失败: %v", err)
	}
	defer accountResp.Body.Close()
	if accountResp.StatusCode != http.StatusOK {
		t.Fatalf("/auth/v1/bootstrap-status 应返回 200，got=%d", accountResp.StatusCode)
	}

	payload := bytes.NewBufferString(`{"userId":"u-1","agentCode":"code"}`)
	request, err := http.NewRequest(http.MethodPost, server.URL+"/workflow/v1/session", payload)
	if err != nil {
		t.Fatalf("创建 workflow 请求失败: %v", err)
	}
	request.Header.Set("Content-Type", "application/json")
	workflowResp, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("请求 /workflow/v1/session 失败: %v", err)
	}
	defer workflowResp.Body.Close()
	if workflowResp.StatusCode != http.StatusOK {
		t.Fatalf("/workflow/v1/session 应返回 200，got=%d", workflowResp.StatusCode)
	}

	var sessionPayload backendEnvelope[struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}]
	if err := json.NewDecoder(workflowResp.Body).Decode(&sessionPayload); err != nil {
		t.Fatalf("解析 workflow 响应失败: %v", err)
	}
	if sessionPayload.Data.Session.ID == "" {
		t.Fatalf("workflow 响应应返回有效 session id")
	}
}
