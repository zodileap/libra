import { AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
import { resolveShortcutItems } from "../../../shared/data";
import type { AuthAvailableAgentItem } from "../../../shared/types";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述:
//
//   - 定义首页组件入参。
interface HomePageProps {
  availableAgents: AuthAvailableAgentItem[];
}

// 描述：展示首页概览与当前用户授权智能体状态。
export function HomePage({ availableAgents }: HomePageProps) {
  const { t } = useDesktopI18n();
  const shortcuts = resolveShortcutItems();

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      <AriFlex className="desk-home-hero" vertical align="flex-start" justify="flex-start" space={16}>
        <AriTypography variant="h1" value={t("欢迎使用 Libra")} />
        <AriTypography
          variant="body"
          value={t("Home 已切换为统一智能体项目入口，左侧直接进入工作流、技能、MCP 与项目列表。")}
        />
      </AriFlex>

      <section className="desk-block">
        <AriTypography variant="h3" value={t("授权智能体")} />
        <AriContainer className="desk-shortcuts">
          {availableAgents.length === 0 ? (
            <AriCard className="desk-shortcut-card">
              <AriTypography variant="h4" value={t("暂无授权智能体")} />
              <AriTypography variant="caption" value={t("请先在账号服务配置用户授权关系后再联调。")} />
            </AriCard>
          ) : (
            availableAgents.map((item) => (
              <AriCard key={item.accessId} className="desk-shortcut-card">
                <AriTypography variant="h4" value={item.name} />
                <AriTypography
                  variant="caption"
                  value={t("编码：{{code}} · 授权状态：{{status}}", {
                    code: item.code,
                    status: item.accessStatus === 1 ? t("已授权") : t("未授权"),
                  })}
                />
              </AriCard>
            ))
          )}
        </AriContainer>
      </section>

      <section className="desk-block">
        <AriTypography variant="h3" value={t("快捷入口")} />
        <AriContainer className="desk-shortcuts">
          {shortcuts.map((item) => (
            <AriCard key={item.id} className="desk-shortcut-card">
              <AriTypography variant="h4" value={item.title} />
              <AriTypography variant="caption" value={item.description} />
            </AriCard>
          ))}
        </AriContainer>
      </section>

      <section className="desk-block">
        <AriTypography variant="h3" value={t("使用情况")} />
        <AriCard className="desk-usage-card">
          <AriTypography variant="caption" value={t("近 7 天请求量")} />
          <AriContainer className="desk-bars">
            <AriContainer className="desk-bar" style={{ height: 26 }} />
            <AriContainer className="desk-bar" style={{ height: 38 }} />
            <AriContainer className="desk-bar" style={{ height: 18 }} />
            <AriContainer className="desk-bar" style={{ height: 52 }} />
            <AriContainer className="desk-bar" style={{ height: 36 }} />
            <AriContainer className="desk-bar" style={{ height: 42 }} />
            <AriContainer className="desk-bar" style={{ height: 64 }} />
          </AriContainer>
        </AriCard>
      </section>
    </AriContainer>
  );
}
