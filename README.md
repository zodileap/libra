# Libra

Libra 是一个开源的桌面优先智能体工作台。仓库当前的设计目标很明确：

- `apps/desktop` 可以独立作为本地 App 使用
- 后端是可选能力，通过单一地址接入 `account / runtime / setup`
- 首次初始化页面直接嵌入后端，不再维护独立 Web 应用

## 仓库结构

- `apps/desktop`
  - Tauri Desktop 应用，也是当前唯一保留的前端入口。
- `crates/core`
  - Rust 核心能力目录，包含 `agent` 与 MCP 相关模块。
- `services`
  - 单一 Go backend module。
  - 主入口是 `services/cmd/server`。
  - 对外通过单一地址暴露 `auth / workflow / setup` 三组接口。
- `services/contracts`
  - 后端结构化契约文档。
  - 这里定义服务结构、HTTP 接口、环境变量、文件存储和数据库元数据表，用于跨语言重写实现。
- `scripts`
  - 一键启动与辅助脚本。

## 当前状态

- 版本：`0.1.0`
- 当前主线：`apps/desktop` + `services` + `crates/core`
- 独立 Web 应用已删除
- 初始化页面已经嵌入后端 `/setup`
- 后端已经统一为单地址模式
- Desktop 已支持：
  - 不接后端直接本地使用
  - 后续在设置中接入后端
  - 后端未初始化时打开 `/setup`，也允许继续本地模式
  - 默认读取官方静态更新源，也允许改成私有自托管 `latest.json`

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

说明：当前 `apps/desktop` 通过 npm 安装 `@aries-kit/react`，不再依赖本地 UI 包链接。

### 3. 启动后端

推荐直接使用根目录脚本：

```bash
./scripts/start-open-source-stack.sh
```

脚本会：

- 创建 `services/data/*` 数据目录
- 启动统一后端 `services/cmd/server`
- 等待 `/setup/v1/status` 健康检查通过
- 输出初始化地址和日志目录

启动完成后，直接访问：

- [http://127.0.0.1:10001/setup](http://127.0.0.1:10001/setup)

如果你希望手动启动，也可以：

```bash
cd services
go run ./cmd/server
```

### 4. 完成初始化

打开 `/setup` 后，按顺序完成：

1. 数据库连接校验
2. 数据库迁移
3. 系统设置
4. 管理员创建
5. 完成安装

### 5. 启动 Desktop

```bash
pnpm run dev:desktop
```

Desktop 的行为是：

- 默认可以直接本地进入
- 只有启用后端后，才会检查 `/setup/v1/status`
- 若后端未初始化，会提示打开 `/setup` 或继续本地模式
- 进入后也可以在 `Settings > General` 中切换后端模式和修改后端地址

### 6. 打包 Desktop 发布产物

如果你在专门的构建主机上打包 Desktop，可直接运行：

```bash
pnpm run release:desktop -- 0.1.1
```

Windows 原生 shell 可直接执行：

```powershell
scripts\package-desktop-release.cmd 0.1.1
```

说明：

- `pnpm run release:desktop` 现在会走跨平台 Node CLI
- `scripts/package-desktop-release.sh` 仅保留给 Bash 环境复用

脚本会：

- 把 `package.json`、`apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml` 同步到目标版本
- 生成或复用官方 Tauri updater 签名密钥
- 将公钥写入 `apps/desktop/src-tauri/updater/public.key`
- 执行正式 `tauri build`
- 产出完整安装包和 updater 热更新产物
- 自动整理成 `releases/<version>/<platform>/` 上传目录

约束：

- 这个脚本不会生成 `latest.json`
- 这个脚本不会上传服务器文件
- 服务器上的 `latest.json` 仍需要手工维护

macOS 发布建议：

- 首次下载安装：发布 `.dmg`
- App 内热更新：发布 `.app.tar.gz` 和对应 `.sig`
- 实际上传时，直接把 `releases/<version>/macos/` 整个目录复制到服务器 `downloads/<version>/` 下即可

## 常用命令

```bash
pnpm run dev:desktop
pnpm run build:desktop
pnpm run package:desktop
pnpm run release:desktop
pnpm run dev:backend
./scripts/start-open-source-stack.sh
```

后端测试：

```bash
cd services
go test ./...
```

Desktop 单测：

```bash
pnpm -C apps/desktop test:unit
```

## 后端结构化契约

如果你希望用 Java、Node.js、Rust 或其他语言重写后端，不需要先读 Go 源码，先看这里：

- [services/contracts/backend.yaml](./services/contracts/backend.yaml)
- [services/contracts/account.yaml](./services/contracts/account.yaml)
- [services/contracts/runtime.yaml](./services/contracts/runtime.yaml)
- [services/contracts/setup.yaml](./services/contracts/setup.yaml)

这些文档定义了：

- 服务结构与目录边界
- 单地址路由归口
- 请求参数与响应字段
- 本地文件存储结构
- 初始化阶段使用的数据库元数据表
- 环境变量与启动方式

约束：只要后端代码发生以下变化，就必须同步更新 `services/contracts/*.yaml`：

- HTTP 路由
- 请求或响应字段
- 错误语义
- 环境变量
- 本地存储结构
- 数据库元数据表
- 服务归口与启动方式

## 服务说明

当前开源版只保留三个后端领域：

- `account`
  - 登录、管理员 bootstrap、身份、权限、智能体访问控制
- `runtime`
  - 会话、消息、Sandbox、预览、桌面更新检查
- `setup`
  - 首次安装编排与 `/setup` 页面托管

历史内部服务已移除：

- `agent_code`
- `agent_3d`
- `billing`
- `enterprise`
- `license`
- `entity`

更详细的服务目录说明见：

- [services/README.md](./services/README.md)
- [docs/open-source-setup-plan.md](./docs/open-source-setup-plan.md)
- [docs/desktop-self-hosted-updates.md](./docs/desktop-self-hosted-updates.md)

## Roadmap

- [x] 项目名称统一为 `Libra`
- [x] 初始化页面迁入后端 `/setup`
- [x] 后端统一为单一地址
- [x] Desktop 支持本地优先、后端可选
- [x] 建立 `services/contracts` 结构化契约目录
- [x] 前端依赖从本地 `aries_react` 链接迁移到公开可安装方案
- [ ] 继续收口 Desktop 剩余管理能力

## 许可证

本项目采用 [Apache License 2.0](./LICENSE)。
