---
name: playwright-interactive
description: 在需要持续复用同一浏览器或 Electron 会话做交互调试、界面核验和回归检查时使用。它强调先列检查清单，再用持久 Playwright 会话做功能和视觉验证。
---
# Playwright Interactive

## Overview

本 skill 用于通过真实 Playwright 浏览器能力做前端页面或 Electron 界面的交互调试。它只接受三种执行模式：原生 `js_repl + browser_*`、已启用 Playwright MCP、或显式跳过；禁止再伪装成 CLI Playwright 测试。

## When to use

- 需要在本地页面、预览页或 Electron 窗口里持续调试交互。
- 需要在一轮开发里多次刷新页面，而不是每次都重建浏览器上下文。
- 需要同时检查功能行为、视觉状态、断言证据和截图结果。

## Preconditions

- 先确认当前仓库已经具备原生 Playwright 运行前提，或当前环境已启用可用的 Playwright MCP。
- 先确认目标页面的启动方式、访问地址、登录前提和测试数据。
- 执行前阅读 [playwright-session-checklist.md](references/playwright-session-checklist.md)，明确会话复用、检查顺序和证据要求。

## Runtime Modes

- `native`：已注入 `js_repl` 与 `browser_*` 原生工具，必须通过真实 Chromium 窗口完成交互验证。
- `mcp`：未注入原生浏览器工具，但已启用且就绪的 Playwright MCP 存在；必须先探测 MCP tools，再通过该 MCP 完成交互。
- `none`：当前环境既没有原生交互工具，也没有已启用 Playwright MCP；本阶段必须显式跳过。

## Core Workflow

1. **Build the QA inventory.**
   - 先列出本轮要验证的用户可见功能、关键按钮、状态切换和视觉断言。
   - 把用户要求、你准备在最终回复里声明的效果，以及页面真实存在的控件统一映射成检查项。
2. **Start the real interaction runtime.**
   - `native` 模式下，用同一个真实 Chromium 会话持续迭代，不要每一步都重启。
   - `mcp` 模式下，先调用 `mcp_tool(server="<resolved-id>", tool="list_tools")` 探测能力，再建立真实浏览器交互链路。
   - `none` 模式下，不进入浏览器测试，直接输出“已跳过”结论与原因。
3. **Run functional QA first.**
   - 先按正常用户路径验证输入、点击、切换、弹窗、菜单、列表和结果反馈。
   - 对失败、阻塞和异常路径单独记录，不要跳过直接下结论。
4. **Run visual QA separately.**
   - 在关键状态下再做一次视觉检查，关注布局、截断、对齐、滚动、空态和主题适配。
   - 如果最终结论依赖截图或界面证据，要明确保存对应截图或页面快照。
5. **Report with evidence.**
   - 区分已验证、未验证和被环境阻塞的范围。
   - 结论只基于真实 Playwright 操作结果，不要把“理论上可行”写成“已确认通过”。

## Guardrails

- 不要在会话尚未启动时声称已经完成页面验证。
- 不要把 `playwright.config.ts`、`e2e/*.spec.ts`、`npx playwright test` 当成这个 skill 的降级实现。
- 不要把功能检查和视觉检查混成一句“看起来没问题”。
- 不要因为要节省时间就省略关键交互路径或异常路径。
- 不要复用已经失效的页面句柄；发现句柄失效时要显式重建。

## Validation

- 检查是否先整理了可追溯的 QA 清单。
- 检查功能结论是否对应到真实 Playwright 操作、真实 Chromium 窗口，或已启用 Playwright MCP 的交互结果。
- 检查视觉结论是否对应到具体状态、截图或页面快照。
- 若运行模式为 `none`，检查最终结果是否显式写明“已跳过”与跳过原因，而不是伪装成失败或已验证。
- 交付前对照 [playwright-session-checklist.md](references/playwright-session-checklist.md) 复核本轮证据是否完整。

## References

- [playwright-session-checklist.md](references/playwright-session-checklist.md): 持久会话调试、功能核验和视觉证据收集的执行清单。
