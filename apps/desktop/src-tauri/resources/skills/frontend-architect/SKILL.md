---
name: frontend-architect
description: 在页面或模块开发前使用，用于规划前端目录结构、模块边界、状态流、服务分层和实现约束，并确保方案与当前 Desktop 工程规则、设计系统和测试分层一致。
---
# Frontend Architecture

## Overview

本 skill 用于在编码前先定义前端结构。目标不是直接写页面，而是明确目录层级、模块职责、状态流、服务边界、公共能力复用方式，以及必须遵守的工程限制。

## When to use

- 需要为新页面、新模块或重构任务先定义整体结构，再进入实现。
- 一个需求会同时影响页面、组件、服务、路由、状态或测试，不适合边写边决定边界。
- 需要把 Desktop 既有设计系统和工程约束转成具体的实现架构。

## Preconditions

- 先检查现有目录、模块 manifest、路由、公共组件和服务层，不要脱离仓库现状重新发明结构。
- 对齐当前 Desktop 前端约束，再输出方案；必要时读取 [desktop-frontend-rules.md](references/desktop-frontend-rules.md)。
- 如果用户已经指定技术边界或文件落点，优先在这些约束内设计，不要另起一套体系。

## Core Workflow

1. **Inspect the current surface.**
   - 先确认相关模块已存在什么：页面、widgets、services、shared、routes、tests。
   - 识别可以复用的现有组件、布局骨架和服务，而不是默认新增一层抽象。
2. **Define module boundaries.**
   - 明确页面层、业务组件层、服务层、共享层分别负责什么。
   - 对每个新增或变更模块给出单一职责和依赖方向。
3. **Design data flow.**
   - 说明页面状态从哪里来、在哪里归一化、由谁触发更新、错误如何映射到用户可见文案。
   - 如果涉及路由、弹窗、表单或工作流节点，写清交互状态的流转关系。
4. **Lock the constraints.**
   - 把 i18n、样式 token、`aries_react` 组件使用规则、header slot、菜单层级、测试分层等约束写清楚。
   - 如有特殊例外，也必须说明为什么现有规则不适用。
5. **Produce an implementation-ready map.**
   - 输出建议目录、关键文件职责、接口边界和风险点。
   - 如果仍有待确认项，单列出来，避免实现阶段临时拍板。

## Guardrails

- 不要脱离当前 Desktop 结构随意创建新技术栈、新页面体系或第二套设计系统。
- 不要把通用组件写成带具体业务逻辑的“伪通用层”。
- 不要在结构方案里使用不存在的组件、变量、接口或文件路径。
- 不要把样式硬编码当作默认方案；优先使用已存在的 `--z-*` 变量和设计系统能力。

## Validation

- 检查目录方案是否能映射到现有仓库结构，而不是概念图。
- 检查每个模块职责是否单一，依赖方向是否清晰。
- 检查约束是否覆盖 i18n、样式、布局、交互、安全和测试。
- 交付前阅读 [desktop-frontend-rules.md](references/desktop-frontend-rules.md)，确认没有与仓库规则冲突。

## References

- [desktop-frontend-rules.md](references/desktop-frontend-rules.md): Desktop 当前前端工程约束与常见结构禁区。
