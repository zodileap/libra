package api

import (
	"net/http"
	"strings"

	service "github.com/zodileap/libra/services/internal/account/service"
	specs "github.com/zodileap/libra/services/internal/account/specs"
)

// 描述：返回当前系统 bootstrap 状态，供首次安装和登录页判断是否已初始化。
func (s *Server) handleBootstrapStatus(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	resp, err := s.auth.BootstrapStatus()
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：创建首个管理员，仅允许在系统未初始化时调用。
func (s *Server) handleBootstrapAdmin(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	if err := s.requireBootstrapToken(r); err != nil {
		writeError(w, err)
		return
	}
	body, err := decodeJSON[specs.AuthBootstrapAdminReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.auth.BootstrapAdmin(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：账号密码登录，成功后返回身份令牌和用户信息。
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	body, err := decodeJSON[specs.AuthLoginReq](r)
	if err != nil {
		writeError(w, err)
		return
	}
	resp, err := s.auth.Login(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：读取当前登录用户信息。
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.GetCurrentUser(session.UserID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：让当前登录令牌失效。
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.Logout(session.Token)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：返回当前用户身份列表。
func (s *Server) handleIdentities(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.ListUserIdentities(session.UserID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：返回当前管理员可直接授权的用户列表。
func (s *Server) handleManageableUsers(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.ListManageableUsers(session.UserID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：返回内置权限模板列表。
func (s *Server) handlePermissionTemplates(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	resp, err := s.auth.ListPermissionTemplates()
	if err != nil {
		writeError(w, err)
		return
	}
	writeSuccess(w, resp)
}

// 描述：查询权限授权记录。
func (s *Server) handlePermissionGrants(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.ListPermissionGrants(session.UserID, specs.AuthPermissionGrantListReq{
			TargetUserID:   strings.TrimSpace(r.URL.Query().Get("targetUserId")),
			PermissionCode: strings.TrimSpace(r.URL.Query().Get("permissionCode")),
			ResourceType:   strings.TrimSpace(r.URL.Query().Get("resourceType")),
		})
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：新增或撤销权限授权记录。
func (s *Server) handlePermissionGrant(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost, http.MethodDelete) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		switch r.Method {
		case http.MethodPost:
			body, err := decodeJSON[specs.AuthGrantPermissionReq](r)
			if err != nil {
				writeError(w, err)
				return
			}
			resp, err := s.auth.GrantPermission(session.UserID, body)
			if err != nil {
				writeError(w, err)
				return
			}
			writeSuccess(w, resp)
		case http.MethodDelete:
			body, err := decodeJSON[specs.AuthRevokePermissionReq](r)
			if err != nil {
				writeError(w, err)
				return
			}
			resp, err := s.auth.RevokePermission(session.UserID, body)
			if err != nil {
				writeError(w, err)
				return
			}
			writeSuccess(w, resp)
		default:
			writeError(w, service.NewMethodNotAllowedError(r.Method))
		}
	})
}

// 描述：返回当前用户的智能体授权关系列表。
func (s *Server) handleUserAgentAccesses(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		status, err := optionalQueryInt(r, "status")
		if err != nil {
			writeError(w, err)
			return
		}
		resp, err := s.auth.GetUserAgentAccessList(session.UserID, specs.AuthUserAgentAccessListReq{
			AgentID: strings.TrimSpace(r.URL.Query().Get("agentId")),
			Status:  status,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}

// 描述：新增或撤销当前用户的智能体授权。
func (s *Server) handleUserAgentAccess(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodPost, http.MethodDelete) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		switch r.Method {
		case http.MethodPost:
			body, err := decodeJSON[specs.AuthGrantUserAgentAccessReq](r)
			if err != nil {
				writeError(w, err)
				return
			}
			resp, err := s.auth.GrantUserAgentAccess(session.UserID, body)
			if err != nil {
				writeError(w, err)
				return
			}
			writeSuccess(w, resp)
		case http.MethodDelete:
			body, err := decodeJSON[specs.AuthRevokeUserAgentAccessReq](r)
			if err != nil {
				writeError(w, err)
				return
			}
			resp, err := s.auth.RevokeUserAgentAccess(session.UserID, body)
			if err != nil {
				writeError(w, err)
				return
			}
			writeSuccess(w, resp)
		default:
			writeError(w, service.NewMethodNotAllowedError(r.Method))
		}
	})
}

// 描述：返回当前用户可用智能体列表，供 Desktop 和平台入口判断授权。
func (s *Server) handleAvailableAgents(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}
	s.withAuth(w, r, func(w http.ResponseWriter, r *http.Request, session service.AuthSessionInfo) {
		resp, err := s.auth.ListAvailableAgents(session.UserID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeSuccess(w, resp)
	})
}
