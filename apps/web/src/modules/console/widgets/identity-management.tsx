import { AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
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

// 描述：身份管理页，展示当前用户可用身份与关联角色。
export function ConsoleIdentityManagementPage() {
  const { identities } = useConsoleContext();

  return (
    <AriContainer className="web-console-page">
      <AriTypography variant="h3" value="身份管理" />
      <AriTypography variant="caption" value="一个用户可同时拥有多个身份，身份可附着不同角色。" />
      <AriContainer className="web-console-list">
        {identities.map((item) => (
          <AriCard key={item.id} className="web-console-list-card">
            <AriFlex justify="space-between" align="center">
              <AriTypography variant="h4" value={item.scopeName} />
              <AriTypography variant="caption" value={item.status} />
            </AriFlex>
            <AriTypography variant="caption" value={`身份类型：${identityTypeText(item.type)}`} />
            <AriTypography variant="caption" value={`角色：${item.roles.join("、") || "未配置"}`} />
          </AriCard>
        ))}
      </AriContainer>
    </AriContainer>
  );
}
