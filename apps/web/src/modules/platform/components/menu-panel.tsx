import { AriContainer, AriFlex } from "aries_react";
import { useNavigate } from "react-router-dom";
import { usePlatformContext } from "../context";

export function MenuPanel() {
  const navigate = useNavigate();
  const { menuItems, currentPath } = usePlatformContext();

  return (
    <AriContainer style={{ padding: 12, borderRight: "1px solid #e5e7eb", height: "100%" }}>
      <div style={{ padding: "6px 4px 14px" }}>
        <div style={{ fontWeight: 700 }}>Zodileap Agen</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>平台入口 + 模块化智能体</div>
      </div>

      <AriFlex direction="column" gap={8}>
        <button
          onClick={() => navigate("/")}
          style={{
            textAlign: "left",
            padding: "10px 12px",
            borderRadius: 8,
            border: currentPath === "/" ? "1px solid #2f6fdd" : "1px solid #d9d9d9",
            background: currentPath === "/" ? "#eff5ff" : "#fff",
            cursor: "pointer"
          }}
        >
          <div style={{ fontWeight: 600 }}>平台总览</div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.75 }}>订阅、授权、模块入口</div>
        </button>

        {menuItems.map((item) => {
          const active = currentPath.startsWith(item.path);
          return (
            <button
              key={item.key}
              onClick={() => navigate(item.path)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: active ? "1px solid #2f6fdd" : "1px solid #d9d9d9",
                background: active ? "#eff5ff" : "#fff",
                cursor: "pointer"
              }}
            >
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.75 }}>{item.description}</div>
            </button>
          );
        })}
      </AriFlex>

      <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 10, fontSize: 12, opacity: 0.75 }}>
        当前用户：demo@zodileap.com
      </div>
    </AriContainer>
  );
}
