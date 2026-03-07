package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	specs "github.com/zodileap/libra/services/runtime/specs/v1"
)

// 描述：运行时状态快照，统一保存会话、消息、Sandbox 与预览地址。
type runtimeState struct {
	MessageSeq int64                                         `json:"messageSeq"`
	Sessions   map[string]specs.RuntimeSessionEntity         `json:"sessions"`
	Messages   map[string][]specs.WorkflowSessionMessageItem `json:"messages"`
	Sandboxes  map[string]specs.RuntimeSandboxEntity         `json:"sandboxes"`
	Previews   map[string]specs.RuntimePreviewEntity         `json:"previews"`
}

// 描述：文件状态存储，负责线程安全读写与 JSON 持久化。
type stateStore struct {
	mu       sync.RWMutex
	filePath string
	state    runtimeState
}

// 描述：创建状态存储，并从本地 JSON 文件加载已存在的运行时数据。
func newStateStore(dataDir string) (*stateStore, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, newInternalError("初始化 runtime 数据目录失败", err)
	}

	store := &stateStore{
		filePath: filepath.Join(dataDir, "runtime-state.json"),
		state: runtimeState{
			Sessions:  map[string]specs.RuntimeSessionEntity{},
			Messages:  map[string][]specs.WorkflowSessionMessageItem{},
			Sandboxes: map[string]specs.RuntimeSandboxEntity{},
			Previews:  map[string]specs.RuntimePreviewEntity{},
		},
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

// 描述：读取持久化文件并恢复内存状态，文件不存在时保持空状态。
func (s *stateStore) load() error {
	payload, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return newInternalError("读取 runtime 状态文件失败", err)
	}
	if len(payload) == 0 {
		return nil
	}

	var state runtimeState
	if err := json.Unmarshal(payload, &state); err != nil {
		return newInternalError("解析 runtime 状态文件失败", err)
	}
	s.ensureStateMaps(&state)
	s.state = state
	return nil
}

// 描述：保存当前状态到 JSON 文件，写入前使用缩进格式，便于本地调试与排错。
func (s *stateStore) saveLocked() error {
	s.ensureStateMaps(&s.state)
	payload, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return newInternalError("编码 runtime 状态失败", err)
	}
	if err := os.WriteFile(s.filePath, payload, 0o644); err != nil {
		return newInternalError("写入 runtime 状态失败", err)
	}
	return nil
}

// 描述：兜底初始化状态 map，避免老数据或空文件导致空指针访问。
func (s *stateStore) ensureStateMaps(state *runtimeState) {
	if state.Sessions == nil {
		state.Sessions = map[string]specs.RuntimeSessionEntity{}
	}
	if state.Messages == nil {
		state.Messages = map[string][]specs.WorkflowSessionMessageItem{}
	}
	if state.Sandboxes == nil {
		state.Sandboxes = map[string]specs.RuntimeSandboxEntity{}
	}
	if state.Previews == nil {
		state.Previews = map[string]specs.RuntimePreviewEntity{}
	}
}

// 描述：以只读方式访问状态快照，适合查询接口使用。
func withRead[T any](store *stateStore, fn func(*runtimeState) (T, error)) (T, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return fn(&store.state)
}

// 描述：以可写方式访问状态快照，并在回调成功后落盘保存。
func withWrite[T any](store *stateStore, fn func(*runtimeState) (T, error)) (T, error) {
	store.mu.Lock()
	defer store.mu.Unlock()

	result, err := fn(&store.state)
	if err != nil {
		return result, err
	}
	if err := store.saveLocked(); err != nil {
		return result, err
	}
	return result, nil
}
