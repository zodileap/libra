package service

import (
	"testing"

	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
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

// 描述：校验会话消息存储的写入与分页查询逻辑。
func TestWorkflowMessageStoreAddAndList(t *testing.T) {
	t.Parallel()

	store := newWorkflowMessageStore()
	sessionID := *zspecs.NewId(1001)
	userID := *zspecs.NewUserId("123e4567-e89b-12d3-a456-426614174000")

	first := store.add(sessionID, userID, "user", "hello")
	second := store.add(sessionID, userID, "assistant", "world")

	if first.MessageId.Int64() <= 0 {
		t.Fatalf("首条消息ID无效: %d", first.MessageId.Int64())
	}
	if second.MessageId.Int64() <= first.MessageId.Int64() {
		t.Fatalf("消息ID应递增: first=%d second=%d", first.MessageId.Int64(), second.MessageId.Int64())
	}

	list, total := store.list(sessionID, 1, 1)
	if total != 2 {
		t.Fatalf("消息总数错误: got=%d want=2", total)
	}
	if len(list) != 1 {
		t.Fatalf("分页结果数量错误: got=%d want=1", len(list))
	}
	if list[0].Content != "hello" {
		t.Fatalf("分页第一条内容错误: got=%s want=hello", list[0].Content)
	}

	list, total = store.list(sessionID, 2, 1)
	if total != 2 || len(list) != 1 {
		t.Fatalf("第二页结果错误: total=%d len=%d", total, len(list))
	}
	if list[0].Content != "world" {
		t.Fatalf("第二页内容错误: got=%s want=world", list[0].Content)
	}
}

// 描述：校验会话消息按会话隔离存储。
func TestWorkflowMessageStoreSessionIsolation(t *testing.T) {
	t.Parallel()

	store := newWorkflowMessageStore()
	userID := *zspecs.NewUserId("123e4567-e89b-12d3-a456-426614174000")
	sessionA := *zspecs.NewId(2001)
	sessionB := *zspecs.NewId(2002)

	store.add(sessionA, userID, "user", "A-1")
	store.add(sessionA, userID, "user", "A-2")
	store.add(sessionB, userID, "user", "B-1")

	listA, totalA := store.list(sessionA, 1, 10)
	if totalA != 2 || len(listA) != 2 {
		t.Fatalf("sessionA 数据错误: total=%d len=%d", totalA, len(listA))
	}
	listB, totalB := store.list(sessionB, 1, 10)
	if totalB != 1 || len(listB) != 1 {
		t.Fatalf("sessionB 数据错误: total=%d len=%d", totalB, len(listB))
	}
	if listB[0].Content != "B-1" {
		t.Fatalf("sessionB 内容错误: got=%s want=B-1", listB[0].Content)
	}
}
