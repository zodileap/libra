package backend

import (
	"net/http"
	"strings"

	accountapi "github.com/zodileap/libra/services/internal/account/api"
	accountconfigs "github.com/zodileap/libra/services/internal/account/configs"
	accountservice "github.com/zodileap/libra/services/internal/account/service"
	accountspecs "github.com/zodileap/libra/services/internal/account/specs"
	runtimeapi "github.com/zodileap/libra/services/internal/runtime/api"
	runtimeconfigs "github.com/zodileap/libra/services/internal/runtime/configs"
	setupapi "github.com/zodileap/libra/services/internal/setup/api"
	setupconfigs "github.com/zodileap/libra/services/internal/setup/configs"
	setupservice "github.com/zodileap/libra/services/internal/setup/service"
	setupspecs "github.com/zodileap/libra/services/internal/setup/specs"
)

// 描述：统一后端 HTTP 处理器，负责把 account/runtime/setup 三个领域路由收敛到同一地址。
type dispatchHandler struct {
	account http.Handler
	runtime http.Handler
	setup   http.Handler
}

// 描述：基于统一后端配置创建单地址 HTTP 处理器。
//
// Params:
//
//   - cfg: 统一后端配置。
//
// Returns:
//
//   - 聚合后的 HTTP 处理器。
func NewHandler(cfg Config) (http.Handler, error) {
	authService, err := accountservice.NewAuthService(cfg.AccountDataDir, cfg.TokenTTL)
	if err != nil {
		return nil, err
	}

	accountHandler := accountapi.NewHandlerWithService(accountconfigs.Config{
		Addr:           cfg.Addr,
		DataDir:        cfg.AccountDataDir,
		AllowedOrigins: cfg.AllowedOrigins,
		TokenTTL:       cfg.TokenTTL,
		BootstrapToken: cfg.BootstrapToken,
	}, authService)

	runtimeHandler, err := runtimeapi.NewHandler(runtimeconfigs.Config{
		Addr:           cfg.Addr,
		DataDir:        cfg.RuntimeDataDir,
		AllowedOrigins: cfg.AllowedOrigins,
	})
	if err != nil {
		return nil, err
	}

	setupDomainService, err := setupservice.NewSetupService(setupservice.SetupServiceOptions{
		DataDir:    cfg.SetupDataDir,
		Version:    cfg.Version,
		SetupToken: cfg.BootstrapToken,
		AccountClient: &localAccountClient{
			auth: authService,
		},
	})
	if err != nil {
		return nil, err
	}

	setupHandler := setupapi.NewHandlerWithService(setupconfigs.Config{
		Addr:           cfg.Addr,
		DataDir:        cfg.SetupDataDir,
		AllowedOrigins: cfg.AllowedOrigins,
		AccountBaseURL: cfg.BaseURL,
		SetupToken:     cfg.BootstrapToken,
		Version:        cfg.Version,
	}, setupDomainService)

	return &dispatchHandler{
		account: accountHandler,
		runtime: runtimeHandler,
		setup:   setupHandler,
	}, nil
}

// 描述：按路径前缀把请求分发到 account、runtime 或 setup 领域处理器。
func (h *dispatchHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case strings.HasPrefix(path, "/auth/v1/"):
		h.account.ServeHTTP(w, r)
	case strings.HasPrefix(path, "/workflow/v1/"):
		h.runtime.ServeHTTP(w, r)
	default:
		h.setup.ServeHTTP(w, r)
	}
}

// 描述：基于共享 account 服务实例实现 setup 需要的管理员初始化客户端，避免统一后端内部再走 HTTP 自调用。
type localAccountClient struct {
	auth *accountservice.AuthService
}

// 描述：返回当前管理员 bootstrap 状态。
func (c *localAccountClient) BootstrapStatus() (setupservice.AccountBootstrapStatus, error) {
	resp, err := c.auth.BootstrapStatus()
	if err != nil {
		return setupservice.AccountBootstrapStatus{}, err
	}
	return setupservice.AccountBootstrapStatus{
		Available:   true,
		Initialized: resp.Initialized,
		AdminUserID: resp.AdminUserID,
	}, nil
}

// 描述：创建首个管理员，并按 setup 领域需要的摘要结构返回结果。
func (c *localAccountClient) BootstrapAdmin(req setupspecs.SetupAdminReq) (setupspecs.SetupAdminSummary, bool, error) {
	resp, err := c.auth.BootstrapAdmin(accountspecs.AuthBootstrapAdminReq{
		Name:             req.Name,
		Email:            req.Email,
		Password:         req.Password,
		OrganizationName: req.OrganizationName,
	})
	if err != nil {
		return setupspecs.SetupAdminSummary{}, false, err
	}
	return setupspecs.SetupAdminSummary{
		AdminUserID: resp.User.ID,
		Name:        resp.User.Name,
		Email:       resp.User.Email,
	}, resp.Created, nil
}
