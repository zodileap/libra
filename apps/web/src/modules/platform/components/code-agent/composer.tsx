import { AriContainer } from "aries_react";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

export function Composer({ value, onChange, onSend }: ComposerProps) {
  return (
    <AriContainer style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入需求，例如：基于 aries_react 生成一个用户管理页面..."
        style={{ width: "100%", minHeight: 110, resize: "vertical", border: 0, outline: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.65 }}>生成时会自动应用右侧资产约束</span>
        <button onClick={onSend} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #2f6fdd", background: "#2f6fdd", color: "#fff" }}>
          发送
        </button>
      </div>
    </AriContainer>
  );
}
