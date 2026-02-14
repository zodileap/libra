# P2 前端 UI 回归清单（Desktop 主线）

## 1. 验收范围

- 验收对象：`apps/desktop`（主线）与 `apps/web`（仅样式/结构维护项）。
- 主题模式：`Light`、`Dark`。
- 窗口尺寸：`1440x920`、`1280x900`、`1024x900`、`900x760`。
- 启动命令：`pnpm -C apps/desktop dev`、`pnpm -C apps/web dev`。

## 2. Desktop 截图点位（建议保留到迭代归档）

- [ ] 登录页 ` /login `：首屏完整截图（Light/Dark 各一张）。
- [ ] 首页 ` /home `：包含侧栏与主区的完整截图（各尺寸至少 1 张）。
- [ ] 会话页 ` /agents/code/session/:sessionId `：消息区滚动后截图（含输入区）。
- [ ] 会话页 ` /agents/model/session/:sessionId `：包含工作流区、状态区截图。
- [ ] 设置页 ` /settings/general `：分组标题、表单行、状态文案截图。

## 3. Desktop 人工核对步骤

- [ ] 侧栏菜单 hover/active/selected 三态一致，切换后无闪动。
- [ ] Tab 焦点顺序可用；Enter 可发送输入；Escape 可关闭提示或菜单。
- [ ] 右键菜单在窗口边缘不会被裁切，滚动/失焦后可正确关闭。
- [ ] 加载态、空态、错误态样式与文案风格统一。
- [ ] 长文本与代码块可换行/滚动；点击复制后有明确反馈文案。
- [ ] 会话页顶部与输入区 sticky 行为稳定，消息区滚动不抖动。
- [ ] 各尺寸下无明显遮挡、重叠、溢出与不可点击区域。

## 4. Web（仅样式/结构）核对步骤

- [ ] 宽屏下左侧菜单 + 右侧内容并排展示。
- [ ] 窄屏下可通过“显示菜单/隐藏菜单”按钮切换菜单区。
- [ ] 菜单项 hover/active 风格一致，内容区排版无断裂。
- [ ] 关键页面（home/code-agent/model-agent）无内联样式回归。

## 5. 结果记录

- [ ] Desktop Light 全通过。
- [ ] Desktop Dark 全通过。
- [ ] Desktop 四档尺寸全通过。
- [ ] Web 样式/结构核对通过。
- [ ] 问题项已记录并回填 `todo.md`（若有）。
