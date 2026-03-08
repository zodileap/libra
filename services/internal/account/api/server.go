package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	configs "github.com/zodileap/libra/services/internal/account/configs"
	service "github.com/zodileap/libra/services/internal/account/service"
)

const (
	// 描述：首装管理员 bootstrap 接口使用的请求头键名。
	bootstrapTokenHeader = "X-Libra-Bootstrap-Token"
)

// 描述：统一响应包结构，保持与 Web 和 Desktop 现有解析逻辑兼容。
type envelope[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

// 描述：账号服务 HTTP 服务器，负责路由注册、请求解析和统一响应输出。
type Server struct {
	auth           *service.AuthService
	allowedOrigins []string
	bootstrapToken string
}

// 描述：按配置创建账号服务 HTTP 处理器。
func NewHandler(cfg configs.Config) (http.Handler, error) {
	authService, err := service.NewAuthService(cfg.DataDir, cfg.TokenTTL)
	if err != nil {
		return nil, err
	}
	return NewHandlerWithService(cfg, authService), nil
}

// 描述：使用现有账号服务实例创建 HTTP 处理器，便于统一后端入口复用同一组领域能力。
//
// Params:
//
//   - cfg: 账号服务运行配置。
//   - authService: 已构建好的账号服务实例。
//
// Returns:
//
//   - 账号服务 HTTP 处理器。
func NewHandlerWithService(cfg configs.Config, authService *service.AuthService) http.Handler {
	server := &Server{
		auth:           authService,
		allowedOrigins: cfg.AllowedOrigins,
		bootstrapToken: cfg.BootstrapToken,
	}
	mux := http.NewServeMux()
	server.registerRoutes(mux)
	return server.withMiddleware(mux)
}

// 描述：注册账号服务对外暴露的鉴权与 bootstrap 路由。
func (s *Server) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/auth/v1/bootstrap-status", s.handleBootstrapStatus)
	mux.HandleFunc("/auth/v1/bootstrap-admin", s.handleBootstrapAdmin)
	mux.HandleFunc("/auth/v1/login", s.handleLogin)
	mux.HandleFunc("/auth/v1/me", s.handleMe)
	mux.HandleFunc("/auth/v1/logout", s.handleLogout)
	mux.HandleFunc("/auth/v1/identities", s.handleIdentities)
	mux.HandleFunc("/auth/v1/manageable-users", s.handleManageableUsers)
	mux.HandleFunc("/auth/v1/permission-templates", s.handlePermissionTemplates)
	mux.HandleFunc("/auth/v1/permission-grants", s.handlePermissionGrants)
	mux.HandleFunc("/auth/v1/permission-grant", s.handlePermissionGrant)
	mux.HandleFunc("/auth/v1/user-agent-accesses", s.handleUserAgentAccesses)
	mux.HandleFunc("/auth/v1/user-agent-access", s.handleUserAgentAccess)
	mux.HandleFunc("/auth/v1/available-agents", s.handleAvailableAgents)
}

// 描述：统一附加跨域头、内容类型和基础访问日志。
func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.applyCORSHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		log.Printf("[account] %s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// 描述：写入跨域响应头，默认放开全部来源，方便 Web 与 Desktop 联调。
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
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Origin, "+bootstrapTokenHeader)
	w.Header().Set("Content-Type", "application/json")
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
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[account] write json failed: %v", err)
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

// 描述：要求请求中携带有效登录 token，并将用户信息透传到业务处理函数。
func (s *Server) withAuth(w http.ResponseWriter, r *http.Request, next func(http.ResponseWriter, *http.Request, service.AuthSessionInfo)) {
	session, err := s.auth.VerifyToken(r.Header.Get("Authorization"))
	if err != nil {
		writeError(w, err)
		return
	}
	next(w, r, session)
}

// 描述：校验 bootstrap 令牌，未配置时默认放行，便于本地开发。
func (s *Server) requireBootstrapToken(r *http.Request) error {
	if !service.MatchBootstrapToken(s.bootstrapToken, r.Header.Get(bootstrapTokenHeader)) {
		return service.NewForbiddenError("初始化令牌无效，请检查后重试。")
	}
	return nil
}

// 描述：解析可选整型查询参数，空值时返回 nil。
func optionalQueryInt(r *http.Request, key string) (*int, error) {
	text := strings.TrimSpace(r.URL.Query().Get(key))
	if text == "" {
		return nil, nil
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return nil, service.NewInvalidParamError("查询参数格式不正确，请检查后重试。")
	}
	return &value, nil
}
