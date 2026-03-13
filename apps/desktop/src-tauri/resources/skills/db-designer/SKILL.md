---
name: db-designer
description: 在需求已明确并需要落库方案时使用。用于设计实体、字段、索引、约束、迁移和回滚策略，并识别兼容性、数据一致性和变更风险。
---
# Database Design

## Overview

本 skill 用于把“怎么落库”设计完整，包括实体、字段、索引、约束、迁移、兼容、回滚和风险说明。目标是让实现和上线前就知道数据层要承担什么边界。

## When to use

- 业务需求已经稳定，需要设计数据库实体和迁移方案。
- 需要在编码前先确认字段、关系、索引、唯一性、历史兼容或回滚策略。
- 用户明确要求“给我数据库设计”“先出表结构和迁移方案”。

## Preconditions

- 先确认业务流程、核心实体、读写模式和查询热点。
- 如果仓库里已有表、实体或 migration，先核对现状而不是假设从零开始。
- 设计前阅读 [schema-review-checklist.md](references/schema-review-checklist.md)，避免遗漏兼容与风险检查。

## Core Workflow

1. **Model the entities.**
   - 定义实体、字段、类型、关系和关键业务约束。
   - 说明哪些字段是业务主键、外键、状态位、审计字段或软删除字段。
2. **Design the read / write patterns.**
   - 根据查询、筛选、排序和写入路径设计索引、唯一约束和必要的冗余字段。
   - 如果有高频统计或幂等要求，要在结构层说明支撑方式。
3. **Plan migrations.**
   - 输出迁移步骤、历史兼容方案、数据回填方式和回滚策略。
   - 对影响线上数据的变更，明确风险和停机 / 灰度要求。
4. **Call out consistency risks.**
   - 识别并发写入、幂等、事务边界、级联更新 / 删除和数据污染风险。
   - 对无法完全解决的问题，给出限制条件或后续保护措施。
5. **Deliver a reviewable design.**
   - 把实体设计、索引约束、迁移路径和风险一起交付。
   - 对未确认的数据规模、存储引擎或历史负担显式列为假设。

## Guardrails

- 不要只给字段表，不说明为什么这样设计。
- 不要忽略迁移、回滚和历史兼容。
- 不要在没有证据时臆造已有表结构或线上数据现状。
- 不要把“建议”写成“已确认”的数据库规则。

## Validation

- 检查每个实体和字段是否都有业务理由。
- 检查查询热点是否有对应索引或说明。
- 检查迁移、回填、回滚和兼容路径是否完整。
- 交付前用 [schema-review-checklist.md](references/schema-review-checklist.md) 过一遍结构与风险检查。

## References

- [schema-review-checklist.md](references/schema-review-checklist.md): 实体、索引、迁移、回滚和一致性风险的复核清单。
