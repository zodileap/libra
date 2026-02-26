package service

import (
	"strings"
	"testing"
	"time"

	specs "git.zodileap.com/gemini/zodileap_account/specs/v1"
	zerr "git.zodileap.com/taurus/zodileap_go_zerr"
	zspecs "git.zodileap.com/taurus/zodileap_go_zspecs"
	zstatuscode "git.zodileap.com/taurus/zodileap_go_zstatuscode"
	"golang.org/x/crypto/bcrypt"
)

// 描述：校验密码匹配逻辑，覆盖 bcrypt 与明文兼容分支。
func TestMatchPassword(t *testing.T) {
	t.Parallel()

	plain := "secret123"
	hashed, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("生成 bcrypt 密码失败: %v", err)
	}

	if !matchPassword(string(hashed), plain) {
		t.Fatalf("bcrypt 密码匹配失败")
	}
	if !matchPassword(plain, plain) {
		t.Fatalf("明文密码匹配失败")
	}
	if matchPassword(plain, "wrong") {
		t.Fatalf("错误密码不应匹配")
	}
	if matchPassword("", plain) {
		t.Fatalf("空存储密码不应匹配")
	}
}

// 描述：校验身份令牌标准化逻辑，支持 Bearer 前缀并拒绝空 token。
func TestNormalizeIdentityToken(t *testing.T) {
	t.Parallel()

	token, err := normalizeIdentityToken("Bearer atk_token")
	if err != nil {
		t.Fatalf("标准化 bearer token 失败: %v", err)
	}
	if token.String() != "atk_token" {
		t.Fatalf("token 标准化结果错误: %s", token.String())
	}

	_, err = normalizeIdentityToken("   ")
	if err == nil {
		t.Fatalf("空 token 应该返回错误")
	}
}

// 描述：校验内存 token 存储的签发、读取、失效与过期逻辑。
func TestAuthTokenStoreIssueGetRevokeAndExpire(t *testing.T) {
	t.Parallel()

	store := newAuthTokenStore()
	userID := *zspecs.NewUserId("123e4567-e89b-12d3-a456-426614174000")

	session, err := store.issue(userID, 30*time.Millisecond)
	if err != nil {
		t.Fatalf("签发 token 失败: %v", err)
	}
	if session.Token.String() == "" {
		t.Fatalf("签发 token 不能为空")
	}

	got, ok := store.get(session.Token)
	if !ok {
		t.Fatalf("签发后应能读到 token")
	}
	if got.UserId.String() != userID.String() {
		t.Fatalf("读取到的 userId 不一致: got=%s want=%s", got.UserId.String(), userID.String())
	}

	store.revoke(session.Token)
	if _, ok = store.get(session.Token); ok {
		t.Fatalf("revoke 后 token 不应可读")
	}

	expireSession, err := store.issue(userID, time.Millisecond)
	if err != nil {
		t.Fatalf("签发短期 token 失败: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, ok = store.get(expireSession.Token); ok {
		t.Fatalf("过期 token 不应可读")
	}
}

// 描述：校验业务错误构造逻辑，确保状态码被正确绑定。
func TestNewAuthBizError(t *testing.T) {
	t.Parallel()

	err := newAuthBizError("1010099999", zstatuscode.Global_Info_IdentityTokenInvalid.New(), "token invalid")
	ze, ok := err.(*zerr.Err)
	if !ok {
		t.Fatalf("错误类型应为 *zerr.Err")
	}
	if ze.StatuCode == nil {
		t.Fatalf("错误状态码不应为空")
	}
	if ze.StatuCode.Code() != zstatuscode.Global_Info_IdentityTokenInvalid.New().Code() {
		t.Fatalf("错误状态码不匹配")
	}
}

// 描述：校验默认身份创建参数构建逻辑，确保覆盖公司、部门与独立用户三类身份。
func TestBuildDefaultUserIdentityCreates(t *testing.T) {
	t.Parallel()

	userID := *zspecs.NewUserId("123e4567-e89b-12d3-a456-426614174000")
	list := buildDefaultUserIdentityCreates(userID)
	if len(list) != 3 {
		t.Fatalf("默认身份数量应为3，got=%d", len(list))
	}
	if list[0].IdentityType.String() != "organization_member" {
		t.Fatalf("第一个身份应为organization_member，got=%s", list[0].IdentityType.String())
	}
	if list[1].ScopeCode.String() != "dept" {
		t.Fatalf("第二个身份作用域编码应为dept，got=%s", list[1].ScopeCode.String())
	}
	if list[0].RoleCodes == nil || !strings.Contains(list[0].RoleCodes.String(), "permission_admin") {
		t.Fatalf("管理员默认身份应包含permission_admin角色")
	}
}

// 描述：校验权限模板查询逻辑，确保至少返回一条可用模板。
func TestAuthServiceListPermissionTemplates(t *testing.T) {
	t.Parallel()

	svc := NewAuthService()
	resp, err := svc.ListPermissionTemplates()
	if err != nil {
		t.Fatalf("查询权限模板失败: %v", err)
	}
	if len(resp.List) == 0 {
		t.Fatalf("权限模板列表不应为空")
	}
}

// 描述：校验权限授权查询条件构建逻辑。
func TestBuildPermissionGrantQuery(t *testing.T) {
	t.Parallel()

	query, err := buildPermissionGrantQuery(specs.AuthPermissionGrantListReq{
		TargetUserId:   "123e4567-e89b-12d3-a456-426614174001",
		PermissionCode: "model.access.grant",
		ResourceType:   "model",
	})
	if err != nil {
		t.Fatalf("构建查询条件失败: %v", err)
	}
	if query.TargetUserId == nil || query.TargetUserId.String() != "123e4567-e89b-12d3-a456-426614174001" {
		t.Fatalf("targetUserId 查询条件不正确")
	}
	if query.PermissionCode == nil || query.PermissionCode.String() != "model.access.grant" {
		t.Fatalf("permissionCode 查询条件不正确")
	}
	if query.ResourceType == nil || query.ResourceType.String() != "model" {
		t.Fatalf("resourceType 查询条件不正确")
	}

	if _, err = buildPermissionGrantQuery(specs.AuthPermissionGrantListReq{TargetUserId: "invalid_user_id"}); err == nil {
		t.Fatalf("非法 targetUserId 应返回错误")
	}
}

// 描述：校验权限管理角色判定逻辑，管理员应具备授权管理能力。
func TestHasGrantManageRole(t *testing.T) {
	t.Parallel()

	adminIdentities := []specs.AuthIdentityItem{
		{IdentityId: "org-1", RoleCodes: []string{"org_member", "permission_admin"}},
	}
	normalIdentities := []specs.AuthIdentityItem{
		{IdentityId: "org-2", RoleCodes: []string{"org_member", "model_operator"}},
	}

	if !hasGrantManageRole(adminIdentities) {
		t.Fatalf("管理员身份应具备授权管理能力")
	}
	if hasGrantManageRole(normalIdentities) {
		t.Fatalf("普通身份不应具备授权管理能力")
	}
}
