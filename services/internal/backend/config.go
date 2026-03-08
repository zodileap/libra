package backend

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 描述：统一后端配置，负责承载单地址服务的监听地址、数据目录和 setup/account 共享参数。
type Config struct {
	Addr           string
	BaseURL        string
	AllowedOrigins []string
	AccountDataDir string
	RuntimeDataDir string
	SetupDataDir   string
	TokenTTL       time.Duration
	BootstrapToken string
	Version        string
}

// 描述：从环境变量加载统一后端配置，并为开源单服务模式提供默认值。
//
// Returns:
//
//   - 单地址后端运行配置。
func Load() Config {
	port := normalizePort(os.Getenv("LIBRA_BACKEND_PORT"), "10001")
	host := normalizeHost(os.Getenv("LIBRA_BACKEND_HOST"), "127.0.0.1")
	dataRoot := strings.TrimSpace(os.Getenv("LIBRA_BACKEND_DATA_DIR"))
	if dataRoot == "" {
		dataRoot = filepath.Join(".", "data")
	}
	version := strings.TrimSpace(os.Getenv("LIBRA_SETUP_VERSION"))
	if version == "" {
		version = "0.1.0"
	}

	return Config{
		Addr:           ":" + port,
		BaseURL:        strings.TrimRight(resolveBaseURL(host, port, os.Getenv("LIBRA_BACKEND_BASE_URL")), "/"),
		AllowedOrigins: parseAllowedOrigins(os.Getenv("LIBRA_BACKEND_ALLOWED_ORIGINS")),
		AccountDataDir: resolveDataDir(dataRoot, "account", os.Getenv("LIBRA_ACCOUNT_DATA_DIR")),
		RuntimeDataDir: resolveDataDir(dataRoot, "runtime", os.Getenv("LIBRA_RUNTIME_DATA_DIR")),
		SetupDataDir:   resolveDataDir(dataRoot, "setup", os.Getenv("LIBRA_SETUP_DATA_DIR")),
		TokenTTL:       parseTokenTTL(os.Getenv("LIBRA_ACCOUNT_TOKEN_TTL_SECONDS"), 24*time.Hour),
		BootstrapToken: resolveBootstrapToken(),
		Version:        version,
	}
}

// 描述：解析统一后端地址，优先使用显式 base URL，否则按 host + port 组装。
func resolveBaseURL(host string, port string, rawBaseURL string) string {
	text := strings.TrimSpace(rawBaseURL)
	if text != "" {
		return text
	}
	return "http://" + host + ":" + port
}

// 描述：解析各领域数据目录；显式配置优先，否则挂到统一 data 根目录下。
func resolveDataDir(root string, domain string, raw string) string {
	text := strings.TrimSpace(raw)
	if text != "" {
		return text
	}
	return filepath.Join(root, domain)
}

// 描述：解析 bootstrap token，优先使用 setup 专用变量，其次兼容旧 account 变量。
func resolveBootstrapToken() string {
	if token := strings.TrimSpace(os.Getenv("LIBRA_SETUP_TOKEN")); token != "" {
		return token
	}
	return strings.TrimSpace(os.Getenv("LIBRA_ACCOUNT_BOOTSTRAP_TOKEN"))
}

// 描述：归一化监听端口，支持 `10001` 或 `:10001` 两种输入。
func normalizePort(raw string, fallback string) string {
	port := strings.TrimSpace(raw)
	if port == "" {
		return fallback
	}
	return strings.TrimPrefix(port, ":")
}

// 描述：归一化监听主机，空值时回退到本地回环地址。
func normalizeHost(raw string, fallback string) string {
	host := strings.TrimSpace(raw)
	if host == "" {
		return fallback
	}
	return host
}

// 描述：解析允许的跨域来源，未配置时默认放开全部来源，方便 Desktop 联调。
func parseAllowedOrigins(raw string) []string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return []string{"*"}
	}

	parts := strings.Split(text, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin == "" {
			continue
		}
		origins = append(origins, origin)
	}
	if len(origins) == 0 {
		return []string{"*"}
	}
	return origins
}

// 描述：解析账号令牌有效期秒数，非法输入时回退到默认值。
func parseTokenTTL(raw string, fallback time.Duration) time.Duration {
	text := strings.TrimSpace(raw)
	if text == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(text)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}
