package service

import (
	"testing"

	specs "git.zodileap.com/gemini/zodileap_agent_code/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
)

// 描述：校验空指令场景应返回参数错误。
func TestExecuteServiceExecutePromptRequired(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	_, err := svc.Execute(specs.CodeExecuteReq{})
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

// 描述：校验执行成功并能按执行ID查询结果。
func TestExecuteServiceExecuteAndGet(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	execResp, err := svc.Execute(specs.CodeExecuteReq{
		Prompt: "生成一个按钮组件",
	})
	if err != nil {
		t.Fatalf("执行不应失败: %v", err)
	}
	if execResp.Result.ExecutionId.Int64() <= 0 {
		t.Fatalf("执行ID无效: %d", execResp.Result.ExecutionId.Int64())
	}
	if len(execResp.Result.Actions) == 0 {
		t.Fatalf("执行动作不应为空")
	}
	if len(execResp.Result.Logs) == 0 {
		t.Fatalf("执行日志不应为空")
	}
	if len(execResp.Result.Artifacts) == 0 {
		t.Fatalf("执行产物不应为空")
	}

	getResp, getErr := svc.GetExecuteResult(specs.CodeExecuteGetReq{
		ExecutionId: execResp.Result.ExecutionId,
	})
	if getErr != nil {
		t.Fatalf("查询执行结果不应失败: %v", getErr)
	}
	if getResp.Result.ExecutionId.Int64() != execResp.Result.ExecutionId.Int64() {
		t.Fatalf("查询结果执行ID不匹配")
	}
}

// 描述：校验查询不存在执行结果时返回错误。
func TestExecuteServiceGetNotFound(t *testing.T) {
	t.Parallel()

	svc := NewExecuteService()
	_, err := svc.GetExecuteResult(specs.CodeExecuteGetReq{})
	if err == nil {
		t.Fatalf("不存在的执行ID应返回错误")
	}
}
