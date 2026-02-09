# services/entity

实体层（原 DAO 实体层）已初始化为 `v1` 结构。

## 已完成

- 初始化 `v1/account`、`v1/billing`、`v1/license`、`v1/enterprise`、`v1/agent_code`、`v1/agent_3d`、`v1/runtime` schema 目录。
- API 结构调整为「一个 entity 对应一个 service」：`services/account`、`services/billing`、`services/license`、`services/enterprise`、`services/agent_code`、`services/agent_3d`、`services/runtime`。
- 提供 `v1/new_schema.sh`（标准 new 命令入口）。
- 提供 `v1/generate.sh`（统一生成入口）。
- 提供每个 server 各自的 `generate.sh`（分别生成）。
- 补充 `v1/bootstrap_entities.sh`，用于批量创建下一阶段业务实体。

## 当前受限项

当前环境无法访问 `goproxy.cn`，因此 `go run github.com/zodileap/taurus_go/entity/cmd new ...` 无法在线拉取依赖。
网络恢复后，直接在 `v1` 执行：

```bash
./bootstrap_entities.sh
./new_schema.sh
./generate.sh
```
