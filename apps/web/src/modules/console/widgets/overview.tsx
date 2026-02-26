import { AriCard, AriContainer, AriTypography } from "aries_react";
import { useConsoleContext } from "../context";

// 描述：控制台概览页，展示身份与权限数据总览。
export function ConsoleOverviewPage() {
  const { identities, permissionGrants, permissionTemplates } = useConsoleContext();

  return (
    <AriContainer className="web-console-page">
      <AriContainer className="web-console-cards-grid">
        <AriCard className="web-console-card">
          <AriTypography variant="h4" value="身份数量" />
          <AriTypography variant="h2" value={String(identities.length)} />
          <AriTypography variant="caption" value="包含公司、部门、独立用户等身份" />
        </AriCard>
        <AriCard className="web-console-card">
          <AriTypography variant="h4" value="授权记录" />
          <AriTypography variant="h2" value={String(permissionGrants.length)} />
          <AriTypography variant="caption" value="可在权限管理中查看、新增与撤销" />
        </AriCard>
        <AriCard className="web-console-card">
          <AriTypography variant="h4" value="权限模板" />
          <AriTypography variant="h2" value={String(permissionTemplates.length)} />
          <AriTypography variant="caption" value="用于快速选择可授权的能力项" />
        </AriCard>
      </AriContainer>
    </AriContainer>
  );
}
