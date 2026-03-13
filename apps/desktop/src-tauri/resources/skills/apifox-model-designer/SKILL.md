---
name: apifox-model-designer
description: 在接口定义尚未稳定或需要同步 Apifox 时使用。用于梳理实体、请求、响应、Mock 场景和同步步骤，并在 Apifox 或 MCP 不可用时明确阻塞与人工替代方案。
---
# Apifox Model Design

## Overview

本 skill 用于把接口建模这件事做完整：梳理实体、请求/响应、错误语义、Mock 场景，以及 Apifox / MCP 的同步与阻塞说明。重点是契约一致性和同步路径透明，而不是只给一份粗略字段表。

## When to use

- 需要先统一前后端字段、接口契约、Mock 场景或错误语义。
- 需要把建模结果同步到 Apifox，或至少给出明确的同步步骤。
- 用户明确要求“先设计接口模型”“先把 Apifox 契约整理出来”。

## Preconditions

- 先确认业务目标、实体关系和消费方需求，不要脱离上下文抽象字段。
- 如果会用到 Apifox MCP，先确认当前运行时是否可用；必要时参考 [apifox-sync-checklist.md](references/apifox-sync-checklist.md)。
- 默认把建模结果直接输出在当前会话中；只有用户明确要求导出文件时，才写入外部文档。

## Core Workflow

1. **Model the domain.**
   - 先定义实体、关键字段、枚举、约束和字段含义。
   - 对含糊字段单列假设，不要直接拍板。
2. **Define the interface contract.**
   - 继续整理请求模型、响应模型、错误结构、分页 / 过滤 / 排序等规则。
   - 如果是多个接口，说明它们的关系和调用顺序。
3. **Plan the mock coverage.**
   - 输出正常、边界和异常的 Mock 场景。
   - 明确哪些场景是前端联调必须的，哪些是补充验证。
4. **Check Apifox / MCP availability.**
   - 涉及同步时，先检查 Apifox 或相关 MCP 是否可用。
   - 可用则说明同步动作与结果；不可用则记录阻塞、人工同步步骤和下一步建议。
5. **Deliver the model honestly.**
   - 把实体、接口、Mock、同步状态和阻塞原因一起交付。
   - 默认留在会话里，不要用本地过程文件替代前端展示或会话上下文。

## Guardrails

- 不要在实体关系没搞清楚时强行定字段。
- 不要把 Apifox 不可用时的“未同步”说成“已同步”。
- 不要默认创建 `api_design.json`、`mock-plan.md` 之类过程文件，除非用户明确要求。
- 不要用模糊词代替契约细节，例如“返回一些信息”“字段视情况而定”。

## Validation

- 检查实体、请求、响应和错误语义是否前后一致。
- 检查 Mock 场景是否覆盖正常、边界和异常路径。
- 检查同步结论是否区分了已执行、未执行和被阻塞。
- 交付前阅读 [apifox-sync-checklist.md](references/apifox-sync-checklist.md) 做一次同步与阻塞自检。

## References

- [apifox-sync-checklist.md](references/apifox-sync-checklist.md): Apifox / MCP 可用性检查、同步步骤和阻塞处理清单。
