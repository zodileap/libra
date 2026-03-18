import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "../constants";

// 描述：
//
//   - 定义 Tauri 返回的项目目录状态结构，兼容 Rust 侧 snake_case 字段。
interface ProjectWorkspacePathStatusResponse {
  path?: string;
  exists?: boolean;
  is_dir?: boolean;
  valid?: boolean;
}

// 描述：
//
//   - 定义前端统一使用的项目目录状态结构，供侧边栏与会话页复用。
export interface ProjectWorkspacePathStatus {
  path: string;
  exists: boolean;
  isDirectory: boolean;
  valid: boolean;
}

// 描述：
//
//   - 将任意来源的项目目录状态规整为前端统一结构；无法识别时回退到“默认可用”，避免预览环境被误锁死。
//
// Params:
//
//   - payload: 原始状态数据。
//   - fallbackPath: 调用方传入的原始路径。
//
// Returns:
//
//   - 归一化后的目录状态。
function normalizeProjectWorkspacePathStatus(
  payload: unknown,
  fallbackPath: string,
): ProjectWorkspacePathStatus {
  const raw = (payload || {}) as ProjectWorkspacePathStatusResponse;
  const path = String(raw.path || fallbackPath || "").trim();
  const exists = raw.exists !== false;
  const isDirectory = raw.is_dir !== false;
  const valid = raw.valid !== false && exists && isDirectory;
  return {
    path,
    exists,
    isDirectory,
    valid,
  };
}

// 描述：
//
//   - 批量检查项目目录是否仍然存在；Tauri 不可用时回退到“默认可用”，保证纯前端预览不被误判为失效。
//
// Params:
//
//   - paths: 待检查的目录路径列表。
//
// Returns:
//
//   - 按输入顺序返回的目录状态列表。
export async function listProjectWorkspacePathStatuses(
  paths: string[],
): Promise<ProjectWorkspacePathStatus[]> {
  const normalizedPaths = Array.from(
    new Set(
      paths
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0),
    ),
  );
  if (normalizedPaths.length === 0) {
    return [];
  }

  try {
    const payload = await invoke<unknown[]>(COMMANDS.CHECK_PROJECT_WORKSPACE_PATHS, {
      paths: normalizedPaths,
    });
    const statusMap = new Map<string, ProjectWorkspacePathStatus>();
    (Array.isArray(payload) ? payload : []).forEach((item, index) => {
      const normalized = normalizeProjectWorkspacePathStatus(item, normalizedPaths[index] || "");
      if (normalized.path) {
        statusMap.set(normalized.path, normalized);
      }
    });
    return normalizedPaths.map((path) => statusMap.get(path) || {
      path,
      exists: true,
      isDirectory: true,
      valid: true,
    });
  } catch (_error) {
    return normalizedPaths.map((path) => ({
      path,
      exists: true,
      isDirectory: true,
      valid: true,
    }));
  }
}

// 描述：
//
//   - 将项目目录状态列表转换为按路径索引的映射，便于页面直接按 path / workspaceId 派生禁用态。
//
// Params:
//
//   - paths: 待检查的目录路径列表。
//
// Returns:
//
//   - 以路径为键的目录状态映射。
export async function getProjectWorkspacePathStatusMap(
  paths: string[],
): Promise<Record<string, ProjectWorkspacePathStatus>> {
  const statuses = await listProjectWorkspacePathStatuses(paths);
  return Object.fromEntries(statuses.map((item) => [item.path, item]));
}
