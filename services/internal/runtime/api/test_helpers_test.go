package api

import (
	specs "github.com/zodileap/libra/services/internal/runtime/specs"
)

// 描述：可按需注入函数的假 workflow 服务，用于 API 层测试隔离真实 sidecar 与业务实现。
type fakeWorkflowService struct {
	createSessionFn        func(req specs.WorkflowSessionCreateReq) (specs.WorkflowSessionCreateResp, error)
	listSessionFn          func(req specs.WorkflowSessionListReq) (specs.WorkflowSessionListResp, error)
	getSessionFn           func(req specs.WorkflowSessionGetReq) (specs.WorkflowSessionGetResp, error)
	updateSessionStatusFn  func(req specs.WorkflowSessionStatusUpdateReq) (specs.WorkflowSessionStatusUpdateResp, error)
	createSessionMessageFn func(req specs.WorkflowSessionMessageCreateReq) (specs.WorkflowSessionMessageCreateResp, error)
	listSessionMessageFn   func(req specs.WorkflowSessionMessageListReq) (specs.WorkflowSessionMessageListResp, error)
	createSandboxFn        func(req specs.WorkflowSandboxCreateReq) (specs.WorkflowSandboxCreateResp, error)
	getSandboxFn           func(req specs.WorkflowSandboxGetReq) (specs.WorkflowSandboxGetResp, error)
	recycleSandboxFn       func(req specs.WorkflowSandboxRecycleReq) (specs.WorkflowSandboxRecycleResp, error)
	createPreviewFn        func(req specs.WorkflowPreviewCreateReq) (specs.WorkflowPreviewCreateResp, error)
	getPreviewFn           func(req specs.WorkflowPreviewGetReq) (specs.WorkflowPreviewGetResp, error)
	expirePreviewFn        func(req specs.WorkflowPreviewExpireReq) (specs.WorkflowPreviewExpireResp, error)
	checkDesktopUpdateFn   func(req specs.WorkflowDesktopUpdateCheckReq) (specs.WorkflowDesktopUpdateCheckResp, error)
}

// 描述：执行会话创建；未注入自定义行为时返回零值结果。
func (f *fakeWorkflowService) CreateSession(req specs.WorkflowSessionCreateReq) (specs.WorkflowSessionCreateResp, error) {
	if f != nil && f.createSessionFn != nil {
		return f.createSessionFn(req)
	}
	return specs.WorkflowSessionCreateResp{}, nil
}

// 描述：执行会话列表查询；未注入自定义行为时返回空列表。
func (f *fakeWorkflowService) ListSession(req specs.WorkflowSessionListReq) (specs.WorkflowSessionListResp, error) {
	if f != nil && f.listSessionFn != nil {
		return f.listSessionFn(req)
	}
	return specs.WorkflowSessionListResp{}, nil
}

// 描述：执行会话详情查询；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) GetSession(req specs.WorkflowSessionGetReq) (specs.WorkflowSessionGetResp, error) {
	if f != nil && f.getSessionFn != nil {
		return f.getSessionFn(req)
	}
	return specs.WorkflowSessionGetResp{}, nil
}

// 描述：执行会话状态更新；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) UpdateSessionStatus(req specs.WorkflowSessionStatusUpdateReq) (specs.WorkflowSessionStatusUpdateResp, error) {
	if f != nil && f.updateSessionStatusFn != nil {
		return f.updateSessionStatusFn(req)
	}
	return specs.WorkflowSessionStatusUpdateResp{}, nil
}

// 描述：执行消息创建；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) CreateSessionMessage(req specs.WorkflowSessionMessageCreateReq) (specs.WorkflowSessionMessageCreateResp, error) {
	if f != nil && f.createSessionMessageFn != nil {
		return f.createSessionMessageFn(req)
	}
	return specs.WorkflowSessionMessageCreateResp{}, nil
}

// 描述：执行消息分页查询；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) ListSessionMessage(req specs.WorkflowSessionMessageListReq) (specs.WorkflowSessionMessageListResp, error) {
	if f != nil && f.listSessionMessageFn != nil {
		return f.listSessionMessageFn(req)
	}
	return specs.WorkflowSessionMessageListResp{}, nil
}

// 描述：执行 sandbox 创建；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) CreateSandbox(req specs.WorkflowSandboxCreateReq) (specs.WorkflowSandboxCreateResp, error) {
	if f != nil && f.createSandboxFn != nil {
		return f.createSandboxFn(req)
	}
	return specs.WorkflowSandboxCreateResp{}, nil
}

// 描述：执行 sandbox 查询；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) GetSandbox(req specs.WorkflowSandboxGetReq) (specs.WorkflowSandboxGetResp, error) {
	if f != nil && f.getSandboxFn != nil {
		return f.getSandboxFn(req)
	}
	return specs.WorkflowSandboxGetResp{}, nil
}

// 描述：执行 sandbox 回收；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) RecycleSandbox(req specs.WorkflowSandboxRecycleReq) (specs.WorkflowSandboxRecycleResp, error) {
	if f != nil && f.recycleSandboxFn != nil {
		return f.recycleSandboxFn(req)
	}
	return specs.WorkflowSandboxRecycleResp{}, nil
}

// 描述：执行 preview 创建；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) CreatePreview(req specs.WorkflowPreviewCreateReq) (specs.WorkflowPreviewCreateResp, error) {
	if f != nil && f.createPreviewFn != nil {
		return f.createPreviewFn(req)
	}
	return specs.WorkflowPreviewCreateResp{}, nil
}

// 描述：执行 preview 查询；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) GetPreview(req specs.WorkflowPreviewGetReq) (specs.WorkflowPreviewGetResp, error) {
	if f != nil && f.getPreviewFn != nil {
		return f.getPreviewFn(req)
	}
	return specs.WorkflowPreviewGetResp{}, nil
}

// 描述：执行 preview 失效；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) ExpirePreview(req specs.WorkflowPreviewExpireReq) (specs.WorkflowPreviewExpireResp, error) {
	if f != nil && f.expirePreviewFn != nil {
		return f.expirePreviewFn(req)
	}
	return specs.WorkflowPreviewExpireResp{}, nil
}

// 描述：执行桌面更新检查；未注入自定义行为时返回零值。
func (f *fakeWorkflowService) CheckDesktopUpdate(req specs.WorkflowDesktopUpdateCheckReq) (specs.WorkflowDesktopUpdateCheckResp, error) {
	if f != nil && f.checkDesktopUpdateFn != nil {
		return f.checkDesktopUpdateFn(req)
	}
	return specs.WorkflowDesktopUpdateCheckResp{}, nil
}
