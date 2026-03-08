package specs

// 描述：登录请求，使用邮箱和密码换取身份令牌。
type AuthLoginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// 描述：当前登录用户的基础信息。
type AuthUserInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email,omitempty"`
	Phone  string `json:"phone,omitempty"`
	Status int    `json:"status,omitempty"`
}

// 描述：登录返回数据，包含令牌、过期时间和用户信息。
type AuthLoginResp struct {
	Token     string       `json:"token"`
	ExpiresAt string       `json:"expiresAt"`
	User      AuthUserInfo `json:"user"`
}

// 描述：获取当前登录用户信息返回数据。
type AuthMeResp struct {
	User AuthUserInfo `json:"user"`
}

// 描述：登出请求体，当前版本无需字段，保留结构用于扩展。
type AuthLogoutReq struct{}

// 描述：登出返回数据。
type AuthLogoutResp struct {
	Success bool `json:"success"`
}

// 描述：用户智能体授权关系数据。
type AuthUserAgentAccessItem struct {
	ID         string `json:"id"`
	UserID     string `json:"userId"`
	AgentID    string `json:"agentId"`
	AccessType int    `json:"accessType,omitempty"`
	Duration   int64  `json:"duration,omitempty"`
	Status     int    `json:"status,omitempty"`
	CreatedAt  string `json:"createdAt,omitempty"`
	LastAt     string `json:"lastAt,omitempty"`
}

// 描述：用户智能体授权关系列表查询请求。
type AuthUserAgentAccessListReq struct {
	AgentID string `json:"agentId" form:"agentId"`
	Status  *int   `json:"status" form:"status"`
}

// 描述：用户智能体授权关系列表返回数据。
type AuthUserAgentAccessListResp struct {
	List []AuthUserAgentAccessItem `json:"list"`
}

// 描述：用户智能体授权关系单条返回数据。
type AuthUserAgentAccessResp struct {
	Item AuthUserAgentAccessItem `json:"item"`
}

// 描述：新增用户智能体授权关系请求。
type AuthGrantUserAgentAccessReq struct {
	AgentID    string `json:"agentId"`
	AccessType *int   `json:"accessType,omitempty"`
	Duration   *int64 `json:"duration,omitempty"`
	Status     *int   `json:"status,omitempty"`
}

// 描述：删除用户智能体授权关系请求。
type AuthRevokeUserAgentAccessReq struct {
	AgentID string `json:"agentId"`
}

// 描述：删除用户智能体授权关系返回数据。
type AuthRevokeUserAgentAccessResp struct {
	Success bool `json:"success"`
}

// 描述：用户可用智能体项。
type AuthAvailableAgentItem struct {
	AgentID      string `json:"agentId"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Version      string `json:"version,omitempty"`
	AgentStatus  int    `json:"agentStatus,omitempty"`
	Remark       string `json:"remark,omitempty"`
	AccessID     string `json:"accessId"`
	AccessType   int    `json:"accessType,omitempty"`
	Duration     int64  `json:"duration,omitempty"`
	AccessStatus int    `json:"accessStatus,omitempty"`
}

// 描述：用户可用智能体列表返回数据。
type AuthAvailableAgentListResp struct {
	List []AuthAvailableAgentItem `json:"list"`
}

// 描述：用户身份信息，可同时归属公司、部门或独立空间。
type AuthIdentityItem struct {
	IdentityID   string   `json:"identityId"`
	IdentityType string   `json:"identityType"`
	ScopeName    string   `json:"scopeName"`
	RoleCodes    []string `json:"roleCodes"`
	Status       string   `json:"status"`
}

// 描述：用户身份列表返回数据。
type AuthIdentityListResp struct {
	List []AuthIdentityItem `json:"list"`
}

// 描述：管理员可直接授权或协作的用户项。
type AuthManageableUserItem struct {
	UserID         string   `json:"userId"`
	Name           string   `json:"name"`
	Email          string   `json:"email,omitempty"`
	Status         string   `json:"status"`
	IdentityScopes []string `json:"identityScopes"`
	Self           bool     `json:"self"`
}

// 描述：管理员可管理用户列表返回数据。
type AuthManageableUserListResp struct {
	List []AuthManageableUserItem `json:"list"`
}

// 描述：权限模板项，表示可授权能力。
type AuthPermissionTemplateItem struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	ResourceType string `json:"resourceType"`
}

// 描述：权限模板列表返回数据。
type AuthPermissionTemplateListResp struct {
	List []AuthPermissionTemplateItem `json:"list"`
}

// 描述：权限授权记录项。
type AuthPermissionGrantItem struct {
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

// 描述：查询权限授权记录请求。
type AuthPermissionGrantListReq struct {
	TargetUserID   string `json:"targetUserId" form:"targetUserId"`
	PermissionCode string `json:"permissionCode" form:"permissionCode"`
	ResourceType   string `json:"resourceType" form:"resourceType"`
}

// 描述：权限授权记录列表返回数据。
type AuthPermissionGrantListResp struct {
	List []AuthPermissionGrantItem `json:"list"`
}

// 描述：新增权限授权请求。
type AuthGrantPermissionReq struct {
	TargetUserID   string `json:"targetUserId"`
	TargetUserName string `json:"targetUserName"`
	PermissionCode string `json:"permissionCode"`
	ResourceType   string `json:"resourceType"`
	ResourceName   string `json:"resourceName"`
	ExpiresAt      string `json:"expiresAt,omitempty"`
}

// 描述：新增权限授权返回数据。
type AuthGrantPermissionResp struct {
	Item AuthPermissionGrantItem `json:"item"`
}

// 描述：撤销权限授权请求。
type AuthRevokePermissionReq struct {
	GrantID string `json:"grantId"`
}

// 描述：撤销权限授权返回数据。
type AuthRevokePermissionResp struct {
	Success bool `json:"success"`
}

// 描述：管理员 bootstrap 状态返回数据。
type AuthBootstrapStatusResp struct {
	Initialized bool   `json:"initialized"`
	HasUsers    bool   `json:"hasUsers"`
	AdminUserID string `json:"adminUserId,omitempty"`
}

// 描述：创建首个管理员请求，仅允许在系统未初始化时使用。
type AuthBootstrapAdminReq struct {
	Name             string `json:"name"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	OrganizationName string `json:"organizationName,omitempty"`
}

// 描述：创建首个管理员返回数据。
type AuthBootstrapAdminResp struct {
	Created bool         `json:"created"`
	User    AuthUserInfo `json:"user"`
}
