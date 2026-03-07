package specs

// 描述：运行时会话实体，保持与 Desktop 当前使用的字段命名兼容。
type RuntimeSessionEntity struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	AgentCode string `json:"agent_code"`
	Status    int    `json:"status"`
	CreatedAt string `json:"created_at,omitempty"`
	LastAt    string `json:"last_at,omitempty"`
	DeletedAt string `json:"deleted_at,omitempty"`
}

// 描述：运行时沙盒实体，用于记录会话和容器之间的绑定关系。
type RuntimeSandboxEntity struct {
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	ContainerID string `json:"container_id,omitempty"`
	PreviewURL  string `json:"preview_url,omitempty"`
	Status      int    `json:"status"`
	CreatedAt   string `json:"created_at,omitempty"`
	LastAt      string `json:"last_at,omitempty"`
	DeletedAt   string `json:"deleted_at,omitempty"`
}

// 描述：运行时预览实体，用于维护沙盒对外暴露的预览地址。
type RuntimePreviewEntity struct {
	ID        string `json:"id"`
	SandboxID string `json:"sandbox_id"`
	URL       string `json:"url"`
	Status    int    `json:"status"`
	ExpiresAt string `json:"expires_at,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	LastAt    string `json:"last_at,omitempty"`
	DeletedAt string `json:"deleted_at,omitempty"`
}

// 描述：创建会话请求。
type WorkflowSessionCreateReq struct {
	UserId    string `json:"userId"`
	AgentCode string `json:"agentCode"`
	Status    *int   `json:"status"`
}

// 描述：创建会话响应。
type WorkflowSessionCreateResp struct {
	Session RuntimeSessionEntity `json:"session"`
}

// 描述：查询会话列表请求。
type WorkflowSessionListReq struct {
	UserId    string  `json:"userId"`
	AgentCode *string `json:"agentCode"`
	Status    *int    `json:"status"`
	ByLastAt  *int    `json:"byLastAt"`
}

// 描述：查询会话列表响应。
type WorkflowSessionListResp struct {
	List []RuntimeSessionEntity `json:"list"`
}

// 描述：查询会话详情请求。
type WorkflowSessionGetReq struct {
	SessionId string `json:"sessionId"`
	UserId    string `json:"userId"`
}

// 描述：查询会话详情响应。
type WorkflowSessionGetResp struct {
	Session RuntimeSessionEntity `json:"session"`
}

// 描述：更新会话状态请求。
type WorkflowSessionStatusUpdateReq struct {
	SessionId string `json:"sessionId"`
	UserId    string `json:"userId"`
	Status    int    `json:"status"`
}

// 描述：更新会话状态响应。
type WorkflowSessionStatusUpdateResp struct {
	Session RuntimeSessionEntity `json:"session"`
}

// 描述：会话消息项。
type WorkflowSessionMessageItem struct {
	MessageId string `json:"messageId"`
	SessionId string `json:"sessionId"`
	UserId    string `json:"userId"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt,omitempty"`
}

// 描述：写入会话消息请求。
type WorkflowSessionMessageCreateReq struct {
	SessionId string `json:"sessionId"`
	UserId    string `json:"userId"`
	Role      string `json:"role"`
	Content   string `json:"content"`
}

// 描述：写入会话消息响应。
type WorkflowSessionMessageCreateResp struct {
	Message WorkflowSessionMessageItem `json:"message"`
}

// 描述：查询会话消息请求。
type WorkflowSessionMessageListReq struct {
	SessionId string `json:"sessionId"`
	UserId    string `json:"userId"`
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

// 描述：查询会话消息响应。
type WorkflowSessionMessageListResp struct {
	List     []WorkflowSessionMessageItem `json:"list"`
	Total    int                          `json:"total"`
	Page     int                          `json:"page"`
	PageSize int                          `json:"pageSize"`
}

// 描述：创建 Sandbox 请求。
type WorkflowSandboxCreateReq struct {
	SessionId   string  `json:"sessionId"`
	UserId      string  `json:"userId"`
	ContainerId *string `json:"containerId"`
	PreviewUrl  *string `json:"previewUrl"`
	Status      *int    `json:"status"`
}

// 描述：创建 Sandbox 响应。
type WorkflowSandboxCreateResp struct {
	Sandbox RuntimeSandboxEntity `json:"sandbox"`
}

// 描述：查询 Sandbox 请求。
type WorkflowSandboxGetReq struct {
	SandboxId *string `json:"sandboxId"`
	SessionId *string `json:"sessionId"`
	UserId    string  `json:"userId"`
}

// 描述：查询 Sandbox 响应。
type WorkflowSandboxGetResp struct {
	List []RuntimeSandboxEntity `json:"list"`
}

// 描述：回收 Sandbox 请求。
type WorkflowSandboxRecycleReq struct {
	SandboxId *string `json:"sandboxId"`
	SessionId *string `json:"sessionId"`
	UserId    string  `json:"userId"`
}

// 描述：回收 Sandbox 响应。
type WorkflowSandboxRecycleResp struct {
	Success bool `json:"success"`
}

// 描述：创建预览地址请求。
type WorkflowPreviewCreateReq struct {
	SandboxId  string `json:"sandboxId"`
	UserId     string `json:"userId"`
	Url        string `json:"url"`
	Status     *int   `json:"status"`
	Expiration *int64 `json:"expiration"`
}

// 描述：创建预览地址响应。
type WorkflowPreviewCreateResp struct {
	Preview RuntimePreviewEntity `json:"preview"`
}

// 描述：查询预览地址请求。
type WorkflowPreviewGetReq struct {
	PreviewId *string `json:"previewId"`
	SandboxId *string `json:"sandboxId"`
	UserId    string  `json:"userId"`
}

// 描述：查询预览地址响应。
type WorkflowPreviewGetResp struct {
	List []RuntimePreviewEntity `json:"list"`
}

// 描述：让预览地址失效请求。
type WorkflowPreviewExpireReq struct {
	PreviewId *string `json:"previewId"`
	SandboxId *string `json:"sandboxId"`
	UserId    string  `json:"userId"`
}

// 描述：让预览地址失效响应。
type WorkflowPreviewExpireResp struct {
	Success bool `json:"success"`
}

// 描述：桌面端更新检查请求。
type WorkflowDesktopUpdateCheckReq struct {
	Platform       string `json:"platform"`
	Arch           string `json:"arch"`
	CurrentVersion string `json:"currentVersion"`
	Channel        string `json:"channel"`
}

// 描述：桌面端更新检查响应。
type WorkflowDesktopUpdateCheckResp struct {
	HasUpdate      bool   `json:"hasUpdate"`
	LatestVersion  string `json:"latestVersion"`
	DownloadURL    string `json:"downloadUrl"`
	ChecksumSHA256 string `json:"checksumSha256,omitempty"`
	ReleaseNotes   string `json:"releaseNotes"`
	PublishedAt    string `json:"publishedAt"`
	Channel        string `json:"channel"`
}
