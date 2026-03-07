package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	configs "github.com/zodileap/libra/services/runtime/configs"
	service "github.com/zodileap/libra/services/runtime/service/v1"
)

// 描述：统一响应包结构，保持与 Desktop 现有后端解析逻辑兼容。
type envelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：运行时 HTTP 服务器，负责路由注册、请求解析和统一响应输出。
type Server struct {
	workflow       *service.WorkflowService
	allowedOrigins []string
}

// 描述：按配置创建运行时 HTTP 处理器。
func NewHandler(cfg configs.Config) (http.Handler, error) {
	workflow, err := service.NewWorkflowService(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	server := &Server{
		workflow:       workflow,
		allowedOrigins: cfg.AllowedOrigins,
	}
	mux := http.NewServeMux()
	server.registerRoutes(mux)
	return server.withMiddleware(mux), nil
}

// 描述：注册 runtime 对外暴露的工作流路由。
func (s *Server) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/workflow/v1/session", s.handleSession)
	mux.HandleFunc("/workflow/v1/sessions", s.handleSessionList)
	mux.HandleFunc("/workflow/v1/session/status", s.handleSessionStatus)
	mux.HandleFunc("/workflow/v1/session/message", s.handleSessionMessage)
	mux.HandleFunc("/workflow/v1/session/messages", s.handleSessionMessageList)
	mux.HandleFunc("/workflow/v1/sandbox", s.handleSandbox)
	mux.HandleFunc("/workflow/v1/preview", s.handlePreview)
	mux.HandleFunc("/workflow/v1/desktop-update/check", s.handleDesktopUpdateCheck)
}

// 描述：为所有路由统一附加 CORS、内容类型和基础访问日志。
func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.applyCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		log.Printf("[runtime] %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// 描述：写入跨域响应头，默认放开桌面端和本地前端联调来源。
func (s *Server) applyCORSHeaders(w http.ResponseWriter, r *http.Request) {
	origin := "*"
	if len(s.allowedOrigins) > 0 && s.allowedOrigins[0] != "*" {
		requestOrigin := strings.TrimSpace(r.Header.Get("Origin"))
		origin = s.allowedOrigins[0]
		for _, allowed := range s.allowedOrigins {
			if requestOrigin != "" && requestOrigin == allowed {
				origin = requestOrigin
				break
			}
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Origin")
	w.Header().Set("Content-Type", "application/json")
}

// 描述：解析 JSON 请求体，并在失败时返回用户友好的参数错误。
func decodeJSON[T any](r *http.Request) (T, error) {
	var body T
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return body, service.NewDecodeError(err)
	}
	return body, nil
}

// 描述：输出成功响应，统一使用 code=200 包裹业务数据。
func writeSuccess[T any](w http.ResponseWriter, data T) {
	writeJSON(w, http.StatusOK, envelope[T]{Code: 200, Message: "ok", Data: data})
}

// 描述：输出错误响应，并根据服务错误类型回填 HTTP 状态与业务码。
func writeError(w http.ResponseWriter, err error) {
	httpStatus := http.StatusInternalServerError
	code := 500001
	message := "服务暂时不可用，请稍后重试。"
	if serviceErr, ok := err.(*service.ServiceError); ok {
		httpStatus = serviceErr.HTTPStatus
		code = serviceErr.Code
		message = serviceErr.Message
	}
	writeJSON(w, httpStatus, envelope[map[string]any]{Code: code, Message: message, Data: map[string]any{}})
}

// 描述：将任意响应对象编码为 JSON；编码失败时兜底返回纯状态码。
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[runtime] write json failed: %v", err)
	}
}

// 描述：限制路由允许的方法，避免同一路径意外接收错误 HTTP 动作。
func allowMethod(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, method := range methods {
		if r.Method == method {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ","))
	writeError(w, service.NewMethodNotAllowedError(r.Method))
	return false
}

// 描述：解析可选整型查询参数，空值时返回 nil。
func optionalQueryInt(r *http.Request, key string) (*int, error) {
	text := strings.TrimSpace(r.URL.Query().Get(key))
	if text == "" {
		return nil, nil
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return nil, service.NewInvalidQueryError(key)
	}
	return &value, nil
}

// 描述：解析可选整型秒数查询参数，空值时返回 nil。
func optionalQueryInt64(r *http.Request, key string) (*int64, error) {
	text := strings.TrimSpace(r.URL.Query().Get(key))
	if text == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return nil, service.NewInvalidQueryError(key)
	}
	return &value, nil
}

// 描述：解析可选字符串查询参数，空值时返回 nil。
func optionalQueryString(r *http.Request, key string) *string {
	text := strings.TrimSpace(r.URL.Query().Get(key))
	if text == "" {
		return nil
	}
	return &text
}
