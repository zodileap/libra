# zodileap-agen

模块化智能体平台（主平台 + 可独立售卖智能体模块）。

## 目录

- `apps/web`: Web 端入口（React，复用 aries_react 体系）
- `apps/desktop`: Desktop 端入口（Tauri，macOS/Windows）
- `services/entity`: 数据库实体与代码生成入口
- `services/<server>`: 后端 API 服务（一个 entity 对应一个 service）
- `crates/core`: Rust Core 通用能力（流程、激活码、模型网关）
- `docs`: 架构与设计文档
- `scripts`: 项目脚本

## 当前阶段目标（P0）

1. 搭建仓库骨架与模块边界。
2. 打通用户基础能力 + 授权最小闭环。
3. 打通代码智能体最小可用链路（会话 + Web 预览）。

## 重要约束

- 平台是主入口，智能体模块必须可独立拆分与发布。
- 不使用 `agent-platform/packages/ui`。
- Web 端 UI 以 `aries_react` 体系为基础。
- Entity 与 API 必须按既定 go 规范和生成流程落地。
