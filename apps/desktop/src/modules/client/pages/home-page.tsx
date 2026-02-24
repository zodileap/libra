import { AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
import { SHORTCUTS } from "../data";
import type { AuthAvailableAgentItem } from "../types";

interface HomePageProps {
  availableAgents: AuthAvailableAgentItem[];
}

// 描述：展示首页概览与当前用户授权智能体状态。
export function HomePage({ availableAgents }: HomePageProps) {
  return (
    <AriContainer className="desk-content">
      <AriFlex vertical align="flex-start" justify="flex-start" space={16}>
        <AriTypography variant="h1" value="欢迎使用 Zodileap Agen" />
        <AriTypography
          variant="body"
          value="平台是主入口，智能体是可拆分模块。你可以从左侧进入代码智能体或模型智能体。"
        />
      </AriFlex>

      <section className="desk-block">
        <AriTypography variant="h3" value="授权智能体" />
        <AriContainer className="desk-shortcuts">
          {availableAgents.length === 0 ? (
            <AriCard className="desk-shortcut-card">
              <AriTypography variant="h4" value="暂无授权智能体" />
              <AriTypography variant="caption" value="请先在账号服务配置用户授权关系后再联调。" />
            </AriCard>
          ) : (
            availableAgents.map((item) => (
              <AriCard key={item.accessId} className="desk-shortcut-card">
                <AriTypography variant="h4" value={item.name} />
                <AriTypography
                  variant="caption"
                  value={`编码：${item.code} · 授权状态：${item.accessStatus === 1 ? "已授权" : "未授权"}`}
                />
              </AriCard>
            ))
          )}
        </AriContainer>
      </section>

      <section className="desk-block">
        <AriTypography variant="h3" value="快捷入口" />
        <AriContainer className="desk-shortcuts">
          {SHORTCUTS.map((item) => (
            <AriCard key={item.id} className="desk-shortcut-card">
              <AriTypography variant="h4" value={item.title} />
              <AriTypography variant="caption" value={item.description} />
            </AriCard>
          ))}
        </AriContainer>
      </section>

      <section className="desk-block">
        <AriTypography variant="h3" value="使用情况" />
        <AriCard className="desk-usage-card">
          <AriTypography variant="caption" value="近 7 天请求量" />
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
