package main

import (
	"errors"
	"log"
	"net/http"
	"time"

	api "github.com/zodileap/libra/services/runtime/api/v1"
	configs "github.com/zodileap/libra/services/runtime/configs"
)

// 描述：启动独立运行的 runtime HTTP 服务，为 Desktop 提供会话、消息和更新检查能力。
func main() {
	cfg := configs.Load()
	handler, err := api.NewHandler(cfg)
	if err != nil {
		log.Fatalf("初始化 runtime handler 失败: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("runtime service listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("runtime service 启动失败: %v", err)
	}
}
