# services/entity/v1

当前实体版本目录。

## server 列表

- `account`: 平台用户与智能体授权
- `billing`: 订阅与订单
- `license`: 激活码与激活记录
- `enterprise`: 企业与成员角色
- `agent_code`: 代码智能体资产
- `agent_3d`: 三维智能体任务
- `runtime`: 会话、沙盒与预览

## 生成命令

创建新 schema：

```bash
./new_schema.sh
```

生成实体与对应 service 基础代码（输出到 `services/<server>`）：

```bash
./generate.sh
```

批量初始化实体命令参考：

```bash
./bootstrap_entities.sh
```
