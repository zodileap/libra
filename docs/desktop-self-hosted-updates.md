# Libra Desktop 私有自托管更新源

## 目标

Libra Desktop 当前按 Tauri 官方 updater 标准读取静态 `latest.json`。

- 默认官方更新源：`https://open.zodileap.com/libra/updates/latest.json`
- 用户可以在 `Settings > General > Update Manifest URL` 中改成自己的私有 HTTPS 地址
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
        ├── libra-desktop.dmg
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
- `.dmg` 给首次下载安装
- `.app.tar.gz + .sig` 给 macOS 热更新

## latest.json 最小示例

下面这个格式按 Tauri 静态 JSON 的核心字段组织：

- `version`
- `notes`
- `pub_date`
- `platforms[target].url`
- `platforms[target].signature`

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

- `signature` 必须填入 `.sig` 文件内容本身，不是签名文件 URL
- macOS 热更新 URL 应指向 `.app.tar.gz`，不要指向 `.dmg`
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

## 推荐发布流程

如果你的 Desktop 安装包是在专门的构建主机上生成，推荐分成两段：

1. 在构建主机打包 Desktop
2. 把产物上传到更新服务器
3. 在更新服务器维护 `latest.json`

仓库内置了一个只负责打包的脚本：

```bash
pnpm run release:desktop -- 0.1.1
```

它会：

- 校验 Desktop 版本号是否一致
- 生成或复用官方 signer key
- 将公钥注入应用源码
- 执行 `tauri build`
- 产出完整安装包和 updater 热更新产物
- 自动整理成 `releases/<version>/<platform>/` 上传目录

它不会：

- 自动生成 `latest.json`
- 自动上传到远端服务器
- 自动修改线上更新清单

所以发布顺序应该是：

1. 在 `source` 中更新 Desktop 版本
2. 在构建主机执行打包脚本
3. 将 `releases/<version>/macos/` 整个目录复制到服务器 `downloads/<version>/` 下
4. 其中 `.dmg` 供首次下载安装，`.app.tar.gz + .sig` 供 App 内热更新
5. 手工更新服务器上的 `latest.json`

## Libra Desktop 当前行为

- 优先读取 `Update Manifest URL`
- 命中新版本后，会调用官方 updater 自动下载并安装
- 安装完成后，应用会自动重启
- 如果没有静态更新源，则提示“未配置可用更新源”

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
