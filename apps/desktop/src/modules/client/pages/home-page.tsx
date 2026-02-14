import { AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
import { SHORTCUTS } from "../data";

// 描述:
//
//   - 首页“近 7 天请求量”柱图的高度档位 class，避免在 JSX 中硬编码内联样式。
const USAGE_BAR_CLASS_NAMES = [
  "desk-bar-size-1",
  "desk-bar-size-2",
  "desk-bar-size-3",
  "desk-bar-size-4",
  "desk-bar-size-5",
  "desk-bar-size-6",
  "desk-bar-size-7",
];

// 描述:
//
//   - 渲染 Desktop 首页，包括快捷入口与使用情况展示。
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
            {USAGE_BAR_CLASS_NAMES.map((className) => (
              <div key={className} className={`desk-bar ${className}`} />
            ))}
          </div>
        </AriCard>
      </section>
    </AriContainer>
  );
}
