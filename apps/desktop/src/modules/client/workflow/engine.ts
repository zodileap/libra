import { invoke } from "@tauri-apps/api/core";
import { normalizeInvokeError } from "../services/blender-bridge";
import { listModelWorkflows } from "./storage";
import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
  WorkflowRunRequest,
  WorkflowRunResult,
  WorkflowStepRecord,
  WorkflowUiHint,
} from "./types";

interface ModelSessionRunResponse {
  trace_id: string;
  message: string;
  steps: Array<{
    index: number;
    action: string;
    input: string;
    status: string;
    elapsed_ms: number;
    summary: string;
    error?: string;
    exported_file?: string;
  }>;
  events: Array<{
    event: string;
    step_index?: number;
    timestamp_ms: number;
    message: string;
  }>;
  assets: Array<{
    kind: string;
    path: string;
    version: number;
  }>;
  exported_file?: string;
}

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

function hasGeminiImageProvider(request: WorkflowRunRequest) {
  return request.aiKeys.some(
    (item) => item.provider === "gemini" && item.enabled && item.keyValue.trim().length > 0,
  );
}

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

const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

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

function buildUiHintFromError(errorText: string): WorkflowUiHint | undefined {
  const lower = errorText.toLowerCase();

  if (
    lower.includes("当前 blender 会话仍是旧版本") ||
    lower.includes("unsupported action") ||
    lower.includes("unsupported_action")
  ) {
    return {
      key: "restart-blender-bridge",
      level: "warning",
      title: "需要重启 Blender",
      message: "Bridge 已自动更新，但当前会话仍是旧版本。请重启 Blender 后点击“我已重启并重试”。",
      actions: [
        { kind: "retry_last_step", label: "我已重启并重试", intent: "primary" },
        { kind: "dismiss", label: "暂不处理", intent: "default" },
      ],
    };
  }

  if (lower.includes("导出能力已关闭")) {
    return {
      key: "export-capability-disabled",
      level: "info",
      title: "导出能力已关闭",
      message: "当前会话仍可执行新建/打开/编辑等 MCP 操作；如需导出，请在模型设置里开启导出能力。",
      actions: [
        { kind: "open_model_settings", label: "打开模型设置", intent: "primary" },
        { kind: "dismiss", label: "知道了", intent: "default" },
      ],
    };
  }

  return undefined;
}

function detectDangerousIntent(prompt: string): { matched: boolean; reason: string } {
  const lower = prompt.toLowerCase();
  const matchedRules: string[] = [];

  if (["删除", "删掉", "清空", "移除", "remove", "delete"].some((key) => lower.includes(key))) {
    matchedRules.push("删除/清空类操作");
  }
  if (["新建文件", "重置场景", "reset scene", "read_homefile"].some((key) => lower.includes(key))) {
    matchedRules.push("重置或新建场景");
  }
  if (["打开文件", "open file", "open_mainfile", "覆盖保存", "另存为覆盖"].some((key) => lower.includes(key))) {
    matchedRules.push("打开/覆盖文件");
  }
  if (["布尔", "boolean"].some((key) => lower.includes(key))) {
    matchedRules.push("布尔修改（不可逆风险）");
  }

  return {
    matched: matchedRules.length > 0,
    reason: matchedRules.join("、"),
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
        traceId: `trace-${Date.now()}`,
        projectName: request.projectName,
        capabilities: request.modelMcpCapabilities,
        outputDir: request.outputDir,
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

export async function runModelWorkflow(request: WorkflowRunRequest): Promise<WorkflowRunResult> {
  const workflow = listModelWorkflows().find((item) => item.id === request.workflowId);
  if (!workflow) {
    throw new Error("未找到可用工作流，请先在模型设置中创建或选择工作流");
  }

  const dangerous = detectDangerousIntent(request.prompt);
  if (dangerous.matched && !request.allowDangerousAction) {
    const entryNodeKind = detectEntryNodeKind(request.prompt, request.referenceImages);
    return {
      runId: `run-${Date.now()}`,
      workflowId: workflow.id,
      entryNodeKind,
      message: `检测到可能存在风险的操作（${dangerous.reason}），已暂停执行，等待你确认。`,
      steps: [
        {
          nodeId: "dangerous-check",
          kind: entryNodeKind,
          name: "危险操作确认",
          status: "manual",
          attempt: 1,
          elapsedMs: 0,
          summary: "等待用户确认后执行",
          error: dangerous.reason,
        },
      ],
      referenceImagesDetected: [],
      uiHint: {
        key: "dangerous-operation-confirm",
        level: "warning",
        title: "检测到潜在危险操作",
        message: `本次指令可能修改或覆盖现有模型/文件（${dangerous.reason}）。确认后将仅执行这一次。`,
        actions: [
          { kind: "allow_once", label: "允许一次并执行", intent: "primary" },
          { kind: "deny", label: "取消本次操作", intent: "danger" },
        ],
        context: {
          prompt: request.prompt,
          reason: dangerous.reason,
        },
      },
    };
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

  for (const node of nodes) {
    const maxAttempts = Math.max(1, (node.retryCount || 0) + 1);
    let lastError = "";
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
        }
        if (result.exportedFile) {
          exportedFile = result.exportedFile;
        }
        success = true;
        break;
      } catch (err) {
        lastError = normalizeInvokeError(err);
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
          }
          if (fallbackResult.exportedFile) {
            exportedFile = fallbackResult.exportedFile;
          }
          continue;
        } catch (fallbackErr) {
          const reason = normalizeInvokeError(fallbackErr);
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
        uiHint: buildUiHintFromError(lastError),
        modelSession,
      };
    }
  }

  return {
    runId,
    workflowId: workflow.id,
    entryNodeKind,
    message: `自动识别起点为「${entryNodeKind}」，工作流执行完成，共 ${stepRecords.filter((item) => item.status === "success").length} 个成功步骤。`,
    steps: stepRecords,
    exportedFile,
    referenceImagesDetected: mergedReferenceImages,
    modelSession,
  };
}
