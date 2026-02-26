import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriTypography } from "aries_react";
import { useNavigate } from "react-router-dom";
import { useConsoleContext } from "../context";

// 描述：控制台登录页，负责账号密码登录。
export function ConsoleLoginPage() {
  const navigate = useNavigate();
  const { login } = useConsoleContext();
  const [account, setAccount] = useState("test@zodileap.com");
  const [password, setPassword] = useState("Test@123456");
  const [submitting, setSubmitting] = useState(false);

  // 描述：提交登录请求并根据结果跳转控制台主页。
  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    if (!account.trim() || !password.trim()) {
      AriMessage.warning({ content: "请输入账号和密码后再登录。", duration: 2000 });
      return;
    }
    setSubmitting(true);
    try {
      await login(account.trim(), password);
      navigate("/console", { replace: true });
    } catch (err) {
      AriMessage.error({
        content: err instanceof Error ? err.message : "登录失败，请稍后重试。",
        duration: 3000,
        showClose: true
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AriContainer className="web-console-login-page">
      <AriCard className="web-console-login-card">
        <AriFlex vertical align="flex-start" justify="flex-start" space={12}>
          <AriTypography variant="h2" value="管理控制台登录" />
          <AriTypography variant="caption" value="登录后可管理身份、角色及模型授权" />
          <AriInput label="账号" value={account} placeholder="请输入邮箱" onChange={setAccount} />
          <AriInput label="密码" type="password" value={password} placeholder="请输入密码" onChange={setPassword} />
          <AriButton label={submitting ? "登录中..." : "登录"} color="primary" onClick={() => void handleSubmit()} />
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
