package configs

import (
	"os"
	"path/filepath"
	"strings"
)

// 描述：初始化服务配置，统一承载监听地址、数据目录、跨域来源、关联 account 服务和版本信息。
type Config struct {
	Addr           string
	DataDir        string
	AllowedOrigins []string
	AccountBaseURL string
	SetupToken     string
	Version        string
}

// 描述：从环境变量加载初始化服务配置，并为开源环境提供默认值。
func Load() Config {
	port := normalizePort(os.Getenv("LIBRA_SETUP_PORT"), "10003")
	dataDir := strings.TrimSpace(os.Getenv("LIBRA_SETUP_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(".", "data", "setup")
	}
	accountBaseURL := strings.TrimSpace(os.Getenv("LIBRA_SETUP_ACCOUNT_BASE_URL"))
	if accountBaseURL == "" {
		accountBaseURL = "http://127.0.0.1:10001"
	}
	version := strings.TrimSpace(os.Getenv("LIBRA_SETUP_VERSION"))
	if version == "" {
		version = "0.1.0"
	}

	return Config{
		Addr:           ":" + port,
		DataDir:        dataDir,
		AllowedOrigins: parseAllowedOrigins(os.Getenv("LIBRA_SETUP_ALLOWED_ORIGINS")),
		AccountBaseURL: strings.TrimRight(accountBaseURL, "/"),
		SetupToken:     strings.TrimSpace(os.Getenv("LIBRA_SETUP_TOKEN")),
		Version:        version,
	}
}

// 描述：归一化端口配置，确保环境变量既支持 `10003` 也支持 `:10003`。
func normalizePort(raw string, fallback string) string {
	port := strings.TrimSpace(raw)
	if port == "" {
		return fallback
	}
	return strings.TrimPrefix(port, ":")
}

// 描述：解析允许的跨域来源，未配置时默认放开全部来源，方便本地联调。
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
