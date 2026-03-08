package main

import (
	"log"
	"net/http"
	"time"

	api "github.com/zodileap/libra/services/internal/account/api"
	configs "github.com/zodileap/libra/services/internal/account/configs"
)

// 描述：启动独立运行的 account HTTP 服务，为 Web 与 Desktop 提供鉴权和账号基础能力。
func main() {
	cfg := configs.Load()
	handler, err := api.NewHandler(cfg)
	if err != nil {
		log.Fatalf("初始化 account handler 失败: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("account service listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("account service 启动失败: %v", err)
	}
}
