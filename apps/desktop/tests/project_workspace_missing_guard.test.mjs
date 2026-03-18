import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 相关源码文件，供项目目录失效保护回归测试复用。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestProjectWorkspaceMissingShouldGreySidebarAndBlockTopicCreation", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const i18nSource = readDesktopSource("src/shared/i18n/messages.ts");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 侧边栏应批量读取项目目录有效性，并在目录失效时将项目名切到次级文本色，同时禁用“项目内新增话题”。
  assert.match(sidebarSource, /const \[workspacePathValidityById, setWorkspacePathValidityById\] = useState<Record<string, boolean>>\(\{\}\);/);
  assert.match(sidebarSource, /const resolveWorkspacePathValidityById = useCallback\(async \(\s*groups: ProjectWorkspaceGroup\[],/s);
  assert.match(sidebarSource, /statusMap\[group\.path\]\?\.valid !== false/);
  assert.match(sidebarSource, /const workspacePathInvalid = workspacePathValidityById\[group\.workspace\.id\] === false;/);
  assert.match(sidebarSource, /className=\{workspacePathInvalid \? "desk-project-workspace-label-invalid" : undefined\}/);
  assert.match(sidebarSource, /disabled=\{creatingWorkspaceSessionId === group\.workspace\.id \|\| workspacePathInvalid\}/);
  assert.match(styleSource, /\.desk-project-workspace-label-invalid,\s*\.desk-session-invalid-workspace-text\s*\{[\s\S]*color:\s*var\(--z-color-text-secondary\);/);
  assert.match(sidebarSource, /if \(workspacePathValidityById\[workspaceId\] === false\) \{\s*AriMessage\.warning\(\{\s*content: t\("项目目录已不存在，请先恢复目录后再新建话题。"\),/s);
  assert.match(i18nSource, /"项目目录已不存在，请先恢复目录后再新建话题。": "项目目录已不存在，请先恢复目录后再新建话题。"/);
  assert.match(i18nSource, /"项目目录已不存在，请先恢复目录后再新建话题。": "The project folder is missing\. Restore it before creating a new topic\."/);
});

test("TestProjectWorkspaceMissingShouldBlockSessionPromptExecution", () => {
  const sessionSource = readDesktopSource("src/widgets/session/page.tsx");
  const i18nSource = readDesktopSource("src/shared/i18n/messages.ts");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 会话页应实时检查当前绑定项目目录的有效性，并在目录丢失时统一阻断发送、重试与自动执行链路。
  assert.match(sessionSource, /const activeWorkspacePath = String\(activeWorkspace\?\.path \|\| ""\)\.trim\(\);/);
  assert.match(sessionSource, /const \[activeWorkspacePathValid, setActiveWorkspacePathValid\] = useState\(true\);/);
  assert.match(sessionSource, /const invalidWorkspacePromptMessage = t\("项目目录已不存在，当前话题不能继续发送新消息。"\);/);
  assert.match(sessionSource, /const isActiveWorkspacePathMissing = Boolean\(activeWorkspace\?\.id && activeWorkspacePath && !activeWorkspacePathValid\);/);
  assert.match(sessionSource, /const resolveActiveWorkspacePathValidity = useCallback\(async \(workspacePath: string\): Promise<boolean> => \{/);
  assert.match(sessionSource, /window\.addEventListener\("focus", syncActiveWorkspacePathValidity\);/);
  assert.match(sessionSource, /const shouldBlockPromptExecutionForMissingWorkspace = \(\) => \{/);
  assert.match(sessionSource, /if \(shouldBlockPromptExecutionForMissingWorkspace\(\)\) \{\s*return;\s*\}/s);
  assert.match(sessionSource, /<AriTypography\s+className="desk-session-invalid-workspace-text"\s+variant="caption"\s+value=\{invalidWorkspacePromptMessage\}/s);
  assert.match(sessionSource, /<AriInput\.TextArea[\s\S]*disabled=\{isActiveWorkspacePathMissing\}/);
  assert.match(sessionSource, /disabled=\{sending \|\| isActiveWorkspacePathMissing\}/);
  assert.match(sessionSource, /disabled=\{!sending && isActiveWorkspacePathMissing\}/);
  assert.match(styleSource, /\.desk-project-workspace-label-invalid,\s*\.desk-session-invalid-workspace-text\s*\{[\s\S]*color:\s*var\(--z-color-text-secondary\);/);
  assert.match(i18nSource, /"项目目录已不存在，当前话题不能继续发送新消息。": "项目目录已不存在，当前话题不能继续发送新消息。"/);
  assert.match(i18nSource, /"项目目录已不存在，当前话题不能继续发送新消息。": "The project folder is missing\. This topic can no longer send new messages\."/);
});

test("TestProjectWorkspaceMissingShouldUseDedicatedTauriPathCheckCommand", () => {
  const constantsSource = readDesktopSource("src/shared/constants.ts");
  const serviceSource = readDesktopSource("src/shared/services/project-workspace-status.ts");
  const tauriSource = readDesktopSource("src-tauri/src/main.rs");

  // 描述：
  //
  //   - 目录有效性应由单独的 Tauri 命令批量返回，前端服务层再统一规整为 path -> status 映射。
  assert.match(constantsSource, /CHECK_PROJECT_WORKSPACE_PATHS: "check_project_workspace_paths"/);
  assert.match(serviceSource, /export interface ProjectWorkspacePathStatus \{/);
  assert.match(serviceSource, /await invoke<unknown\[]>\(COMMANDS\.CHECK_PROJECT_WORKSPACE_PATHS, \{\s*paths: normalizedPaths,\s*\}\)/s);
  assert.match(serviceSource, /export async function getProjectWorkspacePathStatusMap\(/);
  assert.match(tauriSource, /struct ProjectWorkspacePathStatusResponse \{/);
  assert.match(tauriSource, /fn check_project_workspace_paths_inner\(\s*paths: Vec<String>,/s);
  assert.match(tauriSource, /async fn check_project_workspace_paths\(\s*paths: Vec<String>,/s);
  assert.match(tauriSource, /check_project_workspace_paths,/);
});
