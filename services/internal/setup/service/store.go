package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

const (
	// 描述：初始化流程默认状态，表示尚未完成任何安装步骤。
	setupStatusPending = "pending"
	// 描述：初始化流程失败状态，表示最近一次操作发生错误。
	setupStatusFailed = "failed"
	// 描述：初始化流程完成状态，表示系统已完成首次安装。
	setupStatusCompleted = "completed"

	// 描述：初始化流程数据库阶段已完成标记。
	setupStepDatabaseReady = "database_ready"
	// 描述：初始化流程系统设置阶段已完成标记。
	setupStepSystemReady = "system_ready"
	// 描述：初始化流程管理员阶段已完成标记。
	setupStepAdminReady = "admin_ready"
	// 描述：初始化流程全部完成标记。
	setupStepCompleted = "completed"
)

// 描述：数据库状态快照，保存当前初始化过程中的数据库配置与迁移结果。
type databaseState struct {
	Type                string   `json:"type"`
	Host                string   `json:"host"`
	Port                int      `json:"port"`
	User                string   `json:"user"`
	Password            string   `json:"password"`
	Database            string   `json:"database"`
	SSLMode             string   `json:"sslMode,omitempty"`
	ValidatedAt         string   `json:"validatedAt,omitempty"`
	MigratedAt          string   `json:"migratedAt,omitempty"`
	IsValidated         bool     `json:"isValidated"`
	IsMigrated          bool     `json:"isMigrated"`
	LastMigrationReport []string `json:"lastMigrationReport,omitempty"`
}

// 描述：初始化状态快照，保存数据库配置、系统设置、管理员摘要与安装完成标记。
type setupState struct {
	SetupStatus      string                      `json:"setupStatus"`
	CurrentStep      string                      `json:"currentStep"`
	Installed        bool                        `json:"installed"`
	InstalledAt      string                      `json:"installedAt,omitempty"`
	InstalledVersion string                      `json:"installedVersion,omitempty"`
	LastError        string                      `json:"lastError,omitempty"`
	Database         *databaseState              `json:"database,omitempty"`
	SystemConfig     *specs.SetupSystemConfigReq `json:"systemConfig,omitempty"`
	Admin            *specs.SetupAdminSummary    `json:"admin,omitempty"`
}

// 描述：文件状态存储，负责线程安全读写与 JSON 持久化。
type stateStore struct {
	mu       sync.RWMutex
	filePath string
	state    setupState
}

// 描述：创建状态存储，并从本地 JSON 文件加载已存在的 setup 数据。
func newStateStore(dataDir string) (*stateStore, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, newInternalError("初始化 setup 数据目录失败", err)
	}
	store := &stateStore{
		filePath: filepath.Join(dataDir, "setup-state.json"),
		state: setupState{
			SetupStatus: setupStatusPending,
		},
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	store.ensureDefaults(&store.state)
	if err := store.persist(); err != nil {
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
		return newInternalError("读取 setup 状态文件失败", err)
	}
	if len(payload) == 0 {
		return nil
	}
	var state setupState
	if err := json.Unmarshal(payload, &state); err != nil {
		return newInternalError("解析 setup 状态文件失败", err)
	}
	s.ensureDefaults(&state)
	s.state = state
	return nil
}

// 描述：补齐状态默认值，避免老文件或空状态导致缺失字段。
func (s *stateStore) ensureDefaults(state *setupState) {
	if state.SetupStatus == "" {
		state.SetupStatus = setupStatusPending
	}
	if state.CurrentStep == "" {
		state.CurrentStep = setupStatusPending
	}
}

// 描述：保存当前状态到 JSON 文件，使用 0600 权限保护初始化阶段的敏感配置。
func (s *stateStore) persist() error {
	payload, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return newInternalError("编码 setup 状态失败", err)
	}
	if err := os.WriteFile(s.filePath, payload, 0o600); err != nil {
		return newInternalError("写入 setup 状态失败", err)
	}
	return nil
}

// 描述：以只读方式访问状态快照，适合状态查询场景。
func withRead[T any](store *stateStore, fn func(*setupState) (T, error)) (T, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return fn(&store.state)
}

// 描述：以可写方式访问状态快照，并在回调成功后落盘保存。
func withWrite[T any](store *stateStore, fn func(*setupState) (T, error)) (T, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	result, err := fn(&store.state)
	if err != nil {
		return result, err
	}
	if err := store.persist(); err != nil {
		return result, err
	}
	return result, nil
}
