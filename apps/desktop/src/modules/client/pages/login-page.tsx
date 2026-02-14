import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriModal, AriTypography } from "aries_react";

interface LoginPageProps {
  onLogin: (account: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState("demo@zodileap.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // 描述：提交登录请求并在失败时使用弹窗提示错误信息。
  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    const normalizedAccount = account.trim() || "demo@zodileap.com";
    const normalizedPassword = password.trim();
    console.log("Attempting login with account:", normalizedAccount);
    console.log("Password length:", normalizedPassword.length);
    if (!normalizedPassword) {
      console.warn("Password is empty, prompting user to enter password.");
      const text = "请输入密码后再登录。";
      setErrorMessage(text);
      setErrorModalVisible(true);
      AriMessage.warning({
        content: text,
        duration: 2500,
      });
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(normalizedAccount, normalizedPassword);
    } catch (err) {
      const text = err instanceof Error ? err.message : "登录失败，请稍后重试";
      setErrorMessage(text);
      setErrorModalVisible(true);
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

      <AriModal
        visible={errorModalVisible}
        title="登录失败"
        onClose={() => setErrorModalVisible(false)}
        footer={(
          <AriButton
            color="primary"
            label="我知道了"
            onClick={() => setErrorModalVisible(false)}
          />
        )}
      >
        <AriTypography variant="body" value={errorMessage || "未知错误"} />
      </AriModal>
    </AriContainer>
  );
}
