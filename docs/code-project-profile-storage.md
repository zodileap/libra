# 代码项目结构化信息存储策略（Desktop）

## 背景

代码智能体需要一份“与具体实现解耦”的项目结构化信息（Project Profile），用于在框架迁移、技术栈替换等场景下保持页面结构与业务语义稳定。

## 首版存储方案

- 主存储：Desktop 本地存储（`localStorage`）
  - 键：`zodileap.desktop.code.workspace.profiles`
  - 结构：`workspaceId -> ProjectProfile`
- 唯一签名：`workspaceId + workspacePathHash + schemaVersion`
- 版本控制：`revision` 乐观并发控制
  - 写入时可带 `expectedRevision`
  - 版本不一致返回冲突，前端提示刷新后重试

## 为什么不写入项目目录

- 避免污染用户仓库，防止额外 `.xxx` 元数据文件进入 Git 历史。
- 避免跨团队协作时出现“工具元文件冲突”。
- 避免在只读目录、受限目录或远程挂载目录中出现写入失败问题。
- Project Profile 属于智能体运行时资产，不应强绑定到业务代码仓库生命周期。

## 为什么首版不强依赖云端

- Desktop 离线可用是基础能力，本地优先可以保证初始化和会话执行不依赖网络。
- 云端同步涉及账号、权限、冲突归并与隐私治理，属于增强能力，不应阻塞首版交付。
- 先通过本地 `revision + 广播同步` 验证数据模型与交互，再平滑扩展云端增量同步。

## 初始化与迁移

- 新建项目（本地目录 / Git 克隆）后立即创建基础 Profile。
- 若命中已存在项目且缺失 Profile，则自动补齐（幂等）。
- 当字段演进时通过 `schemaVersion` 进行向后兼容与增量迁移。
