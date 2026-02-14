package service

import (
	"strings"
	"sync"
	"time"

	runtime "git.zodileap.com/entity/runtime_v1/instance"
	specs "git.zodileap.com/gemini/zodileap_runtime/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
)

const (
	// 描述：会话消息默认页码。
	defaultMessagePage = 1
	// 描述：会话消息默认分页大小。
	defaultMessagePageSize = 20
	// 描述：会话消息最大分页大小。
	maxMessagePageSize = 200
)

var (
	// 描述：会话消息内存存储，先满足联调路径。
	globalWorkflowMessageStore = newWorkflowMessageStore()
)

// 描述：Runtime 业务工作流服务，聚合会话、消息、Sandbox、Preview 的联调能力。
type WorkflowService struct {
	AgentSession    *BaseAgentSession
	SandboxInstance *BaseSandboxInstance
	PreviewEndpoint *BasePreviewEndpoint
	messageStore    *workflowMessageStore
}

// 描述：创建 Runtime 业务工作流服务实例。
func NewWorkflowService() *WorkflowService {
	return &WorkflowService{
		AgentSession:    NewBaseAgentSession(),
		SandboxInstance: NewBaseSandboxInstance(),
		PreviewEndpoint: NewBasePreviewEndpoint(),
		messageStore:    globalWorkflowMessageStore,
	}
}

// 描述：创建会话。
func (s *WorkflowService) CreateSession(req specs.WorkflowSessionCreateReq) (specs.WorkflowSessionCreateResp, error) {
	return WithService(
		specs.WorkflowSessionCreateResp{},
		func(resp specs.WorkflowSessionCreateResp) (specs.WorkflowSessionCreateResp, error) {
			createReq := runtime.AgentSessionCreate{
				UserId:    req.UserId,
				AgentCode: req.AgentCode,
				Status:    req.Status,
			}
			session, err := s.AgentSession.Create(createReq)
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.Session = session
			return resp, nil
		},
	)
}

// 描述：查询会话列表。
func (s *WorkflowService) ListSession(req specs.WorkflowSessionListReq) (specs.WorkflowSessionListResp, error) {
	return WithService(
		specs.WorkflowSessionListResp{},
		func(resp specs.WorkflowSessionListResp) (specs.WorkflowSessionListResp, error) {
			query := runtime.AgentSessionQuery{
				UserId:    &req.UserId,
				AgentCode: req.AgentCode,
				Status:    req.Status,
				ByLastAt:  req.ByLastAt,
			}
			data, err := s.AgentSession.GetList(query)
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.List = data.List
			return resp, nil
		},
	)
}

// 描述：查询会话详情，并校验用户隔离。
func (s *WorkflowService) GetSession(req specs.WorkflowSessionGetReq) (specs.WorkflowSessionGetResp, error) {
	return WithService(
		specs.WorkflowSessionGetResp{},
		func(resp specs.WorkflowSessionGetResp) (specs.WorkflowSessionGetResp, error) {
			session, err := s.mustSessionOwner(req.SessionId, req.UserId)
			if err != nil {
				return resp, err
			}
			resp.Session = session
			return resp, nil
		},
	)
}

// 描述：更新会话状态（关闭/状态流转）。
func (s *WorkflowService) UpdateSessionStatus(req specs.WorkflowSessionStatusUpdateReq) (specs.WorkflowSessionStatusUpdateResp, error) {
	return WithService(
		specs.WorkflowSessionStatusUpdateResp{},
		func(resp specs.WorkflowSessionStatusUpdateResp) (specs.WorkflowSessionStatusUpdateResp, error) {
			updateReq := specs.AgentSessionUpdateReq{
				Query: runtime.AgentSessionQuery{
					Id:     &req.SessionId,
					UserId: &req.UserId,
				},
				Update: runtime.AgentSessionUpdate{
					Status: &req.Status,
				},
			}
			data, err := s.AgentSession.Update(updateReq)
			if err != nil {
				return resp, zerr.Must(err)
			}
			if len(data.List) == 0 {
				return resp, newWorkflowBizError("1020011001", zstatuscode.Global_API_GetFailed.New().Sprintf("未找到会话"), "会话不存在")
			}
			resp.Session = data.List[0]
			logRuntimeAuditEvent(
				"workflow.session.status.updated",
				map[string]string{
					"userId":    req.UserId.String(),
					"sessionId": req.SessionId.String(),
					"status":    req.Status.String(),
				},
			)
			return resp, nil
		},
	)
}

// 描述：写入会话消息，并做用户隔离校验。
func (s *WorkflowService) CreateSessionMessage(req specs.WorkflowSessionMessageCreateReq) (specs.WorkflowSessionMessageCreateResp, error) {
	return WithService(
		specs.WorkflowSessionMessageCreateResp{},
		func(resp specs.WorkflowSessionMessageCreateResp) (specs.WorkflowSessionMessageCreateResp, error) {
			if strings.TrimSpace(req.Role) == "" {
				return resp, newWorkflowBizError("1020011002", zstatuscode.Global_App_ParamInvalid.New().Sprintf("role不能为空"), "角色不能为空")
			}
			if strings.TrimSpace(req.Content) == "" {
				return resp, newWorkflowBizError("1020011003", zstatuscode.Global_App_ParamInvalid.New().Sprintf("content不能为空"), "消息不能为空")
			}

			if _, err := s.mustSessionOwner(req.SessionId, req.UserId); err != nil {
				return resp, err
			}

			resp.Message = s.messageStore.add(req.SessionId, req.UserId, req.Role, req.Content)
			return resp, nil
		},
	)
}

// 描述：查询会话消息，并做用户隔离校验。
func (s *WorkflowService) ListSessionMessage(req specs.WorkflowSessionMessageListReq) (specs.WorkflowSessionMessageListResp, error) {
	return WithService(
		specs.WorkflowSessionMessageListResp{},
		func(resp specs.WorkflowSessionMessageListResp) (specs.WorkflowSessionMessageListResp, error) {
			if _, err := s.mustSessionOwner(req.SessionId, req.UserId); err != nil {
				return resp, err
			}

			page, pageSize := normalizePagination(req.Page, req.PageSize)
			list, total := s.messageStore.list(req.SessionId, page, pageSize)
			resp.List = list
			resp.Total = total
			resp.Page = page
			resp.PageSize = pageSize
			return resp, nil
		},
	)
}

// 描述：创建 Sandbox 实例。
func (s *WorkflowService) CreateSandbox(req specs.WorkflowSandboxCreateReq) (specs.WorkflowSandboxCreateResp, error) {
	return WithService(
		specs.WorkflowSandboxCreateResp{},
		func(resp specs.WorkflowSandboxCreateResp) (specs.WorkflowSandboxCreateResp, error) {
			if _, err := s.mustSessionOwner(req.SessionId, req.UserId); err != nil {
				return resp, err
			}

			createReq := runtime.SandboxInstanceCreate{
				SessionId:   req.SessionId,
				ContainerId: req.ContainerId,
				PreviewUrl:  req.PreviewUrl,
				Status:      req.Status,
			}
			sandbox, err := s.SandboxInstance.Create(createReq)
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.Sandbox = sandbox
			return resp, nil
		},
	)
}

// 描述：查询 Sandbox 实例。
func (s *WorkflowService) GetSandbox(req specs.WorkflowSandboxGetReq) (specs.WorkflowSandboxGetResp, error) {
	return WithService(
		specs.WorkflowSandboxGetResp{},
		func(resp specs.WorkflowSandboxGetResp) (specs.WorkflowSandboxGetResp, error) {
			query := runtime.SandboxInstanceQuery{}
			if req.SandboxId != nil {
				query.Id = req.SandboxId
			}
			if req.SessionId != nil {
				query.SessionId = req.SessionId
			}
			if query.Id == nil && query.SessionId == nil {
				return resp, newWorkflowBizError("1020011004", zstatuscode.Global_App_ParamInvalid.New().Sprintf("sandboxId 或 sessionId 至少一个必填"), "查询参数无效")
			}

			data, err := s.SandboxInstance.GetList(query)
			if err != nil {
				return resp, zerr.Must(err)
			}

			for _, item := range data.List {
				if item == nil {
					continue
				}
				if _, err := s.mustSessionOwner(item.SessionId(), req.UserId); err != nil {
					continue
				}
				resp.List = append(resp.List, item)
			}
			return resp, nil
		},
	)
}

// 描述：回收 Sandbox 实例。
func (s *WorkflowService) RecycleSandbox(req specs.WorkflowSandboxRecycleReq) (specs.WorkflowSandboxRecycleResp, error) {
	return WithService(
		specs.WorkflowSandboxRecycleResp{},
		func(resp specs.WorkflowSandboxRecycleResp) (specs.WorkflowSandboxRecycleResp, error) {
			query := runtime.SandboxInstanceQuery{}
			if req.SandboxId != nil {
				sandbox, err := s.mustSandboxOwner(*req.SandboxId, req.UserId)
				if err != nil {
					return resp, err
				}
				sandboxID := sandbox.Id()
				query.Id = &sandboxID
			}
			if req.SessionId != nil {
				if _, err := s.mustSessionOwner(*req.SessionId, req.UserId); err != nil {
					return resp, err
				}
				query.SessionId = req.SessionId
			}
			if query.Id == nil && query.SessionId == nil {
				return resp, newWorkflowBizError("1020011005", zstatuscode.Global_App_ParamInvalid.New().Sprintf("sandboxId 或 sessionId 至少一个必填"), "回收参数无效")
			}

			data, err := s.SandboxInstance.Delete(specs.SandboxInstanceDeleteReq{
				Query: query,
			})
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.Success = data.Success
			return resp, nil
		},
	)
}

// 描述：创建预览地址。
func (s *WorkflowService) CreatePreview(req specs.WorkflowPreviewCreateReq) (specs.WorkflowPreviewCreateResp, error) {
	return WithService(
		specs.WorkflowPreviewCreateResp{},
		func(resp specs.WorkflowPreviewCreateResp) (specs.WorkflowPreviewCreateResp, error) {
			if _, err := s.mustSandboxOwner(req.SandboxId, req.UserId); err != nil {
				return resp, err
			}

			createReq := runtime.PreviewEndpointCreate{
				SandboxId:  req.SandboxId,
				Url:        req.Url,
				Status:     req.Status,
				Expiration: req.Expiration,
			}
			preview, err := s.PreviewEndpoint.Create(createReq)
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.Preview = preview
			return resp, nil
		},
	)
}

// 描述：查询预览地址。
func (s *WorkflowService) GetPreview(req specs.WorkflowPreviewGetReq) (specs.WorkflowPreviewGetResp, error) {
	return WithService(
		specs.WorkflowPreviewGetResp{},
		func(resp specs.WorkflowPreviewGetResp) (specs.WorkflowPreviewGetResp, error) {
			query := runtime.PreviewEndpointQuery{}
			if req.PreviewId != nil {
				query.Id = req.PreviewId
			}
			if req.SandboxId != nil {
				query.SandboxId = req.SandboxId
			}
			if query.Id == nil && query.SandboxId == nil {
				return resp, newWorkflowBizError("1020011006", zstatuscode.Global_App_ParamInvalid.New().Sprintf("previewId 或 sandboxId 至少一个必填"), "查询参数无效")
			}

			if req.SandboxId != nil {
				if _, err := s.mustSandboxOwner(*req.SandboxId, req.UserId); err != nil {
					return resp, err
				}
			}

			data, err := s.PreviewEndpoint.GetList(query)
			if err != nil {
				return resp, zerr.Must(err)
			}

			for _, item := range data.List {
				if item == nil {
					continue
				}
				if _, err := s.mustSandboxOwner(item.SandboxId(), req.UserId); err != nil {
					continue
				}
				resp.List = append(resp.List, item)
			}
			return resp, nil
		},
	)
}

// 描述：让预览地址失效。
func (s *WorkflowService) ExpirePreview(req specs.WorkflowPreviewExpireReq) (specs.WorkflowPreviewExpireResp, error) {
	return WithService(
		specs.WorkflowPreviewExpireResp{},
		func(resp specs.WorkflowPreviewExpireResp) (specs.WorkflowPreviewExpireResp, error) {
			query := runtime.PreviewEndpointQuery{}
			if req.PreviewId != nil {
				previewData, err := s.PreviewEndpoint.Get(runtime.PreviewEndpointQuery{Id: req.PreviewId})
				if err != nil {
					return resp, zerr.Must(err)
				}
				if previewData == nil {
					return resp, newWorkflowBizError("1020011007", zstatuscode.Global_API_GetFailed.New().Sprintf("预览地址不存在"), "预览地址不存在")
				}
				if _, err := s.mustSandboxOwner(previewData.SandboxId(), req.UserId); err != nil {
					return resp, err
				}
				previewID := previewData.Id()
				query.Id = &previewID
			}
			if req.SandboxId != nil {
				if _, err := s.mustSandboxOwner(*req.SandboxId, req.UserId); err != nil {
					return resp, err
				}
				query.SandboxId = req.SandboxId
			}
			if query.Id == nil && query.SandboxId == nil {
				return resp, newWorkflowBizError("1020011008", zstatuscode.Global_App_ParamInvalid.New().Sprintf("previewId 或 sandboxId 至少一个必填"), "失效参数无效")
			}

			data, err := s.PreviewEndpoint.Delete(specs.PreviewEndpointDeleteReq{
				Query: query,
			})
			if err != nil {
				return resp, zerr.Must(err)
			}
			resp.Success = data.Success
			return resp, nil
		},
	)
}

// 描述：校验会话是否归属当前用户。
func (s *WorkflowService) mustSessionOwner(sessionID zspecs.Id, userID zspecs.UserId) (*runtime.AgentSessionEntity, error) {
	session, err := s.AgentSession.Get(runtime.AgentSessionQuery{
		Id: &sessionID,
	})
	if err != nil {
		return nil, zerr.Must(err)
	}
	if session == nil {
		return nil, newWorkflowBizError("1020011009", zstatuscode.Global_API_GetFailed.New().Sprintf("会话不存在"), "会话不存在")
	}
	if session.UserId().String() != userID.String() {
		return nil, newWorkflowBizError("1020011010", zstatuscode.Global_App_ParamInvalid.New().Sprintf("会话不属于当前用户"), "用户隔离校验失败")
	}
	return session, nil
}

// 描述：校验 Sandbox 是否归属当前用户。
func (s *WorkflowService) mustSandboxOwner(sandboxID zspecs.Id, userID zspecs.UserId) (*runtime.SandboxInstanceEntity, error) {
	sandbox, err := s.SandboxInstance.Get(runtime.SandboxInstanceQuery{
		Id: &sandboxID,
	})
	if err != nil {
		return nil, zerr.Must(err)
	}
	if sandbox == nil {
		return nil, newWorkflowBizError("1020011011", zstatuscode.Global_API_GetFailed.New().Sprintf("Sandbox不存在"), "Sandbox不存在")
	}
	if _, err := s.mustSessionOwner(sandbox.SessionId(), userID); err != nil {
		return nil, err
	}
	return sandbox, nil
}

// 描述：归一化分页参数。
func normalizePagination(page int, pageSize int) (int, int) {
	if page <= 0 {
		page = defaultMessagePage
	}
	if pageSize <= 0 {
		pageSize = defaultMessagePageSize
	}
	if pageSize > maxMessagePageSize {
		pageSize = maxMessagePageSize
	}
	return page, pageSize
}

// 描述：构造 workflow 业务错误。
func newWorkflowBizError(code string, statusCode *zstatuscode.StatusCode, msg string) error {
	err := zerr.New(code, msg, 4, msg)
	err.StatuCode = statusCode
	return err
}

// 描述：会话消息内存存储。
type workflowMessageStore struct {
	lock sync.RWMutex
	seq  int64
	data map[int64][]specs.WorkflowSessionMessageItem
}

// 描述：创建会话消息存储实例。
func newWorkflowMessageStore() *workflowMessageStore {
	return &workflowMessageStore{
		data: map[int64][]specs.WorkflowSessionMessageItem{},
	}
}

// 描述：追加会话消息。
func (s *workflowMessageStore) add(sessionID zspecs.Id, userID zspecs.UserId, role string, content string) specs.WorkflowSessionMessageItem {
	s.lock.Lock()
	defer s.lock.Unlock()

	s.seq++
	messageID := *zspecs.NewId(s.seq)
	item := specs.WorkflowSessionMessageItem{
		MessageId: messageID,
		SessionId: sessionID,
		UserId:    userID,
		Role:      strings.TrimSpace(role),
		Content:   strings.TrimSpace(content),
		CreatedAt: zspecs.NewCreatedAt(time.Now()),
	}
	sessionKey := sessionID.Int64()
	s.data[sessionKey] = append(s.data[sessionKey], item)
	return item
}

// 描述：分页查询会话消息。
func (s *workflowMessageStore) list(sessionID zspecs.Id, page int, pageSize int) ([]specs.WorkflowSessionMessageItem, int) {
	s.lock.RLock()
	defer s.lock.RUnlock()

	sessionKey := sessionID.Int64()
	all := s.data[sessionKey]
	total := len(all)
	if total == 0 {
		return []specs.WorkflowSessionMessageItem{}, 0
	}

	start := (page - 1) * pageSize
	if start >= total {
		return []specs.WorkflowSessionMessageItem{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	result := make([]specs.WorkflowSessionMessageItem, 0, end-start)
	result = append(result, all[start:end]...)
	return result, total
}
