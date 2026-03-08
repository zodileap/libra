package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

const (
	// 描述：setup 调用 account bootstrap 接口时复用的请求头键名。
	bootstrapTokenHeader = "X-Libra-Bootstrap-Token"
)

// 描述：account bootstrap 状态返回结构，供 setup 服务判断管理员初始化情况。
type AccountBootstrapStatus struct {
	Available   bool
	Initialized bool
	AdminUserID string
	Message     string
}

// 描述：账号服务客户端接口，便于在测试中替换为桩实现。
type AccountClient interface {
	BootstrapStatus() (AccountBootstrapStatus, error)
	BootstrapAdmin(specs.SetupAdminReq) (specs.SetupAdminSummary, bool, error)
}

// 描述：account 服务统一响应包结构。
type accountEnvelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：基于 HTTP 的 account 服务客户端实现。
type HTTPAccountClient struct {
	baseURL    string
	setupToken string
	client     *http.Client
}

// 描述：创建 account HTTP 客户端，未显式提供 client 时使用带超时的默认客户端。
func NewHTTPAccountClient(baseURL string, setupToken string, client *http.Client) *HTTPAccountClient {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &HTTPAccountClient{baseURL: strings.TrimRight(baseURL, "/"), setupToken: strings.TrimSpace(setupToken), client: client}
}

// 描述：读取 account bootstrap 状态，并转换为 setup 服务可消费的结构。
func (c *HTTPAccountClient) BootstrapStatus() (AccountBootstrapStatus, error) {
	request, err := http.NewRequest(http.MethodGet, c.baseURL+"/auth/v1/bootstrap-status", nil)
	if err != nil {
		return AccountBootstrapStatus{}, newInternalError("创建 account 状态请求失败", err)
	}
	response, err := c.client.Do(request)
	if err != nil {
		return AccountBootstrapStatus{}, NewDependencyError("无法连接 account 服务，请确认服务已启动。", err)
	}
	defer response.Body.Close()

	var payload accountEnvelope[struct {
		Initialized bool   `json:"initialized"`
		AdminUserID string `json:"adminUserId"`
	}]
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return AccountBootstrapStatus{}, NewDependencyError("解析 account 状态响应失败。", err)
	}
	if response.StatusCode != http.StatusOK || payload.Code != 200 {
		message := payload.Message
		if strings.TrimSpace(message) == "" {
			message = "读取 account 初始化状态失败。"
		}
		return AccountBootstrapStatus{}, NewDependencyError(message, nil)
	}
	return AccountBootstrapStatus{
		Available:   true,
		Initialized: payload.Data.Initialized,
		AdminUserID: payload.Data.AdminUserID,
	}, nil
}

// 描述：调用 account bootstrap-admin 接口创建首个管理员，并返回管理员摘要。
func (c *HTTPAccountClient) BootstrapAdmin(req specs.SetupAdminReq) (specs.SetupAdminSummary, bool, error) {
	payload, err := json.Marshal(map[string]string{
		"name":             strings.TrimSpace(req.Name),
		"email":            strings.TrimSpace(req.Email),
		"password":         req.Password,
		"organizationName": strings.TrimSpace(req.OrganizationName),
	})
	if err != nil {
		return specs.SetupAdminSummary{}, false, newInternalError("编码管理员创建请求失败", err)
	}
	request, err := http.NewRequest(http.MethodPost, c.baseURL+"/auth/v1/bootstrap-admin", bytes.NewBuffer(payload))
	if err != nil {
		return specs.SetupAdminSummary{}, false, newInternalError("创建 account 管理员请求失败", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if c.setupToken != "" {
		request.Header.Set(bootstrapTokenHeader, c.setupToken)
	}

	response, err := c.client.Do(request)
	if err != nil {
		return specs.SetupAdminSummary{}, false, NewDependencyError("无法连接 account 服务，请确认服务已启动。", err)
	}
	defer response.Body.Close()

	var result accountEnvelope[struct {
		Created bool `json:"created"`
		User    struct {
			ID    string `json:"id"`
			Name  string `json:"name"`
			Email string `json:"email"`
		} `json:"user"`
	}]
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return specs.SetupAdminSummary{}, false, NewDependencyError("解析 account 管理员创建响应失败。", err)
	}
	if response.StatusCode != http.StatusOK || result.Code != 200 {
		message := strings.TrimSpace(result.Message)
		if message == "" {
			message = fmt.Sprintf("account 服务返回异常状态: %d", response.StatusCode)
		}
		return specs.SetupAdminSummary{}, false, NewDependencyError(message, nil)
	}
	return specs.SetupAdminSummary{
		AdminUserID: result.Data.User.ID,
		Name:        result.Data.User.Name,
		Email:       result.Data.User.Email,
	}, result.Data.Created, nil
}
