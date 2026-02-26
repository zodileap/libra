import { AriButton, AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
import { useNavigate } from "react-router-dom";
import { useConsoleContext } from "../context";

// 描述：身份类型转中文文案。
function identityTypeText(type: string): string {
  if (type === "organization_member") {
    return "公司成员";
  }
  if (type === "department_member") {
    return "部门成员";
  }
  if (type === "individual") {
    return "独立用户";
  }
  return type;
}

// 描述：登录后身份选择页；当用户拥有多个身份时，通过横向卡片选择进入身份。
export function ConsoleIdentitySelectPage() {
  const navigate = useNavigate();
  const { identities, selectIdentity } = useConsoleContext();

  // 描述：处理身份卡片确认，写入已选身份并进入控制台首页。
  const handleChooseIdentity = (identityId: string) => {
    selectIdentity(identityId);
    navigate("/console", { replace: true });
  };

  return (
    <AriContainer className="web-console-identity-select-list">
      {identities.map((item) => (
        <AriCard key={item.id} className="web-console-identity-select-card">
          <AriFlex vertical align="flex-start" justify="flex-start" space={10}>
            <AriTypography variant="h4" value={item.scopeName} />
            <AriTypography variant="caption" value={`身份类型：${identityTypeText(item.type)}`} />
            <AriTypography variant="caption" value={`角色：${item.roles.join("、") || "未配置"}`} />
            <AriTypography variant="caption" value={`状态：${item.status}`} />
            <AriButton label="以该身份进入" color="primary" onClick={() => handleChooseIdentity(item.id)} />
          </AriFlex>
        </AriCard>
      ))}
    </AriContainer>
  );
}
