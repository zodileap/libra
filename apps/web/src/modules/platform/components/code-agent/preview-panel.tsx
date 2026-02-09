import { AriCallout, AriContainer } from "aries_react";

interface PreviewPanelProps {
  previewUrl: string;
  previewInput: string;
  onInput: (value: string) => void;
  onApply: () => void;
}

export function PreviewPanel({ previewUrl, previewInput, onInput, onApply }: PreviewPanelProps) {
  return (
    <AriContainer style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, height: "100%" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={previewInput}
          onChange={(e) => onInput(e.target.value)}
          placeholder="输入 sandbox 预览地址，如 http://127.0.0.1:5173"
          style={{ flex: 1, borderRadius: 8, border: "1px solid #d1d5db", padding: "8px 10px" }}
        />
        <button onClick={onApply} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #111827", background: "#111827", color: "#fff" }}>
          加载
        </button>
      </div>

      {previewUrl ? (
        <iframe
          src={previewUrl}
          title="web-preview"
          style={{ width: "100%", height: "calc(100% - 50px)", border: "1px solid #e5e7eb", borderRadius: 8 }}
        />
      ) : (
        <AriCallout type="tip" title="预览未连接">
          当前尚未连接后端 sandbox 预览服务。输入地址后可先手动加载。
        </AriCallout>
      )}
    </AriContainer>
  );
}
