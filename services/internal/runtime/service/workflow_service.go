package service

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
	specs "github.com/zodileap/libra/services/internal/runtime/specs"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	// 描述：会话消息默认页码。
	defaultMessagePage = 1
	// 描述：会话消息默认分页大小。
	defaultMessagePageSize = 20
	// 描述：会话消息最大分页大小。
	maxMessagePageSize = 200
	// 描述：桌面端更新检查默认通道。
	defaultDesktopUpdateChannel = "stable"
	// 描述：默认激活状态，保持与 Desktop 当前会话筛选逻辑兼容。
	defaultActiveStatus = 1
	// 描述：services 通过 sidecar 调用 runtime 时默认租户标识。
	defaultRuntimeTenantID = "local"
	// 描述：services 通过 sidecar 调用 runtime 时默认项目标识。
	defaultRuntimeProjectID = "default"
	// 描述：services 调用 runtime sidecar 的统一超时时间。
	runtimeRequestTimeout = 10 * time.Second
)

// 描述：workflow 业务层依赖的 runtime 管理面接口，便于生产代码接 sidecar、测试代码接假实现。
type WorkflowRuntimeGateway interface {
	CreateSession(ctx context.Context, request *runtimepb.CreateSessionRequest) (*runtimepb.CreateSessionResponse, error)
	ListSessions(ctx context.Context, request *runtimepb.ListSessionsRequest) (*runtimepb.ListSessionsResponse, error)
	GetSession(ctx context.Context, request *runtimepb.GetSessionRequest) (*runtimepb.GetSessionResponse, error)
	UpdateSessionStatus(ctx context.Context, request *runtimepb.UpdateSessionStatusRequest) (*runtimepb.UpdateSessionStatusResponse, error)
	CreateMessage(ctx context.Context, request *runtimepb.CreateMessageRequest) (*runtimepb.CreateMessageResponse, error)
	ListMessages(ctx context.Context, request *runtimepb.ListMessagesRequest) (*runtimepb.ListMessagesResponse, error)
	ListSandboxes(ctx context.Context, request *runtimepb.ListSandboxesRequest) (*runtimepb.ListSandboxesResponse, error)
	CreateSandbox(ctx context.Context, request *runtimepb.CreateSandboxRequest) (*runtimepb.CreateSandboxResponse, error)
	RecycleSandbox(ctx context.Context, request *runtimepb.RecycleSandboxRequest) (*runtimepb.RecycleSandboxResponse, error)
	ListPreviews(ctx context.Context, request *runtimepb.ListPreviewsRequest) (*runtimepb.ListPreviewsResponse, error)
	CreatePreview(ctx context.Context, request *runtimepb.CreatePreviewRequest) (*runtimepb.CreatePreviewResponse, error)
	ExpirePreview(ctx context.Context, request *runtimepb.ExpirePreviewRequest) (*runtimepb.ExpirePreviewResponse, error)
}

// 描述：Runtime 业务工作流服务，负责把既有 REST 语义桥接到统一 runtime sidecar 管理面。
type WorkflowService struct {
	runtime WorkflowRuntimeGateway
}

// 描述：创建 Runtime 业务工作流服务实例，底层固定依赖统一 runtime sidecar。
func NewWorkflowService(runtime WorkflowRuntimeGateway) *WorkflowService {
	return &WorkflowService{runtime: runtime}
}

// 描述：创建会话，并为 Desktop 返回立即可用的基础会话实体。
func (s *WorkflowService) CreateSession(req specs.WorkflowSessionCreateReq) (specs.WorkflowSessionCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	agentCode := strings.TrimSpace(req.AgentCode)
	if userID == "" {
		return specs.WorkflowSessionCreateResp{}, newValidationError("userId 不能为空")
	}
	if agentCode == "" {
		return specs.WorkflowSessionCreateResp{}, newValidationError("agentCode 不能为空")
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.CreateSession(ctx, &runtimepb.CreateSessionRequest{
		TenantId:  defaultRuntimeTenantID,
		UserId:    userID,
		ProjectId: defaultRuntimeProjectID,
		AgentCode: agentCode,
		Status:    int32(defaultStatus(req.Status)),
	})
	if err != nil {
		return specs.WorkflowSessionCreateResp{}, mapRuntimeError("创建会话失败", err)
	}
	session, err := requireSessionRecord(response.GetSession())
	if err != nil {
		return specs.WorkflowSessionCreateResp{}, err
	}
	return specs.WorkflowSessionCreateResp{Session: mapRuntimeSession(session)}, nil
}

// 描述：查询会话列表，按最近更新时间倒序返回，支持用户、智能体和状态筛选。
func (s *WorkflowService) ListSession(req specs.WorkflowSessionListReq) (specs.WorkflowSessionListResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSessionListResp{}, newValidationError("userId 不能为空")
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.ListSessions(ctx, &runtimepb.ListSessionsRequest{
		TenantId:  defaultRuntimeTenantID,
		UserId:    userID,
		ProjectId: defaultRuntimeProjectID,
		AgentCode: trimOptionalString(req.AgentCode),
		Status:    optionalStatusInt32(req.Status),
	})
	if err != nil {
		return specs.WorkflowSessionListResp{}, mapRuntimeError("查询会话列表失败", err)
	}

	list := make([]specs.RuntimeSessionEntity, 0, len(response.GetList()))
	for _, item := range response.GetList() {
		list = append(list, mapRuntimeSession(item))
	}
	if req.ByLastAt != nil && *req.ByLastAt < 0 {
		slicesReverseSession(list)
	}
	return specs.WorkflowSessionListResp{List: list}, nil
}

// 描述：查询会话详情，并校验会话归属关系。
func (s *WorkflowService) GetSession(req specs.WorkflowSessionGetReq) (specs.WorkflowSessionGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionGetResp{}, newValidationError("sessionId 和 userId 不能为空")
	}

	session, err := s.getOwnedSession(sessionID, userID)
	if err != nil {
		return specs.WorkflowSessionGetResp{}, err
	}
	return specs.WorkflowSessionGetResp{Session: mapRuntimeSession(session)}, nil
}

// 描述：更新会话状态，并刷新最后更新时间。
func (s *WorkflowService) UpdateSessionStatus(req specs.WorkflowSessionStatusUpdateReq) (specs.WorkflowSessionStatusUpdateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionStatusUpdateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	if _, err := s.getOwnedSession(sessionID, userID); err != nil {
		return specs.WorkflowSessionStatusUpdateResp{}, err
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.UpdateSessionStatus(ctx, &runtimepb.UpdateSessionStatusRequest{
		SessionId: sessionID,
		Status:    int32(req.Status),
	})
	if err != nil {
		return specs.WorkflowSessionStatusUpdateResp{}, mapRuntimeError("更新会话状态失败", err)
	}
	session, err := requireSessionRecord(response.GetSession())
	if err != nil {
		return specs.WorkflowSessionStatusUpdateResp{}, err
	}
	return specs.WorkflowSessionStatusUpdateResp{Session: mapRuntimeSession(session)}, nil
}

// 描述：写入会话消息，并同步刷新会话的最后更新时间。
func (s *WorkflowService) CreateSessionMessage(req specs.WorkflowSessionMessageCreateReq) (specs.WorkflowSessionMessageCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	role := strings.TrimSpace(req.Role)
	content := strings.TrimSpace(req.Content)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	if role == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("role 不能为空")
	}
	if content == "" {
		return specs.WorkflowSessionMessageCreateResp{}, newValidationError("content 不能为空")
	}
	if _, err := s.getOwnedSession(sessionID, userID); err != nil {
		return specs.WorkflowSessionMessageCreateResp{}, err
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.CreateMessage(ctx, &runtimepb.CreateMessageRequest{
		SessionId: sessionID,
		UserId:    userID,
		Role:      role,
		Content:   content,
	})
	if err != nil {
		return specs.WorkflowSessionMessageCreateResp{}, mapRuntimeError("写入会话消息失败", err)
	}
	message := response.GetMessage()
	if message == nil {
		return specs.WorkflowSessionMessageCreateResp{}, newInternalError("写入会话消息失败", fmt.Errorf("runtime 返回空消息"))
	}
	return specs.WorkflowSessionMessageCreateResp{Message: mapRuntimeMessage(message)}, nil
}

// 描述：分页查询会话消息，并确保不同用户无法跨会话读取消息。
func (s *WorkflowService) ListSessionMessage(req specs.WorkflowSessionMessageListReq) (specs.WorkflowSessionMessageListResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSessionMessageListResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	page, pageSize := normalizePagination(req.Page, req.PageSize)
	if _, err := s.getOwnedSession(sessionID, userID); err != nil {
		return specs.WorkflowSessionMessageListResp{}, err
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.ListMessages(ctx, &runtimepb.ListMessagesRequest{
		SessionId: sessionID,
		Page:      int32(page),
		PageSize:  int32(pageSize),
	})
	if err != nil {
		return specs.WorkflowSessionMessageListResp{}, mapRuntimeError("查询会话消息失败", err)
	}
	list := make([]specs.WorkflowSessionMessageItem, 0, len(response.GetList()))
	for _, item := range response.GetList() {
		list = append(list, mapRuntimeMessage(item))
	}
	return specs.WorkflowSessionMessageListResp{
		List:     list,
		Total:    int(response.GetTotal()),
		Page:     int(response.GetPage()),
		PageSize: int(response.GetPageSize()),
	}, nil
}

// 描述：创建 Sandbox 实例，并要求会话归属当前用户。
func (s *WorkflowService) CreateSandbox(req specs.WorkflowSandboxCreateReq) (specs.WorkflowSandboxCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sessionID := strings.TrimSpace(req.SessionId)
	if userID == "" || sessionID == "" {
		return specs.WorkflowSandboxCreateResp{}, newValidationError("sessionId 和 userId 不能为空")
	}
	if _, err := s.getOwnedSession(sessionID, userID); err != nil {
		return specs.WorkflowSandboxCreateResp{}, err
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.CreateSandbox(ctx, &runtimepb.CreateSandboxRequest{
		SessionId:   sessionID,
		ContainerId: trimOptionalString(req.ContainerId),
		PreviewUrl:  trimOptionalString(req.PreviewUrl),
		Status:      int32(defaultStatus(req.Status)),
	})
	if err != nil {
		return specs.WorkflowSandboxCreateResp{}, mapRuntimeError("创建 sandbox 失败", err)
	}
	sandbox := response.GetSandbox()
	if sandbox == nil {
		return specs.WorkflowSandboxCreateResp{}, newInternalError("创建 sandbox 失败", fmt.Errorf("runtime 返回空 sandbox"))
	}
	return specs.WorkflowSandboxCreateResp{Sandbox: mapRuntimeSandbox(sandbox)}, nil
}

// 描述：查询 Sandbox 列表，并对结果执行当前用户的会话归属过滤。
func (s *WorkflowService) GetSandbox(req specs.WorkflowSandboxGetReq) (specs.WorkflowSandboxGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSandboxGetResp{}, newValidationError("userId 不能为空")
	}
	if req.SandboxId == nil && req.SessionId == nil {
		return specs.WorkflowSandboxGetResp{}, newValidationError("sandboxId 或 sessionId 至少一个必填")
	}

	list, err := s.listOwnedSandboxes(trimOptionalString(req.SandboxId), trimOptionalString(req.SessionId), userID)
	if err != nil {
		return specs.WorkflowSandboxGetResp{}, err
	}
	return specs.WorkflowSandboxGetResp{List: list}, nil
}

// 描述：回收 Sandbox，并同步移除其关联的预览地址记录。
func (s *WorkflowService) RecycleSandbox(req specs.WorkflowSandboxRecycleReq) (specs.WorkflowSandboxRecycleResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowSandboxRecycleResp{}, newValidationError("userId 不能为空")
	}
	if req.SandboxId == nil && req.SessionId == nil {
		return specs.WorkflowSandboxRecycleResp{}, newValidationError("sandboxId 或 sessionId 至少一个必填")
	}

	list, err := s.listOwnedSandboxes(trimOptionalString(req.SandboxId), trimOptionalString(req.SessionId), userID)
	if err != nil {
		return specs.WorkflowSandboxRecycleResp{}, err
	}
	if len(list) == 0 {
		return specs.WorkflowSandboxRecycleResp{}, newNotFoundError("未找到可回收的 sandbox")
	}

	for _, item := range list {
		ctx, cancel := runtimeCallContext()
		_, recycleErr := s.runtime.RecycleSandbox(ctx, &runtimepb.RecycleSandboxRequest{
			SandboxId: item.ID,
		})
		cancel()
		if recycleErr != nil {
			return specs.WorkflowSandboxRecycleResp{}, mapRuntimeError("回收 sandbox 失败", recycleErr)
		}
	}
	return specs.WorkflowSandboxRecycleResp{Success: true}, nil
}

// 描述：创建预览地址，并要求目标 Sandbox 必须归属于当前用户。
func (s *WorkflowService) CreatePreview(req specs.WorkflowPreviewCreateReq) (specs.WorkflowPreviewCreateResp, error) {
	userID := strings.TrimSpace(req.UserId)
	sandboxID := strings.TrimSpace(req.SandboxId)
	url := strings.TrimSpace(req.Url)
	if userID == "" || sandboxID == "" {
		return specs.WorkflowPreviewCreateResp{}, newValidationError("sandboxId 和 userId 不能为空")
	}
	if url == "" {
		return specs.WorkflowPreviewCreateResp{}, newValidationError("url 不能为空")
	}
	if _, err := s.getOwnedSandbox(sandboxID, userID); err != nil {
		return specs.WorkflowPreviewCreateResp{}, err
	}

	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.CreatePreview(ctx, &runtimepb.CreatePreviewRequest{
		SandboxId:      sandboxID,
		Url:            url,
		Status:         int32(defaultStatus(req.Status)),
		ExpirationSecs: optionalExpiration(req.Expiration),
	})
	if err != nil {
		return specs.WorkflowPreviewCreateResp{}, mapRuntimeError("创建预览地址失败", err)
	}
	preview := response.GetPreview()
	if preview == nil {
		return specs.WorkflowPreviewCreateResp{}, newInternalError("创建预览地址失败", fmt.Errorf("runtime 返回空 preview"))
	}
	return specs.WorkflowPreviewCreateResp{Preview: mapRuntimePreview(preview)}, nil
}

// 描述：查询预览地址列表，并根据 Sandbox 归属过滤数据。
func (s *WorkflowService) GetPreview(req specs.WorkflowPreviewGetReq) (specs.WorkflowPreviewGetResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowPreviewGetResp{}, newValidationError("userId 不能为空")
	}
	if req.PreviewId == nil && req.SandboxId == nil {
		return specs.WorkflowPreviewGetResp{}, newValidationError("previewId 或 sandboxId 至少一个必填")
	}

	list, err := s.listOwnedPreviews(trimOptionalString(req.PreviewId), trimOptionalString(req.SandboxId), userID)
	if err != nil {
		return specs.WorkflowPreviewGetResp{}, err
	}
	return specs.WorkflowPreviewGetResp{List: list}, nil
}

// 描述：让预览地址失效，支持按预览 ID 或 Sandbox ID 批量移除。
func (s *WorkflowService) ExpirePreview(req specs.WorkflowPreviewExpireReq) (specs.WorkflowPreviewExpireResp, error) {
	userID := strings.TrimSpace(req.UserId)
	if userID == "" {
		return specs.WorkflowPreviewExpireResp{}, newValidationError("userId 不能为空")
	}
	if req.PreviewId == nil && req.SandboxId == nil {
		return specs.WorkflowPreviewExpireResp{}, newValidationError("previewId 或 sandboxId 至少一个必填")
	}

	list, err := s.listOwnedPreviews(trimOptionalString(req.PreviewId), trimOptionalString(req.SandboxId), userID)
	if err != nil {
		return specs.WorkflowPreviewExpireResp{}, err
	}
	if len(list) == 0 {
		return specs.WorkflowPreviewExpireResp{}, newNotFoundError("未找到可失效的预览地址")
	}

	for _, item := range list {
		ctx, cancel := runtimeCallContext()
		_, expireErr := s.runtime.ExpirePreview(ctx, &runtimepb.ExpirePreviewRequest{
			PreviewId: item.ID,
		})
		cancel()
		if expireErr != nil {
			return specs.WorkflowPreviewExpireResp{}, mapRuntimeError("失效预览地址失败", expireErr)
		}
	}
	return specs.WorkflowPreviewExpireResp{Success: true}, nil
}

// 描述：检查桌面端是否存在可更新版本，并返回对应平台下载地址。
func (s *WorkflowService) CheckDesktopUpdate(req specs.WorkflowDesktopUpdateCheckReq) (specs.WorkflowDesktopUpdateCheckResp, error) {
	channel := resolveDesktopUpdateChannel(req.Channel)
	currentVersion := strings.TrimSpace(req.CurrentVersion)
	latestVersion := strings.TrimSpace(envValue("LIBRA_DESKTOP_LATEST_VERSION"))
	downloadURL := resolveDesktopUpdateDownloadURL(req.Platform, req.Arch, channel)
	checksumSHA256 := strings.TrimSpace(envValue("LIBRA_DESKTOP_CHECKSUM_SHA256"))
	releaseNotes := strings.TrimSpace(envValue("LIBRA_DESKTOP_RELEASE_NOTES"))
	publishedAt := resolveDesktopUpdatePublishedAt()

	resp := specs.WorkflowDesktopUpdateCheckResp{
		Channel:        channel,
		LatestVersion:  latestVersion,
		DownloadURL:    downloadURL,
		ChecksumSHA256: checksumSHA256,
		ReleaseNotes:   releaseNotes,
		PublishedAt:    publishedAt,
	}
	if latestVersion == "" || downloadURL == "" {
		return resp, nil
	}
	resp.HasUpdate = compareSemverVersion(currentVersion, latestVersion) < 0
	return resp, nil
}

// 描述：读取单个会话并校验其归属当前用户，避免 services 侧跨用户透传 runtime 数据。
func (s *WorkflowService) getOwnedSession(sessionID string, userID string) (*runtimepb.RuntimeSessionRecord, error) {
	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.GetSession(ctx, &runtimepb.GetSessionRequest{SessionId: sessionID})
	if err != nil {
		return nil, mapRuntimeError("查询会话失败", err)
	}
	session, err := requireSessionRecord(response.GetSession())
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(session.GetUserId()) != userID {
		return nil, newForbiddenError("会话不属于当前用户")
	}
	return session, nil
}

// 描述：读取单个 Sandbox 并校验其所属会话归属当前用户。
func (s *WorkflowService) getOwnedSandbox(sandboxID string, userID string) (*runtimepb.RuntimeSandboxRecord, error) {
	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.ListSandboxes(ctx, &runtimepb.ListSandboxesRequest{
		SandboxId: sandboxID,
	})
	if err != nil {
		return nil, mapRuntimeError("查询 sandbox 失败", err)
	}
	for _, item := range response.GetList() {
		if item.GetId() != sandboxID {
			continue
		}
		if _, err := s.getOwnedSession(item.GetSessionId(), userID); err != nil {
			return nil, err
		}
		return item, nil
	}
	return nil, newNotFoundError("Sandbox 不存在")
}

// 描述：按条件查询当前用户可见的 Sandbox 列表，并按当前接口约定过滤掉他人会话数据。
func (s *WorkflowService) listOwnedSandboxes(sandboxID string, sessionID string, userID string) ([]specs.RuntimeSandboxEntity, error) {
	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.ListSandboxes(ctx, &runtimepb.ListSandboxesRequest{
		SandboxId: sandboxID,
		SessionId: sessionID,
	})
	if err != nil {
		return nil, mapRuntimeError("查询 sandbox 失败", err)
	}
	list := make([]specs.RuntimeSandboxEntity, 0, len(response.GetList()))
	for _, item := range response.GetList() {
		if _, err := s.getOwnedSession(item.GetSessionId(), userID); err != nil {
			continue
		}
		list = append(list, mapRuntimeSandbox(item))
	}
	return list, nil
}

// 描述：按条件查询当前用户可见的 Preview 列表，并通过 Sandbox 归属做最终过滤。
func (s *WorkflowService) listOwnedPreviews(previewID string, sandboxID string, userID string) ([]specs.RuntimePreviewEntity, error) {
	ctx, cancel := runtimeCallContext()
	defer cancel()
	response, err := s.runtime.ListPreviews(ctx, &runtimepb.ListPreviewsRequest{
		PreviewId: previewID,
		SandboxId: sandboxID,
	})
	if err != nil {
		return nil, mapRuntimeError("查询预览地址失败", err)
	}
	list := make([]specs.RuntimePreviewEntity, 0, len(response.GetList()))
	for _, item := range response.GetList() {
		if _, err := s.getOwnedSandbox(item.GetSandboxId(), userID); err != nil {
			continue
		}
		list = append(list, mapRuntimePreview(item))
	}
	return list, nil
}

// 描述：统一创建 runtime sidecar RPC 上下文，避免 handler 直接持有长连接阻塞。
func runtimeCallContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), runtimeRequestTimeout)
}

// 描述：把 runtime 会话协议结构转换为 services 对外响应实体。
func mapRuntimeSession(item *runtimepb.RuntimeSessionRecord) specs.RuntimeSessionEntity {
	return specs.RuntimeSessionEntity{
		ID:        item.GetId(),
		UserID:    item.GetUserId(),
		AgentCode: item.GetAgentCode(),
		Status:    int(item.GetStatus()),
		CreatedAt: item.GetCreatedAt(),
		LastAt:    item.GetLastAt(),
		DeletedAt: item.GetDeletedAt(),
	}
}

// 描述：把 runtime 消息协议结构转换为 services 对外响应实体。
func mapRuntimeMessage(item *runtimepb.RuntimeMessageRecord) specs.WorkflowSessionMessageItem {
	return specs.WorkflowSessionMessageItem{
		MessageId: item.GetMessageId(),
		SessionId: item.GetSessionId(),
		UserId:    item.GetUserId(),
		Role:      item.GetRole(),
		Content:   item.GetContent(),
		CreatedAt: item.GetCreatedAt(),
	}
}

// 描述：把 runtime Sandbox 协议结构转换为 services 对外响应实体。
func mapRuntimeSandbox(item *runtimepb.RuntimeSandboxRecord) specs.RuntimeSandboxEntity {
	return specs.RuntimeSandboxEntity{
		ID:          item.GetId(),
		SessionID:   item.GetSessionId(),
		ContainerID: item.GetContainerId(),
		PreviewURL:  item.GetPreviewUrl(),
		Status:      int(item.GetStatus()),
		CreatedAt:   item.GetCreatedAt(),
		LastAt:      item.GetLastAt(),
		DeletedAt:   item.GetDeletedAt(),
	}
}

// 描述：把 runtime Preview 协议结构转换为 services 对外响应实体。
func mapRuntimePreview(item *runtimepb.RuntimePreviewRecord) specs.RuntimePreviewEntity {
	return specs.RuntimePreviewEntity{
		ID:        item.GetId(),
		SandboxID: item.GetSandboxId(),
		URL:       item.GetUrl(),
		Status:    int(item.GetStatus()),
		ExpiresAt: item.GetExpiresAt(),
		CreatedAt: item.GetCreatedAt(),
		LastAt:    item.GetLastAt(),
		DeletedAt: item.GetDeletedAt(),
	}
}

// 描述：校验 runtime 返回的会话记录非空，避免上层收到半初始化结果。
func requireSessionRecord(item *runtimepb.RuntimeSessionRecord) (*runtimepb.RuntimeSessionRecord, error) {
	if item == nil {
		return nil, newInternalError("查询会话失败", fmt.Errorf("runtime 返回空会话"))
	}
	return item, nil
}

// 描述：把 gRPC/runtime 错误统一映射为当前 services 对外使用的 HTTP/业务错误。
func mapRuntimeError(message string, err error) error {
	if err == nil {
		return nil
	}
	if grpcStatus, ok := status.FromError(err); ok {
		switch grpcStatus.Code() {
		case codes.NotFound:
			return newNotFoundError(grpcStatus.Message())
		case codes.PermissionDenied:
			return newForbiddenError(grpcStatus.Message())
		case codes.InvalidArgument:
			return newValidationError(grpcStatus.Message())
		default:
			return newInternalError(message, err)
		}
	}
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		return newNotFoundError(err.Error())
	}
	return newInternalError(message, err)
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

// 描述：归一化桌面更新通道，未传时回退到 stable。
func resolveDesktopUpdateChannel(raw string) string {
	channel := strings.ToLower(strings.TrimSpace(raw))
	if channel == "" {
		return defaultDesktopUpdateChannel
	}
	return channel
}

// 描述：解析桌面端更新发布时间，未配置时回退到当前时间，保证前端展示字段始终有值。
func resolveDesktopUpdatePublishedAt() string {
	raw := strings.TrimSpace(envValue("LIBRA_DESKTOP_PUBLISHED_AT"))
	if raw != "" {
		return raw
	}
	return nowRFC3339()
}

// 描述：根据平台、架构与通道解析桌面端下载地址，优先命中最具体环境变量。
func resolveDesktopUpdateDownloadURL(platform string, arch string, channel string) string {
	platformKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(platform), "-", "_"))
	archKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(arch), "-", "_"))
	channelKey := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(channel), "-", "_"))

	keys := []string{
		"DESKTOP_DOWNLOAD_URL",
		"DESKTOP_DOWNLOAD_URL_" + platformKey,
		"DESKTOP_DOWNLOAD_URL_" + platformKey + "_" + archKey,
	}
	if channelKey != "" {
		keys = append(keys,
			"DESKTOP_DOWNLOAD_URL_"+channelKey,
			"DESKTOP_DOWNLOAD_URL_"+platformKey+"_"+channelKey,
			"DESKTOP_DOWNLOAD_URL_"+platformKey+"_"+archKey+"_"+channelKey,
		)
	}

	prefixes := []string{"LIBRA"}
	candidates := make([]string, 0, len(prefixes)*len(keys))
	for _, prefix := range prefixes {
		for _, key := range keys {
			candidates = append(candidates, prefix+"_"+key)
		}
	}
	for index := len(candidates) - 1; index >= 0; index-- {
		value := strings.TrimSpace(os.Getenv(candidates[index]))
		if value != "" {
			return value
		}
	}
	return ""
}

// 描述：比较语义化版本号，返回 -1/0/1。
func compareSemverVersion(current string, target string) int {
	currentParts := parseSemverParts(current)
	targetParts := parseSemverParts(target)
	if len(currentParts) == 0 || len(targetParts) == 0 {
		return 0
	}
	limit := len(currentParts)
	if len(targetParts) > limit {
		limit = len(targetParts)
	}
	for len(currentParts) < limit {
		currentParts = append(currentParts, 0)
	}
	for len(targetParts) < limit {
		targetParts = append(targetParts, 0)
	}
	for index := 0; index < limit; index++ {
		if currentParts[index] < targetParts[index] {
			return -1
		}
		if currentParts[index] > targetParts[index] {
			return 1
		}
	}
	return 0
}

// 描述：解析语义化版本号为整数切片，忽略前缀 `v` 和后缀标签。
func parseSemverParts(raw string) []int {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	normalized = strings.TrimPrefix(normalized, "v")
	if normalized == "" {
		return nil
	}
	if dashIndex := strings.Index(normalized, "-"); dashIndex >= 0 {
		normalized = normalized[:dashIndex]
	}
	segments := strings.Split(normalized, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		text := strings.TrimSpace(segment)
		if text == "" {
			return nil
		}
		value, err := strconv.Atoi(text)
		if err != nil {
			return nil
		}
		parts = append(parts, value)
	}
	return parts
}

// 描述：返回当前 UTC 时间的 RFC3339 字符串，保证前后端时间格式统一。
func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// 描述：读取多个环境变量中的第一个非空值，便于对同一配置提供多级候选键。
func envValue(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

// 描述：为状态字段提供默认值，未显式传入时回退到激活状态。
func defaultStatus(raw *int) int {
	if raw == nil {
		return defaultActiveStatus
	}
	return *raw
}

// 描述：把可选整型状态转换为 proto 请求值，nil 时回退到 0 表示“不筛选/默认态”。
func optionalStatusInt32(raw *int) int32 {
	if raw == nil {
		return 0
	}
	return int32(*raw)
}

// 描述：归一化可选字符串字段，避免向 runtime 透传空白字符串。
func trimOptionalString(raw *string) string {
	if raw == nil {
		return ""
	}
	return strings.TrimSpace(*raw)
}

// 描述：把可选预览过期秒数转换为 proto 请求字段，未传时回退到 0。
func optionalExpiration(raw *int64) int64 {
	if raw == nil {
		return 0
	}
	return *raw
}

// 描述：对会话列表执行原地倒序，兼容现有 byLastAt<0 的查询约定。
func slicesReverseSession(list []specs.RuntimeSessionEntity) {
	for left, right := 0, len(list)-1; left < right; left, right = left+1, right-1 {
		list[left], list[right] = list[right], list[left]
	}
}
