---
name: openapi-model-designer
description: 在接口定义尚未稳定或需要落地项目内 OpenAPI 契约时使用。用于梳理实体、请求、响应、错误语义和 Mock 场景，并把结果写入当前项目的 OpenAPI 文件。
---
# OpenAPI Model Design

## Overview

本 skill 用于把接口建模这件事做完整：梳理实体、请求/响应、错误语义和 Mock 场景，并将结果落到当前项目内的 OpenAPI 文件。重点是契约一致性、本地可维护性，以及后续实现能否持续复用这份契约，而不是任何第三方平台同步。

## When to use

- 需要先统一前后端字段、接口契约、Mock 场景或错误语义。
- 需要把建模结果写入当前项目的 OpenAPI 文件，并作为后续开发的契约来源。
- 用户明确要求“先设计接口模型”“先把 OpenAPI 契约整理出来”。

## Preconditions

- 先确认业务目标、实体关系和消费方需求，不要脱离上下文抽象字段。
- 默认把接口建模正文直接输出在当前会话中；OpenAPI 文件属于真实交付物，可写入当前项目目录。
- 写入前先确认当前项目中是否已有 OpenAPI 文件或约定目录，避免重复生成多个契约副本。

## Core Workflow

1. **Model the domain.**
   - 先定义实体、关键字段、枚举、约束和字段含义。
   - 对含糊字段单列假设，不要直接拍板。
2. **Define the interface contract.**
   - 继续整理请求模型、响应模型、错误结构、分页 / 过滤 / 排序等规则。
   - 如果是多个接口，说明它们的关系和调用顺序。
3. **Write the project OpenAPI file.**
   - 将建模结果写入或更新当前项目内的 OpenAPI 文件。
   - 默认优先写入 `<workspace>/docs/openapi/` 目录；文件名应根据当前项目或模块语义命名，例如 `admin.openapi.json`、`game-service.openapi.json`，不要假设固定业务名称。
   - 若项目中已有现成 OpenAPI 文件，应优先更新同一文件，而不是再生成临时契约文件。
4. **Plan the mock coverage.**
   - 输出正常、边界和异常的 Mock 场景。
   - 明确哪些场景是前端联调必须的，哪些是补充验证。
5. **Deliver the model honestly.**
   - 把实体、接口、Mock、OpenAPI 写入结果和阻塞原因一起交付。
   - 默认留在会话里，不要用本地过程文件代替前端展示或会话上下文。

## Guardrails

- 不要在实体关系没搞清楚时强行定字段。
- 接口建模正文、Mock 说明、OpenAPI 写入结果和阻塞原因，默认直接输出到当前会话并保留在会话上下文中；除非用户明确要求导出文件，否则不要创建或修改 `api-models.md`、`mock-plan.md` 等过程文件。
- 不要用模糊词代替契约细节，例如“返回一些信息”“字段视情况而定”。
- 不要把固定文件名当成事实；OpenAPI 文件名必须和当前项目或模块语义一致。

## Validation

- 检查实体、请求、响应和错误语义是否前后一致。
- 检查 Mock 场景是否覆盖正常、边界和异常路径。
- 检查 OpenAPI 文件是否写入到当前项目内的合理路径且结构合法。
- 检查文件路径与文件名是否符合当前项目语义，而不是沿用别的项目名称。
- 交付前阅读 [openapi-model-checklist.md](references/openapi-model-checklist.md) 做一次契约与落盘自检。

## References

- [openapi-model-checklist.md](references/openapi-model-checklist.md): OpenAPI 文件命名、结构和落盘检查清单。
