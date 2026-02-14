import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState("demo@zodileap.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 描述：提交登录请求并在失败时显示错误提示。
  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onLogin(account.trim() || "demo@zodileap.com", password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AriContainer className="desk-login">
      <AriCard className="desk-login-card">
        <AriFlex vertical space={14}>
          <AriTypography variant="h1" value="Zodileap Agen" />
          <AriTypography variant="caption" value="登录后访问代码智能体和模型智能体" />

          <AriInput
            label="账号"
            value={account}
            placeholder="请输入邮箱"
            onChange={setAccount}
          />
          <AriInput
            label="密码"
            value={password}
            type="password"
            placeholder="请输入密码"
            onChange={setPassword}
          />
          <AriButton
            color="primary"
            label={submitting ? "登录中..." : "登录"}
            onClick={() => {
              void handleSubmit();
            }}
          />
          {error ? <AriTypography variant="caption" value={error} /> : null}
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
