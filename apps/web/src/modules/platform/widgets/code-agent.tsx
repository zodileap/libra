import { AriCallout, AriContainer } from "aries_react";
import { AssetsPanel } from "../components/code-agent/assets-panel";
import { Composer } from "../components/code-agent/composer";
import { MessageList } from "../components/code-agent/message-list";
import { PreviewPanel } from "../components/code-agent/preview-panel";
import { useCodeAgent } from "../hooks/use-code-agent";

export function CodeAgentPage() {
  const {
    state,
    input,
    setInput,
    previewInput,
    setPreviewInput,
    assetDraft,
    setAssetDraft,
    sendMessage,
    updatePreview,
    addAsset,
    removeAsset,
    groupedAssets
  } = useCodeAgent();

  return (
    <AriContainer style={{ padding: 16, height: "100%" }}>
      <h2 style={{ marginTop: 0 }}>代码智能体</h2>
      <AriCallout type="info" title="Web 预览说明">
        预览依赖后端 sandbox 提供的运行地址。当前可先手工输入预览 URL 进行联调。
      </AriCallout>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginTop: 12, minHeight: 640 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateRows: "1fr auto" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, overflow: "auto" }}>
            <MessageList messages={state.messages} />
          </div>
          <Composer value={input} onChange={setInput} onSend={sendMessage} />
        </div>

        <div style={{ display: "grid", gap: 10, gridTemplateRows: "1fr auto" }}>
          <div style={{ minHeight: 340 }}>
            <PreviewPanel
              previewUrl={state.previewUrl}
              previewInput={previewInput}
              onInput={setPreviewInput}
              onApply={updatePreview}
            />
          </div>
          <AssetsPanel
            assetDraft={assetDraft}
            onDraftChange={setAssetDraft}
            onAdd={addAsset}
            onRemove={removeAsset}
            groupedAssets={groupedAssets}
          />
        </div>
      </div>
    </AriContainer>
  );
}
