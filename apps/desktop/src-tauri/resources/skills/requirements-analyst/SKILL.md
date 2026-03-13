---
name: requirements-analyst
description: 当用户目标、范围、边界、依赖或验收标准还不清晰时使用。将零散诉求整理成可执行的功能拆解、约束、开放问题和可验证验收标准，并严格停留在分析阶段，不提前落地代码或过程文件。
---
# Requirements Analysis

## Overview

本 skill 用于把模糊、零散或混合在一起的需求整理成可执行规格。重点是明确目标、范围、边界、依赖、开放问题和验收方式，让后续实现、测试或排期有稳定输入。

## When to use

- 用户只给出业务目标、想法、Issue、聊天记录或零散诉求，还不足以直接实现。
- 后续编码、测试、排期或拆任务依赖更清晰的功能拆解与验收标准。
- 需要在实现前先明确 in scope / out of scope、角色场景、异常路径、风险和待确认项。

## Preconditions

- 先读完用户输入、相关上下文和仓库事实；不要先套模板再找证据。
- 如果仓库里已经有相关页面、接口、实体、工作流或测试入口，先核对这些既有事实。
- 默认在会话中直接交付分析结果；只有用户明确要求导出文档时，才写入仓库或生成文件。

## Core Workflow

1. **Extract the goal.**
   - 用一句话概括业务目标、目标用户和预期结果。
   - 如果一个请求里混了多个目标，先拆成独立子目标。
2. **Frame the scope.**
   - 明确本轮要做什么、不做什么、依赖什么。
   - 把隐含假设显式列成“假设 / 待确认”，不要写成既定事实。
3. **Break down the work.**
   - 输出功能拆解、用户路径、关键状态变化、输入输出、边界条件和异常场景。
   - 如果后续实现依赖接口、实体或页面结构，标出它们的关系，但不要提前替实现拍板。
4. **Define acceptance.**
   - 为每个核心功能写可验证验收项；每一条都必须能被测试、观察或人工检查。
   - 使用 [acceptance-checklist.md](references/acceptance-checklist.md) 补齐遗漏项。
5. **Call out risks and unknowns.**
   - 单列风险、开放问题、数据缺口、依赖阻塞和需要用户确认的决策点。
   - 如果现有信息不足以继续，停在这里并说明缺什么。
6. **Deliver in conversation.**
   - 默认把分析正文直接发在当前会话中。
   - 只有用户明确要求导出时，才创建需求文档或过程文件。

## Guardrails

- 不要在分析阶段执行 `apply_patch`、安装依赖、初始化项目、生成代码或创建过程文件。
- 不要把“可能”“推测”“通常会”写成确定结论。
- 不要用 `TODO.md`、`REQUIREMENTS.md`、计划草稿等文件替代会话输出，除非用户明确要求。
- 不要跳过开放问题；缺少关键约束时，必须显式指出分析还不能转入实现。

## Validation

- 检查结论是否都能追溯到用户输入或仓库事实。
- 检查每个核心功能是否都有边界、异常或验收说明。
- 检查输出中是否混入了实现方案、代码细节或未经确认的技术决策。
- 交付前用 [acceptance-checklist.md](references/acceptance-checklist.md) 做一次证据与验收自检。

## References

- [acceptance-checklist.md](references/acceptance-checklist.md): 需求拆解、边界条件、验收与开放问题的检查表。
