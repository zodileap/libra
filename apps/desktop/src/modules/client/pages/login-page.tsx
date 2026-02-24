import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriTypography } from "aries_react";

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState("test@zodileap.com");
  const [password, setPassword] = useState("Test@123456");
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // 描述：处理密码输入并在用户继续编辑时清理密码错误提示。
  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (passwordError) {
      setPasswordError("");
    }
  };

  // 描述：提交登录请求并使用消息组件反馈输入校验与登录失败信息。
  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    const normalizedAccount = account.trim() || "demo@zodileap.com";
    const normalizedPassword = password;
    if (!normalizedPassword.trim()) {
      const text = "请输入密码后再登录。";
      setPasswordError(text);
      AriMessage.warning({
        content: text,
        duration: 2500,
      });
      return;
    }
    if (normalizedPassword.length < 6) {
      const text = "密码至少需要 6 位字符。";
      setPasswordError(text);
      AriMessage.warning({
        content: text,
        duration: 2500,
      });
      return;
    }

    setPasswordError("");
    setSubmitting(true);
    try {
      await onLogin(normalizedAccount, normalizedPassword);
    } catch (err) {
      const text = err instanceof Error ? err.message : "登录失败，请稍后重试";
      AriMessage.error({
        content: text,
        duration: 3500,
        showClose: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AriContainer className="desk-login">
      <AriCard className="desk-login-card">
        <AriFlex vertical align="flex-start" justify="flex-start" space={14}>
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
            onChange={handlePasswordChange}
          />
          {passwordError ? (
            <AriTypography
              className="desk-inline-status desk-login-password-error"
              variant="caption"
              value={passwordError}
            />
          ) : null}
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
