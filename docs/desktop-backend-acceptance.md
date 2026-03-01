# Desktop-Backend 联调验收清单

## 1. 主流程验收

1. 登录：调用 `POST /auth/v1/login` 成功返回 token。
2. 恢复：调用 `GET /auth/v1/me` 成功返回当前用户。
3. 授权：调用 `GET /auth/v1/available-agents` 返回授权智能体列表。
4. 会话：调用 `POST /workflow/v1/session` 创建会话。
5. 消息：调用 `POST /workflow/v1/session/message` 写入用户消息。
6. 执行：
   - 代码智能体：`POST /execute/v1/execute`（agent_code）。
   - 模型智能体：`POST /execute/v1/execute`（agent_3d）。
7. 结果：调用执行结果查询接口并回写 assistant 消息。

## 2. 异常流程验收

### 2.1 token 过期/失效

- 触发条件：服务返回 HTTP `401` 或业务码 `100001001`。
- 期望行为：desktop 清理本地 token，进入未登录态。

### 2.2 参数错误

- 触发条件：请求体缺失必填字段（如 `prompt`）。
- 期望行为：返回参数错误业务码，desktop 显示可读错误信息。

### 2.3 服务超时/不可达

- 触发条件：服务未启动或地址错误。
- 期望行为：desktop 展示网络失败提示，不清空已有本地业务状态。

### 2.4 业务错误码映射

- `100001001`：未授权，执行登出态回退。
- `100002001`：通用参数错误，执行就地提示。
- 其他业务码：统一展示 `[code] message`。

## 3. 排障步骤

1. 校验服务是否启动并监听预期端口（10001-10004）。
2. 校验 desktop 环境变量是否指向正确服务地址。
3. 校验请求头是否包含 `Authorization`。
4. 通过日志核对 API 层 processName 和请求路径是否一致。
5. 先验证 account，再验证 runtime，最后验证 agent_code/agent_3d。
