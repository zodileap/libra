# Desktop × Blender 版本矩阵（验收基线）

## 1. 目的

- 统一 Desktop 端模型智能体在不同平台与 Blender 版本下的验收口径。
- 覆盖当前主线能力：Bridge 连通、选择集感知、复杂材质、复杂几何、导出流程。

## 2. 验收矩阵

| 平台 | Desktop 构建 | Blender 版本 | Bridge 插件版本 | 验收状态 |
| --- | --- | --- | --- | --- |
| macOS 14+ (Apple Silicon) | `apps/desktop` 当前主分支 | 4.2.x LTS | `zodileap_mcp_bridge 0.2.x` | 待验收 |
| macOS 14+ (Apple Silicon) | `apps/desktop` 当前主分支 | 5.0.x | `zodileap_mcp_bridge 0.2.x` | 待验收 |
| Windows 11 (x64) | `apps/desktop` 当前主分支 | 4.2.x LTS | `zodileap_mcp_bridge 0.2.x` | 待验收 |
| Windows 11 (x64) | `apps/desktop` 当前主分支 | 5.0.x | `zodileap_mcp_bridge 0.2.x` | 待验收 |

## 3. 每格必测项

- Bridge 生命周期：预检失败 -> 自动拉起 -> 恢复成功 -> 最终失败。
- 选择集语义：`active`/`selected`/`all`、`target_names` 过滤、空选择兜底提示。
- 材质流程：多通道贴图（BaseColor/Normal/Roughness/Metallic）、路径修复、打包贴图。
- 几何流程：修改器链（Solidify/Bevel/Mirror/Array/Decimate）与布尔链（多目标、顺序、失败回滚）。
- 文件流程：新建/打开/保存/导出输出路径规则（项目名+时间戳+平台兼容文件名）。
- Trace 与 UI Hint：步骤数据、错误分类和用户友好提示一致。

## 4. 通过标准

- 核心测试脚本执行通过，无崩溃、无阻塞、无静默失败。
- 失败场景可恢复，且 `trace` 中可定位失败步骤与错误分类。
- 同一指令在同版本环境下结果可复现（步骤序列与关键字段一致）。
