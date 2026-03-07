package service

import (
	"strings"
	"sync"
	"time"

	specs "git.zodileap.com/gemini/libra_agent_code/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
)

var (
	// 描述：代码智能体执行结果内存存储。
	globalCodeExecutionStore = newCodeExecutionStore()
)

// 描述：代码智能体执行服务。
type ExecuteService struct {
	store *codeExecutionStore
}

// 描述：创建代码智能体执行服务实例。
func NewExecuteService() *ExecuteService {
	return &ExecuteService{
		store: globalCodeExecutionStore,
	}
}

// 描述：执行代码智能体任务，返回动作、日志、错误、产物结构。
func (s *ExecuteService) Execute(req specs.CodeExecuteReq) (specs.CodeExecuteResp, error) {
	return WithService(
		specs.CodeExecuteResp{},
		func(resp specs.CodeExecuteResp) (specs.CodeExecuteResp, error) {
			if strings.TrimSpace(req.Prompt) == "" {
				return resp, newCodeExecuteBizError("1030011001", zstatuscode.Global_App_ParamInvalid.New().Sprintf("prompt不能为空"), "执行指令不能为空")
			}

			now := time.Now()
			statusSuccess := *zspecs.NewStatus(1)
			actionStart := *zspecs.NewLastAt(now)
			actionEnd := *zspecs.NewLastAt(now.Add(150 * time.Millisecond))

			result := specs.CodeExecuteResult{
				Status: statusSuccess,
				Actions: []specs.CodeExecuteAction{
					{
						Step:        *zspecs.NewCode("parse_intent"),
						Description: "解析用户需求与目标改动",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
					{
						Step:        *zspecs.NewCode("plan_changes"),
						Description: "规划文件改动并评估风险",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
					{
						Step:        *zspecs.NewCode("emit_patch"),
						Description: "生成补丁并输出执行摘要",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
				},
				Logs: []specs.CodeExecuteLog{
					{
						Level:   *zspecs.NewCode("info"),
						Message: "execute request accepted",
						At:      zspecs.NewCreatedAt(now),
					},
					{
						Level:   *zspecs.NewCode("info"),
						Message: "execution pipeline finished",
						At:      zspecs.NewCreatedAt(now.Add(200 * time.Millisecond)),
					},
				},
				Errors: []specs.CodeExecuteError{},
				Artifacts: []specs.CodeExecuteArtifact{
					{
						Type:    *zspecs.NewCode("plan"),
						Path:    "/tmp/agent_code/plan.md",
						Summary: "本次执行的改动计划摘要",
					},
					{
						Type:    *zspecs.NewCode("patch"),
						Path:    "/tmp/agent_code/changes.patch",
						Summary: "可应用的代码补丁文件",
					},
				},
			}
			result.ExecutionId = s.store.nextID()
			s.store.set(result)
			logAgentCodeAuditEvent(
				"execute.invoked",
				map[string]string{
					"userId":      req.UserId.String(),
					"executionId": result.ExecutionId.String(),
				},
			)
			resp.Result = result
			return resp, nil
		},
	)
}

// 描述：按执行ID查询代码智能体执行结果。
func (s *ExecuteService) GetExecuteResult(req specs.CodeExecuteGetReq) (specs.CodeExecuteGetResp, error) {
	return WithService(
		specs.CodeExecuteGetResp{},
		func(resp specs.CodeExecuteGetResp) (specs.CodeExecuteGetResp, error) {
			result, ok := s.store.get(req.ExecutionId)
			if !ok {
				return resp, newCodeExecuteBizError("1030011002", zstatuscode.Global_API_GetFailed.New().Sprintf("执行结果不存在"), "执行结果不存在")
			}
			resp.Result = result
			return resp, nil
		},
	)
}

// 描述：构建代码执行业务错误。
func newCodeExecuteBizError(code string, statusCode *zstatuscode.StatusCode, msg string) error {
	err := zerr.New(code, msg, 4, msg)
	err.StatuCode = statusCode
	return err
}

// 描述：代码执行结果内存存储结构。
type codeExecutionStore struct {
	lock sync.RWMutex
	seq  int64
	data map[int64]specs.CodeExecuteResult
}

// 描述：创建代码执行结果存储。
func newCodeExecutionStore() *codeExecutionStore {
	return &codeExecutionStore{
		data: map[int64]specs.CodeExecuteResult{},
	}
}

// 描述：生成新的执行ID。
func (s *codeExecutionStore) nextID() zspecs.Id {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.seq++
	return *zspecs.NewId(s.seq)
}

// 描述：写入执行结果。
func (s *codeExecutionStore) set(result specs.CodeExecuteResult) {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.data[result.ExecutionId.Int64()] = result
}

// 描述：读取执行结果。
func (s *codeExecutionStore) get(id zspecs.Id) (specs.CodeExecuteResult, bool) {
	s.lock.RLock()
	defer s.lock.RUnlock()
	result, ok := s.data[id.Int64()]
	return result, ok
}
