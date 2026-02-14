package service

import (
	"strconv"
	"strings"
	"sync"
	"time"

	specs "git.zodileap.com/gemini/zodileap_agent_3d/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
)

var (
	// 描述：模型智能体任务执行结果内存存储。
	globalModelTaskExecutionStore = newModelTaskExecutionStore()
)

// 描述：模型智能体任务执行服务。
type ExecuteService struct {
	store *modelTaskExecutionStore
}

// 描述：创建模型智能体任务执行服务实例。
func NewExecuteService() *ExecuteService {
	return &ExecuteService{
		store: globalModelTaskExecutionStore,
	}
}

// 描述：执行模型智能体任务，并返回步骤、日志、错误、产物结构。
func (s *ExecuteService) Execute(req specs.ModelTaskExecuteReq) (specs.ModelTaskExecuteResp, error) {
	return WithService(
		specs.ModelTaskExecuteResp{},
		func(resp specs.ModelTaskExecuteResp) (specs.ModelTaskExecuteResp, error) {
			if strings.TrimSpace(req.Prompt) == "" {
				return resp, newModelTaskExecuteBizError(
					"1040011001",
					zstatuscode.Global_App_ParamInvalid.New().Sprintf("prompt不能为空"),
					"执行指令不能为空",
				)
			}

			now := time.Now()
			statusSuccess := *zspecs.NewStatus(1)
			actionStart := *zspecs.NewLastAt(now)
			actionEnd := *zspecs.NewLastAt(now.Add(240 * time.Millisecond))

			callbackUrl := req.CallbackUrl
			if callbackUrl == nil {
				callbackUrl = zspecs.NewUrl("")
			}

			maxRetry := req.MaxRetry
			if maxRetry <= 0 {
				maxRetry = 2
			}
			retryCount := req.RetryCount
			if retryCount < 0 {
				retryCount = 0
			}

			result := specs.ModelTaskExecuteResult{
				Status: statusSuccess,
				Steps: []specs.ModelTaskExecuteStep{
					{
						Step:        *zspecs.NewCode("parse_prompt"),
						Description: "解析三维任务需求与输入上下文",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
					{
						Step:        *zspecs.NewCode("plan_dcc_ops"),
						Description: "规划 DCC 执行步骤与重试策略",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
					{
						Step:        *zspecs.NewCode("emit_result"),
						Description: "产出模型结果路径与执行摘要",
						Status:      statusSuccess,
						StartedAt:   &actionStart,
						FinishedAt:  &actionEnd,
					},
				},
				Logs: []specs.ModelTaskExecuteLog{
					{
						Level:   *zspecs.NewCode("info"),
						Message: "model execute request accepted",
						At:      zspecs.NewCreatedAt(now),
					},
					{
						Level:   *zspecs.NewCode("info"),
						Message: "dcc execution pipeline finished",
						At:      zspecs.NewCreatedAt(now.Add(300 * time.Millisecond)),
					},
				},
				Errors: []specs.ModelTaskExecuteError{},
				Artifacts: []specs.ModelTaskExecuteArtifact{
					{
						Type:    *zspecs.NewCode("model"),
						Path:    "/tmp/agent_3d/result.glb",
						Summary: "模型主输出文件",
					},
					{
						Type:    *zspecs.NewCode("preview"),
						Path:    "/tmp/agent_3d/preview.png",
						Summary: "模型预览图",
					},
				},
				ResultPath:  "/tmp/agent_3d/result.glb",
				CallbackUrl: callbackUrl,
				RetryPolicy: specs.ModelTaskExecuteRetryPolicy{
					RetryCount: retryCount,
					MaxRetry:   maxRetry,
					Retryable:  retryCount < maxRetry,
					Reason:     "仅在 DCC 连接异常、导出失败等可恢复错误场景重试",
				},
			}
			result.TaskId = s.store.nextID()
			s.store.set(result)
			logAgent3DAuditEvent(
				"execute.invoked",
				map[string]string{
					"userId":     req.UserId.String(),
					"taskId":     result.TaskId.String(),
					"retryCount": strconv.Itoa(retryCount),
					"maxRetry":   strconv.Itoa(maxRetry),
				},
			)
			resp.Result = result
			return resp, nil
		},
	)
}

// 描述：按任务ID查询模型智能体任务执行结果。
func (s *ExecuteService) GetExecuteResult(req specs.ModelTaskExecuteGetReq) (specs.ModelTaskExecuteGetResp, error) {
	return WithService(
		specs.ModelTaskExecuteGetResp{},
		func(resp specs.ModelTaskExecuteGetResp) (specs.ModelTaskExecuteGetResp, error) {
			result, ok := s.store.get(req.TaskId)
			if !ok {
				return resp, newModelTaskExecuteBizError(
					"1040011002",
					zstatuscode.Global_API_GetFailed.New().Sprintf("任务执行结果不存在"),
					"任务执行结果不存在",
				)
			}
			resp.Result = result
			return resp, nil
		},
	)
}

// 描述：构建模型任务执行业务错误。
func newModelTaskExecuteBizError(code string, statusCode *zstatuscode.StatusCode, msg string) error {
	err := zerr.New(code, msg, 4, msg)
	err.StatuCode = statusCode
	return err
}

// 描述：模型任务执行结果内存存储结构。
type modelTaskExecutionStore struct {
	lock sync.RWMutex
	seq  int64
	data map[int64]specs.ModelTaskExecuteResult
}

// 描述：创建模型任务执行结果存储。
func newModelTaskExecutionStore() *modelTaskExecutionStore {
	return &modelTaskExecutionStore{
		data: map[int64]specs.ModelTaskExecuteResult{},
	}
}

// 描述：生成新的任务ID。
func (s *modelTaskExecutionStore) nextID() zspecs.Id {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.seq++
	return *zspecs.NewId(s.seq)
}

// 描述：写入任务执行结果。
func (s *modelTaskExecutionStore) set(result specs.ModelTaskExecuteResult) {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.data[result.TaskId.Int64()] = result
}

// 描述：读取任务执行结果。
func (s *modelTaskExecutionStore) get(id zspecs.Id) (specs.ModelTaskExecuteResult, bool) {
	s.lock.RLock()
	defer s.lock.RUnlock()
	result, ok := s.data[id.Int64()]
	return result, ok
}
