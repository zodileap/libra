package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	configs "github.com/zodileap/libra/services/internal/setup/configs"
	service "github.com/zodileap/libra/services/internal/setup/service"
)

// 描述：统一响应包结构，保持与 Web 和 Desktop 现有后端解析逻辑兼容。
type envelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：初始化 HTTP 服务器，负责路由注册、请求解析和统一响应输出。
type Server struct {
	setup          *service.SetupService
	allowedOrigins []string
}

// 描述：按配置创建初始化 HTTP 处理器。
func NewHandler(cfg configs.Config) (http.Handler, error) {
	setupService, err := service.NewSetupService(service.SetupServiceOptions{
		DataDir:        cfg.DataDir,
		Version:        cfg.Version,
		AccountBaseURL: cfg.AccountBaseURL,
		SetupToken:     cfg.SetupToken,
	})
	if err != nil {
		return nil, err
	}
	return NewHandlerWithService(cfg, setupService), nil
}

// 描述：使用指定的 setup 服务实例创建 HTTP 处理器，便于测试注入桩依赖。
func NewHandlerWithService(cfg configs.Config, setupService *service.SetupService) http.Handler {
	server := &Server{setup: setupService, allowedOrigins: cfg.AllowedOrigins}
	mux := http.NewServeMux()
	server.registerRoutes(mux)
	return server.withMiddleware(mux)
}

// 描述：注册初始化服务对外暴露的路由。
func (s *Server) registerRoutes(mux *http.ServeMux) {
	s.registerSetupPageRoutes(mux)
	mux.HandleFunc("/setup/v1/status", s.handleStatus)
	mux.HandleFunc("/setup/v1/database/validate", s.handleDatabaseValidate)
	mux.HandleFunc("/setup/v1/database/migrate", s.handleDatabaseMigrate)
	mux.HandleFunc("/setup/v1/system-config", s.handleSystemConfig)
	mux.HandleFunc("/setup/v1/admin", s.handleAdmin)
	mux.HandleFunc("/setup/v1/finalize", s.handleFinalize)
}

// 描述：统一附加跨域头、内容类型和基础访问日志。
func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.applyCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		log.Printf("[setup] %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// 描述：写入跨域响应头，默认放开全部来源，方便本地 Web 和 Desktop 联调。
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
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Origin")
}

// 描述：解析 JSON 请求体，并在失败时返回统一参数错误。
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
	serviceErr := service.AsServiceError(err)
	writeJSON(w, serviceErr.HTTPStatus, envelope[map[string]any]{
		Code:    serviceErr.Code,
		Message: serviceErr.Message,
		Data:    map[string]any{},
	})
}

// 描述：将任意响应对象编码为 JSON；编码失败时记录日志。
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[setup] write json failed: %v", err)
	}
}

// 描述：限制路由允许的方法，避免同一路径接收错误 HTTP 动作。
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
