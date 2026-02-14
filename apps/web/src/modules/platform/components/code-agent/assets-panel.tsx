import { AriButton, AriContainer, AriTypography } from "aries_react";
import type { AssetKind, ConstraintAsset } from "../../types";

interface AssetsPanelProps {
  assetDraft: Omit<ConstraintAsset, "id">;
  onDraftChange: (next: Omit<ConstraintAsset, "id">) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  groupedAssets: {
    framework: ConstraintAsset[];
    component: ConstraintAsset[];
    module: ConstraintAsset[];
  };
}

function titleOf(kind: AssetKind): string {
  if (kind === "framework") return "框架";
  if (kind === "component") return "自定义组件";
  return "代码模块";
}

export function AssetsPanel({ assetDraft, onDraftChange, onAdd, onRemove, groupedAssets }: AssetsPanelProps) {
  // 描述:
  //
  //   - 更新资产草稿字段，保持表单状态单一入口。
  //
  // Params:
  //
  //   - key: 字段名。
  //   - value: 字段值。
  const setField = (key: keyof Omit<ConstraintAsset, "id">, value: string) => {
    onDraftChange({ ...assetDraft, [key]: value });
  };

  return (
    <AriContainer className="web-panel">
      <AriTypography className="web-page-title" variant="h3" value="资产约束" />
      <div className="web-assets-list">
        <select
          value={assetDraft.kind}
          onChange={(e) => setField("kind", e.target.value as AssetKind)}
          className="web-form-field compact"
        >
          <option value="framework">框架</option>
          <option value="component">组件</option>
          <option value="module">代码模块</option>
        </select>
        <input
          value={assetDraft.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="名称"
          className="web-form-field compact"
        />
        <input
          value={assetDraft.source}
          onChange={(e) => setField("source", e.target.value)}
          placeholder="来源（Git 地址/上传标识）"
          className="web-form-field compact"
        />
        <textarea
          value={assetDraft.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="描述"
          className="web-form-field textarea"
        />
        <AriButton color="primary" label="添加资产" onClick={onAdd} />
      </div>

      {(Object.keys(groupedAssets) as AssetKind[]).map((kind) => (
        <div key={kind} className="web-assets-group">
          <AriTypography variant="h4" value={titleOf(kind)} />
          {groupedAssets[kind].length === 0 ? <AriTypography variant="caption" value="暂无" /> : null}
          <div className="web-assets-list">
            {groupedAssets[kind].map((asset) => (
              <div key={asset.id} className="web-asset-card">
                <div className="web-inline-row between">
                  <AriTypography variant="h4" value={asset.name} />
                  <AriButton
                    type="text"
                    color="danger"
                    label="删除"
                    onClick={() => onRemove(asset.id)}
                  />
                </div>
                <AriTypography variant="caption" value={asset.source || "未填写来源"} />
                {asset.description ? (
                  <AriTypography variant="caption" value={asset.description} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </AriContainer>
  );
}
