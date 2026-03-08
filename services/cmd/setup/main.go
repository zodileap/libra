package main

import (
	"log"
	"net/http"
	"time"

	api "github.com/zodileap/libra/services/internal/setup/api"
	configs "github.com/zodileap/libra/services/internal/setup/configs"
)

// 描述：启动独立运行的 setup HTTP 服务，为开源首次安装向导提供状态与编排接口。
func main() {
	cfg := configs.Load()
	handler, err := api.NewHandler(cfg)
	if err != nil {
		log.Fatalf("初始化 setup handler 失败: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("setup service listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("setup service 启动失败: %v", err)
	}
}
