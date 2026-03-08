package api

import (
	"net/http"

	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

// 描述：返回当前初始化状态。
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	resp, err := s.setup.Status()
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：校验数据库配置并保存当前初始化使用的数据库连接信息。
func (s *Server) handleDatabaseValidate(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.SetupDatabaseConfigReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.setup.ValidateDatabase(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：执行数据库迁移，创建初始化所需元数据表。
func (s *Server) handleDatabaseMigrate(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	resp, err := s.setup.MigrateDatabase()
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：保存系统设置并推进初始化步骤。
func (s *Server) handleSystemConfig(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.SetupSystemConfigReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.setup.SaveSystemConfig(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：通过 account 服务创建首个管理员。
func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.SetupAdminReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.setup.CreateAdmin(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：完成初始化并写入最终安装状态。
func (s *Server) handleFinalize(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.SetupFinalizeReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.setup.Finalize(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}
