package service

import (
	"testing"
	"time"

	specs "github.com/zodileap/libra/services/internal/account/specs"
)

// 描述：创建测试用账号服务实例，统一使用临时目录避免状态串扰。
func newTestAuthService(t *testing.T) *AuthService {
	t.Helper()
	svc, err := NewAuthService(t.TempDir(), time.Hour)
	if err != nil {
		t.Fatalf("创建测试服务失败: %v", err)
	}
	return svc
}

// 描述：校验 bootstrap 状态查询与管理员初始化流程。
func TestAuthServiceBootstrapStatusAndAdmin(t *testing.T) {
	t.Parallel()

	svc := newTestAuthService(t)
	status, err := svc.BootstrapStatus()
	if err != nil {
		t.Fatalf("查询 bootstrap 状态失败: %v", err)
	}
	if status.Initialized {
		t.Fatalf("初始状态不应已初始化")
	}

	resp, err := svc.BootstrapAdmin(specs.AuthBootstrapAdminReq{
		Name:             "Admin",
		Email:            "admin@example.com",
		Password:         "secret123",
		OrganizationName: "Libra Org",
	})
	if err != nil {
		t.Fatalf("创建管理员失败: %v", err)
	}
	if !resp.Created {
		t.Fatalf("创建管理员后应返回 created=true")
	}
	if resp.User.Email != "admin@example.com" {
		t.Fatalf("管理员邮箱不匹配: %s", resp.User.Email)
	}

	status, err = svc.BootstrapStatus()
	if err != nil {
		t.Fatalf("再次查询 bootstrap 状态失败: %v", err)
	}
	if !status.Initialized || status.AdminUserID == "" {
		t.Fatalf("创建管理员后应标记为已初始化")
	}
}

// 描述：校验登录、令牌校验、当前用户查询和登出流程。
func TestAuthServiceLoginVerifyMeAndLogout(t *testing.T) {
	t.Parallel()

	svc := newTestAuthService(t)
	_, err := svc.BootstrapAdmin(specs.AuthBootstrapAdminReq{
		Name:     "Admin",
		Email:    "admin@example.com",
		Password: "secret123",
	})
	if err != nil {
		t.Fatalf("准备管理员失败: %v", err)
	}

	loginResp, err := svc.Login(specs.AuthLoginReq{Email: "admin@example.com", Password: "secret123"})
	if err != nil {
		t.Fatalf("登录失败: %v", err)
	}
	if loginResp.Token == "" {
		t.Fatalf("登录后 token 不能为空")
	}

	session, err := svc.VerifyToken("Bearer " + loginResp.Token)
	if err != nil {
		t.Fatalf("校验 token 失败: %v", err)
	}
	if session.UserID != loginResp.User.ID {
		t.Fatalf("token 对应的用户 ID 不匹配")
	}

	meResp, err := svc.GetCurrentUser(session.UserID)
	if err != nil {
		t.Fatalf("查询当前用户失败: %v", err)
	}
	if meResp.User.Email != "admin@example.com" {
		t.Fatalf("当前用户邮箱不匹配: %s", meResp.User.Email)
	}

	logoutResp, err := svc.Logout(loginResp.Token)
	if err != nil {
		t.Fatalf("登出失败: %v", err)
	}
	if !logoutResp.Success {
		t.Fatalf("登出结果应为成功")
	}
	if _, err := svc.VerifyToken(loginResp.Token); err == nil {
		t.Fatalf("登出后 token 不应继续有效")
	}
}

// 描述：校验默认身份、权限模板与可用智能体列表均可在管理员初始化后返回。
func TestAuthServiceDefaultResources(t *testing.T) {
	t.Parallel()

	svc := newTestAuthService(t)
	bootstrapResp, err := svc.BootstrapAdmin(specs.AuthBootstrapAdminReq{
		Name:     "Admin",
		Email:    "admin@example.com",
		Password: "secret123",
	})
	if err != nil {
		t.Fatalf("准备管理员失败: %v", err)
	}

	identitiesResp, err := svc.ListUserIdentities(bootstrapResp.User.ID)
	if err != nil {
		t.Fatalf("查询身份失败: %v", err)
	}
	if len(identitiesResp.List) != 3 {
		t.Fatalf("管理员默认身份数量应为 3，got=%d", len(identitiesResp.List))
	}
	if !hasGrantManageRole(identitiesResp.List) {
		t.Fatalf("管理员默认身份应包含权限管理角色")
	}

	templatesResp, err := svc.ListPermissionTemplates()
	if err != nil {
		t.Fatalf("查询权限模板失败: %v", err)
	}
	if len(templatesResp.List) < 3 {
		t.Fatalf("权限模板数量不足，got=%d", len(templatesResp.List))
	}

	agentsResp, err := svc.ListAvailableAgents(bootstrapResp.User.ID)
	if err != nil {
		t.Fatalf("查询可用智能体失败: %v", err)
	}
	if len(agentsResp.List) != 2 {
		t.Fatalf("默认可用智能体数量应为 2，got=%d", len(agentsResp.List))
	}

	manageableUsersResp, err := svc.ListManageableUsers(bootstrapResp.User.ID)
	if err != nil {
		t.Fatalf("查询可管理用户失败: %v", err)
	}
	if len(manageableUsersResp.List) != 2 {
		t.Fatalf("可管理用户数量应为 2，got=%d", len(manageableUsersResp.List))
	}
	if manageableUsersResp.List[0].Self {
		t.Fatalf("默认排序应优先展示非当前账号用户")
	}
	if !manageableUsersResp.List[1].Self {
		t.Fatalf("当前管理员自身应标记为 self=true")
	}
}

// 描述：校验权限授权新增与撤销流程，并确认演示用户可作为授权目标存在。
func TestAuthServiceGrantAndRevokePermission(t *testing.T) {
	t.Parallel()

	svc := newTestAuthService(t)
	bootstrapResp, err := svc.BootstrapAdmin(specs.AuthBootstrapAdminReq{
		Name:     "Admin",
		Email:    "admin@example.com",
		Password: "secret123",
	})
	if err != nil {
		t.Fatalf("准备管理员失败: %v", err)
	}

	grantResp, err := svc.GrantPermission(bootstrapResp.User.ID, specs.AuthGrantPermissionReq{
		TargetUserID:   defaultDemoUserID,
		TargetUserName: "Demo User",
		PermissionCode: "model.access.grant",
		ResourceType:   "model",
		ResourceName:   "基础模型池",
	})
	if err != nil {
		t.Fatalf("新增授权失败: %v", err)
	}
	if grantResp.Item.GrantID == "" {
		t.Fatalf("授权记录 ID 不能为空")
	}

	listResp, err := svc.ListPermissionGrants(bootstrapResp.User.ID, specs.AuthPermissionGrantListReq{})
	if err != nil {
		t.Fatalf("查询授权记录失败: %v", err)
	}
	if len(listResp.List) != 1 {
		t.Fatalf("授权记录数量应为 1，got=%d", len(listResp.List))
	}

	revokeResp, err := svc.RevokePermission(bootstrapResp.User.ID, specs.AuthRevokePermissionReq{GrantID: grantResp.Item.GrantID})
	if err != nil {
		t.Fatalf("撤销授权失败: %v", err)
	}
	if !revokeResp.Success {
		t.Fatalf("撤销授权应返回成功")
	}
}

// 描述：校验密码匹配逻辑，确保 bcrypt 哈希和非法占位值行为符合预期。
func TestMatchPassword(t *testing.T) {
	t.Parallel()

	hash, err := hashPassword("secret123")
	if err != nil {
		t.Fatalf("生成密码哈希失败: %v", err)
	}
	if !matchPassword(hash, "secret123") {
		t.Fatalf("正确密码应匹配成功")
	}
	if matchPassword(hash, "wrong") {
		t.Fatalf("错误密码不应匹配")
	}
	if matchPassword("!bootstrap-only!", "whatever") {
		t.Fatalf("占位密码不应允许登录")
	}
}
