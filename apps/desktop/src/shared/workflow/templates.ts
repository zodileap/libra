import type { CodeWorkflowDefinition, WorkflowDefinition } from "./types";

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

export const DEFAULT_CODE_WORKFLOWS: CodeWorkflowDefinition[] = [
  {
    id: "wf-code-frontend-1-v1",
    name: "前端项目-1",
    description: "面向 React + aries_react 的页面/组件开发流程",
    version: 1,
    shared: false,
    agentKey: "code",
    promptPrefix:
      "你正在执行“前端项目-1”工作流：优先输出可运行页面结构，严格复用 aries_react 组件，并补充必要单元测试。",
  },
  {
    id: "wf-code-frontend-2-v1",
    name: "前端项目-2",
    description: "面向复杂交互和状态管理的前端迭代流程",
    version: 1,
    shared: false,
    agentKey: "code",
    promptPrefix:
      "你正在执行“前端项目-2”工作流：先拆分页面状态和数据流，再落地组件与交互，确保错误处理对用户友好。",
  },
  {
    id: "wf-code-backend-v1",
    name: "后端项目",
    description: "面向接口、服务与测试联动的后端开发流程",
    version: 1,
    shared: false,
    agentKey: "code",
    promptPrefix:
      "你正在执行“后端项目”工作流：优先给出 API/Service 分层实现，补齐错误码映射与单元测试，确保可定位错误上下文。",
  },
];
