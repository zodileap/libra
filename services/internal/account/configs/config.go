package configs

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 描述：账号服务配置，统一承载监听地址、数据目录、跨域来源、令牌时长与 bootstrap 令牌。
type Config struct {
	Addr           string
	DataDir        string
	AllowedOrigins []string
	TokenTTL       time.Duration
	BootstrapToken string
}

// 描述：从环境变量加载账号服务配置，并为开源运行环境提供默认值。
func Load() Config {
	port := normalizePort(os.Getenv("LIBRA_ACCOUNT_PORT"), "10001")
	dataDir := strings.TrimSpace(os.Getenv("LIBRA_ACCOUNT_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(".", "data", "account")
	}

	return Config{
		Addr:           ":" + port,
		DataDir:        dataDir,
		AllowedOrigins: parseAllowedOrigins(os.Getenv("LIBRA_ACCOUNT_ALLOWED_ORIGINS")),
		TokenTTL:       parseTokenTTL(os.Getenv("LIBRA_ACCOUNT_TOKEN_TTL_SECONDS"), 24*time.Hour),
		BootstrapToken: strings.TrimSpace(os.Getenv("LIBRA_ACCOUNT_BOOTSTRAP_TOKEN")),
	}
}

// 描述：归一化端口配置，确保环境变量既支持 `10001` 也支持 `:10001`。
func normalizePort(raw string, fallback string) string {
	port := strings.TrimSpace(raw)
	if port == "" {
		return fallback
	}
	return strings.TrimPrefix(port, ":")
}

// 描述：解析允许的跨域来源，未配置时默认放开全部来源，便于本地调试和桌面端联调。
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

// 描述：解析身份令牌有效期秒数，非法或空值时返回默认时长。
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
