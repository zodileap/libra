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

  // 描述：
  //
  //   - 工作流工具栏应支持“选择模式 / 拖动模式”切换，并以图标按钮提供新增节点入口。
  assert.match(source, /type WorkflowCanvasMode = "select" \| "pan"/);
  assert.match(source, /icon="arrow_selector_tool"/);
  assert.match(source, /icon="pan_tool_alt"/);
  assert.match(source, /<AriDivider type="vertical" className="desk-workflow-editor-canvas-toolbar-divider" \/>/);
  assert.match(source, /<AriButton ghost icon="add" onClick={addNode} \/>/);
  assert.match(source, /icon="save"/);
  assert.match(source, /aria-label="保存工作流"/);
  assert.match(source, /const WORKFLOW_NODE_TYPE = "workflowNode";/);
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
  assert.match(source, /edgesReconnectable=\{canvasMode === "select"\}/);
  assert.match(source, /elementsSelectable={canvasMode === "select"}/);
  assert.match(source, /panOnDrag={canvasMode === "pan" \? \[0\] : false}/);
  assert.doesNotMatch(source, /<Controls /);
  assert.match(source, /const headerSlotElement = useDesktopHeaderSlot\(\);/);
  assert.match(source, /import \{ useDesktopHeaderSlot \} from "\.\.\/app-header\/header-slot-context";/);
  assert.match(source, /createPortal\(workflowHeaderNode, headerSlotElement\)/);
  assert.doesNotMatch(source, /setHeaderSlotElement\(document\.getElementById\("desk-app-header-slot"\)\);/);
  assert.doesNotMatch(source, /<DeskPageHeader/);

  // 描述：
  //
  //   - 右键节点/连线后应设置当前选中目标，并通过 AriContextMenu(targetRef) 提供“删除”动作。
  assert.match(source, /<AriContextMenu/);
  assert.match(source, /const canvasRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /targetRef={canvasRef}/);
  assert.match(source, /<div\s+ref={canvasRef}\s+className="desk-workflow-reactflow-wrap desk-workflow-editor-reactflow-wrap"/);
  assert.match(source, /key: "delete"/);
  assert.match(source, /label: "删除"/);
  assert.match(source, /onNodeContextMenu=\{\(event, node\) =>/);
  assert.match(source, /onEdgeContextMenu=\{\(event, edge\) =>/);
  assert.match(source, /patchContextTarget\(\{\s*type: "node",\s*id: node\.id,\s*\}\)/s);
  assert.match(source, /patchContextTarget\(\{\s*type: "edge",\s*id: edge\.id,\s*\}\)/s);
});
