# Desktop-Backend 联调契约

## 1. 联调范围

- 本文覆盖 `apps/desktop` 与 `services/account`、`services/runtime`、`services/agent_code`、`services/agent_3d` 的联调契约。
- 当前迭代目标：完成登录鉴权、会话消息、代码执行、模型执行四条主路径。
- 联调顺序：`account` -> `runtime` -> `agent_code` -> `agent_3d`。

## 2. 接口清单

### 2.1 account

- `POST /auth/v1/login`：账号密码登录，返回 token 与用户信息。
- `GET /auth/v1/me`：读取当前登录用户信息。
- `POST /auth/v1/logout`：当前 token 失效。
- `GET /auth/v1/available-agents`：读取当前用户可用智能体列表。
- `GET /auth/v1/user-agent-accesses`：读取用户智能体授权关系。
- `POST /auth/v1/user-agent-access`：新增/更新用户智能体授权关系。
- `DELETE /auth/v1/user-agent-access`：删除用户智能体授权关系。

### 2.2 runtime

- `POST /workflow/v1/session`：创建会话。
- `GET /workflow/v1/session`：读取会话详情。
- `GET /workflow/v1/sessions`：读取会话列表。
- `PUT /workflow/v1/session/status`：会话状态流转/关闭。
- `POST /workflow/v1/session/message`：写入会话消息。
- `GET /workflow/v1/session/messages`：分页读取会话消息。
- `POST /workflow/v1/sandbox`：创建 Sandbox。
- `GET /workflow/v1/sandbox`：读取 Sandbox。
- `DELETE /workflow/v1/sandbox`：回收 Sandbox。
- `POST /workflow/v1/preview`：创建预览地址。
- `GET /workflow/v1/preview`：读取预览地址。
- `DELETE /workflow/v1/preview`：让预览地址失效。

### 2.3 agent_code

- `POST /execute/v1/execute`：代码智能体执行入口。
- `GET /execute/v1/execute`：按 `executionId` 查询执行结果。

### 2.4 agent_3d

- `POST /execute/v1/execute`：模型智能体执行入口。
- `GET /execute/v1/execute`：按 `taskId` 查询执行结果。

## 3. 字段与错误规范

- 字段命名统一使用 `camelCase`。
- ID 字段统一使用字符串语义（如 `userId`、`sessionId`、`taskId`）。
- 时间字段统一使用 RFC3339/RFC3339Nano 格式字符串。
- 分页统一使用 `page`、`pageSize` 入参，响应返回 `list`、`total`、`page`、`pageSize`。
- 响应结构统一为：
  - `code`：业务状态码。
  - `message`：业务消息。
  - `data`：业务数据。
- 未授权统一识别：
  - HTTP `401` 或业务码 `100001001`。

## 4. Desktop 环境变量

- `VITE_ACCOUNT_BASE_URL`：account 服务地址，默认 `http://127.0.0.1:18080`。
- `VITE_RUNTIME_BASE_URL`：runtime 服务地址，默认 `http://127.0.0.1:18081`。
- `VITE_AGENT_CODE_BASE_URL`：agent_code 服务地址，默认 `http://127.0.0.1:18082`。
- `VITE_AGENT_3D_BASE_URL`：agent_3d 服务地址，默认 `http://127.0.0.1:18083`。
- `VITE_APP_API_URL`：desktop app 配置基地址。
- `VITE_APP_LOCAL_IMG_SRC`：desktop 本地图片根路径。

## 5. 前端联调策略

- 登录成功后缓存 token，后续请求统一注入 `Authorization: Bearer <token>`。
- 遇到未授权响应时统一清理 token 并回到登录态。
- 启动时若存在 token，优先调用 `/auth/v1/me` 与 `/auth/v1/available-agents` 恢复状态。
- 会话读写与执行入口全部走后端接口，不再以本地存储作为主路径。

## 6. 示例请求与响应

### 6.1 登录

请求：

```http
POST /auth/v1/login
Content-Type: application/json

{
  "email": "demo@zodileap.com",
  "password": "123456"
}
```

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "token": "atk_xxx",
    "expiresAt": "2026-02-14T10:00:00Z",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Demo",
      "email": "demo@zodileap.com"
    }
  }
}
```

### 6.2 创建会话

请求：

```http
POST /workflow/v1/session
Authorization: Bearer atk_xxx
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "agentCode": "code"
}
```

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "session": {
      "id": "1001",
      "userId": "123e4567-e89b-12d3-a456-426614174000",
      "agentCode": "code"
    }
  }
}
```

### 6.3 代码执行入口

请求：

```http
POST /execute/v1/execute
Authorization: Bearer atk_xxx
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "sessionId": "1001",
  "prompt": "新增登录页并接入后端接口"
}
```

响应：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "result": {
      "executionId": "2001",
      "status": 1,
      "actions": [],
      "logs": [],
      "errors": [],
      "artifacts": []
    }
  }
}
```
