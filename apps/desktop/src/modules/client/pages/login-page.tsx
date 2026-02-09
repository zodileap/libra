import { useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";

interface LoginPageProps {
  onLogin: (account: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [account, setAccount] = useState("demo@zodileap.com");
  const [password, setPassword] = useState("");

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
            label="登录"
            onClick={() => onLogin(account.trim() || "demo@zodileap.com")}
          />
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
