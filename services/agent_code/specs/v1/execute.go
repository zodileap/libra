package specs

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
)

// 描述：代码智能体执行入口请求。
type CodeExecuteReq struct {
	UserId      zspecs.UserId  `json:"userId" binding:"required"` // 用户ID
	SessionId   *zspecs.Id     `json:"sessionId"`                 // 会话ID
	Prompt      string         `json:"prompt" binding:"required"` // 自然语言指令
	Framework   *zspecs.Code   `json:"framework"`                 // 目标框架
	Module      *zspecs.Code   `json:"module"`                    // 目标模块
	Component   *zspecs.Code   `json:"component"`                 // 目标组件
	Workspace   string         `json:"workspace"`                 // 工作目录
	EnableWrite *zspecs.Status `json:"enableWrite"`               // 是否允许写文件
}

// 描述：代码智能体执行动作。
type CodeExecuteAction struct {
	Step        zspecs.Code    `json:"step"`        // 步骤编码
	Description string         `json:"description"` // 步骤描述
	Status      zspecs.Status  `json:"status"`      // 步骤状态
	StartedAt   *zspecs.LastAt `json:"startedAt"`   // 开始时间
	FinishedAt  *zspecs.LastAt `json:"finishedAt"`  // 结束时间
}

// 描述：代码智能体执行日志。
type CodeExecuteLog struct {
	Level   zspecs.Code       `json:"level"`   // 日志等级
	Message string            `json:"message"` // 日志内容
	At      *zspecs.CreatedAt `json:"at"`      // 日志时间
}

// 描述：代码智能体执行错误。
type CodeExecuteError struct {
	Code        string `json:"code"`        // 错误码
	Message     string `json:"message"`     // 错误信息
	Recoverable bool   `json:"recoverable"` // 是否可恢复
}

// 描述：代码智能体执行产物。
type CodeExecuteArtifact struct {
	Type    zspecs.Code `json:"type"`    // 产物类型
	Path    string      `json:"path"`    // 产物路径
	Summary string      `json:"summary"` // 产物摘要
}

// 描述：代码智能体执行结果。
type CodeExecuteResult struct {
	ExecutionId zspecs.Id             `json:"executionId"` // 执行ID
	Status      zspecs.Status         `json:"status"`      // 执行状态
	Actions     []CodeExecuteAction   `json:"actions"`     // 执行动作
	Logs        []CodeExecuteLog      `json:"logs"`        // 执行日志
	Errors      []CodeExecuteError    `json:"errors"`      // 执行错误
	Artifacts   []CodeExecuteArtifact `json:"artifacts"`   // 执行产物
}

// 描述：代码智能体执行入口响应。
type CodeExecuteResp struct {
	Result CodeExecuteResult `json:"result"` // 执行结果
}

// 描述：查询执行结果请求。
type CodeExecuteGetReq struct {
	ExecutionId zspecs.Id `json:"executionId" form:"executionId" binding:"required"` // 执行ID
}

// 描述：查询执行结果响应。
type CodeExecuteGetResp struct {
	Result CodeExecuteResult `json:"result"` // 执行结果
}
