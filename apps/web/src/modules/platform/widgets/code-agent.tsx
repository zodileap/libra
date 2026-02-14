import { AriCallout, AriContainer, AriTypography } from "aries_react";
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
    <AriContainer className="web-page web-page-full">
      <AriTypography className="web-page-title" variant="h2" value="代码智能体" />
      <AriCallout type="info" title="Web 预览说明">
        预览依赖后端 sandbox 提供的运行地址。当前可先手工输入预览 URL 进行联调。
      </AriCallout>

      <div className="web-workbench">
        <div className="web-workbench-main">
          <div className="web-panel web-panel-scroll web-scroll">
            <MessageList messages={state.messages} />
          </div>
          <Composer value={input} onChange={setInput} onSend={sendMessage} />
        </div>

        <div className="web-workbench-side">
          <div className="web-panel-scroll">
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
