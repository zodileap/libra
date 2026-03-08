package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	configs "github.com/zodileap/libra/services/internal/runtime/configs"
)

// 描述：校验 workflow 会话与消息接口在独立运行时服务中可用。
func TestWorkflowSessionLifecycle(t *testing.T) {
	t.Parallel()

	handler, err := NewHandler(configs.Config{
		Addr:           ":10002",
		DataDir:        filepath.Join(t.TempDir(), "runtime"),
		AllowedOrigins: []string{"*"},
	})
	if err != nil {
		t.Fatalf("创建 handler 失败: %v", err)
	}

	server := httptest.NewServer(handler)
	defer server.Close()

	createResp := requestJSON[struct {
		Code int `json:"code"`
		Data struct {
			Session struct {
				ID        string `json:"id"`
				UserID    string `json:"user_id"`
				AgentCode string `json:"agent_code"`
				Status    int    `json:"status"`
			} `json:"session"`
		} `json:"data"`
	}](t, server.URL+"/workflow/v1/session", http.MethodPost, `{"userId":"u-1","agentCode":"code"}`)
	if createResp.Code != 200 {
		t.Fatalf("创建会话业务码错误: got=%d", createResp.Code)
	}
	if createResp.Data.Session.UserID != "u-1" || createResp.Data.Session.Status != 1 {
		t.Fatalf("创建会话结果错误: %+v", createResp.Data.Session)
	}

	listResp := requestJSON[struct {
		Code int `json:"code"`
		Data struct {
			List []struct {
				ID string `json:"id"`
			} `json:"list"`
		} `json:"data"`
	}](t, server.URL+"/workflow/v1/sessions?userId=u-1&agentCode=code&status=1", http.MethodGet, "")
	if len(listResp.Data.List) != 1 || listResp.Data.List[0].ID != createResp.Data.Session.ID {
		t.Fatalf("会话列表结果错误: %+v", listResp.Data.List)
	}

	messageResp := requestJSON[struct {
		Code int `json:"code"`
		Data struct {
			Message struct {
				MessageID string `json:"messageId"`
				Content   string `json:"content"`
			} `json:"message"`
		} `json:"data"`
	}](t, server.URL+"/workflow/v1/session/message", http.MethodPost, `{"userId":"u-1","sessionId":"`+createResp.Data.Session.ID+`","role":"user","content":"hello"}`)
	if messageResp.Data.Message.MessageID == "" || messageResp.Data.Message.Content != "hello" {
		t.Fatalf("写入消息结果错误: %+v", messageResp.Data.Message)
	}

	messagesResp := requestJSON[struct {
		Code int `json:"code"`
		Data struct {
			Total int `json:"total"`
			List  []struct {
				Content string `json:"content"`
			} `json:"list"`
		} `json:"data"`
	}](t, server.URL+"/workflow/v1/session/messages?userId=u-1&sessionId="+createResp.Data.Session.ID+"&page=1&pageSize=20", http.MethodGet, "")
	if messagesResp.Data.Total != 1 || len(messagesResp.Data.List) != 1 || messagesResp.Data.List[0].Content != "hello" {
		t.Fatalf("查询消息结果错误: %+v", messagesResp.Data)
	}
}

// 描述：校验桌面端更新检查优先读取新的 LIBRA 环境变量。
func TestWorkflowDesktopUpdateCheckUsesLibraEnv(t *testing.T) {
	t.Setenv("LIBRA_DESKTOP_LATEST_VERSION", "0.2.0")
	t.Setenv("LIBRA_DESKTOP_DOWNLOAD_URL_DARWIN_ARM64_STABLE", "https://example.com/libra-arm64.dmg")
	t.Setenv("LIBRA_DESKTOP_RELEASE_NOTES", "runtime update")
	t.Setenv("LIBRA_DESKTOP_PUBLISHED_AT", "2026-03-07T12:00:00Z")

	handler, err := NewHandler(configs.Config{
		Addr:           ":10002",
		DataDir:        filepath.Join(t.TempDir(), "runtime"),
		AllowedOrigins: []string{"*"},
	})
	if err != nil {
		t.Fatalf("创建 handler 失败: %v", err)
	}

	server := httptest.NewServer(handler)
	defer server.Close()

	resp := requestJSON[struct {
		Code int `json:"code"`
		Data struct {
			HasUpdate     bool   `json:"hasUpdate"`
			LatestVersion string `json:"latestVersion"`
			DownloadURL   string `json:"downloadUrl"`
		} `json:"data"`
	}](t, server.URL+"/workflow/v1/desktop-update/check?platform=darwin&arch=arm64&currentVersion=0.1.0&channel=stable", http.MethodGet, "")
	if !resp.Data.HasUpdate {
		t.Fatalf("应识别到可更新版本: %+v", resp.Data)
	}
	if resp.Data.LatestVersion != "0.2.0" || resp.Data.DownloadURL != "https://example.com/libra-arm64.dmg" {
		t.Fatalf("更新检查结果错误: %+v", resp.Data)
	}
}

// 描述：执行 HTTP 请求并解析 JSON 响应，失败时直接中止测试。
func requestJSON[T any](t *testing.T, url string, method string, body string) T {
	t.Helper()

	var requestBody *strings.Reader
	if body == "" {
		requestBody = strings.NewReader("")
	} else {
		requestBody = strings.NewReader(body)
	}

	req, err := http.NewRequest(method, url, requestBody)
	if err != nil {
		t.Fatalf("创建请求失败: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	var result T
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("解析响应失败: %v", err)
	}
	return result
}
