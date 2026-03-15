# 代码智能体完善 TODO（新规划）

## 总目标

- 为代码项目建立“结构化项目信息（Project Profile）”，让 AI 能基于项目语义重建实现，而不是依赖现有代码翻译。
- 结构化项目信息是**项目级共享资产**，同一项目下所有话题共享并实时同步。
- 调整项目入口与设置交互：主区可直接进入项目设置，侧边栏项目 hover 操作更清晰。

## 约束与范围

- 当前迭代仅实现 `apps/desktop` 与相关 `core` / `src-tauri` 能力，不做 `apps/web` 功能开发。
- 不在用户项目目录写入 `.xxx` 元数据目录（避免污染项目代码）。
- 项目信息首版以本地持久化为主，云端同步作为后续增强。

---

## M1：项目信息存储架构定稿（P0）

### 任务

- [x] 明确存储策略：`本地 AppData（主） + 云端同步（可选后续）`。
- [x] 设计项目唯一标识策略（workspaceId + path hash + schemaVersion）。
- [x] 定义 `ProjectProfile` 数据模型（见 M2 字段）。
- [x] 制定并发更新策略（revision/version + last write wins 或乐观锁）。
- [x] 制定迁移策略（旧数据无 profile 时的降级与补齐）。

### 验收

- [x] 有明确文档说明“为何不写项目目录、为何首版不强依赖云端”。
- [x] 本地 profile 存储路径与键规则固定且可回放。

---

## M2：数据层与接口实现（P0）

### 任务

- [x] 在数据层新增 `ProjectProfile` 结构（项目级，不与话题绑定）。
- [x] 建立 profile 字段：
  - [x] `schemaVersion`
  - [x] `workspaceId`
  - [x] `revision`
  - [x] `updatedAt` / `updatedBy`
  - [x] `summary`
  - [x] `techStacks`（frontend/backend/db/infra）
  - [x] `architecture`（模块边界/目录职责/关键约束）
  - [x] `uiSpec`（页面结构语义，不绑定具体 UI 框架）
  - [x] `apiSpec`（接口契约与数据结构）
  - [x] `domainRules`（业务规则）
  - [x] `codingConventions`（命名/风格/测试要求）
- [x] 提供统一 API：
  - [x] `getProjectProfile(workspaceId)`
  - [x] `upsertProjectProfile(workspaceId, payload)`
  - [x] `patchProjectProfile(workspaceId, patch)`
  - [x] `bootstrapProjectProfile(workspaceId)`
- [x] 在 `CodeWorkspaceGroup` 与 `ProjectProfile` 建立关联读取入口。

### 验收

- [x] 不同会话读取同一 `workspaceId` 可拿到同一份 profile。
- [x] 更新 profile 后 revision 递增，旧版本写入可识别冲突。

---

## M3：项目创建与预初始化（P0）

### 任务

- [x] 本地文件夹创建项目成功后，自动触发 `bootstrapProjectProfile`。
- [x] Git 克隆创建项目成功后，自动触发 `bootstrapProjectProfile`。
- [x] 如果是已存在项目（路径已命中），补齐“缺失 profile”并跳过重复初始化。
- [x] 初始化内容包括：
  - [x] 基础语言/框架识别
  - [x] 包管理器与构建工具识别
  - [x] 目录结构摘要
  - [x] 初始模块边界草稿
- [x] 提供“重新生成项目信息”入口（手动触发）。

### 决策

- [x] 初始化能力归类为“内置系统能力”，不作为 workflow/skill。

### 验收

- [x] 新建项目后，不进设置页也能拿到基础 profile。
- [x] 已存在项目重复接入不会重复污染与重复生成。

---

## M4：UI 入口与交互改造（P0）

### 任务

- [x] Main 区增加“进入项目设置（项目信息）”入口，行为与“更多 -> 编辑”一致。
- [x] 侧边栏项目 hover 操作调整为三按钮：
  - [x] `更多`
  - [x] `设置`（新，位于更多与编辑之间）
  - [x] `编辑`（保留为“在项目内新增话题”）
- [x] 将“更多 -> 编辑”移出菜单，改由独立“设置”按钮承载。
- [x] 项目设置页新增“结构化项目信息”区块，放在“依赖规范”下方：
  - [x] 分区表单模式（推荐）
  - [x] JSON 高级模式（可选）
  - [x] 自动保存与保存状态反馈

### 验收

- [x] 不通过更多菜单，也可从主区直接进入项目设置。
- [x] hover 操作顺序与位置符合：更多 / 设置 / 编辑。

---

## M5：跨话题共享与同步一致性（P0）

### 任务

- [x] 建立 `project_profile_updated` 广播事件。
- [x] 会话页监听项目 profile 更新并刷新上下文缓存。
- [x] 同项目下任一话题更新 profile，其他话题即时同步。
- [x] 处理并发更新冲突提示（最少提示“已被其他会话更新，请刷新后重试”）。

### 验收

- [x] 两个会话窗口同时打开同一项目，A 更新后 B 在可接受时延内可见。
- [x] 不同项目互不串扰。

---

## M6：代码智能体接入与提示词增强（P1）

### 任务

- [x] Code Agent 执行前读取当前项目 `ProjectProfile`。
- [x] 将 profile 摘要注入 system/context prompt，优先使用结构化信息。
- [x] 当用户需求涉及“框架替换但页面结构不变”时，优先依据 `uiSpec + architecture` 生成。
- [x] 增加 profile 缺失降级逻辑（回退到现有路径与依赖规则上下文）。

### 验收

- [x] 在“UI 框架替换”场景下，结果结构一致性优于直接代码翻译。
- [x] profile 缺失时不会阻断原有执行链路。

---

## 测试计划（必须）

### 数据与同步

- [x] 单测：ProjectProfile CRUD、revision 冲突、迁移逻辑。
- [x] 单测：bootstrap 初始化幂等性（重复执行不脏写）。
- [x] 单测：跨会话同步事件派发与消费。

### 前端交互

- [x] 单测：Main 入口可进入项目设置。
- [x] 单测：侧边栏 hover 三按钮顺序与行为。
- [x] 单测：设置页“依赖规范 + 结构化信息”展示与自动保存。

### 端到端

- [x] E2E：本地目录创建项目 -> 自动初始化 profile -> 会话可读取。
- [x] E2E：Git 创建项目 -> 自动初始化 profile -> 会话可读取。
- [x] E2E：会话 A 更新 profile -> 会话 B 同步。

---

## DoD（完成定义）

- [x] 结构化项目信息已成为项目级共享资产，且在多话题间保持一致。
- [x] 项目设置入口与侧边栏交互改造完成并通过回归测试。
- [x] 新建项目可自动预初始化 profile，且具备幂等性。
- [x] Code Agent 已接入 profile 上下文，关键场景（框架替换）效果可验证提升。
