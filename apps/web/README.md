# apps/web

Web 主入口（React）。

## 已初始化

- 已接入 `aries_react` 作为 UI 基础。
- `aries_react` 通过本地链接依赖接入（`link:/Users/yoho/code/client/aries_react`）。
- Vite 已配置本地别名到 `aries_react/dist`，避免源码包入口与主题资源解析冲突。
- 已建立页面规范目录结构：`routes.ts`、`context.ts`、`provider.tsx`、`layout.tsx`、`types.ts`、`hooks/`、`components/`、`widgets/`。
- 已落地平台主入口布局（左菜单 + 右内容）。
- 已实现两个智能体页面骨架：
  - 代码智能体：会话区、输入区、预览区、资产约束面板。
  - 三维模型智能体：任务提交、任务列表、模型查看器占位。

## 下一步

- 接入登录态、授权与订阅接口。
- 将代码智能体对接后端 sandbox，自动下发预览地址。
- 将三维智能体接入真实任务编排与模型结果流。
