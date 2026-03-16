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

如果你直接在 Windows PowerShell 或 CMD 中调用脚本，请使用：

```powershell
scripts\package-desktop-release.cmd 0.1.1
```

它会：

- 校验 Desktop 版本号是否一致
- 生成或复用官方 signer key
- 从构建机本地 `~/.tauri/libra-desktop-updater.key.pub` 注入 updater 公钥
- 执行 `tauri build`
- 产出完整安装包和 updater 热更新产物
- 自动整理成 `releases/<version>/<platform>/` 上传目录

它不会：

- 自动生成 `latest.json`
- 自动上传到远端服务器
- 自动把真实 updater 公钥写回仓库
- 自动修改线上更新清单

所以发布顺序应该是：

1. 在 `source` 中更新 Desktop 版本
2. 在构建主机执行打包脚本
3. 将 `releases/<version>/macos/` 整个目录复制到服务器 `downloads/<version>/` 下
4. 其中 `.dmg` 供首次下载安装，`.app.tar.gz + .sig` 供 App 内热更新
5. 手工更新服务器上的 `latest.json`

## 从零开始的 macOS 正式打包（API Key 方案）

下面这套流程假设你当前还没有可用于外部分发的 Apple 开发者账号，并且希望按 Apple 官方推荐链路完成：

- `Developer ID Application` 签名
- Apple notarization
- Tauri updater `.app.tar.gz + .sig`

先说明当前仓库的边界：

- 默认 Bundle ID：`com.libra.zodileap.desktop`
- 官方打包仍会自动读取本地 `apps/desktop/src-tauri/tauri.local.conf.json`
- Apple 证书、API Key、updater 私钥、公钥、密码都只保留在本机构建机
- 仓库 tracked 文件中的 updater 公钥默认留空，不再保存真实值

### 1. 先准备 Apple 账号和会员

如果你还没有正式账号，先做这几件事：

1. 注册一个 Apple Account，并开启双重认证。
2. 加入 Apple Developer Program。
3. 如果你是组织账号，提前准备：
   - 法人主体
   - `D-U-N-S Number`
   - 企业域名邮箱
   - 可公开访问的公司网站
4. 如果你不是 `Account Holder`，先确认团队里谁能操作下面两件事：
   - 创建 `Developer ID Application` 证书
   - 创建 App Store Connect `Team Keys`

对当前仓库这类“站外下载 + notarization”的 macOS 分发，免费 Apple 账号不够，必须使用 Apple Developer Program 会员。

### 2. 在 Apple 后台注册正式 App ID

当前仓库对外默认 Bundle ID 是：

```text
com.libra.zodileap.desktop
```

在 Apple Developer 后台注册时也必须使用同一个值：

1. 打开 `Certificates, Identifiers & Profiles`
2. 进入 `Identifiers`
3. 点击 `+`
4. 选择 `App IDs`
5. 选择 `Explicit App ID`
6. 在 `Bundle ID` 中填写 `com.libra.zodileap.desktop`

如果这里填了别的值，后面的签名、notarization 和更新链路都会对不上。

### 3. 准备本地仓库配置

当前仓库默认 `tauri.conf.json` 已经是官方 Bundle ID：

```text
com.libra.zodileap.desktop
```

如果你希望官方打包流程仍然显式走本地覆盖，可在本机创建：

```text
apps/desktop/src-tauri/tauri.local.conf.json
```

示例：

```json
{
  "identifier": "com.libra.zodileap.desktop"
}
```

说明：

- 这个文件已在 `.gitignore` 中
- 官方打包脚本会自动合并它
- fork 用户也可以在这里改成自己的 Bundle ID，而不需要改 tracked 文件

### 4. 在真实 Mac 上生成 CSR

必须在真实 macOS 机器上操作：

1. 打开 `Keychain Access`
2. 进入 `Keychain Access > Certificate Assistant > Request a Certificate from a Certificate Authority`
3. 填写：
   - `User Email Address`：你的开发者邮箱
   - `Common Name`：自定义名字，例如 `Libra Desktop Developer ID`
   - `CA Email Address`：留空
4. 选择 `Saved to disk`
5. 导出 `.certSigningRequest`

CSR 对应的私钥会留在当前这台 Mac 的钥匙串中。只要后面下载的 `.cer` 也安装在同一台机器上，就不需要额外导出 `.p12` 才能本机签名。

注意：

- `CA Email Address` 保持留空
- 如果表单提示该项必填，通常是当前没有切到 `Saved to disk`
- 同一台 Mac 上完成 `CSR -> 下载 .cer -> 安装 .cer` 时，本机签名不需要先导出 `.p12`

### 5. 申请 Developer ID 证书

回到 Apple Developer 后台：

1. 打开 `Certificates`
2. 点击 `+`
3. 选择 `Developer ID`
4. 选择 `Developer ID Application`
5. 上传刚才导出的 `.certSigningRequest`
6. 下载 `.cer`
7. 双击 `.cer` 安装到 Keychain

如果你将来要分发 `.pkg` 安装包，再额外申请 `Developer ID Installer`。当前仓库默认发布 `.dmg`，所以 `Developer ID Application` 就够了。

安装完成后，可用下面命令确认签名身份是否存在：

```bash
security find-identity -v -p codesigning
```

你应该能看到类似：

```text
Developer ID Application: <Your Name Or Company> (<TEAM_ID>)
```

如果你以后要在另一台 Mac 或 CI 上签名，再从这台机器的 Keychain 导出 `.p12`。当前“同机申请、同机打包”的场景可以先不做。

### 6. 创建 App Store Connect API Key

notarization 推荐使用 App Store Connect API，而不是 Apple ID + app-specific password。

在 App Store Connect 中：

1. 打开 `Users and Access`
2. 进入 `Integrations`
3. 打开 `Team Keys`
4. 生成新的 API Key
5. 下载 `.p8` 私钥文件

这里会得到 3 个关键值：

- `Issuer ID`
- `Key ID`
- `.p8` 私钥文件

注意：`.p8` 只能下载一次，丢了就需要重新生成。

### 7. 在本机构建机保存本地签名材料

这个仓库现在已经改成：

- updater 私钥：本地
- updater 公钥：本地
- Apple notarization 凭据：本地
- 仓库 tracked 文件中不再保存真实 updater 公钥

建议本地目录约定如下：

```text
$HOME/.private_keys/AuthKey_<KEY_ID>.p8
$HOME/.tauri/libra-desktop-updater.key
$HOME/.tauri/libra-desktop-updater.key.pub
```

你还可以先把 API Key 文件权限收紧：

```bash
mkdir -p "$HOME/.private_keys"
chmod 700 "$HOME/.private_keys"
chmod 600 "$HOME/.private_keys/AuthKey_<KEY_ID>.p8"
```

如果你需要确认 Apple 证书已经在本机 Keychain 中就绪，可运行：

```bash
security find-identity -v -p codesigning
```

如果你还没有 updater key，可在本机构建机生成：

```bash
pnpm --dir /Users/yoho/code/zodileap-agen/apps/desktop exec tauri signer generate \
  --ci \
  -w "$HOME/.tauri/libra-desktop-updater.key" \
  -p '请改成你自己的强密码'
```

这条命令会生成：

- `~/.tauri/libra-desktop-updater.key`
- `~/.tauri/libra-desktop-updater.key.pub`

当前仓库的打包脚本会自动读取这两个本地文件，不需要把真实公钥写回 `git`。

### 8. 导出本地打包所需环境变量

推荐 API Key 方案最少需要这些：

```bash
export APPLE_SIGNING_IDENTITY='Developer ID Application: <Your Name Or Company> (<TEAM_ID>)'
export APPLE_API_ISSUER='<ISSUER_ID>'
export APPLE_API_KEY='<KEY_ID>'
export APPLE_API_KEY_PATH="$HOME/.private_keys/AuthKey_<KEY_ID>.p8"
export TAURI_UPDATER_PRIVATE_KEY_PASSWORD='你的 updater 私钥密码'
```

可选：

```bash
export APPLE_TEAM_ID='<TEAM_ID>'
export TAURI_UPDATER_PRIVATE_KEY_PATH="$HOME/.tauri/libra-desktop-updater.key"
export TAURI_UPDATER_PUBLIC_KEY_PATH="$HOME/.tauri/libra-desktop-updater.key.pub"
```

两个常见坑：

- `APPLE_API_KEY_PATH` 不要写成 `'~/.private_keys/...'`；单引号里的 `~` 不会展开
- `TAURI_UPDATER_PRIVATE_KEY_PASSWORD` 必须和生成 `.key` 时使用的密码一致；丢失后只能轮换新 key

当前仓库的读取逻辑是：

- `scripts/run-desktop-tauri.mjs` 会读取本地 `.key/.pub`
- `scripts/package-desktop-release.mjs` 会校验 Apple API Key notarization 环境
- Rust 运行时会优先使用构建时注入的本地 updater 公钥

### 9. 本仓库的 macOS 打包命令

只验证本地构建是否通过：

```bash
pnpm -C /Users/yoho/code/zodileap-agen/apps/desktop build
```

走正式发布脚本并同步版本号：

```bash
pnpm run release:desktop -- 0.1.1
```

当前仓库会自动完成：

- 读取本地 `tauri.local.conf.json`
- 读取本地 `~/.tauri/libra-desktop-updater.key.pub`
- 将本地 updater 公钥以临时 config 注入 Tauri
- 使用 Apple API Key 完成 notarization
- 产出 `.dmg`、`.app.tar.gz`、`.app.tar.gz.sig`

如果你想单独确认官方脚本已经吃到了本地覆盖文件，可以先观察构建输出中是否出现：

- `Using local Tauri config overrides:`
- `Using local updater public key source:`

脚本现在只会在日志里打印 `[set]` / `[not set]` 这类状态，不会直接回显 Apple 凭据或本地密钥路径。

### 10. 打包完成后的验收命令

建议至少验证下面 3 项：

```bash
codesign -dv --verbose=4 /path/to/Libra.app
spctl -a -vv /path/to/Libra.app
xcrun stapler validate /path/to/Libra.app
```

预期结果：

- `Identifier=com.libra.zodileap.desktop`
- `codesign` 输出中能看到 `Developer ID` 证书链
- `codesign` / `stapler` 能确认公证票据已经随产物附着
- `spctl` 输出里包含 `source=Notarized Developer ID`

如果 `codesign` 已经正常但 `xcrun stapler validate` 失败，优先排查：

- `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` 是否对当前 shell 生效
- `.p8` 文件路径是否真实存在
- 证书 identity 是否就是 `security find-identity` 里显示的完整名称

### 11. 产物用途

当前仓库的 macOS 产物分工固定如下：

- `.dmg`：首次下载安装
- `.app.tar.gz`：应用内热更新包
- `.app.tar.gz.sig`：对应 updater 签名

如果 `.dmg` 成功但 `.sig` 没生成，通常说明：

- `TAURI_UPDATER_PRIVATE_KEY_PASSWORD` 错了
- 或者本地 `.key` / `.pub` 不是同一对

### 12. 当前仓库对公钥的约定

为了避免把真实 updater 公钥提交到开源仓库，当前实现已经改成：

- `apps/desktop/src-tauri/tauri.conf.json` 中的 `plugins.updater.pubkey` 默认为空字符串
- `apps/desktop/src-tauri/updater/public.key` 默认为空文件
- 真正参与构建和运行时验签的公钥只来自本地构建机

这意味着：

- 真实公钥不会出现在 git 里
- fork 用户可以用自己的 `.pub` 本地打包
- 官方构建机也只需要维护本机的 `.key/.pub`

如果你未来要把打包迁移到 CI，再补这两件事：

1. 把证书从 Keychain 导出成 `.p12`
2. 在 CI 里临时导入 keychain，并把 `.p8` 与 updater 私钥密码作为 secret 注入

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

## 参考

- Apple Developer Program 会员与分发能力：[Programs overview](https://developer.apple.com/help/account/membership/programs-overview)
- Apple 组织账号入驻要求：[Enrollment](https://developer.apple.com/support/enrollment/)
- Apple 注册 Explicit App ID：[Register an App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)
- Apple 生成 CSR：[Create a certificate signing request](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request)
- Apple Developer ID 证书：[Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
- App Store Connect API Key：[App Store Connect API](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api)
- Tauri macOS 签名与 notarization：[macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- Tauri updater 公钥与签名要求：[Updater](https://v2.tauri.app/plugin/updater/)
