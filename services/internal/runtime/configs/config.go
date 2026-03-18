package configs

import (
	"os"
	"path/filepath"
	"strings"
)

// 描述：运行时服务配置，负责统一承载监听地址、数据目录与跨域配置。
type Config struct {
	Addr               string
	DataDir            string
	AllowedOrigins     []string
	RuntimeSidecarAddr string
	RuntimeSidecarBin  string
}

// 描述：从环境变量加载运行时服务配置，并为开源环境提供默认值。
func Load() Config {
	port := normalizePort(os.Getenv("LIBRA_RUNTIME_PORT"), "10002")
	dataDir := strings.TrimSpace(os.Getenv("LIBRA_RUNTIME_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(".", "data", "runtime")
	}

	return Config{
		Addr:               ":" + port,
		DataDir:            dataDir,
		AllowedOrigins:     parseAllowedOrigins(os.Getenv("LIBRA_RUNTIME_ALLOWED_ORIGINS")),
		RuntimeSidecarAddr: normalizeSidecarAddr(os.Getenv("LIBRA_RUNTIME_SIDECAR_ADDR"), "127.0.0.1:46329"),
		RuntimeSidecarBin:  strings.TrimSpace(os.Getenv("LIBRA_RUNTIME_SIDECAR_BIN")),
	}
}

// 描述：归一化端口配置，确保环境变量既支持 `10002` 也支持 `:10002`。
func normalizePort(raw string, fallback string) string {
	port := strings.TrimSpace(raw)
	if port == "" {
		return fallback
	}
	return strings.TrimPrefix(port, ":")
}

// 描述：解析允许的跨域来源，未配置时默认放开全部来源，便于桌面端本地联调。
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

// 描述：归一化 sidecar gRPC 地址，避免空值时服务侧无法自动拉起 runtime。
func normalizeSidecarAddr(raw string, fallback string) string {
	addr := strings.TrimSpace(raw)
	if addr == "" {
		return fallback
	}
	return addr
}
