package service

import (
	"testing"

	specs "git.zodileap.com/gemini/libra_agent_3d/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
)

// 描述：校验空指令场景应返回参数错误。
func TestExecuteServiceExecutePromptRequired(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	_, err := svc.Execute(specs.ModelTaskExecuteReq{})
	if err == nil {
		t.Fatalf("空 prompt 应返回错误")
	}

	ze, ok := err.(*zerr.Err)
	if !ok {
		t.Fatalf("错误类型应为 *zerr.Err")
	}
	if ze.StatuCode == nil {
		t.Fatalf("业务状态码不应为空")
	}
	if ze.StatuCode.Code() != zstatuscode.Global_App_ParamInvalid.New().Code() {
		t.Fatalf("业务状态码不匹配: got=%d", ze.StatuCode.Code())
	}
}

// 描述：校验执行成功并能按任务ID查询结果。
func TestExecuteServiceExecuteAndGet(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	execResp, err := svc.Execute(specs.ModelTaskExecuteReq{
		Prompt: "生成一个机械臂模型并导出 glb",
	})
	if err != nil {
		t.Fatalf("执行不应失败: %v", err)
	}
	if execResp.Result.TaskId.Int64() <= 0 {
		t.Fatalf("任务ID无效: %d", execResp.Result.TaskId.Int64())
	}
	if len(execResp.Result.Steps) == 0 {
		t.Fatalf("执行步骤不应为空")
	}
	if len(execResp.Result.Logs) == 0 {
		t.Fatalf("执行日志不应为空")
	}
	if len(execResp.Result.Artifacts) == 0 {
		t.Fatalf("执行产物不应为空")
	}

	getResp, getErr := svc.GetExecuteResult(specs.ModelTaskExecuteGetReq{
		TaskId: execResp.Result.TaskId,
	})
	if getErr != nil {
		t.Fatalf("查询执行结果不应失败: %v", getErr)
	}
	if getResp.Result.TaskId.Int64() != execResp.Result.TaskId.Int64() {
		t.Fatalf("查询结果任务ID不匹配")
	}
}

// 描述：校验查询不存在任务结果时返回错误。
func TestExecuteServiceGetNotFound(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	_, err := svc.GetExecuteResult(specs.ModelTaskExecuteGetReq{})
	if err == nil {
		t.Fatalf("不存在的任务ID应返回错误")
	}
}
