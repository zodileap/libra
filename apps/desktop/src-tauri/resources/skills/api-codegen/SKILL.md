---
name: api-codegen
description: 在接口契约已明确时使用，用于生成客户端或服务端调用层、类型定义、mock 与测试骨架，并说明生成边界、未覆盖内容和验证命令，避免脱离契约臆造实现。
---
# API Code Generation

## Overview

本 skill 用于在契约已经明确的前提下，把接口定义转换成可维护的代码输出。重点是契约对齐、生成边界清晰、验证路径明确，而不是“根据印象补一个差不多的实现”。

## When to use

- 接口字段、方法、路径、错误语义已经明确，需要生成调用层、类型定义或基础测试骨架。
- 需要把后端契约同步到前端服务层、SDK、Mock 或验证代码。
- 用户明确要求“根据接口契约生成代码”或“先起调用层和测试骨架”。

## Preconditions

- 先确认契约来源真实可读：接口文档、OpenAPI、后端实现、已有类型或用户给定字段表。
- 明确目标语言、框架、目录落点和覆盖范围；若这些不清楚，先停在约束确认。
- 生成前阅读 [output-contract.md](references/output-contract.md)，确保输出结构和验证说明完整。

## Core Workflow

1. **Validate the contract.**
   - 先核对接口路径、方法、请求参数、响应字段、错误结构和鉴权要求。
   - 若契约不完整，显式列出缺口，不要擅自补齐关键字段。
2. **Map the target surface.**
   - 确认调用层、类型定义、mock、测试文件应落在哪些目录。
   - 先复用现有服务层或类型命名约定，不要另造一套风格。
3. **Generate only the justified scope.**
   - 生成本轮明确需要的调用封装、类型、基础 mock 或测试骨架。
   - 对暂未覆盖的分页、重试、缓存、鉴权细节等，明确标注未包含范围。
4. **Document integration and validation.**
   - 说明新增文件、调用入口、依赖关系和需要执行的验证命令。
   - 如果生成结果依赖人工补全，也要列出待补位置。
5. **Report boundaries.**
   - 明确哪些代码是契约直推的，哪些内容因信息不足未生成。
   - 对高风险假设单列提示，不要埋在代码里。

## Guardrails

- 不要在契约缺失时臆造字段、状态码、错误语义或分页规则。
- 不要覆盖用户已有的业务逻辑实现，除非任务明确要求重写。
- 不要只生成代码不说明验证方式。
- 不要把“代码骨架”包装成“完整可上线实现”。

## Validation

- 检查生成结果是否与契约字段一一对应。
- 检查目录落点、命名风格和现有仓库习惯是否一致。
- 检查是否明确说明了验证命令、mock 范围和未覆盖内容。
- 交付前对照 [output-contract.md](references/output-contract.md) 做一次输出完整性检查。

## References

- [output-contract.md](references/output-contract.md): 代码生成结果、边界声明与验证说明的交付结构。
