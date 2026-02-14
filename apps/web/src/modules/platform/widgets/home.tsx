import { AriCallout, AriContainer, AriTypography } from "aries_react";

const cards = [
  { title: "可用智能体", value: "2", desc: "代码智能体 / 三维模型智能体" },
  { title: "授权状态", value: "准备接入", desc: "用户授权与激活码能力待联调" },
  { title: "当前阶段", value: "P0", desc: "优先打通代码智能体与预览链路" }
];

export function PlatformHomePage() {
  return (
    <AriContainer className="web-page">
      <AriTypography className="web-page-title" variant="h2" value="智能体平台总览" />
      <AriCallout type="info" title="产品边界">
        平台作为主入口，智能体模块可独立授权与售卖。Core 承担流程、激活码和模型调用通用逻辑。
      </AriCallout>

      <div className="web-grid-cards">
        {cards.map((card) => (
          <AriContainer key={card.title} className="web-card">
            <AriTypography variant="caption" value={card.title} />
            <AriTypography variant="h1" value={card.value} />
            <AriTypography variant="caption" value={card.desc} />
          </AriContainer>
        ))}
      </div>
    </AriContainer>
  );
}
