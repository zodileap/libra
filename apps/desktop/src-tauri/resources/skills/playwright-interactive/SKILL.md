---
name: playwright-interactive
description: 在需要持续复用同一浏览器或 Electron 会话做交互调试、界面核验和回归检查时使用。它强调先列检查清单，再用持久 Playwright 会话做功能和视觉验证。
---
# Playwright Interactive

## Overview

本 skill 用于通过持久化的 Playwright 会话做前端页面或 Electron 界面的交互调试。重点是：复用同一会话、缩短反复启动成本、把功能检查和视觉检查拆开执行，并基于真实操作结果给出结论。

## When to use

- 需要在本地页面、预览页或 Electron 窗口里持续调试交互。
- 需要在一轮开发里多次刷新页面，而不是每次都重建浏览器上下文。
- 需要同时检查功能行为、视觉状态、断言证据和截图结果。

## Preconditions

- 先确认当前仓库已经具备 Playwright 运行前提，或本轮任务允许安装与初始化相关依赖。
- 先确认目标页面的启动方式、访问地址、登录前提和测试数据。
- 执行前阅读 [playwright-session-checklist.md](references/playwright-session-checklist.md)，明确会话复用、检查顺序和证据要求。

## Core Workflow

1. **Build the QA inventory.**
   - 先列出本轮要验证的用户可见功能、关键按钮、状态切换和视觉断言。
   - 把用户要求、你准备在最终回复里声明的效果，以及页面真实存在的控件统一映射成检查项。
2. **Start one persistent session.**
   - 用同一个浏览器或 Electron 会话持续迭代，不要每一步都重启。
   - 如果只是渲染层改动，优先刷新页面；只有主进程或启动链路变化时才重启完整会话。
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
- 不要把功能检查和视觉检查混成一句“看起来没问题”。
- 不要因为要节省时间就省略关键交互路径或异常路径。
- 不要复用已经失效的页面句柄；发现句柄失效时要显式重建。

## Validation

- 检查是否先整理了可追溯的 QA 清单。
- 检查功能结论是否对应到真实 Playwright 操作或断言。
- 检查视觉结论是否对应到具体状态、截图或页面快照。
- 交付前对照 [playwright-session-checklist.md](references/playwright-session-checklist.md) 复核本轮证据是否完整。

## References

- [playwright-session-checklist.md](references/playwright-session-checklist.md): 持久会话调试、功能核验和视觉证据收集的执行清单。
