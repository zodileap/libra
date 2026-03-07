# Libra

开源的模块化智能体平台。

Libra 面向「桌面端智能体工作台 + 可拆分后端能力 + 可独立发布的核心能力模块」这一类场景，当前仓库已经包含：

- `apps/desktop`：Tauri 桌面端
- `apps/web`：Web 端演示入口
- `services/runtime`：已脱离内部私有依赖的开源 Runtime 服务
- `crates/core`：Rust 核心能力与 MCP 相关模块

## 项目状态

- 当前版本：`0.1.0`
- 当前重点：Desktop 端与 Runtime 服务
- 当前后端状态：
  - `services/runtime` 已可独立构建
  - 其他服务仍在从内部依赖体系迁移中

这意味着：Libra 已经具备继续开源化重构的基础，但仓库还不处于“所有模块开箱即用”的阶段。

## 仓库结构

- `apps/desktop`
  - Tauri Desktop 应用
  - 当前主入口
- `apps/web`
  - React Web 演示入口
  - 当前不作为主要研发目标
- `crates/core`
  - Rust 核心能力目录
  - 包含 `agent` 及 MCP 相关模块
- `services/runtime`
  - 开源版 Runtime 服务
  - 提供会话、消息、Sandbox、预览地址、桌面更新检查接口
- `services/account`
  - 账号服务，仍依赖内部体系
- `services/agent_code`
  - 代码智能体服务，仍依赖内部体系
- `services/agent_3d`
  - 3D / 模型智能体服务，仍依赖内部体系
- `services/entity`
  - Entity 代码生成与实体定义目录
- `scripts`
  - 项目脚本

## 当前能力

- Desktop 端智能体会话与工作流界面
- Runtime 会话与消息接口
- Runtime Sandbox / Preview 基础接口
- 桌面端版本检查接口
- Rust Core 智能体与 MCP 相关基础模块

## 快速开始

### 1. 环境要求

- Node.js
- `pnpm`
- Go `>= 1.24`
- Rust / Cargo
- Tauri 开发环境

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动 Desktop

```bash
pnpm run dev:desktop
```

### 4. 启动 Runtime 服务

```bash
cd services/runtime
go run ./cmd
```

## 常用命令

```bash
pnpm run dev:desktop
pnpm run build:desktop
pnpm run package:desktop
pnpm run dev:web
pnpm run build:web
```

Runtime 服务测试：

```bash
cd services/runtime
go test ./...
```

Desktop 单测：

```bash
pnpm -C apps/desktop test:unit
```

## 开发说明

### 前端依赖说明

当前 `apps/web` 和 `apps/desktop` 仍通过本地路径链接 `aries_react` 依赖。

这意味着如果你直接在一台全新机器上克隆本仓库，前端部分未必能立即安装成功。当前仓库更适合：

- 阅读代码
- 继续开源化重构
- 参与 Desktop 与 Runtime 的能力迁移

后续会逐步把这部分依赖改造成更适合公开仓库的安装方式。

### 后端迁移说明

当前后端分成两类：

- 已开源化改造：
  - `services/runtime`
- 仍依赖内部体系：
  - `services/account`
  - `services/agent_code`
  - `services/agent_3d`
  - `services/billing`
  - `services/enterprise`
  - `services/license`

后续迁移方向是：逐个服务去除 `git.zodileap.com` 与内部 Taurus 依赖，改造成公开可构建的 Go 服务。

## Roadmap

- [x] 统一项目品牌为 `Libra`
- [x] Runtime 服务脱离内部私有依赖
- [ ] Account 服务开源化重构
- [ ] Agent Code 服务开源化重构
- [ ] Agent 3D 服务开源化重构
- [ ] 前端依赖从本地 `aries_react` 链接迁移到公开可安装方案
- [ ] 完善公开文档与示例

## 许可证

本项目采用 [Apache License 2.0](./LICENSE)。
