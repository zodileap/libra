import { AriButton, AriCallout, AriContainer } from "aries_react";

interface PreviewPanelProps {
  previewUrl: string;
  previewInput: string;
  onInput: (value: string) => void;
  onApply: () => void;
}

export function PreviewPanel({ previewUrl, previewInput, onInput, onApply }: PreviewPanelProps) {
  return (
    <AriContainer className="web-panel">
      <div className="web-inline-row">
        <input
          value={previewInput}
          onChange={(e) => onInput(e.target.value)}
          placeholder="输入 sandbox 预览地址，如 http://127.0.0.1:5173"
          className="web-form-field compact"
        />
        <AriButton type="default" label="加载" onClick={onApply} />
      </div>

      {previewUrl ? (
        <iframe
          src={previewUrl}
          title="web-preview"
          className="web-preview-frame"
        />
      ) : (
        <AriCallout type="tip" title="预览未连接">
          当前尚未连接后端 sandbox 预览服务。输入地址后可先手动加载。
        </AriCallout>
      )}
    </AriContainer>
  );
}
