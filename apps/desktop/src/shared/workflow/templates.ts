import { translateDesktopText } from "../i18n";
import type { AgentWorkflowDefinition } from "./types";

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
      version: 1,
      shared: false,
      agentKey: "agent",
      promptPrefix:
        translateDesktopText("你正在执行“前端项目开发”工作流：先完成需求分析和接口建模，再设计前端结构、实现页面并补齐测试。"),
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
            type: "skill",
            skillId: "requirements-analyst",
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
            type: "skill",
            skillId: "frontend-architect",
            x: 800,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-pages",
            title: translateDesktopText("页面实现"),
            description: translateDesktopText("根据需求和设计完成页面与交互"),
            instruction: translateDesktopText("先定义页面元素与菜单结构，再实现页面和交互细节。"),
            type: "skill",
            skillId: "frontend-page-builder",
            x: 1040,
            y: 160,
          },
          {
            id: "wf-agent-full-delivery-test",
            title: translateDesktopText("测试交付"),
            description: translateDesktopText("执行测试并整理交付结果"),
            instruction: translateDesktopText("执行单测或集成测试，并输出结果、风险和修复建议。"),
            type: "action",
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
