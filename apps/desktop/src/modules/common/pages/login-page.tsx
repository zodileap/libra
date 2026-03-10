import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriTypography } from "@aries-kit/react";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述:
//
//   - 定义登录页组件入参。
interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<void>;
}

// 描述:
//
//   - 渲染登录页面并处理账号密码校验与提交状态。
export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useDesktopI18n();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
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
    const normalizedAccount = account.trim();
    const normalizedPassword = password;
    if (!normalizedAccount) {
      AriMessage.warning({
        content: t("请输入账号后再登录。"),
        duration: 2500,
      });
      return;
    }
    if (!normalizedPassword.trim()) {
      const text = t("请输入密码后再登录。");
      setPasswordError(text);
      AriMessage.warning({
        content: text,
        duration: 2500,
      });
      return;
    }
    if (normalizedPassword.length < 6) {
      const text = t("密码至少需要 6 位字符。");
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
      const text = err instanceof Error ? err.message : t("登录失败，请稍后重试");
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
          <AriTypography variant="h1" value="Libra" />
          <AriTypography variant="caption" value={t("登录后访问统一智能体工作台")} />

          <AriInput
            label={t("账号")}
            value={account}
            placeholder={t("请输入邮箱")}
            onChange={setAccount}
          />
          <AriInput
            label={t("密码")}
            value={password}
            type="password"
            placeholder={t("请输入密码")}
            onChange={handlePasswordChange}
          />
          {passwordError ? (
            <AriTypography
              className="desk-login-password-error"
              variant="caption"
              value={passwordError}
            />
          ) : null}
          <AriButton
            color="primary"
            label={submitting ? t("登录中...") : t("登录")}
            onClick={() => {
              void handleSubmit();
            }}
          />
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
