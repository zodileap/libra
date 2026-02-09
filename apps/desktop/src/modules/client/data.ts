import type { AgentSession, AgentSummary, ShortcutItem } from "./types";

export const AGENTS: AgentSummary[] = [
  {
    key: "code",
    name: "代码智能体",
    description: "代码生成、重构与沙盒预览",
    hint: "Build AI apps"
  },
  {
    key: "model",
    name: "模型智能体",
    description: "三维模型生成与桌面软件联动",
    hint: "3D workflows"
  }
];

export const SHORTCUTS: ShortcutItem[] = [
  {
    id: "shortcut-build",
    title: "Build AI apps",
    description: "快速创建代码项目与页面框架"
  },
  {
    id: "shortcut-chat",
    title: "Chat with agents",
    description: "按约束资产进行多轮生成"
  },
  {
    id: "shortcut-usage",
    title: "Monitor usage",
    description: "查看智能体调用和订阅使用情况"
  }
];

export const AGENT_SESSIONS: AgentSession[] = [
  { id: "code-001", agentKey: "code", title: "React + aries_react 脚手架", updatedAt: "今天 09:40" },
  { id: "code-002", agentKey: "code", title: "权限后台页面重构", updatedAt: "昨天 21:15" },
  { id: "model-001", agentKey: "model", title: "机械臂材质方案", updatedAt: "今天 10:12" },
  { id: "model-002", agentKey: "model", title: "低模角色风格探索", updatedAt: "昨天 18:22" }
];
