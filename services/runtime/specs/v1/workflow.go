package specs

import (
	runtime "git.zodileap.com/entity/runtime_v1/instance"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
)

// 描述：创建会话请求。
type WorkflowSessionCreateReq struct {
	UserId    zspecs.UserId  `json:"userId" binding:"required"`    // 用户ID
	AgentCode zspecs.Code    `json:"agentCode" binding:"required"` // 智能体编码
	Status    *zspecs.Status `json:"status"`                       // 会话状态
}

// 描述：创建会话响应。
type WorkflowSessionCreateResp struct {
	Session *runtime.AgentSessionEntity `json:"session"` // 会话详情
}

// 描述：查询会话列表请求。
type WorkflowSessionListReq struct {
	UserId    zspecs.UserId   `json:"userId" form:"userId" binding:"required"` // 用户ID
	AgentCode *zspecs.Code    `json:"agentCode" form:"agentCode"`              // 智能体编码筛选
	Status    *zspecs.Status  `json:"status" form:"status"`                    // 会话状态筛选
	ByLastAt  *zspecs.OrderBy `json:"byLastAt" form:"byLastAt"`                // 按更新时间排序
}

// 描述：查询会话列表响应。
type WorkflowSessionListResp struct {
	List []*runtime.AgentSessionEntity `json:"list"` // 会话列表
}

// 描述：查询会话详情请求。
type WorkflowSessionGetReq struct {
	SessionId zspecs.Id     `json:"sessionId" form:"sessionId" binding:"required"` // 会话ID
	UserId    zspecs.UserId `json:"userId" form:"userId" binding:"required"`       // 用户ID
}

// 描述：查询会话详情响应。
type WorkflowSessionGetResp struct {
	Session *runtime.AgentSessionEntity `json:"session"` // 会话详情
}

// 描述：更新会话状态请求（用于关闭/流转）。
type WorkflowSessionStatusUpdateReq struct {
	SessionId zspecs.Id     `json:"sessionId" binding:"required"` // 会话ID
	UserId    zspecs.UserId `json:"userId" binding:"required"`    // 用户ID
	Status    zspecs.Status `json:"status" binding:"required"`    // 目标状态
}

// 描述：更新会话状态响应。
type WorkflowSessionStatusUpdateResp struct {
	Session *runtime.AgentSessionEntity `json:"session"` // 更新后的会话详情
}

// 描述：写入会话消息请求。
type WorkflowSessionMessageCreateReq struct {
	SessionId zspecs.Id     `json:"sessionId" binding:"required"` // 会话ID
	UserId    zspecs.UserId `json:"userId" binding:"required"`    // 用户ID
	Role      string        `json:"role" binding:"required"`      // 角色（user/assistant/system）
	Content   string        `json:"content" binding:"required"`   // 消息内容
}

// 描述：会话消息项。
type WorkflowSessionMessageItem struct {
	MessageId zspecs.Id         `json:"messageId"` // 消息ID
	SessionId zspecs.Id         `json:"sessionId"` // 会话ID
	UserId    zspecs.UserId     `json:"userId"`    // 用户ID
	Role      string            `json:"role"`      // 消息角色
	Content   string            `json:"content"`   // 消息内容
	CreatedAt *zspecs.CreatedAt `json:"createdAt"` // 创建时间
}

// 描述：写入会话消息响应。
type WorkflowSessionMessageCreateResp struct {
	Message WorkflowSessionMessageItem `json:"message"` // 写入后的消息
}

// 描述：查询会话消息请求。
type WorkflowSessionMessageListReq struct {
	SessionId zspecs.Id     `json:"sessionId" form:"sessionId" binding:"required"` // 会话ID
	UserId    zspecs.UserId `json:"userId" form:"userId" binding:"required"`       // 用户ID
	Page      int           `json:"page" form:"page"`                              // 页码（默认1）
	PageSize  int           `json:"pageSize" form:"pageSize"`                      // 每页数量（默认20）
}

// 描述：查询会话消息响应。
type WorkflowSessionMessageListResp struct {
	List     []WorkflowSessionMessageItem `json:"list"`     // 消息列表
	Total    int                          `json:"total"`    // 总条数
	Page     int                          `json:"page"`     // 当前页
	PageSize int                          `json:"pageSize"` // 每页数量
}

// 描述：创建 Sandbox 请求。
type WorkflowSandboxCreateReq struct {
	SessionId   zspecs.Id      `json:"sessionId" binding:"required"` // 会话ID
	UserId      zspecs.UserId  `json:"userId" binding:"required"`    // 用户ID
	ContainerId *zspecs.Code   `json:"containerId"`                  // 容器ID
	PreviewUrl  *zspecs.Url    `json:"previewUrl"`                   // 预览地址
	Status      *zspecs.Status `json:"status"`                       // Sandbox 状态
}

// 描述：创建 Sandbox 响应。
type WorkflowSandboxCreateResp struct {
	Sandbox *runtime.SandboxInstanceEntity `json:"sandbox"` // Sandbox 详情
}

// 描述：查询 Sandbox 请求。
type WorkflowSandboxGetReq struct {
	SandboxId *zspecs.Id    `json:"sandboxId" form:"sandboxId"`              // Sandbox ID
	SessionId *zspecs.Id    `json:"sessionId" form:"sessionId"`              // 会话ID
	UserId    zspecs.UserId `json:"userId" form:"userId" binding:"required"` // 用户ID
}

// 描述：查询 Sandbox 响应。
type WorkflowSandboxGetResp struct {
	List []*runtime.SandboxInstanceEntity `json:"list"` // Sandbox 列表
}

// 描述：回收 Sandbox 请求。
type WorkflowSandboxRecycleReq struct {
	SandboxId *zspecs.Id    `json:"sandboxId"`                 // Sandbox ID
	SessionId *zspecs.Id    `json:"sessionId"`                 // 会话ID
	UserId    zspecs.UserId `json:"userId" binding:"required"` // 用户ID
}

// 描述：回收 Sandbox 响应。
type WorkflowSandboxRecycleResp struct {
	Success bool `json:"success"` // 是否回收成功
}

// 描述：创建预览地址请求。
type WorkflowPreviewCreateReq struct {
	SandboxId  zspecs.Id          `json:"sandboxId" binding:"required"` // Sandbox ID
	UserId     zspecs.UserId      `json:"userId" binding:"required"`    // 用户ID
	Url        zspecs.Url         `json:"url" binding:"required"`       // 预览地址
	Status     *zspecs.Status     `json:"status"`                       // 预览状态
	Expiration *zspecs.Expiration `json:"expiration"`                   // 过期秒数
}

// 描述：创建预览地址响应。
type WorkflowPreviewCreateResp struct {
	Preview *runtime.PreviewEndpointEntity `json:"preview"` // 预览地址详情
}

// 描述：查询预览地址请求。
type WorkflowPreviewGetReq struct {
	PreviewId *zspecs.Id    `json:"previewId" form:"previewId"`              // 预览ID
	SandboxId *zspecs.Id    `json:"sandboxId" form:"sandboxId"`              // Sandbox ID
	UserId    zspecs.UserId `json:"userId" form:"userId" binding:"required"` // 用户ID
}

// 描述：查询预览地址响应。
type WorkflowPreviewGetResp struct {
	List []*runtime.PreviewEndpointEntity `json:"list"` // 预览地址列表
}

// 描述：让预览地址失效请求。
type WorkflowPreviewExpireReq struct {
	PreviewId *zspecs.Id    `json:"previewId"`                 // 预览ID
	SandboxId *zspecs.Id    `json:"sandboxId"`                 // Sandbox ID
	UserId    zspecs.UserId `json:"userId" binding:"required"` // 用户ID
}

// 描述：让预览地址失效响应。
type WorkflowPreviewExpireResp struct {
	Success bool `json:"success"` // 是否失效成功
}

// 描述：桌面端更新检查请求。
type WorkflowDesktopUpdateCheckReq struct {
	Platform       string `json:"platform" form:"platform"`             // 平台标识（darwin/windows/linux）
	Arch           string `json:"arch" form:"arch"`                     // 架构标识（arm64/x86_64）
	CurrentVersion string `json:"currentVersion" form:"currentVersion"` // 当前桌面端版本
	Channel        string `json:"channel" form:"channel"`               // 更新通道（stable/beta）
}

// 描述：桌面端更新检查响应。
type WorkflowDesktopUpdateCheckResp struct {
	HasUpdate      bool   `json:"hasUpdate"`                // 是否存在可更新版本
	LatestVersion  string `json:"latestVersion"`            // 最新版本号
	DownloadURL    string `json:"downloadUrl"`              // 平台安装包下载地址
	ChecksumSHA256 string `json:"checksumSha256,omitempty"` // 可选：安装包 sha256
	ReleaseNotes   string `json:"releaseNotes"`             // 更新说明
	PublishedAt    string `json:"publishedAt"`              // 发布时间（RFC3339）
	Channel        string `json:"channel"`                  // 更新通道
}
