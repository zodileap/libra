package specs

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
)

// 描述：模型智能体任务执行入口请求。
type ModelTaskExecuteReq struct {
	UserId            zspecs.UserId   `json:"userId" binding:"required"` // 用户ID
	SessionId         *zspecs.Id      `json:"sessionId"`                 // 会话ID
	Prompt            string          `json:"prompt" binding:"required"` // 任务指令
	DccSoftware       *zspecs.Code    `json:"dccSoftware"`               // DCC 软件标识
	DccVersion        *zspecs.Version `json:"dccVersion"`                // DCC 软件版本
	DccExecutablePath string          `json:"dccExecutablePath"`         // DCC 可执行路径
	CallbackUrl       *zspecs.Url     `json:"callbackUrl"`               // 回调地址
	ClientTraceId     string          `json:"clientTraceId"`             // 客户端链路追踪ID
	RetryCount        int             `json:"retryCount"`                // 当前重试次数
	MaxRetry          int             `json:"maxRetry"`                  // 最大重试次数
}

// 描述：模型智能体任务执行步骤。
type ModelTaskExecuteStep struct {
	Step        zspecs.Code    `json:"step"`        // 步骤编码
	Description string         `json:"description"` // 步骤描述
	Status      zspecs.Status  `json:"status"`      // 步骤状态
	StartedAt   *zspecs.LastAt `json:"startedAt"`   // 开始时间
	FinishedAt  *zspecs.LastAt `json:"finishedAt"`  // 结束时间
}

// 描述：模型智能体任务执行日志。
type ModelTaskExecuteLog struct {
	Level   zspecs.Code       `json:"level"`   // 日志等级
	Message string            `json:"message"` // 日志内容
	At      *zspecs.CreatedAt `json:"at"`      // 日志时间
}

// 描述：模型智能体任务执行错误。
type ModelTaskExecuteError struct {
	Code          string `json:"code"`          // 错误码
	Message       string `json:"message"`       // 错误信息
	Retryable     bool   `json:"retryable"`     // 是否可重试
	NextRetryInMs int64  `json:"nextRetryInMs"` // 建议重试间隔（毫秒）
}

// 描述：模型智能体任务执行产物。
type ModelTaskExecuteArtifact struct {
	Type    zspecs.Code `json:"type"`    // 产物类型
	Path    string      `json:"path"`    // 产物路径
	Summary string      `json:"summary"` // 产物摘要
}

// 描述：模型智能体任务重试策略。
type ModelTaskExecuteRetryPolicy struct {
	RetryCount int    `json:"retryCount"` // 当前重试次数
	MaxRetry   int    `json:"maxRetry"`   // 最大重试次数
	Retryable  bool   `json:"retryable"`  // 当前是否允许重试
	Reason     string `json:"reason"`     // 重试策略说明
}

// 描述：模型智能体任务执行结果。
type ModelTaskExecuteResult struct {
	TaskId      zspecs.Id                   `json:"taskId"`      // 任务ID
	Status      zspecs.Status               `json:"status"`      // 任务状态
	Steps       []ModelTaskExecuteStep      `json:"steps"`       // 执行步骤
	Logs        []ModelTaskExecuteLog       `json:"logs"`        // 执行日志
	Errors      []ModelTaskExecuteError     `json:"errors"`      // 执行错误
	Artifacts   []ModelTaskExecuteArtifact  `json:"artifacts"`   // 执行产物
	ResultPath  string                      `json:"resultPath"`  // 结果主路径
	CallbackUrl *zspecs.Url                 `json:"callbackUrl"` // 回调地址
	RetryPolicy ModelTaskExecuteRetryPolicy `json:"retryPolicy"` // 重试策略
}

// 描述：模型智能体任务执行入口响应。
type ModelTaskExecuteResp struct {
	Result ModelTaskExecuteResult `json:"result"` // 执行结果
}

// 描述：模型智能体任务结果查询请求。
type ModelTaskExecuteGetReq struct {
	TaskId zspecs.Id `json:"taskId" form:"taskId" binding:"required"` // 任务ID
}

// 描述：模型智能体任务结果查询响应。
type ModelTaskExecuteGetResp struct {
	Result ModelTaskExecuteResult `json:"result"` // 执行结果
}
