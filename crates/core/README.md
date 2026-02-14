# crates/core

`core` 是目录，不是单一 Rust 包。用于组织可独立打包与售卖的核心能力包。

## 目录结构

- `core/agent`：智能体内核（流程、激活码、模型调用编排）。
- `core/mcp/common`：MCP 公共错误与基础工具。
- `core/mcp/code`：代码智能体 MCP 能力包（可独立发布）。
- `core/mcp/model`：模型智能体 MCP 能力包（可独立发布）。

## 设计目标

- 各能力包可独立构建、独立发布、独立按需集成。
- `agent` 可按 feature 选择是否集成 `mcp/code`、`mcp/model`。
- 平台侧只依赖实际购买/启用的能力包，避免冗余打包。

## 协议与边界

- 对外协议文档：`crates/core/docs/protocol.md`
- 统一协议类型定义：`core/mcp/common`（`ProtocolStepRecord`、`ProtocolEventRecord`、`ProtocolAssetRecord`、`ProtocolError`、`ProtocolUiHint`）
- 模型复杂会话规划：`core/mcp/model`（复合步骤、风险分级、一次性确认令牌、恢复提示）
- `agent` feature 边界：
  - `with-mcp-model`：启用模型 MCP 能力。
  - `with-mcp-code`：启用代码 MCP 能力边界（当前阶段以能力预留为主）。
