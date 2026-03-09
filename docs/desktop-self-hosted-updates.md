# Libra Desktop 私有自托管更新源

## 目标

Libra Desktop 当前支持通过静态 `latest.json` 读取桌面端更新元数据。

- 默认官方更新源：`https://open.zodileap.com/libra/updates/latest.json`
- 用户可以在 `Settings > General > Update Manifest URL` 中改成自己的私有 HTTPS 地址
- 如果未填写静态更新源，但已经接入统一后端，则会回退到现有 Runtime 的 `/workflow/v1/desktop-update/check`

这意味着：开源用户不需要先写一个专门的更新后端，只用站点目录 + Nginx 静态托管，就能搭一个可用的私有更新源。

## 推荐目录结构

```text
/your-site-root/libra-updates/
├── latest.json
└── downloads/
    └── 1.2.3/
        ├── libra-desktop-setup.exe
        ├── libra-desktop-setup.exe.sig
        ├── libra-desktop.msi
        ├── libra-desktop.msi.sig
        ├── libra-desktop.app.tar.gz
        ├── libra-desktop.app.tar.gz.sig
        ├── libra-desktop.AppImage
        └── libra-desktop.AppImage.sig
```

建议：

- `latest.json` 只放很小的元数据
- 安装包按 `downloads/{version}` 归档
- `latest.json` 使用 `no-cache`
- 安装包目录使用 `immutable + 长缓存`

## latest.json 最小示例

下面这个格式兼容 Tauri 静态 JSON 的核心字段，Libra Desktop 当前会读取：

- `version`
- `notes`
- `pub_date`
- `platforms[target].url`

```json
{
  "version": "1.2.3",
  "notes": "1. 修复若干稳定性问题\n2. 优化更新提示",
  "pub_date": "2026-03-09T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "replace-with-sig-file-content",
      "url": "https://example.com/libra-updates/downloads/1.2.3/libra-desktop-setup.exe"
    },
    "darwin-aarch64": {
      "signature": "replace-with-sig-file-content",
      "url": "https://example.com/libra-updates/downloads/1.2.3/libra-desktop.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "replace-with-sig-file-content",
      "url": "https://example.com/libra-updates/downloads/1.2.3/libra-desktop.AppImage"
    }
  }
}
```

说明：

- `signature` 当前文档保留 Tauri 官方静态更新字段，便于后续对齐正式 updater 链路
- Libra Desktop 当前开源版会直接读取 `url` 作为下载地址
- 若当前平台缺少对应 `platforms[target]`，桌面端会把它视为“未配置可用更新源”

## Nginx 建议

```nginx
location = /libra-updates/latest.json {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}

location /libra-updates/downloads/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri $uri/ =404;
}
```

文本类资源建议同时开启 gzip。

## Libra Desktop 当前行为

- 优先读取 `Update Manifest URL`
- 如果该地址读取失败，且用户已启用统一后端，则回退到 Runtime 更新接口
- 如果既没有静态更新源，也没有统一后端更新接口，则提示“未配置可用更新源”

## 对开源用户的建议

如果你只需要：

- 单一发布通道
- 私有安装包分发
- 固定“最新版本”

那就直接使用静态 `latest.json` + Nginx 即可。

如果你后面需要：

- 灰度发布
- 分用户分渠道更新
- 强制升级策略
- 鉴权下载

再单独实现动态更新服务更合适。
