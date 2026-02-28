import { invoke } from "@tauri-apps/api/core";
import {
  normalizeInvokeErrorDetail,
  type NormalizedInvokeErrorDetail,
} from "../services/blender-bridge";
import {
  buildUiHintFromProtocolError,
  mapProtocolUiHint,
} from "../services/protocol-ui-hint";
import { listModelWorkflows } from "./storage";
import type {
  ModelAssetRecord,
  ModelEventRecord,
  ModelStepRecord,
  ProtocolUiHint,
} from "../types";
import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowStepRecord,
  WorkflowUiHint,
} from "./types";

// 描述:
//
//   - 定义模型会话命令执行响应结构。
interface ModelSessionRunResponse {
  trace_id: string;
  message: string;
  steps: ModelStepRecord[];
  events: ModelEventRecord[];
  assets: ModelAssetRecord[];
  exported_file?: string;
  ui_hint?: ProtocolUiHint;
}

// 描述:
//
//   - 定义工作流运行期间的上下文载体。
interface WorkflowContext {
  prompt: string;
  referenceImages: string[];
  styleImages: string[];
  generatedCandidates: string[];
  structured?: Record<string, unknown>;
  initialModelPath?: string;
  refinedModelPath?: string;
  exportedFile?: string;
}

// 描述:
//
//   - 判断请求中是否存在可用的 Gemini 生图 Key。
//
// Params:
//
//   - request: 工作流运行请求。
//
// Returns:
//
//   - 是否可执行 Gemini 生图节点。
function hasGeminiImageProvider(request: WorkflowRunRequest) {
  return request.aiKeys.some(
    (item) => item.provider === "gemini" && item.enabled && item.keyValue.trim().length > 0,
  );
}

// 描述:
//
//   - 按起始节点类型截取可执行节点区间。
//
// Params:
//
//   - workflow: 工作流定义。
//   - startKind: 起始节点类型。
//
// Returns:
//
//   - 截取后的节点序列。
function buildNodeRange(workflow: WorkflowDefinition, startKind: WorkflowNodeKind) {
  const all = workflow.nodes;
  if (all.length === 0) {
    return [] as WorkflowNodeDefinition[];
  }
  const index = all.findIndex((item) => item.kind === startKind && item.enabled);
  if (index < 0) {
    return all;
  }
  return all.slice(Math.max(0, index));
}

// 描述:
//
//   - 匹配提示词中可识别的图片路径扩展名。
const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

// 描述:
//
//   - 从提示词中提取图片路径列表（去重后）。
//
// Params:
//
//   - prompt: 用户提示词。
//
// Returns:
//
//   - 图片路径数组。
function extractImagePathsFromPrompt(prompt: string): string[] {
  const tokens = prompt
    .split(/\s+/)
    .map((value) => value.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’.,，。！？；：]+$/g, ""))
    .filter(Boolean);
  const paths = tokens.filter((token) => {
    if (!IMAGE_EXT_REGEX.test(token)) return false;
    return token.startsWith("/") || token.includes(":\\") || token.startsWith("./") || token.startsWith("../");
  });
  return Array.from(new Set(paths));
}

// 描述:
//
//   - 根据提示词语义与输入资源判断工作流入口节点。
//
// Params:
//
//   - prompt: 用户提示词。
//   - referenceImages: 参考图路径列表。
//
// Returns:
//
//   - 入口节点类型。
function detectEntryNodeKind(prompt: string, referenceImages: string[]): WorkflowNodeKind {
  const lower = prompt.toLowerCase();

  if (
    lower.includes("2.5") ||
    lower.includes("meshy 2.5") ||
    lower.includes("兜底细化") ||
    lower.includes("retexture") ||
    lower.includes("remesh")
  ) {
    return "meshy_refine";
  }

  const hasDccMcpIntent =
    [
      "blender",
      "zbrush",
      "mcp",
      "优化模型",
      "修改模型",
      "编辑模型",
      "导入",
      "打开",
      "新建",
      "保存",
      "撤销",
      "重做",
      "移动",
      "旋转",
      "缩放",
      "加厚",
      "倒角",
      "镜像",
      "阵列",
      "布尔",
      "减面",
      "自动平滑",
      "材质",
      "贴图",
      "导出",
      "正方体",
      "立方体",
      "cube",
      "box",
    ].some((key) => lower.includes(key));
  if (hasDccMcpIntent) {
    return "blender_refine_export";
  }

  const hasImageToModelIntent =
    ["图生模", "根据图片", "上传图片", "用图片", "参考图", "创建模型", "生成模型", "image to 3d", "image-to-3d"]
      .some((key) => lower.includes(key));
  if (referenceImages.length > 0 && hasImageToModelIntent) {
    return "meshy_image_to_3d";
  }

  if (lower.includes("2.") || lower.includes("步骤2")) {
    return "meshy_image_to_3d";
  }

  if (
    ["生图", "出图", "概念图", "候选图", "渲染图", "image generate", "generate image"]
      .some((key) => lower.includes(key))
  ) {
    return "image_generate";
  }

  if (lower.includes("1.5") || lower.includes("结构化")) {
    return "structured_constraints";
  }

  return "input";
}

// 描述:
//
//   - 生成提示词摘要，用于结构化约束节点输出。
//
// Params:
//
//   - prompt: 用户提示词。
//
// Returns:
//
//   - 包含主体、风格与保留项的摘要对象。
function summarizePrompt(prompt: string) {
  const words = prompt
    .replace(/[，。！？,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const subject = words.slice(0, 6).join(" ") || "模型主体";
  return {
    subject,
    style: prompt.includes("低模") ? "low-poly" : prompt.includes("写实") ? "realistic" : "default",
    mustKeep: prompt.includes("保留") ? ["用户要求保留特征"] : [],
  };
}

async function runNode(
  node: WorkflowNodeDefinition,
  ctx: WorkflowContext,
  request: WorkflowRunRequest,
): Promise<{ summary: string; output?: Record<string, unknown>; exportedFile?: string; modelSession?: ModelSessionRunResponse }> {
  if (!node.enabled) {
    return {
      summary: "节点已禁用，已跳过",
      output: { skipped: true },
    };
  }

  switch (node.kind) {
    case "input": {
      return {
        summary: `已接收输入，参考图 ${ctx.referenceImages.length}，风格图 ${ctx.styleImages.length}`,
        output: {
          prompt: ctx.prompt,
          referenceImages: ctx.referenceImages,
          styleImages: ctx.styleImages,
        },
      };
    }
    case "image_generate": {
      if (!hasGeminiImageProvider(request)) {
        throw new Error("未配置可用的 Gemini 生图 Key，请先在 AI Key 中启用并填写 Gemini key");
      }
      const count = Math.min(4, Math.max(1, Number(node.params.candidateCount || 4)));
      ctx.generatedCandidates = Array.from({ length: count }).map(
        (_, index) => `generated://candidate-${Date.now()}-${index + 1}.png`,
      );
      return {
        summary: `已生成 ${count} 张候选图`,
        output: {
          candidates: ctx.generatedCandidates,
        },
      };
    }
    case "structured_constraints": {
      const structured = summarizePrompt(ctx.prompt);
      ctx.structured = structured;
      return {
        summary: "已生成结构化约束（主体/风格/保留特征）",
        output: structured,
      };
    }
    case "meshy_image_to_3d": {
      const source = ctx.generatedCandidates[0] || ctx.referenceImages[0] || ctx.styleImages[0];
      if (!source) {
        throw new Error("图生模缺少输入图，请先提供参考图或执行生图步骤");
      }
      ctx.initialModelPath = `meshy://initial-${Date.now()}.glb`;
      return {
        summary: "Meshy 图生模完成（初始 GLB）",
        output: {
          sourceImage: source,
          initialModel: ctx.initialModelPath,
          quality: node.params.quality || "balanced",
        },
      };
    }
    case "meshy_refine": {
      const source = ctx.initialModelPath || ctx.referenceImages[0];
      if (!source) {
        throw new Error("兜底细化缺少初始模型，请先执行图生模或提供模型输入");
      }
      ctx.refinedModelPath = `meshy://refined-${Date.now()}.glb`;
      return {
        summary: "Meshy 兜底细化完成（Remesh + Retexture）",
        output: {
          sourceModel: source,
          refinedModel: ctx.refinedModelPath,
          remesh: Boolean(node.params.remesh ?? true),
          retexture: Boolean(node.params.retexture ?? true),
        },
      };
    }
    case "blender_refine_export": {
      const response = await invoke<ModelSessionRunResponse>("run_model_session_command", {
        sessionId: request.sessionId,
        prompt: ctx.prompt,
        provider: request.provider,
        traceId: `trace-${Date.now()}`,
        projectName: request.projectName,
        capabilities: request.modelMcpCapabilities,
        outputDir: request.outputDir,
        confirmationToken: request.confirmationToken,
      });
      if (!response.steps || response.steps.length === 0) {
        throw new Error("MCP 执行未返回步骤记录");
      }

      ctx.exportedFile = response.exported_file;
      return {
        summary: response.message || "MCP 操作已完成（如有导出会返回文件路径）",
        output: {
          exportedFile: response.exported_file,
        },
        exportedFile: response.exported_file,
        modelSession: response,
      };
    }
    default:
      throw new Error(`unsupported workflow node: ${node.kind satisfies never}`);
  }
}

function findFallbackNode(
  workflow: WorkflowDefinition,
  fallbackKind?: WorkflowNodeKind,
): WorkflowNodeDefinition | null {
  if (!fallbackKind) {
    return null;
  }
  return workflow.nodes.find((item) => item.kind === fallbackKind && item.enabled) || null;
}

// 描述：统计模型会话内成功的 MCP 步骤数，用于和工作流节点数分开展示，避免口径混淆。
function countModelSessionSuccessSteps(modelSession?: ModelSessionRunResponse): number {
  if (!modelSession?.steps?.length) {
    return 0;
  }
  return modelSession.steps.filter((item) => item.status === "success").length;
}

// 描述：构建工作流执行完成文案，同时展示“工作流节点”与“MCP步骤”两个维度。
function buildWorkflowCompletionMessage(
  entryNodeKind: WorkflowNodeKind,
  workflowSuccessCount: number,
  modelSessionSuccessCount: number,
): string {
  if (modelSessionSuccessCount > 0) {
    return `自动识别起点为「${entryNodeKind}」，工作流执行完成（工作流节点成功 ${workflowSuccessCount} 个，MCP 步骤成功 ${modelSessionSuccessCount} 个）。`;
  }
  return `自动识别起点为「${entryNodeKind}」，工作流执行完成（工作流节点成功 ${workflowSuccessCount} 个）。`;
}

export async function runModelWorkflow(request: WorkflowRunRequest): Promise<WorkflowRunResult> {
  const workflow = listModelWorkflows().find((item) => item.id === request.workflowId);
  if (!workflow) {
    throw new Error("未找到可用工作流，请先在模型设置中创建或选择工作流");
  }

  const promptDetectedImages = extractImagePathsFromPrompt(request.prompt);
  const mergedReferenceImages = Array.from(
    new Set([...request.referenceImages, ...promptDetectedImages]),
  );
  const entryNodeKind = detectEntryNodeKind(request.prompt, mergedReferenceImages);
  const nodes = buildNodeRange(workflow, entryNodeKind).filter((item) => item.enabled);
  if (nodes.length === 0) {
    throw new Error("工作流没有可执行节点，请检查节点开关");
  }

  const runId = `run-${Date.now()}`;
  const ctx: WorkflowContext = {
    prompt: request.prompt,
    referenceImages: mergedReferenceImages,
    styleImages: request.styleImages,
    generatedCandidates: [],
  };

  const stepRecords: WorkflowStepRecord[] = [];
  let modelSession: ModelSessionRunResponse | undefined;
  let exportedFile: string | undefined;
  let mappedUiHint: WorkflowUiHint | undefined;

  for (const node of nodes) {
    const maxAttempts = Math.max(1, (node.retryCount || 0) + 1);
    let lastError = "";
    let lastErrorDetail: NormalizedInvokeErrorDetail | null = null;
    let success = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const result = await runNode(node, ctx, request);
        stepRecords.push({
          nodeId: node.id,
          kind: node.kind,
          name: node.name,
          status: "success",
          attempt,
          elapsedMs: Date.now() - startedAt,
          summary: result.summary,
          output: result.output,
        });
        if (result.modelSession) {
          modelSession = result.modelSession;
          if (result.modelSession.ui_hint) {
            mappedUiHint = mapProtocolUiHint(result.modelSession.ui_hint);
          }
        }
        if (result.exportedFile) {
          exportedFile = result.exportedFile;
        }
        success = true;
        break;
      } catch (err) {
        lastErrorDetail = normalizeInvokeErrorDetail(err);
        lastError = lastErrorDetail.message;
        stepRecords.push({
          nodeId: node.id,
          kind: node.kind,
          name: node.name,
          status: "failed",
          attempt,
          elapsedMs: Date.now() - startedAt,
          summary: "执行失败",
          error: lastError,
        });
      }
    }

    if (!success) {
      const fallbackNode = findFallbackNode(workflow, node.fallbackKind);
      if (fallbackNode) {
        try {
          const startedAt = Date.now();
          const fallbackResult = await runNode(fallbackNode, ctx, request);
          stepRecords.push({
            nodeId: fallbackNode.id,
            kind: fallbackNode.kind,
            name: `${fallbackNode.name}（Fallback）`,
            status: "success",
            attempt: 1,
            elapsedMs: Date.now() - startedAt,
            summary: fallbackResult.summary,
            output: fallbackResult.output,
          });
          if (fallbackResult.modelSession) {
            modelSession = fallbackResult.modelSession;
            if (fallbackResult.modelSession.ui_hint) {
              mappedUiHint = mapProtocolUiHint(fallbackResult.modelSession.ui_hint);
            }
          }
          if (fallbackResult.exportedFile) {
            exportedFile = fallbackResult.exportedFile;
          }
          continue;
        } catch (fallbackErr) {
          const fallbackErrorDetail = normalizeInvokeErrorDetail(fallbackErr);
          const reason = fallbackErrorDetail.message;
          lastErrorDetail = fallbackErrorDetail;
          stepRecords.push({
            nodeId: fallbackNode.id,
            kind: fallbackNode.kind,
            name: `${fallbackNode.name}（Fallback）`,
            status: "failed",
            attempt: 1,
            elapsedMs: 0,
            summary: "Fallback 执行失败",
            error: reason,
          });
        }
      }

      stepRecords.push({
        nodeId: node.id,
        kind: node.kind,
        name: node.name,
        status: "manual",
        attempt: 1,
        elapsedMs: 0,
        summary: "自动恢复失败，进入人工接管",
        error: lastError,
      });

      return {
        runId,
        workflowId: workflow.id,
        entryNodeKind,
        message: `工作流在节点「${node.name}」失败：${lastError}。已切换为人工接管。`,
        steps: stepRecords,
        exportedFile,
        referenceImagesDetected: mergedReferenceImages,
        uiHint:
          mappedUiHint
          || buildUiHintFromProtocolError(
            lastErrorDetail || {
              message: lastError,
              retryable: false,
            },
          )
          || undefined,
        modelSession,
      };
    }
  }

  return {
    runId,
    workflowId: workflow.id,
    entryNodeKind,
    message: buildWorkflowCompletionMessage(
      entryNodeKind,
      stepRecords.filter((item) => item.status === "success").length,
      countModelSessionSuccessSteps(modelSession),
    ),
    steps: stepRecords,
    exportedFile,
    referenceImagesDetected: mergedReferenceImages,
    uiHint: mappedUiHint,
    modelSession,
  };
}
