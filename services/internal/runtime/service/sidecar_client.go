package service

import (
	"context"
	"path/filepath"
	"time"

	libraRuntime "github.com/zodileap/libra/sdk/go/libra_runtime"
	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
)

// 描述：runtime sidecar 适配层配置，负责对齐 services 的统一监听地址、数据目录与 sidecar 二进制路径。
type RuntimeSidecarClientConfig struct {
	Addr       string
	DataDir    string
	RuntimeBin string
}

// 描述：统一运行流桥接接口，负责暴露 services 网关实际需要的最小流式控制能力。
type RunStreamBridge interface {
	Recv() (*runtimepb.RunEvent, error)
	CancelRun(sessionID string, runID string) error
	SubmitApproval(approvalID string, approved bool) error
	SubmitUserInput(requestID string, resolution string, answers []*runtimepb.UserInputAnswer) error
	CloseSend() error
}

// 描述：统一 runtime sidecar 适配层，负责把 services 侧调用转发到 Go SDK。
type RuntimeSidecarClient struct {
	client *libraRuntime.Client
}

// 描述：基于 services data 目录创建 runtime sidecar 适配层，并统一使用 Rust runtime 作为唯一运行时数据源。
//
// Params:
//
//   - config: sidecar 适配层配置。
//
// Returns:
//
//   - 0: 已初始化的 sidecar 适配层。
func NewRuntimeSidecarClient(sidecarConfig RuntimeSidecarClientConfig) *RuntimeSidecarClient {
	config := libraRuntime.DefaultConfig()
	if sidecarConfig.DataDir != "" {
		config.DataDir = filepath.Join(sidecarConfig.DataDir, "sidecar")
	}
	if sidecarConfig.Addr != "" {
		config.Addr = sidecarConfig.Addr
	}
	if sidecarConfig.RuntimeBin != "" {
		config.RuntimeBin = sidecarConfig.RuntimeBin
	}
	config.StartupTimeout = 10 * time.Second
	return &RuntimeSidecarClient{
		client: libraRuntime.NewClient(config),
	}
}

// 描述：执行 runtime 健康检查，供服务端启动自检或后续网关预热使用。
func (c *RuntimeSidecarClient) Health(ctx context.Context) (*runtimepb.HealthResponse, error) {
	return c.client.Health(ctx)
}

// 描述：向 runtime 创建新的会话记录，供 services 对外会话创建接口复用。
func (c *RuntimeSidecarClient) CreateSession(
	ctx context.Context,
	request *runtimepb.CreateSessionRequest,
) (*runtimepb.CreateSessionResponse, error) {
	return c.client.CreateSession(ctx, request)
}

// 描述：向 runtime 查询当前会话分页消息列表。
func (c *RuntimeSidecarClient) ListMessages(
	ctx context.Context,
	request *runtimepb.ListMessagesRequest,
) (*runtimepb.ListMessagesResponse, error) {
	return c.client.ListMessages(ctx, request)
}

// 描述：向 runtime 创建新的会话消息记录。
func (c *RuntimeSidecarClient) CreateMessage(
	ctx context.Context,
	request *runtimepb.CreateMessageRequest,
) (*runtimepb.CreateMessageResponse, error) {
	return c.client.CreateMessage(ctx, request)
}

// 描述：向 runtime 查询当前用户可见的会话列表。
func (c *RuntimeSidecarClient) ListSessions(
	ctx context.Context,
	request *runtimepb.ListSessionsRequest,
) (*runtimepb.ListSessionsResponse, error) {
	return c.client.ListSessions(ctx, request)
}

// 描述：向 runtime 查询指定会话详情。
func (c *RuntimeSidecarClient) GetSession(
	ctx context.Context,
	request *runtimepb.GetSessionRequest,
) (*runtimepb.GetSessionResponse, error) {
	return c.client.GetSession(ctx, request)
}

// 描述：向 runtime 更新指定会话状态。
func (c *RuntimeSidecarClient) UpdateSessionStatus(
	ctx context.Context,
	request *runtimepb.UpdateSessionStatusRequest,
) (*runtimepb.UpdateSessionStatusResponse, error) {
	return c.client.UpdateSessionStatus(ctx, request)
}

// 描述：向 runtime 查询 sandbox 列表。
func (c *RuntimeSidecarClient) ListSandboxes(
	ctx context.Context,
	request *runtimepb.ListSandboxesRequest,
) (*runtimepb.ListSandboxesResponse, error) {
	return c.client.ListSandboxes(ctx, request)
}

// 描述：向 runtime 创建 sandbox 记录。
func (c *RuntimeSidecarClient) CreateSandbox(
	ctx context.Context,
	request *runtimepb.CreateSandboxRequest,
) (*runtimepb.CreateSandboxResponse, error) {
	return c.client.CreateSandbox(ctx, request)
}

// 描述：向 runtime 回收 sandbox 记录。
func (c *RuntimeSidecarClient) RecycleSandbox(
	ctx context.Context,
	request *runtimepb.RecycleSandboxRequest,
) (*runtimepb.RecycleSandboxResponse, error) {
	return c.client.RecycleSandbox(ctx, request)
}

// 描述：向 runtime 查询 preview 列表。
func (c *RuntimeSidecarClient) ListPreviews(
	ctx context.Context,
	request *runtimepb.ListPreviewsRequest,
) (*runtimepb.ListPreviewsResponse, error) {
	return c.client.ListPreviews(ctx, request)
}

// 描述：向 runtime 创建 preview 记录。
func (c *RuntimeSidecarClient) CreatePreview(
	ctx context.Context,
	request *runtimepb.CreatePreviewRequest,
) (*runtimepb.CreatePreviewResponse, error) {
	return c.client.CreatePreview(ctx, request)
}

// 描述：向 runtime 失效 preview 记录。
func (c *RuntimeSidecarClient) ExpirePreview(
	ctx context.Context,
	request *runtimepb.ExpirePreviewRequest,
) (*runtimepb.ExpirePreviewResponse, error) {
	return c.client.ExpirePreview(ctx, request)
}

// 描述：打开统一运行流，供 services WebSocket 网关把浏览器命令桥接到 sidecar。
func (c *RuntimeSidecarClient) OpenRunStream(
	ctx context.Context,
	request *runtimepb.RunStartRequest,
) (RunStreamBridge, error) {
	return c.client.OpenRunStream(ctx, request)
}

// 描述：提交统一运行流之外的取消请求，供网关在流尚未建立时兜底使用。
func (c *RuntimeSidecarClient) CancelRun(
	ctx context.Context,
	request *runtimepb.CancelRunRequest,
) (*runtimepb.CancelRunResponse, error) {
	if err := c.client.CancelRun(ctx, request.GetSessionId()); err != nil {
		return nil, err
	}
	return &runtimepb.CancelRunResponse{Ok: true}, nil
}

// 描述：提交统一运行流之外的审批结果，供网关在没有活动双向流时兜底使用。
func (c *RuntimeSidecarClient) SubmitApproval(
	ctx context.Context,
	request *runtimepb.SubmitApprovalRequest,
) (*runtimepb.SubmitApprovalResponse, error) {
	if err := c.client.SubmitApproval(ctx, request.GetApprovalId(), request.GetApproved()); err != nil {
		return nil, err
	}
	return &runtimepb.SubmitApprovalResponse{Ok: true}, nil
}

// 描述：提交统一运行流之外的用户输入答案，供网关在没有活动双向流时兜底使用。
func (c *RuntimeSidecarClient) SubmitUserInput(
	ctx context.Context,
	request *runtimepb.SubmitUserInputRequest,
) (*runtimepb.SubmitUserInputResponse, error) {
	if err := c.client.SubmitUserInput(ctx, request.GetRequestId(), request.GetResolution(), request.GetAnswers()); err != nil {
		return nil, err
	}
	return &runtimepb.SubmitUserInputResponse{Ok: true}, nil
}
