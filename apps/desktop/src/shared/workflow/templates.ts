import { translateDesktopText } from "../i18n";
import type { AgentWorkflowDefinition } from "./types";

// 描述：
//
//   - 返回“需求分析”阶段内嵌到工作流中的执行说明，替代独立内置技能后仍能为阶段执行提供稳定约束。
//
// Returns:
//
//   - 需求分析阶段的内嵌说明文本。
function buildFrontendRequirementsStageContent(): string {
  return [
    "## 阶段目标",
    "- 把零散诉求整理成可执行规格，明确目标、范围、边界、依赖、风险和可验证验收标准。",
    "",
    "## 执行步骤",
    "1. 用一句话概括业务目标、目标用户和预期结果；若混入多个目标，先拆分。",
    "2. 明确本轮要做什么、不做什么、依赖什么，把隐含假设列为“待确认”。",
    "3. 输出功能拆解、用户路径、关键状态变化、输入输出、边界条件和异常场景。",
    "4. 为每个核心功能补齐可验证验收项，确保后续测试或人工检查都可落地。",
    "5. 单列风险、开放问题、依赖阻塞和需要用户确认的决策点。",
    "",
    "## 约束",
    "- 当前阶段只做分析，不执行 apply_patch、安装依赖、初始化项目、生成代码或创建过程文件。",
    "- 结论必须基于用户输入和仓库事实，不要把猜测写成确定结论。",
    "- 默认直接在会话中交付分析结果；只有用户明确要求导出时，才创建文档或文件。",
    "",
    "## 交付检查",
    "- 每个核心功能都要覆盖范围、边界、异常和验收项。",
    "- 明确指出仍未闭合的信息缺口，缺少关键约束时不要直接转入实现。",
  ].join("\n");
}

// 描述：
//
//   - 返回“前端架构”阶段内嵌到工作流中的执行说明，确保删除内置技能后仍能复用既有工程约束。
//
// Returns:
//
//   - 前端架构阶段的内嵌说明文本。
function buildFrontendArchitectureStageContent(): string {
  return [
    "## 阶段目标",
    "- 基于当前 Desktop 工程真实结构规划目录、模块边界、状态流、服务分层和实现约束。",
    "",
    "## 执行步骤",
    "1. 先检查现有页面、widgets、services、shared、routes 和 tests，不要脱离仓库现状重新发明结构。",
    "2. 明确页面层、业务组件层、服务层、共享层分别负责什么，以及依赖方向。",
    "3. 说明状态从哪里来、在哪里归一化、由谁触发更新、错误如何映射为用户友好文案。",
    "4. 把 i18n、样式 token、header slot、菜单层级、测试分层等约束写清楚。",
    "5. 输出可直接指导编码的目录建议、关键文件职责、接口边界和风险点。",
    "",
    "## 约束",
    "- 不要新建第二套前端体系、设计系统或无必要的抽象层。",
    "- 样式必须优先使用现有 --z-* 变量与 aries_react 组件能力，不能默认硬编码。",
    "- 通用组件层不能写入具体业务逻辑，业务能力必须由模块页面注入。",
    "- 涉及事实性内容前先检索仓库，不要编造目录、组件、接口或变量名。",
    "",
    "## 交付检查",
    "- 目录方案必须能映射到当前仓库真实结构。",
    "- 模块职责要单一，依赖方向要清晰，约束要覆盖布局、交互、样式和测试。",
  ].join("\n");
}

// 描述：
//
//   - 返回“页面实现”阶段内嵌到工作流中的执行说明，让工作流直接携带实现规范与交付检查点。
//
// Returns:
//
//   - 页面实现阶段的内嵌说明文本。
function buildFrontendPageImplementationStageContent(): string {
  return [
    "## 阶段目标",
    "- 在需求和结构明确后完成可运行页面、交互状态、错误提示与测试补齐。",
    "",
    "## 执行步骤",
    "1. 先确认页面挂载位置、可复用 widgets / services、是否需要 header slot、菜单或弹窗结构。",
    "2. 先完成页面骨架、主区域布局和响应式层级，再接入交互细节。",
    "3. 接好表单、按钮、异步加载、空态、错误态、成功反馈和状态流转。",
    "4. 页面只消费规范化后的服务层数据，不要把复杂业务逻辑塞进通用组件。",
    "5. 补齐最相关的测试，并执行测试、构建或运行验证后再结束当前阶段。",
    "",
    "## 约束",
    "- 用户可见文案必须接入 i18n，错误提示必须做用户友好化映射，禁止 window.alert。",
    "- main 区域 Header 必须挂到全局标题栏插槽，布局优先使用 AriContainer / AriFlex 等组件。",
    "- 样式优先走 aries_react 能力与 --z-* 变量，避免直接写死颜色、间距、尺寸。",
    "- 当前阶段必须产生至少一种运行验证证据，例如单测、构建、预览或真实交互校验。",
    "",
    "## 交付检查",
    "- Light / Dark、加载态、空态、错误态、禁用态和成功态都要覆盖。",
    "- 补齐测试、构建或运行验证后，再总结结果、风险和遗留问题。",
  ].join("\n");
}

// 描述：
//
//   - 返回内置工作流模板列表；模板文案按当前界面语言动态翻译，保证语言切换后新建/复制流程保持一致。
//
// Returns:
//
//   - 当前语言下的内置工作流模板列表。
export function resolveDefaultAgentWorkflows(): AgentWorkflowDefinition[] {
  return [
    {
      id: "wf-agent-full-delivery-v1",
      name: translateDesktopText("前端项目开发"),
      description: translateDesktopText("需求分析 -> 接口建模 -> 前端架构 -> 页面实现 -> 测试交付"),
      version: 2,
      shared: false,
      agentKey: "agent",
      promptPrefix:
        translateDesktopText("你正在执行“前端项目开发”工作流：先完成需求分析和接口建模，再按工作流内嵌规范设计前端结构、实现页面，并在测试交付阶段使用技能完成验证。"),
      graph: {
        nodes: [
          {
            id: "wf-agent-full-delivery-start",
            title: translateDesktopText("开始"),
            description: translateDesktopText("接收项目需求并初始化上下文"),
            instruction: "",
            type: "start",
            x: 80,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-requirements",
            title: translateDesktopText("需求分析"),
            description: translateDesktopText("拆解目标、范围和验收标准"),
            instruction: translateDesktopText("先输出需求拆解、边界条件与可验证的验收标准。"),
            content: buildFrontendRequirementsStageContent(),
            type: "action",
            x: 320,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-openapi-model",
            title: translateDesktopText("接口建模"),
            description: translateDesktopText("整理前后端交互模型并维护项目内 OpenAPI 契约"),
            instruction: translateDesktopText("先定义实体、请求模型、响应模型，再写入或更新当前项目的 OpenAPI 文件；文件路径与文件名应基于当前项目或模块语义确定，不要假设固定业务名称。"),
            type: "skill",
            skillId: "openapi-model-designer",
            x: 560,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-frontend-structure",
            title: translateDesktopText("前端架构"),
            description: translateDesktopText("定义前端目录结构与模块边界"),
            instruction: translateDesktopText("输出前端代码结构、模块边界与实现约束。"),
            content: buildFrontendArchitectureStageContent(),
            type: "action",
            x: 800,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-pages",
            title: translateDesktopText("页面实现"),
            description: translateDesktopText("根据需求和设计完成页面与交互"),
            instruction: translateDesktopText("先定义页面元素与菜单结构，再实现页面和交互细节。"),
            content: buildFrontendPageImplementationStageContent(),
            type: "action",
            x: 1040,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-test",
            title: translateDesktopText("测试交付"),
            description: translateDesktopText("执行测试并整理交付结果"),
            instruction: translateDesktopText("先执行与改动相关的单元测试、构建或 lint；涉及页面交互时，再按 Playwright Interactive 运行约束完成真实界面验证，最后输出结果、风险和修复建议。"),
            type: "skill",
            skillId: "playwright-interactive",
            skillVersion: "1.0.0",
            x: 1280,
            y: 160,
          },
        ],
        edges: [
          {
            id: "wf-agent-full-delivery-edge-start-requirements",
            sourceId: "wf-agent-full-delivery-start",
            targetId: "wf-agent-full-delivery-requirements",
            type: "default",
          },
          {
            id: "wf-agent-full-delivery-edge-requirements-openapi-model",
            sourceId: "wf-agent-full-delivery-requirements",
            targetId: "wf-agent-full-delivery-openapi-model",
            type: "default",
          },
          {
            id: "wf-agent-full-delivery-edge-openapi-model-frontend-structure",
            sourceId: "wf-agent-full-delivery-openapi-model",
            targetId: "wf-agent-full-delivery-frontend-structure",
            type: "default",
          },
          {
            id: "wf-agent-full-delivery-edge-frontend-structure-pages",
            sourceId: "wf-agent-full-delivery-frontend-structure",
            targetId: "wf-agent-full-delivery-pages",
            type: "default",
          },
          {
            id: "wf-agent-full-delivery-edge-pages-test",
            sourceId: "wf-agent-full-delivery-pages",
            targetId: "wf-agent-full-delivery-test",
            type: "default",
          },
        ],
      },
    },
  ];
}
