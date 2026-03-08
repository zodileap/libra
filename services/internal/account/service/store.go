package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	specs "github.com/zodileap/libra/services/internal/account/specs"
)

const (
	// 描述：默认代码智能体记录 ID。
	defaultCodeAgentID = "agent-code-default"
	// 描述：默认模型智能体记录 ID。
	defaultModelAgentID = "agent-model-default"
)

// 描述：用户持久化结构，负责保存登录、身份和角色信息。
type userRecord struct {
	ID           string                   `json:"id"`
	Name         string                   `json:"name"`
	Email        string                   `json:"email"`
	Phone        string                   `json:"phone,omitempty"`
	Status       int                      `json:"status"`
	PasswordHash string                   `json:"passwordHash"`
	Identities   []specs.AuthIdentityItem `json:"identities"`
	CreatedAt    string                   `json:"createdAt"`
	LastAt       string                   `json:"lastAt"`
}

// 描述：智能体记录结构，定义账号服务内可授权的默认智能体目录。
type agentRecord struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	AgentStatus int    `json:"agentStatus,omitempty"`
	Remark      string `json:"remark,omitempty"`
}

// 描述：用户与智能体授权关系持久化结构。
type agentAccessRecord struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	AgentID    string `json:"agentId"`
	AccessType int    `json:"accessType,omitempty"`
	Duration   int64  `json:"duration,omitempty"`
	Status     int    `json:"status,omitempty"`
	CreatedAt  string `json:"createdAt"`
	LastAt     string `json:"lastAt"`
}

// 描述：权限授权记录持久化结构。
type permissionGrantRecord struct {
	GrantID        string `json:"grantId"`
	ActorUserID    string `json:"actorUserId"`
	TargetUserID   string `json:"targetUserId"`
	TargetUserName string `json:"targetUserName"`
	PermissionCode string `json:"permissionCode"`
	ResourceType   string `json:"resourceType"`
	ResourceName   string `json:"resourceName"`
	GrantedBy      string `json:"grantedBy"`
	Status         string `json:"status"`
	ExpiresAt      string `json:"expiresAt,omitempty"`
	CreatedAt      string `json:"createdAt"`
	LastAt         string `json:"lastAt"`
}

// 描述：账号服务持久化快照，负责保存用户、授权与默认智能体元数据。
type accountState struct {
	Users            map[string]userRecord            `json:"users"`
	Agents           map[string]agentRecord           `json:"agents"`
	AgentAccesses    map[string]agentAccessRecord     `json:"agentAccesses"`
	PermissionGrants map[string]permissionGrantRecord `json:"permissionGrants"`
}

// 描述：文件状态存储，负责线程安全读写和 JSON 持久化。
type stateStore struct {
	mu       sync.RWMutex
	filePath string
	state    accountState
}

// 描述：创建账号服务状态存储，并从本地 JSON 文件恢复已有数据。
func newStateStore(dataDir string) (*stateStore, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, newInternalError("初始化 account 数据目录失败", err)
	}

	store := &stateStore{
		filePath: filepath.Join(dataDir, "account-state.json"),
		state: accountState{
			Users:            map[string]userRecord{},
			Agents:           map[string]agentRecord{},
			AgentAccesses:    map[string]agentAccessRecord{},
			PermissionGrants: map[string]permissionGrantRecord{},
		},
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	store.ensureStateMaps(&store.state)
	store.seedDefaultAgents(&store.state)
	if err := store.persist(); err != nil {
		return nil, err
	}
	return store, nil
}

// 描述：从持久化文件加载已有状态；若文件不存在则保持空状态。
func (s *stateStore) load() error {
	payload, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return newInternalError("读取 account 状态文件失败", err)
	}
	if len(payload) == 0 {
		return nil
	}

	var state accountState
	if err := json.Unmarshal(payload, &state); err != nil {
		return newInternalError("解析 account 状态文件失败", err)
	}
	s.ensureStateMaps(&state)
	s.state = state
	return nil
}

// 描述：确保状态中的 map 已初始化，避免空状态和老文件导致空指针。
func (s *stateStore) ensureStateMaps(state *accountState) {
	if state.Users == nil {
		state.Users = map[string]userRecord{}
	}
	if state.Agents == nil {
		state.Agents = map[string]agentRecord{}
	}
	if state.AgentAccesses == nil {
		state.AgentAccesses = map[string]agentAccessRecord{}
	}
	if state.PermissionGrants == nil {
		state.PermissionGrants = map[string]permissionGrantRecord{}
	}
}

// 描述：向状态中补齐默认智能体定义，确保 Desktop 登录后至少能看到基础入口。
func (s *stateStore) seedDefaultAgents(state *accountState) {
	if _, ok := state.Agents[defaultCodeAgentID]; !ok {
		state.Agents[defaultCodeAgentID] = agentRecord{
			ID:          defaultCodeAgentID,
			Code:        "code",
			Name:        "代码智能体",
			Version:     "0.1.0",
			AgentStatus: 1,
			Remark:      "开源版默认代码智能体",
		}
	}
	if _, ok := state.Agents[defaultModelAgentID]; !ok {
		state.Agents[defaultModelAgentID] = agentRecord{
			ID:          defaultModelAgentID,
			Code:        "model",
			Name:        "模型智能体",
			Version:     "0.1.0",
			AgentStatus: 1,
			Remark:      "开源版默认模型智能体",
		}
	}
}

// 描述：持久化当前状态到 JSON 文件，并采用缩进格式方便本地调试。
func (s *stateStore) persist() error {
	payload, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return newInternalError("编码 account 状态失败", err)
	}
	if err := os.WriteFile(s.filePath, payload, 0o644); err != nil {
		return newInternalError("写入 account 状态失败", err)
	}
	return nil
}

// 描述：只读访问状态快照，适合查询类接口。
func withRead[T any](store *stateStore, fn func(*accountState) (T, error)) (T, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return fn(&store.state)
}

// 描述：可写访问状态快照，并在写入成功后自动落盘。
func withWrite[T any](store *stateStore, fn func(*accountState) (T, error)) (T, error) {
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
