import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 客户端源码文件，供工作流画布交互能力回归测试复用。
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

test("TestWorkflowCanvasShouldSupportModeSwitchAndContextDelete", () => {
  const source = readDesktopSource("src/widgets/workflow/page.tsx");
  const styleSource = readDesktopSource("src/styles.css");

  // 描述：
  //
  //   - 工作流工具栏应支持“选择模式 / 拖动模式”切换，并以图标按钮提供新增节点入口。
  assert.match(source, /type WorkflowCanvasMode = "select" \| "pan"/);
  assert.match(source, /icon="select_tool"/);
  assert.match(source, /icon="hand_tool"/);
  assert.match(source, /<AriDivider\s+type="vertical"\s+className="desk-workflow-editor-canvas-toolbar-divider"\s+\/>/s);
  assert.match(source, /<AriButton ghost icon="add" onClick={addNode} disabled=\{!canEditWorkflow\} \/>/);
  assert.match(source, /icon="edit"/);
  assert.match(source, /aria-label=\{workflowReadonly \? t\("查看工作流"\) : t\("编辑工作流"\)\}/);
  assert.match(source, /icon="content_copy"/);
  assert.match(source, /aria-label=\{t\("复制工作流"\)\}/);
  assert.match(source, /<AriButton\s+type="text"\s+icon="delete"\s+aria-label=\{t\("删除工作流"\)\}/s);
  assert.doesNotMatch(
    source,
    /<AriButton\s+type="text"\s+color="danger"\s+icon="delete"\s+aria-label=\{t\("删除工作流"\)\}/s,
  );
  assert.doesNotMatch(source, /icon="save"/);
  assert.doesNotMatch(source, /aria-label="保存工作流"/);
  assert.doesNotMatch(source, /const saveCurrentWorkflow = \(\) =>/);
  assert.match(source, /const hasPendingWorkflowChanges = useMemo\(\(\) =>/);
  assert.match(source, /useEffect\(\(\) => \{\s*if \(!selectedWorkflow \|\| !canEditWorkflow \|\| !hasPendingWorkflowChanges\) \{\s*return;\s*\}/s);
  assert.match(source, /window\.setTimeout\(\(\) =>/);
  assert.match(source, /setWorkflowVersion\(\(value\) => value \+ 1\)/);
  assert.match(source, /const workflowLoadIdentityRef = useRef\(\"\"\);/);
  assert.match(source, /const nextWorkflowIdentity = selectedWorkflow\.id;/);
  assert.match(source, /if \(workflowLoadIdentityRef\.current === nextWorkflowIdentity\) \{\s*return;\s*\}/s);
  assert.match(source, /const openWorkflowEditModal = \(\) =>/);
  assert.match(source, /const confirmWorkflowEdit = \(\) =>/);
  assert.match(source, /const deleteCurrentWorkflow = \(\) =>/);
  assert.match(source, /const duplicateCurrentWorkflow = \(\) => \{/);
  assert.match(source, /<AriModal/);
  assert.match(source, /title=\{workflowReadonly \? t\("查看工作流"\) : t\("编辑工作流"\)\}/);
  assert.match(source, /className="desk-workflow-edit-modal"/);
  assert.match(source, /width="var\(--desk-workflow-edit-modal-width\)"/);
  assert.match(source, /className="desk-workflow-edit-modal-body"/);
  assert.match(
    source,
    /className="desk-workflow-edit-modal-card desk-workflow-edit-modal-card-basic"/,
  );
  assert.match(source, /label=\{t\("工作流名称"\)\}/);
  assert.match(source, /label=\{t\("工作流说明"\)\}/);
  assert.match(source, /value=\{t\("基础信息"\)\}/);
  assert.doesNotMatch(source, /value=\{t\("项目能力"\)\}/);
  assert.doesNotMatch(source, /className="desk-workflow-edit-capability-list"/);
  assert.doesNotMatch(source, /label=\{t\("必需项目能力"\)\}/);
  assert.doesNotMatch(source, /label=\{t\("可选项目能力"\)\}/);
  assert.match(source, /deleteAgentWorkflow\(selectedWorkflow\.id\)/);
  assert.match(source, /instruction:\s*String\(source\.instruction \|\| ""\)\.trim\(\)/);
  assert.match(source, /instruction:\s*String\(node\.instruction \|\| ""\)\.trim\(\)/);
  assert.match(source, /instruction:\s*parsed\.instruction/);
  assert.match(source, /name="selectedNode\.instruction"/);
  assert.match(source, /patchSelectedNode\(\{\s*instruction:\s*value\s*\}\)/);
  assert.match(source, /placeholder=\{t\("请输入该节点命中后的 AI 提示词"\)\}/);
  assert.match(source, /<AriInput\.TextArea/);
  assert.match(source, /rows=\{3\}/);
  assert.match(source, /autoSize=\{\{\s*minRows:\s*3,\s*maxRows:\s*8\s*\}\}/);
  assert.match(source, /value=\{workflowInfoName\}/);
  assert.match(source, /value=\{t\("工作流 · \{\{description\}\} · v\{\{version\}\}", \{/);
  assert.match(source, /const WORKFLOW_NODE_TYPE = "workflowNode";/);
  assert.match(styleSource, /\.desk-workflow-edit-modal-body/);
  assert.match(styleSource, /\.desk-workflow-edit-modal-card/);
  assert.match(styleSource, /--desk-workflow-edit-modal-width:/);
  assert.match(styleSource, /\.desk-workflow-edit-modal \{/);
  assert.match(styleSource, /\.desk-workflow-edit-modal-card-basic/);
  assert.match(styleSource, /\.desk-workflow-edit-modal-body\s*\{[\s\S]*display:\s*grid;/s);
  assert.doesNotMatch(styleSource, /--desk-workflow-edit-modal-info-width:/);
  assert.doesNotMatch(styleSource, /\.desk-workflow-edit-modal-card-capabilities/);
  assert.doesNotMatch(styleSource, /\.desk-workflow-edit-capability-list/);
  assert.match(source, /<NodeResizer/);
  assert.match(source, /isVisible=\{Boolean\(selected\)\}/);
  assert.match(source, /lineClassName="desk-workflow-node-resize-line"/);
  assert.match(source, /handleClassName="desk-workflow-node-resize-handle"/);
  assert.match(source, /<Handle\s+type="target"/);
  assert.match(source, /<Handle\s+type="source"/);
  assert.match(source, /type: WORKFLOW_NODE_TYPE,/);
  assert.match(source, /nodeTypes=\{workflowNodeTypes\}/);
  assert.match(source, /const onReconnect = useCallback\(/);
  assert.match(source, /reconnectEdge\(/);
  assert.match(source, /onReconnect=\{onReconnect\}/);
  assert.match(source, /edgesReconnectable=\{canEditWorkflow && canvasMode === "select"\}/);
  assert.match(source, /elementsSelectable=\{canvasMode === "select"\}/);
  assert.match(source, /panOnDrag={canvasMode === "pan" \? \[0\] : false}/);
  assert.doesNotMatch(source, /<Controls /);
  assert.match(source, /const headerSlotElement = useDesktopHeaderSlot\(\);/);
  assert.match(source, /import \{ useDesktopHeaderSlot \} from "\.\.\/app-header\/header-slot-context";/);
  assert.match(source, /createPortal\(workflowHeaderNode, headerSlotElement\)/);
  assert.doesNotMatch(source, /setHeaderSlotElement\(document\.getElementById\("desk-app-header-slot"\)\);/);
  assert.doesNotMatch(source, /<DeskPageHeader/);
  assert.match(source, /\{selectedNodeData \? \(\s*<AriCard[\s\S]*className="desk-workflow-editor-floating-panel"/s);
  assert.match(source, /value=\{selectedNodeData\.title\}/);
  assert.doesNotMatch(source, /selectedNodeData\?\.title \|\| workflowInfoName/);
  assert.doesNotMatch(source, /name="workflow\.name"/);
  assert.doesNotMatch(source, /name="workflow\.description"/);
  assert.doesNotMatch(source, /name="workflow\.promptPrefix"/);

  // 描述：
  //
  //   - 右键节点/连线后应设置当前选中目标，并通过 AriContextMenu(targetRef) 提供“删除”动作。
  assert.match(source, /<AriContextMenu/);
  assert.match(source, /const canvasRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /const \[contextMenuOpen,\s*setContextMenuOpen\] = useState\(false\);/);
  assert.match(source, /targetRef={canvasRef}/);
  assert.match(source, /open={contextMenuOpen}/);
  assert.match(source, /onOpenChange=\{\(nextOpen(?:: boolean)?\) => \{[\s\S]*if \(!nextOpen\) \{[\s\S]*setContextMenuOpen\(false\);[\s\S]*\}[\s\S]*\}\}/);
  assert.match(source, /<div\s+ref={canvasRef}\s+className="desk-workflow-reactflow-wrap desk-workflow-editor-reactflow-wrap"/);
  assert.match(source, /canEditWorkflow && contextTarget\?\.id[\s\S]*\?[\s\S]*key: "delete"[\s\S]*:\s*\[\]/s);
  assert.match(source, /key: "delete"/);
  assert.match(source, /label: t\("删除"\)/);
  assert.match(source, /onNodeContextMenu=\{\(event, node\) =>/);
  assert.match(source, /onEdgeContextMenu=\{\(event, edge\) =>/);
  assert.match(source, /if \(!canEditWorkflow\) \{\s*return;\s*\}/);
  assert.match(source, /patchContextTarget\(\{\s*type: "node",\s*id: node\.id,\s*\}\)/s);
  assert.match(source, /patchContextTarget\(\{\s*type: "edge",\s*id: edge\.id,\s*\}\)/s);
  assert.match(source, /onNodeContextMenu=\{\(event, node\) =>[\s\S]*setContextMenuOpen\(true\);[\s\S]*\}/s);
  assert.match(source, /onEdgeContextMenu=\{\(event, edge\) =>[\s\S]*setContextMenuOpen\(true\);[\s\S]*\}/s);
  assert.match(source, /onPaneContextMenu=\{\(event\) => \{[\s\S]*patchContextTarget\(null\);[\s\S]*setContextMenuOpen\(false\);[\s\S]*\}\}/);
  assert.match(source, /onPaneClick=\{\(\) => \{[\s\S]*patchContextTarget\(null\);[\s\S]*setContextMenuOpen\(false\);[\s\S]*\}\}/);
  assert.match(source, /onNodeClick=\{\(_event, node\) => \{[\s\S]*setContextMenuOpen\(false\);[\s\S]*\}\}/s);
  assert.match(source, /onEdgeClick=\{\(_event, edge\) => \{[\s\S]*setContextMenuOpen\(false\);[\s\S]*\}\}/s);
});
