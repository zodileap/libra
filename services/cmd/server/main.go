package main

import (
	"errors"
	"log"
	"net/http"
	"time"

	backend "github.com/zodileap/libra/services/internal/backend"
)

// 描述：启动 Libra 开源版统一后端服务，在同一地址上暴露 auth、workflow 与 setup 三组接口。
func main() {
	cfg := backend.Load()
	handler, err := backend.NewHandler(cfg)
	if err != nil {
		log.Fatalf("初始化 unified backend handler 失败: %v", err)
	}

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("libra backend listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("libra backend 启动失败: %v", err)
	}
}
