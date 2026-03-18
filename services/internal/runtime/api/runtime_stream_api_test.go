package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
	service "github.com/zodileap/libra/services/internal/runtime/service"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// 描述：伪造的 runtime-stream sidecar 网关，用于验证 API 层 WebSocket 协议桥接而不依赖真实 sidecar。
type fakeRuntimeSidecarGateway struct {
	mu           sync.Mutex
	openRequests []*runtimepb.RunStartRequest
	stream       service.RunStreamBridge
}

// 描述：记录运行流上的控制消息，并按预设事件序列向 API 层回放 sidecar 事件。
type fakeRunStreamBridge struct {
	mu                sync.Mutex
	events            []*runtimepb.RunEvent
	index             int
	cancelRequests    []*runtimepb.CancelRunRequest
	approvalRequests  []*runtimepb.SubmitApprovalRequest
	userInputRequests []*runtimepb.SubmitUserInputRequest
}

// 描述：记录打开运行流请求，并返回预设的假流实现。
func (f *fakeRuntimeSidecarGateway) OpenRunStream(
	_ context.Context,
	request *runtimepb.RunStartRequest,
) (service.RunStreamBridge, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.openRequests = append(f.openRequests, request)
	return f.stream, nil
}

// 描述：当前测试场景不需要兜底取消 RPC，直接返回成功即可。
func (f *fakeRuntimeSidecarGateway) CancelRun(
	_ context.Context,
	request *runtimepb.CancelRunRequest,
) (*runtimepb.CancelRunResponse, error) {
	_ = request
	return &runtimepb.CancelRunResponse{Ok: true}, nil
}

// 描述：当前测试场景不需要兜底审批 RPC，直接返回成功即可。
func (f *fakeRuntimeSidecarGateway) SubmitApproval(
	_ context.Context,
	request *runtimepb.SubmitApprovalRequest,
) (*runtimepb.SubmitApprovalResponse, error) {
	_ = request
	return &runtimepb.SubmitApprovalResponse{Ok: true}, nil
}

// 描述：当前测试场景不需要兜底用户输入 RPC，直接返回成功即可。
func (f *fakeRuntimeSidecarGateway) SubmitUserInput(
	_ context.Context,
	request *runtimepb.SubmitUserInputRequest,
) (*runtimepb.SubmitUserInputResponse, error) {
	_ = request
	return &runtimepb.SubmitUserInputResponse{Ok: true}, nil
}

// 描述：按测试预设顺序回放运行事件；回放结束后返回 EOF，模拟 sidecar 正常结束流。
func (f *fakeRunStreamBridge) Recv() (*runtimepb.RunEvent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.index >= len(f.events) {
		return nil, io.EOF
	}
	event := f.events[f.index]
	f.index++
	return event, nil
}

// 描述：记录取消控制消息，供测试断言 WebSocket 指令是否成功桥接到活动流。
func (f *fakeRunStreamBridge) CancelRun(sessionID string, runID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cancelRequests = append(f.cancelRequests, &runtimepb.CancelRunRequest{
		SessionId: sessionID,
		RunId:     runID,
	})
	return nil
}

// 描述：记录审批控制消息，供测试断言 WebSocket 指令是否成功桥接到活动流。
func (f *fakeRunStreamBridge) SubmitApproval(approvalID string, approved bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.approvalRequests = append(f.approvalRequests, &runtimepb.SubmitApprovalRequest{
		ApprovalId: approvalID,
		Approved:   approved,
	})
	return nil
}

// 描述：记录用户输入控制消息，供测试断言 WebSocket 指令是否成功桥接到活动流。
func (f *fakeRunStreamBridge) SubmitUserInput(
	requestID string,
	resolution string,
	answers []*runtimepb.UserInputAnswer,
) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.userInputRequests = append(f.userInputRequests, &runtimepb.SubmitUserInputRequest{
		RequestId:  requestID,
		Resolution: resolution,
		Answers:    answers,
	})
	return nil
}

// 描述：关闭发送侧在假流中无需额外动作，但保留实现以满足统一桥接接口。
func (f *fakeRunStreamBridge) CloseSend() error {
	return nil
}

// 描述：验证 runtime-stream 会把 `run.start` 指令转换为 sidecar 运行流，并向前端回推统一事件。
func TestRuntimeStreamShouldBridgeStartAndEvents(t *testing.T) {
	t.Parallel()

	sidecar := &fakeRuntimeSidecarGateway{
		stream: &fakeRunStreamBridge{
			events: []*runtimepb.RunEvent{
				{
					Kind:      "delta",
					Delta:     "hello",
					SessionId: "sess-stream-1",
					TraceId:   "trace-1",
				},
				{
					Kind:      "final",
					SessionId: "sess-stream-1",
					TraceId:   "trace-1",
					FinalResult: &runtimepb.AgentRunResult{
						TraceId:        "trace-1",
						DisplayMessage: "done",
					},
				},
			},
		},
	}
	server := newRuntimeAPITestServer(t, &fakeWorkflowService{}, sidecar)
	defer server.Close()

	conn := dialRuntimeStream(t, server.URL)
	defer conn.Close()

	startPayload := mustMarshalProtoJSON(t, &runtimepb.RunStartRequest{
		Context: &runtimepb.RuntimeContext{
			TenantId:  "tenant-1",
			UserId:    "user-1",
			ProjectId: "project-1",
			SessionId: "sess-stream-1",
		},
		AgentKey: "agent-code-default",
		Provider: "codex",
		Prompt:   "hello",
	})
	if err := conn.WriteJSON(runtimeStreamEnvelope{Type: "run.start", Payload: startPayload}); err != nil {
		t.Fatalf("发送 run.start 失败: %v", err)
	}

	first := readRuntimeStreamEnvelope(t, conn)
	if first.Type != "delta" {
		t.Fatalf("首条事件类型错误: got=%s", first.Type)
	}
	var firstEvent runtimepb.RunEvent
	if err := protojson.Unmarshal(first.Payload, &firstEvent); err != nil {
		t.Fatalf("解析首条事件失败: %v", err)
	}
	if firstEvent.GetDelta() != "hello" || firstEvent.GetSessionId() != "sess-stream-1" {
		t.Fatalf("首条事件内容错误: %+v", firstEvent)
	}

	second := readRuntimeStreamEnvelope(t, conn)
	if second.Type != "final" {
		t.Fatalf("完成事件类型错误: got=%s", second.Type)
	}
	var secondEvent runtimepb.RunEvent
	if err := protojson.Unmarshal(second.Payload, &secondEvent); err != nil {
		t.Fatalf("解析完成事件失败: %v", err)
	}
	if secondEvent.GetFinalResult().GetDisplayMessage() != "done" {
		t.Fatalf("完成事件结果错误: %+v", secondEvent.GetFinalResult())
	}

	sidecar.mu.Lock()
	defer sidecar.mu.Unlock()
	if len(sidecar.openRequests) != 1 || sidecar.openRequests[0].GetContext().GetSessionId() != "sess-stream-1" {
		t.Fatalf("sidecar 打开运行流请求错误: %+v", sidecar.openRequests)
	}
}

// 描述：验证 runtime-stream 会把取消、审批与用户输入指令桥接到当前活动流，而不是丢回旧的本地状态服务。
func TestRuntimeStreamShouldForwardControlMessagesToActiveStream(t *testing.T) {
	t.Parallel()

	stream := &fakeRunStreamBridge{
		events: []*runtimepb.RunEvent{
			{
				Kind:      "started",
				SessionId: "sess-stream-2",
				TraceId:   "trace-2",
			},
		},
	}
	sidecar := &fakeRuntimeSidecarGateway{stream: stream}
	server := newRuntimeAPITestServer(t, &fakeWorkflowService{}, sidecar)
	defer server.Close()

	conn := dialRuntimeStream(t, server.URL)
	defer conn.Close()

	startPayload := mustMarshalProtoJSON(t, &runtimepb.RunStartRequest{
		Context: &runtimepb.RuntimeContext{
			TenantId:  "tenant-1",
			UserId:    "user-1",
			ProjectId: "project-1",
			SessionId: "sess-stream-2",
		},
		AgentKey: "agent-code-default",
		Provider: "codex",
		Prompt:   "hello",
	})
	if err := conn.WriteJSON(runtimeStreamEnvelope{Type: "run.start", Payload: startPayload}); err != nil {
		t.Fatalf("发送 run.start 失败: %v", err)
	}
	_ = readRuntimeStreamEnvelope(t, conn)

	if err := conn.WriteJSON(runtimeStreamEnvelope{
		Type:    "approval.submit",
		Payload: mustMarshalProtoJSON(t, &runtimepb.SubmitApprovalRequest{ApprovalId: "approval-1", Approved: true}),
	}); err != nil {
		t.Fatalf("发送 approval.submit 失败: %v", err)
	}
	if err := conn.WriteJSON(runtimeStreamEnvelope{
		Type: "user_input.submit",
		Payload: mustMarshalProtoJSON(t, &runtimepb.SubmitUserInputRequest{
			RequestId:  "request-1",
			Resolution: "answered",
			Answers: []*runtimepb.UserInputAnswer{
				{QuestionId: "q-1", Value: "value-1"},
			},
		}),
	}); err != nil {
		t.Fatalf("发送 user_input.submit 失败: %v", err)
	}
	if err := conn.WriteJSON(runtimeStreamEnvelope{
		Type:    "run.cancel",
		Payload: mustMarshalProtoJSON(t, &runtimepb.CancelRunRequest{SessionId: "sess-stream-2", RunId: "run-1"}),
	}); err != nil {
		t.Fatalf("发送 run.cancel 失败: %v", err)
	}

	waitForRuntimeStreamControl(t, func() bool {
		stream.mu.Lock()
		defer stream.mu.Unlock()
		return len(stream.approvalRequests) == 1 && len(stream.userInputRequests) == 1 && len(stream.cancelRequests) == 1
	})

	stream.mu.Lock()
	defer stream.mu.Unlock()
	if len(stream.approvalRequests) != 1 || stream.approvalRequests[0].GetApprovalId() != "approval-1" {
		t.Fatalf("审批控制桥接错误: %+v", stream.approvalRequests)
	}
	if len(stream.userInputRequests) != 1 || stream.userInputRequests[0].GetRequestId() != "request-1" {
		t.Fatalf("用户输入控制桥接错误: %+v", stream.userInputRequests)
	}
	if len(stream.cancelRequests) != 1 || stream.cancelRequests[0].GetRunId() != "run-1" {
		t.Fatalf("取消控制桥接错误: %+v", stream.cancelRequests)
	}
}

// 描述：构造 runtime API 测试服务器，并仅挂载当前测试需要的路由与中间件。
func newRuntimeAPITestServer(
	t *testing.T,
	workflow workflowServiceGateway,
	sidecar runtimeSidecarGateway,
) *httptest.Server {
	t.Helper()

	server := &Server{
		workflow:       workflow,
		sidecar:        sidecar,
		allowedOrigins: []string{"*"},
	}
	mux := http.NewServeMux()
	server.registerRoutes(mux)
	return httptest.NewServer(server.withMiddleware(mux))
}

// 描述：建立测试用 WebSocket 连接，统一复用 runtime-stream 路径并补齐浏览器常见 Origin 头。
func dialRuntimeStream(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/workflow/v1/runtime-stream"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{
		"Origin": []string{"http://localhost:3000"},
	})
	if err != nil {
		t.Fatalf("连接 runtime-stream 失败: %v", err)
	}
	return conn
}

// 描述：读取一条 runtime-stream JSON 信封，失败时直接终止测试。
func readRuntimeStreamEnvelope(t *testing.T, conn *websocket.Conn) runtimeStreamEnvelope {
	t.Helper()

	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("读取 runtime-stream 失败: %v", err)
	}
	var envelope runtimeStreamEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("解析 runtime-stream 信封失败: %v", err)
	}
	return envelope
}

// 描述：把 proto 消息编码为 proto JSON，供 WebSocket 测试直接复用线上协议格式。
func mustMarshalProtoJSON(t *testing.T, message proto.Message) json.RawMessage {
	t.Helper()

	payload, err := protojson.Marshal(message)
	if err != nil {
		t.Fatalf("编码 proto JSON 失败: %v", err)
	}
	return payload
}

// 描述：在异步 WebSocket handler 完成控制消息转发前做短暂轮询，避免测试因为调度时序产生偶发失败。
func waitForRuntimeStreamControl(t *testing.T, ready func() bool) {
	t.Helper()

	for range 100 {
		if ready() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("等待 runtime-stream 控制消息转发超时")
}
