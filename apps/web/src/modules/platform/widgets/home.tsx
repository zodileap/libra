import { AriCallout, AriContainer } from "aries_react";

const cards = [
  { title: "可用智能体", value: "2", desc: "代码智能体 / 三维模型智能体" },
  { title: "授权状态", value: "准备接入", desc: "用户授权与激活码能力待联调" },
  { title: "当前阶段", value: "P0", desc: "优先打通代码智能体与预览链路" }
];

export function PlatformHomePage() {
  return (
    <AriContainer style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>智能体平台总览</h2>
      <AriCallout type="info" title="产品边界">
        平台作为主入口，智能体模块可独立授权与售卖。Core 承担流程、激活码和模型调用通用逻辑。
      </AriCallout>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
        {cards.map((card) => (
          <div key={card.title} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.65 }}>{card.title}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{card.value}</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>{card.desc}</div>
          </div>
        ))}
      </div>
    </AriContainer>
  );
}
