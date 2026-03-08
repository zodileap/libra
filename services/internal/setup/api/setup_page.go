package api

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/*
var setupPageFiles embed.FS

// 描述：注册 setup 服务内置的初始化静态页面，避免开源部署阶段再依赖独立 Web 前端。
func (s *Server) registerSetupPageRoutes(mux *http.ServeMux) {
	staticFS, err := fs.Sub(setupPageFiles, "web")
	if err != nil {
		panic(err)
	}

	fileServer := http.FileServer(http.FS(staticFS))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.Redirect(w, r, "/setup", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/setup", s.handleSetupPage)
	mux.Handle("/assets/", fileServer)
}

// 描述：输出后端托管的初始化页 HTML，并覆盖响应头为 text/html。
func (s *Server) handleSetupPage(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	page, err := setupPageFiles.ReadFile("web/setup.html")
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(page)
}
