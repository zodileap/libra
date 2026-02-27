# 全局规范

- 当进行回答的时候，默认使用中文。
- Desktop 与 Web 的样式值（颜色、间距、尺寸、圆角、阴影、透明度等）禁止硬编码，必须优先引用 `aries_react` 在 `:root` 中提供的 `--z-*` 变量，确保主题与 Light/Dark 可自适应。
- 若当前变量体系不存在所需样式值，先在 `aries_react` 中补齐变量，再在业务项目中引用，禁止直接写死。
- 代码都要有注释，包括函数、方法、类、接口、复杂逻辑等，注释规范见下文“文档规范”部分。
- 代码迭代，应该都要有单元测试，只有测试通过才算完成，测试规范见下文“测试规范”部分。
- 前端禁止使用 `window.alert`，错误提示与确认交互必须使用 `aries_react` 组件（如 `AriModal`、`AriMessage`）。
- 前端调用 API 的错误提示必须做“用户友好化”映射，禁止直接展示后端原始错误码、原始报错文本或技术细节。
- 前端 JSX 布局实现中，除非 `aries_react` 现有布局组件无法满足，否则禁止使用原生 `div`；优先使用 `AriContainer`、`AriFlex` 等布局组件。
- 前端导航菜单（尤其是侧边栏多级菜单）必须优先使用 `aries_react` 的 `AriMenu`（通过 `items.children` 实现层级）；除非 `AriMenu` 能力明确不满足，否则禁止自定义容器/按钮拼装树形菜单。
- 前端通用组件（`widgets`/`components` 下的可复用层）禁止写入具体业务逻辑（如 code/model 分支、业务 API、业务文案、业务状态流转）；通用层仅保留展示骨架与通用交互，业务能力必须由各模块页面（如 `modules/code`、`modules/model`）通过 props/context/配置注入。
- 严禁编造信息或“先写后证实”。凡是变量名、组件能力、接口字段、命令结果等事实性内容，必须先在仓库内检索验证，再使用。
- 涉及样式变量（`--z-*`）时，必须先确认变量真实存在于当前依赖产物/源码；无法验证时应明确说明“不确定”，禁止猜测写入。

## 当前迭代约束
- worktree 提交时，不提交以下文件改动：`todo.md`。
- 当前迭代，对于apps,不对 `apps/web` 进行功能实现，研发集中在 `apps/desktop`。

## Git规范

### 对于版本号

- 采用三段式版本：`Major.Minor.Patch`。

### 对于 commit

- 提交说明结构：
  `<type>[optional scope]: <description>`
  `[optional body]`
  `[optional footer(s)]`
- 多标签格式（当涉及多个变更类型时）：
  `<type1>[optional scope]: <description1>`
  `<type2>[optional scope]: <description2>`
  `[optional body]`
  `[optional footer(s)]`

### 核心提交类型

- `major`：重大更新或架构变更。
  版本变更：Major（`X.0.0`）。
  适用场景：不兼容的 API 变更、大规模重构。
  使用 `major` 时，必须在正文或脚注中说明：
  `BREAKING CHANGE: <详细描述不兼容的变更>`。
- `feat`：新增功能或模块。
  版本变更：Minor（`0.X.0`）。
  适用场景：新增完整功能、模块或组件。
- `update`：现有功能的微小更新或调整。
  版本变更：Patch（`0.0.X`）。
  适用场景：参数调整、配置更新、文案修改、或不涉及大规模结构变化的小改进。
- `fix`：缺陷修复。
  版本变更：Patch（`0.0.X`）。
  适用场景：修复 bug、解决已知问题。
- `perf`：性能优化。
  版本变更：Patch（`0.0.X`）。
  适用场景：提升性能的代码更改。
- `refactor`：代码重构。
  版本变更：Patch（`0.0.X`）。
  适用场景：既不修复 bug 也不新增功能的结构优化。
- `build`：构建系统变更。
  版本变更：Patch（`0.0.X`）。
  适用场景：构建系统或外部依赖项调整。

### 辅助提交类型（不影响版本号）

- `docs`：文档更新。
- `style`：代码风格调整（不影响功能）。
- `test`：测试相关变更。
- `ci`：CI 配置变更。
- `chore`：杂项变更（不修改 src 或 test 的其他变更）。
- `revert`：代码回退（特殊处理）。

### 提交信息格式要求

- 必须使用中文描述。
- 严格遵循约定式提交规范格式。
- 不添加额外签名信息（如工具生成标识）。
- 提交信息简洁明了，准确反映变更内容。
- 支持多个标签：一次提交涉及多个变更类型时可使用多标签。
- 提交信息末尾不要署名。

## 文档规范

### 总体说明

- 文档注释标签均为可选。
- 注释必须以“描述”开头，开头不要添加函数、方法、属性等名称。
- 每个标签的内容之间空一行。
- 描述部分要详细说明作用；若是函数/方法注释，需要说明函数具体做了哪些事情。

### 标签

- `Params:` 参数标签。
  示例：
  `// Params:`
  `//`
  `//   - path: 文件路径。`
  `//   - b: 文件内容。`
- `default:` 参数默认值标签。
  示例：
  `// Params:`
  `//`
  `//   - path: 文件夹路径。`
  `//     default: 111`
- `Returns:` 返回值标签。
  示例：
  `// Returns:`
  `//`
  `//   0: 成功。`
- `Example:` 示例代码标签。
- `ExamplePath:` 示例代码在 git 上的路径标签。
  示例：
  `// ExamplePath: taurus_go_demo/asset/asset_test.go`
- `ErrCodes:` 错误码标签（用于函数或方法注释）。
  示例：
  `// ErrCodes:`
  `//   - Err_0200010001`
  `//   - Err_0200010002`
- `Verbs:` 错误码参数值注释标签（用于错误码注释）。
- `Extends:` 继承来源标记。
  示例：
  `Extends [AriContainer]`
  `Extends {@link AriContainer}`

# Web 模块（React）

- 硬性规定：Web 端使用 `aries_react` 作为 UI 组件基础，不使用第三方 UI 库。
- 使用 React hooks 时遵循最佳开发实践。
- 页面应按以下结构组织：
  `routes.ts`、`context.ts`、`provider.tsx`、`layout.tsx`、`types.ts`、`hooks/`、`components/`、`widgets/`。
- `context.ts` 只定义 Context 和 hooks，不写 JSX，不定义组件。
- `provider.tsx` 统一承载状态管理、hooks 调用、路由解析和 i18n 注入。
- i18n 必须在 provider 中统一注册，并通过 context 向下游注入。
- 不要把 hook 返回值拆散后再注入 context，应整体注入以保证一致性。
- 页面路由必须懒加载，并通过 `t` 函数提供路由标题等文案。
- 类型统一放在 `types.ts` 中，命名与页面名称保持一致。
- 页面布局写在 `layout.tsx`，页面主体由 layout 组合。
- 编写实现时需保持与现有模块风格一致。
- 使用 `aries_react` 组件前必须先查看对应 props 类型定义再编码。
- 若 `aries_react` 不能满足业务需求，可直接修改 `aries_react`。
- 每次修改 `aries_react` 后必须同步更新本地包：
  1. 进入 `aries_react` 包目录。
  2. 执行 `pnpm build`。
  3. 执行 `yalc push`。

# Desktop 模块（Tauri）

- 客户端采用 Tauri，目标平台为 macOS 和 Windows。
- 在 `client` 下创建 `aries_tauri` UI 包。
- 当前阶段不全量复制 `aries_react`，先完成基础框架。
- 仅当 Web 端实际使用到 `aries_react` 的组件时，才在 `aries_tauri` 中按需复刻。
- Desktop 的 UI 视觉和交互尽量与 Web 保持一致。

# 服务模块（Go）

- 服务目录分为 `entity` 与 `api` 两个子目录。

## Entity（DAO）

- Go 版本要求：`>= 1.24.0`。
- Entity 是数据库实体项目，实体以 schema 为唯一修改入口。
- 项目内实体目录为 `services/entity/v1`，整体设计与 `go/dao/entity/v1` 保持一致。
- 生成 schema 时在目标目录执行：
  `go run github.com/zodileap/taurus_go/entity/cmd new`
  例如: `go run github.com/zodileap/taurus_go/entity/cmd new User Permission -e Address,Blog -t "."`
- 每个 schema 生成后先完善字段与约束，再统一生成服务基础代码。
- 在 `services/entity` 根目录维护 `generate.sh`，通过该脚本向对应服务生成默认代码。
- 优先使用 zspecs 中已有的实体类型（优先 `E` 结尾类型）。
- 表实体命名以 `xxEntity` 结尾；关联表以 `Rel` 开头。
- 实体属性与表字段优先使用指针类型。
- 命名使用驼峰风格。
- 禁止使用关系定义（禁止关系建模）。
- 每张表必须包含至少一个主键，默认主键名为 `Id`。
- 每张表必须包含 `CreatedAt`、`LastAt`、`DeletedAt` 三个字段，并按统一默认值与精度配置。
- 每个字段都必须有 Comment，结构体字段注释与字段 Comment 必须语义一致。
- Entity `Config` 中 `Comment` 必填，内容简短、直接描述实体本身（如“用户基本信息”）。
- Entity（DAO）主要基于 `git.zodileap.com/taurus` 体系构建。

## API

- Go 版本要求：`>= 1.24.0`。
- `api_mate` 与其他服务模块统一遵循同一服务开发规范。
- 服务目录按分层组织：`api/v1`、`service/v1`、`specs/v1`、`configs`、`cmd` 等。
- API 层必须使用 `WithGet`、`WithPost`、`WithPut`、`WithDelete` 包裹，并通过 `init.go` 注册路由映射。
- Service 层必须使用 `WithService`，模块实现优先复用 `base_service.go` 能力。
- 仅使用内部 Go 包体系（zodileap_go、taurus_go 及实体映射体系）。
- 实体字段访问使用函数调用形式，不使用 `.Get()`。
- RPC 包禁止依赖服务的 `specs` 包，避免循环引用。
- RPC 转换函数返回值统一遵循 `(data, error)`，且返回实体包真实存在的类型。
- RPC 层只负责基础类型转换，Service 层负责组装完整请求结构并执行业务调用。
- 所有函数返回值固定为两个：`(DataType, error)`。
- 返回错误时，`err != nil` 需使用 `zerr.Must(err)` 包裹后返回。
- 错误处理需要可定位（文件名、行号）且包含必要上下文，避免泄露敏感信息。
- 错误码需通过统一流程检查、创建和维护，避免重复或冲突。
- 初始化流程固定为：
  1. 通过 toolkit 初始化服务。
  2. 执行 Entity 的 `generate.sh` 生成基础代码。
  3. 在基础代码上补充业务实现。

# Core 模块（Rust）

- `core` 只是目录，不是单一 Cargo 包；目录下按能力拆分为可独立打包的多个包。
- `core/agent`：智能体核心编排能力（流程、激活码、模型调用网关等）。
- `core/mcp`：MCP 能力目录，至少包含 `common`、`code`、`model` 子包。
- `core/mcp/model` 与 `core/mcp/code` 必须支持独立构建与独立发布，按购买能力按需集成。
- `core/agent` 也需支持独立构建，可通过 feature 选择是否集成 `mcp` 子包。
- 模型智能体当前优先支持“当前已打开 Blender 会话”能力；通过 Blender 会话桥接脚本接入 MCP。


# 测试规范

- 所有新增功能或模块必须包含单元测试。
- 测试文件命名必须以 `_test` 结尾。
- 测试函数命名必须以 `Test` 开头。
- 每个测试函数必须包含明确的断言，确保功能正确性。
- 测试覆盖率应达到至少 80%。
- 测试代码必须遵循与生产代码相同的编码规范和注释要求。
- 测试应涵盖正常情况、边界情况和异常情况。
- 测试应该放在单独的文件中，不要和具体实现混在一起。
