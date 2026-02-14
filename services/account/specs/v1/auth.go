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
