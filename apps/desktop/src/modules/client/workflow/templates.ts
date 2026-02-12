import type { WorkflowDefinition } from "./types";

export const DEFAULT_MODEL_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "wf-model-full-v1",
    name: "模型完整流程（0→1→2→2.5→3）",
    description: "输入 -> 生图 -> 结构化 -> 图生模 -> Meshy 兜底 -> DCC MCP 操作（导入/新建/编辑/导出）",
    version: 1,
    shared: false,
    nodes: [
      {
        id: "node-input",
        kind: "input",
        name: "0. 输入",
        enabled: true,
        retryCount: 0,
        params: {},
      },
      {
        id: "node-image-generate",
        kind: "image_generate",
        name: "1. 生图（Gemini）",
        enabled: true,
        retryCount: 1,
        fallbackKind: "structured_constraints",
        params: {
          candidateCount: 4,
        },
      },
      {
        id: "node-structured",
        kind: "structured_constraints",
        name: "1.5 结构化描述",
        enabled: true,
        retryCount: 0,
        params: {},
      },
      {
        id: "node-meshy-i2m",
        kind: "meshy_image_to_3d",
        name: "2. Meshy 图生模",
        enabled: true,
        retryCount: 1,
        fallbackKind: "blender_refine_export",
        params: {
          quality: "balanced",
        },
      },
      {
        id: "node-meshy-refine",
        kind: "meshy_refine",
        name: "2.5 Meshy 兜底细化",
        enabled: true,
        retryCount: 1,
        fallbackKind: "blender_refine_export",
        params: {
          remesh: true,
          retexture: true,
        },
      },
      {
        id: "node-blender-refine",
        kind: "blender_refine_export",
        name: "3. DCC MCP 操作（导入/新建/编辑/按需导出）",
        enabled: true,
        retryCount: 1,
        params: {},
      },
    ],
  },
  {
    id: "wf-model-direct-blender-v1",
    name: "当前 DCC 直接操作",
    description: "跳过前序步骤，直接通过 MCP 对当前会话做导入/新建/编辑/按需导出",
    version: 1,
    shared: false,
    nodes: [
      {
        id: "node-blender-direct",
        kind: "blender_refine_export",
        name: "3. DCC 直接操作（导入/新建/编辑/按需导出）",
        enabled: true,
        retryCount: 1,
        params: {},
      },
    ],
  },
];
