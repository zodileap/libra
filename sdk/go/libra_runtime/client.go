package libra_runtime

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// 描述：Go SDK 的 runtime 客户端配置，统一约束监听地址、sidecar 二进制路径和启动超时。
type Config struct {
	Addr           string
	DataDir        string
	RuntimeBin     string
	StartupTimeout time.Duration
}

// 描述：统一 runtime Go SDK 客户端，负责 sidecar 生命周期、gRPC 连接和运行流管理。
type Client struct {
	mu      sync.Mutex
	config  Config
	conn    *grpc.ClientConn
	service runtimepb.RuntimeServiceClient
	cmd     *exec.Cmd
	streams map[string]runtimepb.RuntimeService_RunClient
}

// 描述：统一 runtime 双向运行流句柄，负责让宿主在单条 gRPC 流上继续发送取消、审批与用户输入控制消息。
type RunStream struct {
	parent    *Client
	sessionID string
	stream    runtimepb.RuntimeService_RunClient
	closeOnce sync.Once
}

// 描述：返回 Go SDK 默认配置，方便 services 和其他宿主直接复用。
func DefaultConfig() Config {
	return Config{
		Addr:           "127.0.0.1:46329",
		DataDir:        filepath.Join(os.TempDir(), "libra", "runtime-go"),
		RuntimeBin:     "libra-runtime",
		StartupTimeout: 10 * time.Second,
	}
}

// 描述：基于给定配置创建 runtime Go SDK 客户端。
func NewClient(cfg Config) *Client {
	if cfg.Addr == "" {
		cfg.Addr = DefaultConfig().Addr
	}
	if cfg.DataDir == "" {
		cfg.DataDir = DefaultConfig().DataDir
	}
	if cfg.RuntimeBin == "" {
		cfg.RuntimeBin = DefaultConfig().RuntimeBin
	}
	if cfg.StartupTimeout <= 0 {
		cfg.StartupTimeout = DefaultConfig().StartupTimeout
	}
	return &Client{
		config:  cfg,
		streams: map[string]runtimepb.RuntimeService_RunClient{},
	}
}

// 描述：确保 runtime sidecar 已启动并建立 gRPC 连接；若当前不可用，则自动拉起本地 sidecar。
func (c *Client) EnsureStarted(ctx context.Context) error {
	if _, err := c.Health(ctx); err == nil {
		return nil
	}

	c.mu.Lock()
	if c.cmd == nil || c.cmd.Process == nil {
		if err := os.MkdirAll(c.config.DataDir, 0o755); err != nil {
			c.mu.Unlock()
			return err
		}
		cmd := exec.Command(
			c.config.RuntimeBin,
			"--addr",
			c.config.Addr,
			"--data-dir",
			c.config.DataDir,
			"serve",
		)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			c.mu.Unlock()
			return fmt.Errorf("启动 runtime sidecar 失败: %w", err)
		}
		c.cmd = cmd
	}
	c.mu.Unlock()

	deadline := time.Now().Add(c.config.StartupTimeout)
	for {
		if _, err := c.Health(ctx); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("等待 runtime sidecar 就绪超时")
		}
		time.Sleep(120 * time.Millisecond)
	}
}

// 描述：执行健康检查，并在需要时懒建立 gRPC 连接。
func (c *Client) Health(ctx context.Context) (*runtimepb.HealthResponse, error) {
	if err := c.ensureDialed(ctx); err != nil {
		return nil, err
	}
	return c.service.Health(ctx, &runtimepb.HealthRequest{})
}

// 描述：检测运行时能力，供 services 网关在发起运行前补齐 prompt 所需上下文。
func (c *Client) DetectCapabilities(
	ctx context.Context,
	request *runtimepb.DetectCapabilitiesRequest,
) (*runtimepb.DetectCapabilitiesResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.DetectCapabilities(ctx, request)
}

// 描述：查询 runtime 持久化会话列表。
func (c *Client) ListSessions(
	ctx context.Context,
	request *runtimepb.ListSessionsRequest,
) (*runtimepb.ListSessionsResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.ListSessions(ctx, request)
}

// 描述：创建新的持久化会话记录，供 services/desktop/cli 复用统一 session 生命周期。
func (c *Client) CreateSession(
	ctx context.Context,
	request *runtimepb.CreateSessionRequest,
) (*runtimepb.CreateSessionResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.CreateSession(ctx, request)
}

// 描述：查询 runtime 持久化中的单个会话详情。
func (c *Client) GetSession(
	ctx context.Context,
	request *runtimepb.GetSessionRequest,
) (*runtimepb.GetSessionResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.GetSession(ctx, request)
}

// 描述：更新指定会话状态，供 services 保持现有状态切换接口但底层统一走 runtime。
func (c *Client) UpdateSessionStatus(
	ctx context.Context,
	request *runtimepb.UpdateSessionStatusRequest,
) (*runtimepb.UpdateSessionStatusResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.UpdateSessionStatus(ctx, request)
}

// 描述：查询 runtime 持久化消息列表。
func (c *Client) ListMessages(
	ctx context.Context,
	request *runtimepb.ListMessagesRequest,
) (*runtimepb.ListMessagesResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.ListMessages(ctx, request)
}

// 描述：创建新的持久化消息记录，供宿主把用户或系统消息统一交给 runtime 保存。
func (c *Client) CreateMessage(
	ctx context.Context,
	request *runtimepb.CreateMessageRequest,
) (*runtimepb.CreateMessageResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.CreateMessage(ctx, request)
}

// 描述：查询 Sandbox 列表，供 services 继续暴露既有管理 REST 入口。
func (c *Client) ListSandboxes(
	ctx context.Context,
	request *runtimepb.ListSandboxesRequest,
) (*runtimepb.ListSandboxesResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.ListSandboxes(ctx, request)
}

// 描述：创建 Sandbox 记录，并把状态落入 runtime 唯一 SQLite 存储。
func (c *Client) CreateSandbox(
	ctx context.Context,
	request *runtimepb.CreateSandboxRequest,
) (*runtimepb.CreateSandboxResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.CreateSandbox(ctx, request)
}

// 描述：回收 Sandbox 记录，并同步失效其关联 Preview。
func (c *Client) RecycleSandbox(
	ctx context.Context,
	request *runtimepb.RecycleSandboxRequest,
) (*runtimepb.RecycleSandboxResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.RecycleSandbox(ctx, request)
}

// 描述：查询 Preview 列表，供 services 对外维持既有 preview 查询接口。
func (c *Client) ListPreviews(
	ctx context.Context,
	request *runtimepb.ListPreviewsRequest,
) (*runtimepb.ListPreviewsResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.ListPreviews(ctx, request)
}

// 描述：创建 Preview 记录，并把过期时间计算交给 runtime 服务端处理。
func (c *Client) CreatePreview(
	ctx context.Context,
	request *runtimepb.CreatePreviewRequest,
) (*runtimepb.CreatePreviewResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.CreatePreview(ctx, request)
}

// 描述：使一个或多个 Preview 失效，并返回 runtime 侧实际处理数量。
func (c *Client) ExpirePreview(
	ctx context.Context,
	request *runtimepb.ExpirePreviewRequest,
) (*runtimepb.ExpirePreviewResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.ExpirePreview(ctx, request)
}

// 描述：建立统一运行流，向宿主输出增量事件，并在结束时返回最终结果。
func (c *Client) Run(
	ctx context.Context,
	request *runtimepb.RunStartRequest,
	onEvent func(*runtimepb.RunEvent) error,
) (*runtimepb.AgentRunResult, error) {
	runStream, err := c.OpenRunStream(ctx, request)
	if err != nil {
		return nil, err
	}
	defer runStream.CloseSend()

	for {
		event, err := runStream.Recv()
		if err != nil {
			return nil, err
		}
		if onEvent != nil {
			if err := onEvent(event); err != nil {
				return nil, err
			}
		}
		if event.GetFinalResult() != nil {
			return event.GetFinalResult(), nil
		}
		if event.GetKind() == "error" || event.GetKind() == "cancelled" {
			return nil, fmt.Errorf("%s: %s", event.GetCode(), event.GetMessage())
		}
	}
}

// 描述：打开一条新的运行流，并在首帧发送 `start_run` 控制消息。
func (c *Client) OpenRunStream(
	ctx context.Context,
	request *runtimepb.RunStartRequest,
) (*RunStream, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	stream, err := c.service.Run(ctx)
	if err != nil {
		return nil, err
	}
	if err := stream.Send(&runtimepb.RunControlRequest{
		Payload: &runtimepb.RunControlRequest_StartRun{StartRun: request},
	}); err != nil {
		return nil, err
	}

	sessionID := ""
	if request.GetContext() != nil {
		sessionID = request.GetContext().GetSessionId()
	}
	if sessionID != "" {
		c.mu.Lock()
		c.streams[sessionID] = stream
		c.mu.Unlock()
	}

	return &RunStream{
		parent:    c,
		sessionID: sessionID,
		stream:    stream,
	}, nil
}

// 描述：取消指定会话正在执行的任务；若当前进程持有活动流，则优先复用该流发送控制消息。
func (c *Client) CancelRun(ctx context.Context, sessionID string) error {
	if err := c.EnsureStarted(ctx); err != nil {
		return err
	}
	if sessionID == "" {
		return fmt.Errorf("sessionID 不能为空")
	}
	c.mu.Lock()
	stream := c.streams[sessionID]
	c.mu.Unlock()
	if stream != nil {
		return stream.Send(&runtimepb.RunControlRequest{
			Payload: &runtimepb.RunControlRequest_CancelRun{
				CancelRun: &runtimepb.CancelRunRequest{SessionId: sessionID},
			},
		})
	}
	_, err := c.service.CancelRun(ctx, &runtimepb.CancelRunRequest{SessionId: sessionID})
	return err
}

// 描述：提交人工审批结果。
func (c *Client) SubmitApproval(ctx context.Context, approvalID string, approved bool) error {
	if err := c.EnsureStarted(ctx); err != nil {
		return err
	}
	_, err := c.service.SubmitApproval(ctx, &runtimepb.SubmitApprovalRequest{
		ApprovalId: approvalID,
		Approved:   approved,
	})
	return err
}

// 描述：提交结构化用户输入结果。
func (c *Client) SubmitUserInput(
	ctx context.Context,
	requestID string,
	resolution string,
	answers []*runtimepb.UserInputAnswer,
) error {
	if err := c.EnsureStarted(ctx); err != nil {
		return err
	}
	_, err := c.service.SubmitUserInput(ctx, &runtimepb.SubmitUserInputRequest{
		RequestId:  requestID,
		Resolution: resolution,
		Answers:    answers,
	})
	return err
}

// 描述：通过 runtime 代理纯模型调用，供总结/记忆和其他非编排场景复用。
func (c *Client) CallModel(
	ctx context.Context,
	request *runtimepb.CallModelRequest,
) (*runtimepb.CallModelResponse, error) {
	if err := c.EnsureStarted(ctx); err != nil {
		return nil, err
	}
	return c.service.CallModel(ctx, request)
}

// 描述：关闭当前 gRPC 连接与 sidecar 子进程；若 sidecar 由其他宿主维护，则仅关闭当前连接。
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
		c.service = nil
	}
	if c.cmd != nil && c.cmd.Process != nil {
		_ = c.cmd.Process.Kill()
		_, _ = c.cmd.Process.Wait()
		c.cmd = nil
	}
	return nil
}

// 描述：接收 sidecar 推送的一条运行事件；若流已关闭，会自动清理内部注册表。
func (s *RunStream) Recv() (*runtimepb.RunEvent, error) {
	event, err := s.stream.Recv()
	if err != nil {
		if err == io.EOF {
			s.cleanup()
		}
		return nil, err
	}
	return event, nil
}

// 描述：通过当前运行流直接下发取消控制消息，优先复用已建立的双向流。
func (s *RunStream) CancelRun(sessionID string, runID string) error {
	if strings.TrimSpace(sessionID) == "" {
		sessionID = s.sessionID
	}
	return s.stream.Send(&runtimepb.RunControlRequest{
		Payload: &runtimepb.RunControlRequest_CancelRun{
			CancelRun: &runtimepb.CancelRunRequest{
				SessionId: sessionID,
				RunId:     runID,
			},
		},
	})
}

// 描述：通过当前运行流提交人工审批结果。
func (s *RunStream) SubmitApproval(approvalID string, approved bool) error {
	return s.stream.Send(&runtimepb.RunControlRequest{
		Payload: &runtimepb.RunControlRequest_SubmitApproval{
			SubmitApproval: &runtimepb.SubmitApprovalRequest{
				ApprovalId: approvalID,
				Approved:   approved,
			},
		},
	})
}

// 描述：通过当前运行流提交结构化用户输入答案。
func (s *RunStream) SubmitUserInput(
	requestID string,
	resolution string,
	answers []*runtimepb.UserInputAnswer,
) error {
	return s.stream.Send(&runtimepb.RunControlRequest{
		Payload: &runtimepb.RunControlRequest_SubmitUserInput{
			SubmitUserInput: &runtimepb.SubmitUserInputRequest{
				RequestId:  requestID,
				Resolution: resolution,
				Answers:    answers,
			},
		},
	})
}

// 描述：关闭当前流的发送侧，并清理宿主客户端中登记的活动流。
func (s *RunStream) CloseSend() error {
	s.cleanup()
	return s.stream.CloseSend()
}

// 描述：清理客户端内部的活动流映射，避免后续控制消息复用到已经结束的流。
func (s *RunStream) cleanup() {
	s.closeOnce.Do(func() {
		if s.parent == nil || s.sessionID == "" {
			return
		}
		s.parent.mu.Lock()
		delete(s.parent.streams, s.sessionID)
		s.parent.mu.Unlock()
	})
}

// 描述：在首次调用时懒建立 gRPC 连接，并在连接断开后支持重建。
func (c *Client) ensureDialed(ctx context.Context) error {
	c.mu.Lock()
	if c.conn != nil && c.service != nil {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	dialCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(
		dialCtx,
		c.config.Addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.service = runtimepb.NewRuntimeServiceClient(conn)
	c.mu.Unlock()
	return nil
}
