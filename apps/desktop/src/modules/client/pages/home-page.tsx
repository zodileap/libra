import { AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
import { SHORTCUTS } from "../data";

export function HomePage() {
  return (
    <AriContainer className="desk-content">
      <AriFlex vertical space={16}>
        <AriTypography variant="h1" value="欢迎使用 Zodileap Agen" />
        <AriTypography
          variant="body"
          value="平台是主入口，智能体是可拆分模块。你可以从左侧进入代码智能体或模型智能体。"
        />
      </AriFlex>

      <section className="desk-block">
        <AriTypography variant="h3" value="快捷入口" />
        <div className="desk-shortcuts">
          {SHORTCUTS.map((item) => (
            <AriCard key={item.id} className="desk-shortcut-card">
              <AriTypography variant="h4" value={item.title} />
              <AriTypography variant="caption" value={item.description} />
            </AriCard>
          ))}
        </div>
      </section>

      <section className="desk-block">
        <AriTypography variant="h3" value="使用情况" />
        <AriCard className="desk-usage-card">
          <AriTypography variant="caption" value="近 7 天请求量" />
          <div className="desk-bars">
            <div className="desk-bar" style={{ height: 26 }} />
            <div className="desk-bar" style={{ height: 38 }} />
            <div className="desk-bar" style={{ height: 18 }} />
            <div className="desk-bar" style={{ height: 52 }} />
            <div className="desk-bar" style={{ height: 36 }} />
            <div className="desk-bar" style={{ height: 42 }} />
            <div className="desk-bar" style={{ height: 64 }} />
          </div>
        </AriCard>
      </section>
    </AriContainer>
  );
}
