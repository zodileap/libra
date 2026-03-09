# apps/desktop

Desktop 主入口（Tauri，macOS/Windows）。

## 约束

- UI 风格尽量与 Web 保持一致。
- `aries_tauri` 采用按需复刻策略，不做全量复制。
- 三维智能体需要支持 Blender/ZBrush 对接。

## 下一步

- 初始化 Tauri 工程骨架。
- 接入统一登录态与智能体入口。
- 预留 DCC 连接层接口。

## 更新源

- Desktop 默认静态更新源：`https://open.zodileap.com/libra/updates/latest.json`
- 用户可在 `Settings > General > Update Manifest URL` 中改成自己的私有 HTTPS 更新源
- 私有自托管说明见 [../docs/desktop-self-hosted-updates.md](../docs/desktop-self-hosted-updates.md)
