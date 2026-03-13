---
name: frontend-page-builder
description: 在需求和结构已经明确后使用，用于把页面方案落成 Desktop 可运行界面，完成布局、交互、状态绑定、错误提示和测试补齐，并遵守当前设计系统与工程约束。
---
# Frontend Page Build

## Overview

本 skill 用于把已经明确的页面方案落成可运行前端实现。它关注“怎么把页面做出来并验证”，而不是重新做需求或重新设计架构。

## When to use

- 需求和前端结构已经基本明确，需要开始实现页面、弹窗、列表、表单或交互流。
- 需要把设计稿、页面元素清单或交互说明转换成 Desktop 可运行代码。
- 需要在实现过程中同步补齐 i18n、错误提示、状态绑定和测试。

## Preconditions

- 先确认页面方案、路由位置、依赖服务和交互边界；如果这些还没稳定，先回到架构或需求 skill。
- 先阅读 [page-implementation-checklist.md](references/page-implementation-checklist.md)，明确 Desktop 页面实现约束。
- 如果要接接口，先确认服务层、字段和错误语义已经存在或已被定义。

## Core Workflow

1. **Read the target surface.**
   - 看清页面应该挂在哪个模块、使用哪些公共组件、是否需要 header slot、详情弹窗或菜单结构。
   - 先识别现有页面骨架和可复用的 widgets / services。
2. **Build the layout.**
   - 先完成页面结构、主区域、关键容器和响应式层级。
   - 样式优先使用现有 `--z-*` 变量和组件能力，不要直接硬编码。
3. **Wire the interactions.**
   - 接好状态流转、表单输入、按钮动作、异步加载、空态、错误态和成功反馈。
   - 用户可见文案走 i18n；错误提示走用户友好映射。
4. **Integrate the data layer.**
   - 页面只消费规范化后的服务层数据；不要把复杂业务逻辑塞进通用组件。
   - 如果后端能力不完整，显式说明阻塞，不要伪造数据链路。
5. **Verify and harden.**
   - 补齐与变更最相关的测试。
   - 检查交互、样式、主题适配、空态、禁用态和错误态是否完整。

## Guardrails

- 不要把页面实现阶段变成重新定义需求或架构的过程；高影响未决问题要回抛。
- 不要直接写用户可见文本、`window.alert` 或未映射的原始错误。
- 不要为了局部页面实现破坏公共组件边界或跳过设计系统。
- 不要在 `main` 区域自造 header；标题必须挂全局 slot。

## Validation

- 检查页面是否能在 Light / Dark 下正常显示，且不依赖不存在的 token。
- 检查主要交互、空态、加载态、错误态和成功反馈是否都能跑通。
- 检查文案是否都接入 i18n，错误提示是否做了用户友好化。
- 交付前用 [page-implementation-checklist.md](references/page-implementation-checklist.md) 过一遍实现与测试完整性。

## References

- [page-implementation-checklist.md](references/page-implementation-checklist.md): 页面实现、交互和测试补齐时的执行检查表。
