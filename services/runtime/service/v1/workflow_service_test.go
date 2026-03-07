package service

import (
	"path/filepath"
	"testing"

	specs "github.com/zodileap/libra/services/runtime/specs/v1"
)

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

	service, err := NewWorkflowService(filepath.Join(t.TempDir(), "runtime"))
	if err != nil {
		t.Fatalf("创建服务失败: %v", err)
	}

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
