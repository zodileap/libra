package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
	service "github.com/zodileap/libra/services/internal/runtime/service"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// 描述：统一 sidecar 网关接口，便于 API 层在测试中注入假实现，而生产环境继续复用 Go SDK 适配层。
type runtimeSidecarGateway interface {
	OpenRunStream(ctx context.Context, request *runtimepb.RunStartRequest) (service.RunStreamBridge, error)
	CancelRun(ctx context.Context, request *runtimepb.CancelRunRequest) (*runtimepb.CancelRunResponse, error)
	SubmitApproval(ctx context.Context, request *runtimepb.SubmitApprovalRequest) (*runtimepb.SubmitApprovalResponse, error)
	SubmitUserInput(ctx context.Context, request *runtimepb.SubmitUserInputRequest) (*runtimepb.SubmitUserInputResponse, error)
}

// 描述：运行流 WebSocket 指令信封；`type` 决定 payload 应反序列化到哪种 runtime.v1 proto 消息。
type runtimeStreamEnvelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// 描述：运行流错误负载，统一承载用户可读错误信息，避免直接暴露底层堆栈或 gRPC 技术细节。
type runtimeStreamErrorPayload struct {
	Message string `json:"message"`
}

// 描述：处理统一 runtime WebSocket 执行流，把浏览器命令桥接到 sidecar gRPC 双向流。
func (s *Server) handleRuntimeStream(w http.ResponseWriter, r *http.Request) {
	if !allowMethod(w, r, http.MethodGet) {
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return s.isWebSocketOriginAllowed(r.Header.Get("Origin"))
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[runtime] upgrade websocket failed: %v", err)
		return
	}
	defer conn.Close()

	writeMu := &sync.Mutex{}
	var activeStream service.RunStreamBridge
	defer func() {
		if activeStream != nil {
			_ = activeStream.CloseSend()
		}
	}()

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("[runtime] read websocket message failed: %v", err)
			}
			return
		}

		var envelope runtimeStreamEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			writeRuntimeStreamError(conn, writeMu, "runtime-stream 请求格式无效")
			continue
		}

		switch strings.TrimSpace(envelope.Type) {
		case "run.start":
			if activeStream != nil {
				writeRuntimeStreamError(conn, writeMu, "当前连接已存在活动运行流")
				continue
			}
			start, err := decodeRuntimeStreamPayload(envelope.Payload, &runtimepb.RunStartRequest{})
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "run.start payload 无效")
				continue
			}
			if err := validateRuntimeStreamStart(start); err != nil {
				writeRuntimeStreamError(conn, writeMu, err.Error())
				continue
			}
			stream, err := s.sidecar.OpenRunStream(context.Background(), start)
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "启动 runtime sidecar 运行流失败")
				continue
			}
			activeStream = stream
			go forwardRuntimeStreamEvents(conn, writeMu, stream)
		case "run.cancel":
			request, err := decodeRuntimeStreamPayload(envelope.Payload, &runtimepb.CancelRunRequest{})
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "run.cancel payload 无效")
				continue
			}
			if activeStream != nil {
				err = activeStream.CancelRun(request.GetSessionId(), request.GetRunId())
			} else {
				_, err = s.sidecar.CancelRun(context.Background(), request)
			}
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "提交取消请求失败")
			}
		case "approval.submit":
			request, err := decodeRuntimeStreamPayload(envelope.Payload, &runtimepb.SubmitApprovalRequest{})
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "approval.submit payload 无效")
				continue
			}
			if activeStream != nil {
				err = activeStream.SubmitApproval(request.GetApprovalId(), request.GetApproved())
			} else {
				_, err = s.sidecar.SubmitApproval(context.Background(), request)
			}
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "提交审批结果失败")
			}
		case "user_input.submit":
			request, err := decodeRuntimeStreamPayload(envelope.Payload, &runtimepb.SubmitUserInputRequest{})
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "user_input.submit payload 无效")
				continue
			}
			if activeStream != nil {
				err = activeStream.SubmitUserInput(
					request.GetRequestId(),
					request.GetResolution(),
					request.GetAnswers(),
				)
			} else {
				_, err = s.sidecar.SubmitUserInput(context.Background(), request)
			}
			if err != nil {
				writeRuntimeStreamError(conn, writeMu, "提交用户输入失败")
			}
		default:
			writeRuntimeStreamError(conn, writeMu, "不支持的 runtime-stream 指令")
		}
	}
}

// 描述：从 proto JSON 负载解码 runtime-stream 命令体，保持 WebSocket 协议与 runtime.v1 字段名一致。
func decodeRuntimeStreamPayload[T proto.Message](payload json.RawMessage, target T) (T, error) {
	if len(payload) == 0 {
		return target, io.EOF
	}
	if err := protojson.Unmarshal(payload, target); err != nil {
		return target, err
	}
	return target, nil
}

// 描述：校验运行开始负载中的关键上下文字段，确保服务网关不会在缺失用户隔离信息时放行执行。
func validateRuntimeStreamStart(request *runtimepb.RunStartRequest) error {
	if request == nil {
		return errors.New("run.start payload 不能为空")
	}
	context := request.GetContext()
	if context == nil {
		return errors.New("run.start.context 不能为空")
	}
	switch {
	case strings.TrimSpace(context.GetTenantId()) == "":
		return errors.New("tenantId 不能为空")
	case strings.TrimSpace(context.GetUserId()) == "":
		return errors.New("userId 不能为空")
	case strings.TrimSpace(context.GetProjectId()) == "":
		return errors.New("projectId 不能为空")
	case strings.TrimSpace(context.GetSessionId()) == "":
		return errors.New("sessionId 不能为空")
	case strings.TrimSpace(request.GetAgentKey()) == "":
		return errors.New("agentKey 不能为空")
	case strings.TrimSpace(request.GetProvider()) == "":
		return errors.New("provider 不能为空")
	case strings.TrimSpace(request.GetPrompt()) == "":
		return errors.New("prompt 不能为空")
	default:
		return nil
	}
}

// 描述：把 sidecar 返回的运行事件逐条写回 WebSocket，并维持事件 `type` 与 runtime event kind 一致。
func forwardRuntimeStreamEvents(
	conn *websocket.Conn,
	writeMu *sync.Mutex,
	stream service.RunStreamBridge,
) {
	defer stream.CloseSend()

	for {
		event, err := stream.Recv()
		if err != nil {
			if err != io.EOF {
				writeRuntimeStreamError(conn, writeMu, "接收 runtime 事件失败")
			}
			return
		}
		payload, err := protojson.Marshal(event)
		if err != nil {
			writeRuntimeStreamError(conn, writeMu, "编码 runtime 事件失败")
			return
		}
		if err := writeRuntimeStreamEnvelope(conn, writeMu, runtimeStreamEnvelope{
			Type:    event.GetKind(),
			Payload: json.RawMessage(payload),
		}); err != nil {
			return
		}
		if event.GetFinalResult() != nil || event.GetKind() == "error" || event.GetKind() == "cancelled" {
			return
		}
	}
}

// 描述：输出统一运行流错误事件，避免多个写入协程并发操作同一条 WebSocket 连接。
func writeRuntimeStreamError(conn *websocket.Conn, writeMu *sync.Mutex, message string) {
	payload, err := json.Marshal(runtimeStreamErrorPayload{Message: message})
	if err != nil {
		log.Printf("[runtime] encode runtime stream error failed: %v", err)
		return
	}
	if err := writeRuntimeStreamEnvelope(conn, writeMu, runtimeStreamEnvelope{
		Type:    "error",
		Payload: payload,
	}); err != nil {
		log.Printf("[runtime] write runtime stream error failed: %v", err)
	}
}

// 描述：串行写入 WebSocket 信封，确保运行事件和错误事件不会发生交叉输出。
func writeRuntimeStreamEnvelope(
	conn *websocket.Conn,
	writeMu *sync.Mutex,
	envelope runtimeStreamEnvelope,
) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	return conn.WriteJSON(envelope)
}

// 描述：校验 WebSocket Origin 是否被当前服务配置允许，避免浏览器侧误用任意来源直接接入执行流。
func (s *Server) isWebSocketOriginAllowed(origin string) bool {
	if len(s.allowedOrigins) == 0 {
		return true
	}
	trimmedOrigin := strings.TrimSpace(origin)
	for _, allowed := range s.allowedOrigins {
		if allowed == "*" || strings.TrimSpace(allowed) == trimmedOrigin {
			return true
		}
	}
	return trimmedOrigin == ""
}
