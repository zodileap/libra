package service

import (
	"context"
	"strconv"
	"testing"

	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
	specs "github.com/zodileap/libra/services/internal/runtime/specs"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// 描述：用于 workflow service 单测的假 runtime 网关，按需实现最小 sidecar 行为。
type fakeWorkflowRuntimeGateway struct {
	createSessionFn  func(ctx context.Context, request *runtimepb.CreateSessionRequest) (*runtimepb.CreateSessionResponse, error)
	listSessionsFn   func(ctx context.Context, request *runtimepb.ListSessionsRequest) (*runtimepb.ListSessionsResponse, error)
	getSessionFn     func(ctx context.Context, request *runtimepb.GetSessionRequest) (*runtimepb.GetSessionResponse, error)
	updateSessionFn  func(ctx context.Context, request *runtimepb.UpdateSessionStatusRequest) (*runtimepb.UpdateSessionStatusResponse, error)
	createMessageFn  func(ctx context.Context, request *runtimepb.CreateMessageRequest) (*runtimepb.CreateMessageResponse, error)
	listMessagesFn   func(ctx context.Context, request *runtimepb.ListMessagesRequest) (*runtimepb.ListMessagesResponse, error)
	listSandboxesFn  func(ctx context.Context, request *runtimepb.ListSandboxesRequest) (*runtimepb.ListSandboxesResponse, error)
	createSandboxFn  func(ctx context.Context, request *runtimepb.CreateSandboxRequest) (*runtimepb.CreateSandboxResponse, error)
	recycleSandboxFn func(ctx context.Context, request *runtimepb.RecycleSandboxRequest) (*runtimepb.RecycleSandboxResponse, error)
	listPreviewsFn   func(ctx context.Context, request *runtimepb.ListPreviewsRequest) (*runtimepb.ListPreviewsResponse, error)
	createPreviewFn  func(ctx context.Context, request *runtimepb.CreatePreviewRequest) (*runtimepb.CreatePreviewResponse, error)
	expirePreviewFn  func(ctx context.Context, request *runtimepb.ExpirePreviewRequest) (*runtimepb.ExpirePreviewResponse, error)
}

// 描述：执行会话创建；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) CreateSession(ctx context.Context, request *runtimepb.CreateSessionRequest) (*runtimepb.CreateSessionResponse, error) {
	if f.createSessionFn != nil {
		return f.createSessionFn(ctx, request)
	}
	return &runtimepb.CreateSessionResponse{}, nil
}

// 描述：执行会话列表查询；未配置时返回空列表。
func (f *fakeWorkflowRuntimeGateway) ListSessions(ctx context.Context, request *runtimepb.ListSessionsRequest) (*runtimepb.ListSessionsResponse, error) {
	if f.listSessionsFn != nil {
		return f.listSessionsFn(ctx, request)
	}
	return &runtimepb.ListSessionsResponse{}, nil
}

// 描述：执行会话详情查询；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) GetSession(ctx context.Context, request *runtimepb.GetSessionRequest) (*runtimepb.GetSessionResponse, error) {
	if f.getSessionFn != nil {
		return f.getSessionFn(ctx, request)
	}
	return &runtimepb.GetSessionResponse{}, nil
}

// 描述：执行会话状态更新；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) UpdateSessionStatus(ctx context.Context, request *runtimepb.UpdateSessionStatusRequest) (*runtimepb.UpdateSessionStatusResponse, error) {
	if f.updateSessionFn != nil {
		return f.updateSessionFn(ctx, request)
	}
	return &runtimepb.UpdateSessionStatusResponse{}, nil
}

// 描述：执行消息创建；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) CreateMessage(ctx context.Context, request *runtimepb.CreateMessageRequest) (*runtimepb.CreateMessageResponse, error) {
	if f.createMessageFn != nil {
		return f.createMessageFn(ctx, request)
	}
	return &runtimepb.CreateMessageResponse{}, nil
}

// 描述：执行消息查询；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) ListMessages(ctx context.Context, request *runtimepb.ListMessagesRequest) (*runtimepb.ListMessagesResponse, error) {
	if f.listMessagesFn != nil {
		return f.listMessagesFn(ctx, request)
	}
	return &runtimepb.ListMessagesResponse{}, nil
}

// 描述：执行 sandbox 查询；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) ListSandboxes(ctx context.Context, request *runtimepb.ListSandboxesRequest) (*runtimepb.ListSandboxesResponse, error) {
	if f.listSandboxesFn != nil {
		return f.listSandboxesFn(ctx, request)
	}
	return &runtimepb.ListSandboxesResponse{}, nil
}

// 描述：执行 sandbox 创建；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) CreateSandbox(ctx context.Context, request *runtimepb.CreateSandboxRequest) (*runtimepb.CreateSandboxResponse, error) {
	if f.createSandboxFn != nil {
		return f.createSandboxFn(ctx, request)
	}
	return &runtimepb.CreateSandboxResponse{}, nil
}

// 描述：执行 sandbox 回收；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) RecycleSandbox(ctx context.Context, request *runtimepb.RecycleSandboxRequest) (*runtimepb.RecycleSandboxResponse, error) {
	if f.recycleSandboxFn != nil {
		return f.recycleSandboxFn(ctx, request)
	}
	return &runtimepb.RecycleSandboxResponse{}, nil
}

// 描述：执行 preview 查询；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) ListPreviews(ctx context.Context, request *runtimepb.ListPreviewsRequest) (*runtimepb.ListPreviewsResponse, error) {
	if f.listPreviewsFn != nil {
		return f.listPreviewsFn(ctx, request)
	}
	return &runtimepb.ListPreviewsResponse{}, nil
}

// 描述：执行 preview 创建；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) CreatePreview(ctx context.Context, request *runtimepb.CreatePreviewRequest) (*runtimepb.CreatePreviewResponse, error) {
	if f.createPreviewFn != nil {
		return f.createPreviewFn(ctx, request)
	}
	return &runtimepb.CreatePreviewResponse{}, nil
}

// 描述：执行 preview 失效；未配置时返回零值。
func (f *fakeWorkflowRuntimeGateway) ExpirePreview(ctx context.Context, request *runtimepb.ExpirePreviewRequest) (*runtimepb.ExpirePreviewResponse, error) {
	if f.expirePreviewFn != nil {
		return f.expirePreviewFn(ctx, request)
	}
	return &runtimepb.ExpirePreviewResponse{}, nil
}

// 描述：校验分页参数归一化逻辑。
func TestNormalizePagination(t *testing.T) {
	t.Parallel()

	page, pageSize := normalizePagination(0, 0)
	if page != defaultMessagePage {
		t.Fatalf("默认页码错误: got=%d want=%d", page, defaultMessagePage)
	}
	if pageSize != defaultMessagePageSize {
		t.Fatalf("默认分页大小错误: got=%d want=%d", pageSize, defaultMessagePageSize)
	}

	page, pageSize = normalizePagination(2, maxMessagePageSize+10)
	if page != 2 {
		t.Fatalf("页码不应被修改: got=%d want=%d", page, 2)
	}
	if pageSize != maxMessagePageSize {
		t.Fatalf("分页大小上限错误: got=%d want=%d", pageSize, maxMessagePageSize)
	}
}

// 描述：校验会话消息的写入、分页与用户隔离逻辑。
func TestWorkflowMessageStoreAddAndList(t *testing.T) {
	t.Parallel()

	sessionID := "sess-1"
	messages := make([]*runtimepb.RuntimeMessageRecord, 0)
	gateway := &fakeWorkflowRuntimeGateway{
		createSessionFn: func(_ context.Context, request *runtimepb.CreateSessionRequest) (*runtimepb.CreateSessionResponse, error) {
			return &runtimepb.CreateSessionResponse{
				Session: &runtimepb.RuntimeSessionRecord{
					Id:        sessionID,
					UserId:    request.GetUserId(),
					AgentCode: request.GetAgentCode(),
					Status:    1,
				},
			}, nil
		},
		getSessionFn: func(_ context.Context, request *runtimepb.GetSessionRequest) (*runtimepb.GetSessionResponse, error) {
			if request.GetSessionId() != sessionID {
				return nil, status.Error(codes.NotFound, "session not found")
			}
			return &runtimepb.GetSessionResponse{
				Session: &runtimepb.RuntimeSessionRecord{
					Id:        sessionID,
					UserId:    "user-1",
					AgentCode: "code",
					Status:    1,
				},
			}, nil
		},
		createMessageFn: func(_ context.Context, request *runtimepb.CreateMessageRequest) (*runtimepb.CreateMessageResponse, error) {
			record := &runtimepb.RuntimeMessageRecord{
				MessageId: strconv.Itoa(len(messages) + 1),
				SessionId: request.GetSessionId(),
				UserId:    request.GetUserId(),
				Role:      request.GetRole(),
				Content:   request.GetContent(),
			}
			messages = append(messages, record)
			return &runtimepb.CreateMessageResponse{Message: record}, nil
		},
		listMessagesFn: func(_ context.Context, request *runtimepb.ListMessagesRequest) (*runtimepb.ListMessagesResponse, error) {
			page := int(request.GetPage())
			pageSize := int(request.GetPageSize())
			start := (page - 1) * pageSize
			if start >= len(messages) {
				return &runtimepb.ListMessagesResponse{
					List:     []*runtimepb.RuntimeMessageRecord{},
					Total:    int32(len(messages)),
					Page:     request.GetPage(),
					PageSize: request.GetPageSize(),
				}, nil
			}
			end := start + pageSize
			if end > len(messages) {
				end = len(messages)
			}
			return &runtimepb.ListMessagesResponse{
				List:     messages[start:end],
				Total:    int32(len(messages)),
				Page:     request.GetPage(),
				PageSize: request.GetPageSize(),
			}, nil
		},
	}
	service := NewWorkflowService(gateway)

	sessionResp, err := service.CreateSession(specs.WorkflowSessionCreateReq{UserId: "user-1", AgentCode: "code"})
	if err != nil {
		t.Fatalf("创建会话失败: %v", err)
	}

	first, err := service.CreateSessionMessage(specs.WorkflowSessionMessageCreateReq{
		SessionId: sessionResp.Session.ID,
		UserId:    "user-1",
		Role:      "user",
		Content:   "hello",
	})
	if err != nil {
		t.Fatalf("写入首条消息失败: %v", err)
	}
	second, err := service.CreateSessionMessage(specs.WorkflowSessionMessageCreateReq{
		SessionId: sessionResp.Session.ID,
		UserId:    "user-1",
		Role:      "assistant",
		Content:   "world",
	})
	if err != nil {
		t.Fatalf("写入第二条消息失败: %v", err)
	}
	if first.Message.MessageId == second.Message.MessageId {
		t.Fatalf("消息 ID 应递增: first=%s second=%s", first.Message.MessageId, second.Message.MessageId)
	}

	list, err := service.ListSessionMessage(specs.WorkflowSessionMessageListReq{
		SessionId: sessionResp.Session.ID,
		UserId:    "user-1",
		Page:      1,
		PageSize:  1,
	})
	if err != nil {
		t.Fatalf("查询第一页消息失败: %v", err)
	}
	if list.Total != 2 || len(list.List) != 1 || list.List[0].Content != "hello" {
		t.Fatalf("分页第一页结果错误: %+v", list)
	}

	secondPage, err := service.ListSessionMessage(specs.WorkflowSessionMessageListReq{
		SessionId: sessionResp.Session.ID,
		UserId:    "user-1",
		Page:      2,
		PageSize:  1,
	})
	if err != nil {
		t.Fatalf("查询第二页消息失败: %v", err)
	}
	if secondPage.Total != 2 || len(secondPage.List) != 1 || secondPage.List[0].Content != "world" {
		t.Fatalf("分页第二页结果错误: %+v", secondPage)
	}
}

// 描述：校验语义化版本比较逻辑（含 v 前缀与补零对齐）。
func TestCompareSemverVersion(t *testing.T) {
	t.Parallel()

	if compareSemverVersion("0.1.0", "0.2.0") >= 0 {
		t.Fatalf("版本比较错误: 0.1.0 应小于 0.2.0")
	}
	if compareSemverVersion("v1.2.0", "1.2.0") != 0 {
		t.Fatalf("版本比较错误: v1.2.0 应等于 1.2.0")
	}
	if compareSemverVersion("1.2", "1.2.0") != 0 {
		t.Fatalf("版本比较错误: 1.2 应等于 1.2.0")
	}
	if compareSemverVersion("1.2.1", "1.2.0") <= 0 {
		t.Fatalf("版本比较错误: 1.2.1 应大于 1.2.0")
	}
}

// 描述：校验按平台、架构与通道解析下载地址的优先级，并兼容新旧环境变量前缀。
func TestResolveDesktopUpdateDownloadURL(t *testing.T) {
	t.Setenv("LIBRA_DESKTOP_DOWNLOAD_URL", "https://fallback/update.pkg")
	t.Setenv("LIBRA_DESKTOP_DOWNLOAD_URL_DARWIN", "https://darwin/update.pkg")
	t.Setenv("LIBRA_DESKTOP_DOWNLOAD_URL_DARWIN_ARM64", "https://darwin-arm64/update.pkg")
	t.Setenv("LIBRA_DESKTOP_DOWNLOAD_URL_DARWIN_ARM64_STABLE", "https://darwin-arm64-stable/update.pkg")

	got := resolveDesktopUpdateDownloadURL("darwin", "arm64", "stable")
	if got != "https://darwin-arm64-stable/update.pkg" {
		t.Fatalf("下载地址优先级错误: got=%s", got)
	}
}
