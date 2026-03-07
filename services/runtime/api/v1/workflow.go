package api

import (
	"net/http"
	"strings"

	service "github.com/zodileap/libra/services/runtime/service/v1"
	specs "github.com/zodileap/libra/services/runtime/specs/v1"
)

// 描述：处理会话创建与详情查询。
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost, http.MethodGet) {
		return
	}

	if r.Method == http.MethodPost {
		req, err := decodeJSON[specs.WorkflowSessionCreateReq](r)
		if err != nil {
			writeError(w, err)
			return
		}
		resp, err := s.workflow.CreateSession(req)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
		return
	}

	resp, err := s.workflow.GetSession(specs.WorkflowSessionGetReq{
		SessionId: strings.TrimSpace(r.URL.Query().Get("sessionId")),
		UserId:    strings.TrimSpace(r.URL.Query().Get("userId")),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理会话列表查询。
func (s *Server) handleSessionList(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	status, err := optionalQueryInt(r, "status")
	if err != nil {
		writeError(w, err)
		return
	}
	byLastAt, err := optionalQueryInt(r, "byLastAt")
	if err != nil {
		writeError(w, err)
		return
	}

	resp, err := s.workflow.ListSession(specs.WorkflowSessionListReq{
		UserId:    strings.TrimSpace(r.URL.Query().Get("userId")),
		AgentCode: optionalQueryString(r, "agentCode"),
		Status:    status,
		ByLastAt:  byLastAt,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理会话状态更新。
func (s *Server) handleSessionStatus(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPut) {
		return
	}
	body, err := decodeJSON[specs.WorkflowSessionStatusUpdateReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.workflow.UpdateSessionStatus(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理会话消息写入。
func (s *Server) handleSessionMessage(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.WorkflowSessionMessageCreateReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.workflow.CreateSessionMessage(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理会话消息分页查询。
func (s *Server) handleSessionMessageList(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	page, err := optionalQueryInt(r, "page")
	if err != nil {
		writeError(w, err)
		return
	}
	pageSize, err := optionalQueryInt(r, "pageSize")
	if err != nil {
		writeError(w, err)
		return
	}

	resp, err := s.workflow.ListSessionMessage(specs.WorkflowSessionMessageListReq{
		SessionId: strings.TrimSpace(r.URL.Query().Get("sessionId")),
		UserId:    strings.TrimSpace(r.URL.Query().Get("userId")),
		Page:      derefInt(page),
		PageSize:  derefInt(pageSize),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理 Sandbox 的创建、查询与回收。
func (s *Server) handleSandbox(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost, http.MethodGet, http.MethodDelete) {
		return
	}

	if r.Method == http.MethodPost {
		body, err := decodeJSON[specs.WorkflowSandboxCreateReq](r)
		if err != nil {
			writeError(w, err)
			return
		}
		resp, err := s.workflow.CreateSandbox(body)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
		return
	}

	if r.Method == http.MethodGet {
		resp, err := s.workflow.GetSandbox(specs.WorkflowSandboxGetReq{
			SandboxId: optionalQueryString(r, "sandboxId"),
			SessionId: optionalQueryString(r, "sessionId"),
			UserId:    strings.TrimSpace(r.URL.Query().Get("userId")),
		})
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
		return
	}

	body, err := decodeJSON[specs.WorkflowSandboxRecycleReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.workflow.RecycleSandbox(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理预览地址的创建、查询与失效。
func (s *Server) handlePreview(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost, http.MethodGet, http.MethodDelete) {
		return
	}

	if r.Method == http.MethodPost {
		body, err := decodeJSON[specs.WorkflowPreviewCreateReq](r)
		if err != nil {
			writeError(w, err)
			return
		}
		resp, err := s.workflow.CreatePreview(body)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
		return
	}

	if r.Method == http.MethodGet {
		resp, err := s.workflow.GetPreview(specs.WorkflowPreviewGetReq{
			PreviewId: optionalQueryString(r, "previewId"),
			SandboxId: optionalQueryString(r, "sandboxId"),
			UserId:    strings.TrimSpace(r.URL.Query().Get("userId")),
		})
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
		return
	}

	body, err := decodeJSON[specs.WorkflowPreviewExpireReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.workflow.ExpirePreview(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：处理桌面端更新检查。
func (s *Server) handleDesktopUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	resp, err := s.workflow.CheckDesktopUpdate(specs.WorkflowDesktopUpdateCheckReq{
		Platform:       strings.TrimSpace(r.URL.Query().Get("platform")),
		Arch:           strings.TrimSpace(r.URL.Query().Get("arch")),
		CurrentVersion: strings.TrimSpace(r.URL.Query().Get("currentVersion")),
		Channel:        strings.TrimSpace(r.URL.Query().Get("channel")),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：安全解引用可选整型参数，空值时返回 0，由服务层继续归一化。
func derefInt(raw *int) int {
	if raw == nil {
		return 0
	}
	return *raw
}

// 描述：对服务层的辅助错误构造做最小暴露，避免在 handler 中散落错误细节。
func init() {
	service.ExposeAPIErrors()
}
