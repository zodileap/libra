# Services

Libra 开源后端采用单一 Go module + 单地址入口的轻量结构。

目标只有三个：

- 部署简单
- 目录简单
- 契约清晰，便于其他语言重写

## 当前结构

```text
services/
  go.mod
  go.sum
  README.md
  cmd/
    server/
      main.go
    account/
      main.go
    runtime/
      main.go
    setup/
      main.go
  internal/
    backend/
      config.go
      server.go
    account/
      api/
      configs/
      service/
      specs/
    runtime/
      api/
      configs/
      service/
      specs/
    setup/
      api/
      configs/
      service/
      specs/
  contracts/
    backend.yaml
    account.yaml
    runtime.yaml
    setup.yaml
  data/
    account/
    runtime/
    setup/
```

## 入口约定

### 主入口

开源版默认只推荐一个入口：

```bash
cd services
go run ./cmd/server
```

它会在同一地址上统一暴露：

- `/auth/v1/*`
- `/workflow/v1/*`
- `/setup`
- `/setup/v1/*`

### 调试入口

`cmd/account`、`cmd/runtime`、`cmd/setup` 仍然保留，但只作为领域调试入口，不是默认部署方式。

如果没有明确需求，不要把开源部署文档写回多地址模式。

## 目录职责

- `cmd/server`
  - 统一后端启动入口。
- `internal/backend`
  - 单地址配置与路由归口。
- `internal/account`
  - 登录、管理员 bootstrap、身份、权限、智能体访问控制。
- `internal/runtime`
  - 会话、消息、Sandbox、预览、桌面更新检查。
- `internal/setup`
  - 初始化编排与 `/setup` 页面托管。
- `contracts`
  - 结构化契约文档，用于跨语言实现。
- `data`
  - 开源默认模式下的本地文件存储目录。

## 契约文档要求

`contracts/*.yaml` 不是附属说明，而是后端规范的一部分。

以下内容一旦变化，必须在同一轮改动中同步更新对应契约：

- 路由新增、删除、重命名或归口调整
- 请求参数或响应字段变化
- 错误语义变化
- 环境变量变化
- 本地文件存储结构变化
- 数据库元数据表变化
- 启动方式或默认地址变化
- 服务目录结构变化

如果代码和契约不一致，以代码为准，但该改动视为未完成。

## 为什么不用更重的结构

这里刻意没有走 Spring Boot 风格的复杂层次，也没有继续沿用旧内部工程里的生成式目录。

原因很直接：

- 开源项目需要让读代码的人一眼知道入口和边界
- 单一 `go.mod` 更容易维护
- `cmd + internal + contracts + data` 已经足够表达当前系统
- 复杂抽象不会提升开源可维护性，只会提高理解成本

## 当前保留的领域

- `account`
- `runtime`
- `setup`

## 已移除的历史领域

- `agent_code`
- `agent_3d`
- `billing`
- `enterprise`
- `license`
- `entity`

这些内容不属于当前开源首装闭环，也不应该再以旧目录形式回流。

## 常用命令

统一启动：

```bash
cd services
go run ./cmd/server
```

运行测试：

```bash
cd services
go test ./...
```

使用根目录脚本启动：

```bash
./scripts/start-open-source-stack.sh
```
