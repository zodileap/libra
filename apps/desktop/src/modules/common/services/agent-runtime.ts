import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../../../shared/constants";
import {
  normalizeAgentRuntimeCapabilities,
  type AgentRuntimeCapabilities,
} from "../../../shared/workflow/prompt-guidance";

// 描述：
//
//   - 定义运行时能力查询上下文；workspaceRoot 存在时，后端会按该项目目录解析 MCP 注册表与 Node 运行目录。
export interface AgentRuntimeCapabilityContext {
  workspaceRoot?: string;
}

// 描述：
//
//   - 从 Tauri 后端读取当前会话真实可用的智能体运行时能力快照，统一用于 Prompt 注入与执行参数透传。
//
// Params:
//
//   - context: 可选的工作区上下文。
//
// Returns:
//
//   - 归一化后的运行时能力快照。
export async function getAgentRuntimeCapabilities(
  context?: AgentRuntimeCapabilityContext,
): Promise<AgentRuntimeCapabilities> {
  const payload = await invoke<unknown>(COMMANDS.GET_AGENT_RUNTIME_CAPABILITIES, {
    workdir: String(context?.workspaceRoot || "").trim() || undefined,
  });
  return normalizeAgentRuntimeCapabilities(payload);
}
