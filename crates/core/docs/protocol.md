# Core Protocol Contract（agent + mcp）

## 目标

本文档定义 `crates/core` 内 `agent` 与 `mcp/*` 共用的协议结构，确保 Desktop 侧只需对接一套字段语义。

## 协议模型

统一类型定义在：`zodileap_mcp_common`

- `ProtocolStepRecord`: 步骤记录。
- `ProtocolEventRecord`: 事件记录。
- `ProtocolAssetRecord`: 资产记录。
- `ProtocolError`: 结构化错误。
- `ProtocolUiHint`: UI 提示（含动作）。

### Step（ProtocolStepRecord）

- `index`: 步骤序号（从 0 开始）。
- `code`: 步骤代码（机器可读，如 `export_glb`、`llm_call`）。
- `status`: `success | failed | skipped | manual`。
- `elapsed_ms`: 步骤耗时（毫秒）。
- `summary`: 人类可读摘要。
- `error`: 失败时的结构化错误。
- `data`: 步骤扩展数据（可选）。

### Event（ProtocolEventRecord）

- `event`: 事件名（如 `step_started`、`step_finished`、`llm_started`）。
- `step_index`: 关联步骤索引（可选）。
- `timestamp_ms`: 事件时间戳（毫秒）。
- `message`: 事件消息。

### Asset（ProtocolAssetRecord）

- `kind`: 资产类型（如 `exported_model`、`model_output`）。
- `path`: 资产路径。
- `version`: 资产版本号。
- `meta`: 扩展元数据（可选）。

### Error（ProtocolError）

- `code`: 稳定错误码（对外契约字段）。
- `message`: 错误描述（可迭代优化）。
- `suggestion`: 建议动作（可选）。
- `retryable`: 是否可重试。

### UI Hint（ProtocolUiHint）

- `key`: hint 标识。
- `level`: `info | warning | danger`。
- `title`: 标题。
- `message`: 说明。
- `actions`: 可执行动作（`key`、`label`、`intent`）。
- `context`: 额外上下文（可选）。

## 复杂 MCP 会话扩展（模型智能体）

复杂 Blender MCP 会话仍复用统一 `Step/Event/Asset/Error/UI Hint` 协议，不新增破坏性字段。扩展信息通过 `ProtocolStepRecord.data` 与 `ProtocolUiHint.context` 透出：

- `step.data.operation_kind`: `basic | boolean_chain | modifier_chain | batch_transform | batch_material | scene_file_ops`。
- `step.data.branch`: `primary | fallback`。
- `step.data.risk_level`: `low | medium | high`。
- `step.data.recoverable`: 步骤失败后是否允许自动恢复。
- `step.data.condition`: 条件分支触发条件（例如 `on_primary_failed`）。
- `step.data.error_attribution`: 失败归因步骤编码（失败时）。

复杂会话新增约定 `event`：

- `branch_selected`: 记录当前命中的执行分支。
- `rollback_started`: 自动恢复/回滚开始。
- `rollback_finished`: 自动恢复/回滚完成。
- `rollback_failed`: 自动恢复/回滚失败。
- `safety_confirmation_required`: 命中高风险步骤，等待一次性确认。

复杂会话新增约定 `ui_hint.key`：

- `dangerous-operation-confirm`: 高风险步骤一次性确认（`context.confirmation_token`）。
- `complex-operation-recovery`: 复杂操作失败后的恢复建议（`retry_last_step` / `apply_recovery_plan`）。

## feature 边界与启用行为

`zodileap_agent_core` 提供如下编译特性：

- `with-mcp-model`: 启用模型 MCP 能力（导出、模型工具链路）。
- `with-mcp-code`: 启用代码 MCP 能力（当前阶段仅预留边界）。

运行期能力探测：

- `is_feature_enabled(AgentFeatureFlag)`
- `enabled_feature_flags()`

当请求依赖未启用特性时：

- 返回 `ProtocolError`，`code=core.agent.feature_disabled`。
- 错误中包含启用建议（`suggestion`）。

## 兼容策略

- 向后兼容变更：新增可选字段；新增事件名；新增 `kind` 类型。
- 非兼容变更：删除字段、重命名字段、修改字段语义、修改枚举既有取值含义。
- 客户端要求：
  - 未识别字段必须忽略。
  - 未识别 `event` / `kind` / `code` 必须降级处理，不应导致崩溃。
  - `message` 仅用于展示，流程判断必须基于 `code` 与结构化字段。
