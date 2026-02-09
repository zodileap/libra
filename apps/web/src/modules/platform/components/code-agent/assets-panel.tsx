import { AriContainer } from "aries_react";
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
  const setField = (key: keyof Omit<ConstraintAsset, "id">, value: string) => {
    onDraftChange({ ...assetDraft, [key]: value });
  };

  return (
    <AriContainer style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
      <h3 style={{ marginTop: 0 }}>资产约束</h3>
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        <select
          value={assetDraft.kind}
          onChange={(e) => setField("kind", e.target.value as AssetKind)}
          style={{ borderRadius: 8, border: "1px solid #d1d5db", padding: "8px 10px" }}
        >
          <option value="framework">框架</option>
          <option value="component">组件</option>
          <option value="module">代码模块</option>
        </select>
        <input
          value={assetDraft.name}
          onChange={(e) => setField("name", e.target.value)}
          placeholder="名称"
          style={{ borderRadius: 8, border: "1px solid #d1d5db", padding: "8px 10px" }}
        />
        <input
          value={assetDraft.source}
          onChange={(e) => setField("source", e.target.value)}
          placeholder="来源（Git 地址/上传标识）"
          style={{ borderRadius: 8, border: "1px solid #d1d5db", padding: "8px 10px" }}
        />
        <textarea
          value={assetDraft.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="描述"
          style={{ borderRadius: 8, border: "1px solid #d1d5db", padding: "8px 10px", minHeight: 70, resize: "vertical" }}
        />
        <button onClick={onAdd} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #2f6fdd", background: "#2f6fdd", color: "#fff" }}>
          添加资产
        </button>
      </div>

      {(Object.keys(groupedAssets) as AssetKind[]).map((kind) => (
        <div key={kind} style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{titleOf(kind)}</div>
          {groupedAssets[kind].length === 0 && <div style={{ fontSize: 12, opacity: 0.65 }}>暂无</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {groupedAssets[kind].map((asset) => (
              <div key={asset.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>{asset.name}</strong>
                  <button onClick={() => onRemove(asset.id)} style={{ border: 0, background: "transparent", color: "#b91c1c", cursor: "pointer" }}>
                    删除
                  </button>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{asset.source || "未填写来源"}</div>
                {asset.description && <div style={{ marginTop: 4, fontSize: 12 }}>{asset.description}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </AriContainer>
  );
}
