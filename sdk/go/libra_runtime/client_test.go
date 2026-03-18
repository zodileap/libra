package libra_runtime

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimepb "github.com/zodileap/libra/sdk/go/libra_runtime/runtimepb"
)

// 描述：
//
//   - 验证 Go SDK 能拉起真实 runtime sidecar，并通过健康检查确认连接可用。
func TestClientShouldStartRuntimeAndReportHealth(t *testing.T) {
	runtimeBin := filepath.Clean(filepath.Join("..", "..", "..", "crates", "target", "debug", "libra-runtime"))
	client := NewClient(Config{
		Addr:           "127.0.0.1:55121",
		DataDir:        filepath.Join(t.TempDir(), "runtime"),
		RuntimeBin:     runtimeBin,
		StartupTimeout: 10 * time.Second,
	})
	defer func() {
		_ = client.Close()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := client.EnsureStarted(ctx); err != nil {
		t.Fatalf("EnsureStarted 应成功，got=%v", err)
	}
	health, err := client.Health(ctx)
	if err != nil {
		t.Fatalf("Health 应成功，got=%v", err)
	}
	if !health.GetReady() {
		t.Fatalf("runtime 应返回 ready=true")
	}
}

// 描述：
//
//   - 验证 Go SDK 能通过真实 runtime sidecar 调用 session/message/sandbox/preview 管理 RPC，
//   - 并确认数据目录下不再生成 legacy runtime-state.json。
func TestClientShouldManageWorkflowResourcesViaSidecar(t *testing.T) {
	runtimeBin := filepath.Clean(filepath.Join("..", "..", "..", "crates", "target", "debug", "libra-runtime"))
	dataDir := filepath.Join(t.TempDir(), "runtime")
	client := NewClient(Config{
		Addr:           "127.0.0.1:55122",
		DataDir:        dataDir,
		RuntimeBin:     runtimeBin,
		StartupTimeout: 10 * time.Second,
	})
	defer func() {
		_ = client.Close()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	sessionResp, err := client.CreateSession(ctx, &runtimepb.CreateSessionRequest{
		TenantId:  "tenant-1",
		UserId:    "user-1",
		ProjectId: "project-1",
		AgentCode: "agent-a",
		Status:    1,
	})
	if err != nil {
		t.Fatalf("CreateSession 应成功，got=%v", err)
	}
	sessionID := sessionResp.GetSession().GetId()
	if sessionID == "" {
		t.Fatalf("CreateSession 应返回 session id")
	}

	messageResp, err := client.CreateMessage(ctx, &runtimepb.CreateMessageRequest{
		SessionId: sessionID,
		UserId:    "user-1",
		Role:      "user",
		Content:   "hello",
	})
	if err != nil {
		t.Fatalf("CreateMessage 应成功，got=%v", err)
	}
	if messageResp.GetMessage().GetContent() != "hello" {
		t.Fatalf("CreateMessage 内容错误: %+v", messageResp.GetMessage())
	}

	sandboxResp, err := client.CreateSandbox(ctx, &runtimepb.CreateSandboxRequest{
		SessionId:   sessionID,
		ContainerId: "container-1",
		PreviewUrl:  "http://preview.local",
		Status:      1,
	})
	if err != nil {
		t.Fatalf("CreateSandbox 应成功，got=%v", err)
	}
	sandboxID := sandboxResp.GetSandbox().GetId()
	if sandboxID == "" {
		t.Fatalf("CreateSandbox 应返回 sandbox id")
	}

	previewResp, err := client.CreatePreview(ctx, &runtimepb.CreatePreviewRequest{
		SandboxId:      sandboxID,
		Url:            "http://preview.local/app",
		Status:         1,
		ExpirationSecs: 60,
	})
	if err != nil {
		t.Fatalf("CreatePreview 应成功，got=%v", err)
	}
	if previewResp.GetPreview().GetId() == "" {
		t.Fatalf("CreatePreview 应返回 preview id")
	}

	if _, err := os.Stat(filepath.Join(dataDir, "runtime-state.json")); !os.IsNotExist(err) {
		t.Fatalf("不应再生成 runtime-state.json: err=%v", err)
	}
}
