package specs

import (
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
)

// 描述：登录请求，使用邮箱和密码换取身份令牌。
type AuthLoginReq struct {
	Email    zspecs.Email    `json:"email" binding:"required"`          // 邮箱
	Password zspecs.Password `json:"password" binding:"required,min=6"` // 密码
}

// 描述：当前登录用户的基础信息。
type AuthUserInfo struct {
	Id     zspecs.UserId   `json:"id"`     // 用户ID
	Name   zspecs.UserName `json:"name"`   // 用户名称
	Email  *zspecs.Email   `json:"email"`  // 邮箱
	Phone  *zspecs.Phone   `json:"phone"`  // 手机号
	Status *zspecs.Status  `json:"status"` // 用户状态
}

// 描述：登录返回数据，包含令牌、过期时间和用户信息。
type AuthLoginResp struct {
	Token     zspecs.IdentityToken `json:"token"`     // 身份令牌
	ExpiresAt zspecs.ExpireAt      `json:"expiresAt"` // 令牌过期时间
	User      AuthUserInfo         `json:"user"`      // 当前用户
}

// 描述：获取当前用户信息返回数据。
type AuthMeResp struct {
	User AuthUserInfo `json:"user"` // 当前用户
}

// 描述：登出请求体，当前版本无需字段，保留结构用于扩展。
type AuthLogoutReq struct{}

// 描述：登出返回数据。
type AuthLogoutResp struct {
	Success bool `json:"success"` // 是否登出成功
}

// 描述：用户智能体授权关系数据。
type AuthUserAgentAccessItem struct {
	Id         zspecs.Id         `json:"id"`         // 授权记录ID
	UserId     zspecs.UserId     `json:"userId"`     // 用户ID
	AgentId    zspecs.Id         `json:"agentId"`    // 智能体ID
	AccessType *zspecs.Status    `json:"accessType"` // 授权类型
	Duration   *zspecs.Duration  `json:"duration"`   // 有效时长
	Status     *zspecs.Status    `json:"status"`     // 授权状态
	CreatedAt  *zspecs.CreatedAt `json:"createdAt"`  // 创建时间
	LastAt     *zspecs.LastAt    `json:"lastAt"`     // 更新时间
}

// 描述：用户智能体授权关系列表查询请求。
type AuthUserAgentAccessListReq struct {
	AgentId *zspecs.Id     `json:"agentId" form:"agentId"` // 按智能体ID筛选
	Status  *zspecs.Status `json:"status" form:"status"`   // 按状态筛选
}

// 描述：用户智能体授权关系列表返回数据。
type AuthUserAgentAccessListResp struct {
	List []AuthUserAgentAccessItem `json:"list"` // 授权关系列表
}

// 描述：用户智能体授权关系单条返回数据。
type AuthUserAgentAccessResp struct {
	Item AuthUserAgentAccessItem `json:"item"` // 单条授权关系
}

// 描述：新增用户智能体授权关系请求。
type AuthGrantUserAgentAccessReq struct {
	AgentId    zspecs.Id        `json:"agentId" binding:"required"` // 智能体ID
	AccessType *zspecs.Status   `json:"accessType"`                 // 授权类型
	Duration   *zspecs.Duration `json:"duration"`                   // 有效时长
	Status     *zspecs.Status   `json:"status"`                     // 授权状态
}

// 描述：删除用户智能体授权关系请求。
type AuthRevokeUserAgentAccessReq struct {
	AgentId zspecs.Id `json:"agentId" binding:"required"` // 智能体ID
}

// 描述：删除用户智能体授权关系返回数据。
type AuthRevokeUserAgentAccessResp struct {
	Success bool `json:"success"` // 是否删除成功
}

// 描述：用户可用智能体项。
type AuthAvailableAgentItem struct {
	AgentId      zspecs.Id        `json:"agentId"`      // 智能体ID
	Code         zspecs.Code      `json:"code"`         // 智能体编码
	Name         zspecs.Name      `json:"name"`         // 智能体名称
	Version      *zspecs.Version  `json:"version"`      // 智能体版本
	AgentStatus  *zspecs.Status   `json:"agentStatus"`  // 智能体状态
	Remark       *zspecs.Remark   `json:"remark"`       // 智能体备注
	AccessId     zspecs.Id        `json:"accessId"`     // 授权记录ID
	AccessType   *zspecs.Status   `json:"accessType"`   // 授权类型
	Duration     *zspecs.Duration `json:"duration"`     // 有效时长
	AccessStatus *zspecs.Status   `json:"accessStatus"` // 授权状态
}

// 描述：用户可用智能体列表返回数据。
type AuthAvailableAgentListResp struct {
	List []AuthAvailableAgentItem `json:"list"` // 可用智能体列表
}

// 描述：用户身份信息，可同时归属公司、部门或独立空间。
type AuthIdentityItem struct {
	IdentityId   string   `json:"identityId"`   // 身份ID
	IdentityType string   `json:"identityType"` // 身份类型
	ScopeName    string   `json:"scopeName"`    // 身份作用域名称
	RoleCodes    []string `json:"roleCodes"`    // 身份绑定角色编码
	Status       string   `json:"status"`       // 身份状态
}

// 描述：用户身份列表返回数据。
type AuthIdentityListResp struct {
	List []AuthIdentityItem `json:"list"` // 身份列表
}

// 描述：权限模板项，表示可授权能力。
type AuthPermissionTemplateItem struct {
	Code         string `json:"code"`         // 权限编码
	Name         string `json:"name"`         // 权限名称
	Description  string `json:"description"`  // 权限描述
	ResourceType string `json:"resourceType"` // 资源类型
}

// 描述：权限模板列表返回数据。
type AuthPermissionTemplateListResp struct {
	List []AuthPermissionTemplateItem `json:"list"` // 权限模板列表
}

// 描述：权限授权记录项。
type AuthPermissionGrantItem struct {
	GrantId        string `json:"grantId"`        // 授权记录ID
	ActorUserId    string `json:"actorUserId"`    // 操作人用户ID
	TargetUserId   string `json:"targetUserId"`   // 目标用户ID
	TargetUserName string `json:"targetUserName"` // 目标用户名称
	PermissionCode string `json:"permissionCode"` // 权限编码
	ResourceType   string `json:"resourceType"`   // 资源类型
	ResourceName   string `json:"resourceName"`   // 资源名称
	GrantedBy      string `json:"grantedBy"`      // 授权人ID
	Status         string `json:"status"`         // 授权状态
	ExpiresAt      string `json:"expiresAt"`      // 过期时间
	CreatedAt      string `json:"createdAt"`      // 创建时间
	LastAt         string `json:"lastAt"`         // 更新时间
}

// 描述：查询权限授权记录请求。
type AuthPermissionGrantListReq struct {
	TargetUserId   string `json:"targetUserId" form:"targetUserId"`     // 目标用户ID
	PermissionCode string `json:"permissionCode" form:"permissionCode"` // 权限编码
	ResourceType   string `json:"resourceType" form:"resourceType"`     // 资源类型
}

// 描述：权限授权记录列表返回数据。
type AuthPermissionGrantListResp struct {
	List []AuthPermissionGrantItem `json:"list"` // 权限授权记录列表
}

// 描述：新增权限授权请求。
type AuthGrantPermissionReq struct {
	TargetUserId   string `json:"targetUserId" binding:"required"`   // 目标用户ID
	TargetUserName string `json:"targetUserName" binding:"required"` // 目标用户名称
	PermissionCode string `json:"permissionCode" binding:"required"` // 权限编码
	ResourceType   string `json:"resourceType" binding:"required"`   // 资源类型
	ResourceName   string `json:"resourceName" binding:"required"`   // 资源名称
	ExpiresAt      string `json:"expiresAt"`                         // 过期时间
}

// 描述：新增权限授权返回数据。
type AuthGrantPermissionResp struct {
	Item AuthPermissionGrantItem `json:"item"` // 授权记录
}

// 描述：撤销权限授权请求。
type AuthRevokePermissionReq struct {
	GrantId string `json:"grantId" binding:"required"` // 授权记录ID
}

// 描述：撤销权限授权返回数据。
type AuthRevokePermissionResp struct {
	Success bool `json:"success"` // 是否撤销成功
}
