import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 侧边栏与样式源码，验证 Home/Agent 侧边栏结构调整。
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

test("TestHomeAndAgentSidebarShouldUseProjectFirstLayout", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - Home 侧边栏应新增图标列表入口，并承载“工作流 + 技能 + MCP”三个跳转能力。
  assert.match(sidebarSource, /const homeToolbarEntries = useMemo\(\(\) => \{/);
  assert.match(sidebarSource, /label: t\("工作流"\)/);
  assert.match(sidebarSource, /label: t\("技能"\)/);
  assert.match(sidebarSource, /label: "MCP"/);
  assert.match(sidebarSource, /icon: "account_tree"/);
  assert.match(sidebarSource, /path: WORKFLOW_PAGE_PATH/);
  assert.match(sidebarSource, /path: SKILL_PAGE_PATH/);
  assert.match(sidebarSource, /path: MCP_PAGE_PATH/);
  assert.match(sidebarSource, /navigate\(target\.path\);/);
  assert.match(sidebarSource, /className="desk-sidebar-toolbar" padding=\{0\}/);

  // 描述：
  //
  //   - 智能体侧边栏应改为“新项目入口 + 项目标题行（新增\/排序）+ 项目会话列表”结构，不再渲染返回 Home 头部。
  assert.doesNotMatch(sidebarSource, /showBackHeader/);
  assert.doesNotMatch(sidebarSource, /\{showBackHeader \? <SidebarBackHeader onBack=\{\(\) => navigate\("\/home"\)\} label="Home" \/> : null\}/);
  assert.match(sidebarSource, /className="desk-sidebar-toolbar" padding=\{0\}/);
  assert.match(sidebarSource, /key: "create-project",[\s\S]*label: t\("新项目"\)/);
  assert.match(sidebarSource, /<AriTypography variant="caption" value=\{t\("项目"\)\} \/>/);
  assert.match(sidebarSource, /icon="note_stack_add"[\s\S]*aria-label=\{t\("新项目"\)\}/);
  assert.match(sidebarSource, /icon="sort"[\s\S]*aria-label=\{t\("排序"\)\}/);
  assert.match(sidebarSource, /const \[sessionSortMode, setSessionSortMode\] = useState<"default" \| "name">\("default"\);/);
  assert.match(sidebarSource, /const displayedSessions = useMemo\(\(\) => \{/);
  assert.match(sidebarSource, /buildSessionMenuItems\(displayedSessions\)/);

  // 描述：
  //
  //   - 智能体侧边栏底部应移除原有“智能体设置/工作流设置”快捷区，工作流入口迁移到 Home。
  assert.doesNotMatch(sidebarSource, /AGENT_SIDEBAR_QUICK_ACTIONS/);
  assert.doesNotMatch(sidebarSource, /MODEL_SIDEBAR_QUICK_ACTIONS/);
  assert.doesNotMatch(sidebarSource, /className="desk-sidebar-quick-actions"/);

  // 描述：
  //
  //   - 新布局样式类应在样式表中定义，避免结构上线后出现间距异常。
  assert.match(styleSource, /\.desk-sidebar-toolbar/);
  assert.match(styleSource, /\.desk-agent-session-header/);
  assert.match(styleSource, /\.desk-agent-session-header-actions/);
});

test("TestOnlyWorkflowAndSettingsSidebarShouldKeepBackHeader", () => {
  const sidebarSource = readDesktopSource("src/sidebar/index.tsx");

  // 描述：
  //
  //   - 返回头部仅保留在工作流侧边栏与设置侧边栏，项目管理与会话侧边栏都不再出现返回入口。
  assert.match(sidebarSource, /<SidebarBackHeader\s+onBack=\{\(\) => navigate\(WORKFLOW_PAGE_PATH\)\}\s+label=\{t\("返回"\)\}/s);
  assert.match(sidebarSource, /<SidebarBackHeader onBack=\{\(\) => navigate\("\/home"\)\} label=\{t\("Home"\)\} \/>/);
  assert.doesNotMatch(sidebarSource, /function shouldShowAgentSidebarBackHeader\(pathname: string\): boolean \{/);
  assert.doesNotMatch(sidebarSource, /label="Home"/);
});
