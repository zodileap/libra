# services/runtime

独立的 Libra Runtime 服务。

## 描述

- 提供 Desktop 当前使用的运行时接口：会话、消息、Sandbox、预览地址、桌面更新检查。
- 使用原生 Go `net/http` 与本地 JSON 文件持久化，不依赖任何私有基础包。
- 默认数据目录为 `./data`，可通过环境变量调整。

## 环境变量

- `LIBRA_RUNTIME_PORT`：监听端口，默认 `10002`。
- `LIBRA_RUNTIME_DATA_DIR`：状态持久化目录，默认 `./data`。
- `LIBRA_RUNTIME_ALLOWED_ORIGINS`：允许的跨域来源，逗号分隔，默认 `*`。
- `LIBRA_DESKTOP_LATEST_VERSION`：桌面端最新版本号。
- `LIBRA_DESKTOP_DOWNLOAD_URL*`：桌面端下载地址，支持平台/架构/通道后缀。
- `LIBRA_DESKTOP_CHECKSUM_SHA256`：安装包校验值。
- `LIBRA_DESKTOP_RELEASE_NOTES`：版本说明。
- `LIBRA_DESKTOP_PUBLISHED_AT`：发布时间。

## 运行

```bash
go run ./cmd
```
