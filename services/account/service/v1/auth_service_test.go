package service

import (
	"testing"
	"time"

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
