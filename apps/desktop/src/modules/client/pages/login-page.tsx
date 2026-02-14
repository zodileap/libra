import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState("demo@zodileap.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 描述：提交登录请求并在失败时使用弹窗提示错误信息。
  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onLogin(account.trim() || "demo@zodileap.com", password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败，请稍后重试";
      window.alert(message);
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
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
