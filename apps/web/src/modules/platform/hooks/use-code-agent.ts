import { useMemo, useState } from "react";
import type { CodeAgentState, CodeMessage, ConstraintAsset } from "../types";

const seedMessages: CodeMessage[] = [
  {
    id: "m1",
    role: "assistant",
    content: "已为你初始化项目骨架。请输入下一个需求，我会基于约束资产生成代码。",
    createdAt: "2026-02-07 17:20"
  }
];

const seedAssets: ConstraintAsset[] = [
  {
    id: "a1",
    kind: "framework",
    name: "aries_react",
    source: "https://github.com/zodileap/libra.git",
    description: "统一 UI 组件基础"
  }
];

const seedState: CodeAgentState = {
  messages: seedMessages,
  assets: seedAssets,
  previewUrl: ""
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useCodeAgent() {
  const [state, setState] = useState<CodeAgentState>(seedState);
  const [input, setInput] = useState("");
  const [previewInput, setPreviewInput] = useState("");
  const [assetDraft, setAssetDraft] = useState<Omit<ConstraintAsset, "id">>({
    kind: "framework",
    name: "",
    source: "",
    description: ""
  });

  const sendMessage = () => {
    const content = input.trim();
    if (!content) {
      return;
    }

    const userMsg: CodeMessage = {
      id: createId("user"),
      role: "user",
      content,
      createdAt: new Date().toISOString().slice(0, 16).replace("T", " ")
    };

    const assistantMsg: CodeMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "已记录你的需求。下一步我会按已选框架/组件/模块约束生成实现方案。",
      createdAt: new Date().toISOString().slice(0, 16).replace("T", " ")
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg, assistantMsg]
    }));
    setInput("");
  };

  const updatePreview = () => {
    const url = previewInput.trim();
    setState((prev) => ({ ...prev, previewUrl: url }));
  };

  const addAsset = () => {
    const name = assetDraft.name.trim();
    if (!name) {
      return;
    }
    const next: ConstraintAsset = {
      ...assetDraft,
      id: createId("asset"),
      name,
      source: assetDraft.source.trim(),
      description: assetDraft.description.trim()
    };

    setState((prev) => ({ ...prev, assets: [next, ...prev.assets] }));
    setAssetDraft({ kind: "framework", name: "", source: "", description: "" });
  };

  const removeAsset = (id: string) => {
    setState((prev) => ({
      ...prev,
      assets: prev.assets.filter((asset) => asset.id !== id)
    }));
  };

  const groupedAssets = useMemo(() => {
    return {
      framework: state.assets.filter((a) => a.kind === "framework"),
      component: state.assets.filter((a) => a.kind === "component"),
      module: state.assets.filter((a) => a.kind === "module")
    };
  }, [state.assets]);

  return {
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
  };
}
