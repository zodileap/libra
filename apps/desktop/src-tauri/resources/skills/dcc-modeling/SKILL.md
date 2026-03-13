---
name: dcc-modeling
description: 在需要通过已注册 DCC MCP 执行 Blender、Maya、C4D 等建模软件操作时使用。用于选择软件、约束单软件或跨软件流程、补齐关键参数，并对执行结果与导入导出风险做验证。
---
# DCC Modeling

## Overview

本 skill 用于通过已注册的 DCC MCP 执行建模、检查、编辑、材质、导入导出和跨软件迁移。重点是：选对软件、补齐关键参数、明确迁移链路、如实反馈执行结果。

## When to use

- 用户希望在 Blender、Maya、C4D 等 DCC 软件里执行对象编辑、场景检查、材质处理、导入导出等操作。
- 同一话题需要绑定一个默认 DCC 软件，或在明确条件下规划跨软件流程。
- 需要依据当前可用 MCP Runtime 约束决定能不能执行、怎么执行。

## Preconditions

- 只能通过已注册并启用的 DCC MCP 执行操作；先检查可用运行时，不要假设软件一定可用。
- 先阅读 [runtime/requirements.json](runtime/requirements.json) 和 [dcc-routing-rules.md](references/dcc-routing-rules.md)。
- 执行前确认对象、文件路径、格式、单位、坐标系和风险边界；关键参数不完整时先补齐。

## Core Workflow

1. **Choose the software.**
   - 用户明确指定软件时，优先使用该软件，并将其作为当前话题默认软件。
   - 用户未指定且有多个可用 DCC 时，必须先让用户选择。
   - 用户未指定且只有一个可用 DCC 时，可直接绑定该软件。
2. **Lock the task boundary.**
   - 明确本轮是检查、编辑、材质、导入、导出还是跨软件迁移。
   - 对对象名、层级、文件路径、导出格式、单位和坐标系做一次确认。
3. **Plan before executing.**
   - 单软件任务先列 MCP 操作步骤，再执行。
   - 跨软件任务先输出“源软件 -> 中间格式 -> 目标软件”的迁移链路，再逐步执行。
4. **Execute through MCP only.**
   - 调用真实 MCP，记录结果、失败点、返回信息和产物路径。
   - 如果某步被阻塞，停在阻塞说明，不要伪造软件执行结果。
5. **Validate the outcome.**
   - 检查对象状态、文件输出、导入结果和关键风险是否符合预期。
   - 若结果不完整，明确下一步建议或需要用户确认的点。

## Guardrails

- 不要跳过 MCP 直接声称“已在软件中完成”。
- 只有在用户明确提到两个或以上 DCC 软件时，才允许直接规划跨软件流程。
- 如果用户表达了跨软件意图但未明确源 / 目标软件，必须先要求用户选择，不能自动脑补第二个软件。
- 不要忽略格式、单位、材质丢失、骨骼、约束或坐标系等迁移风险。

## Validation

- 检查当前绑定软件是否与用户意图一致。
- 检查所有执行结论都来自真实 MCP 调用结果。
- 检查导入导出路径、格式和关键对象是否有结果反馈。
- 交付前对照 [dcc-routing-rules.md](references/dcc-routing-rules.md) 和 [runtime/requirements.json](runtime/requirements.json) 复核路由与运行时约束。

## References

- [dcc-routing-rules.md](references/dcc-routing-rules.md): 单软件绑定、跨软件迁移和阻塞处理规则。
- [runtime/requirements.json](runtime/requirements.json): 当前 DCC skill 的运行时约束与多软件选择规则。
