import { DEFAULT_MODEL_WORKFLOWS } from "./templates";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "./types";

const WORKFLOW_STORAGE_KEY = "zodileap.desktop.model.workflows";

function normalizeWorkflowNode(node: WorkflowNodeDefinition): WorkflowNodeDefinition {
  const nextNode: WorkflowNodeDefinition = {
    ...node,
    params: { ...(node.params || {}) },
  };

  if (nextNode.kind === "blender_refine_export") {
    if (typeof nextNode.name === "string") {
      nextNode.name = nextNode.name
        .replace("优化 + 导出", "DCC MCP 操作（按需导出）")
        .replace("自然语言优化（按需导出）", "DCC MCP 操作（导入/新建/编辑/按需导出）")
        .replace("直接优化（按需导出）", "DCC 直接操作（导入/新建/编辑/按需导出）");
    }
    if ("appendExportKeyword" in nextNode.params) {
      delete (nextNode.params as Record<string, unknown>).appendExportKeyword;
    }
  }

  return nextNode;
}

function normalizeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    nodes: (workflow.nodes || []).map(normalizeWorkflowNode),
  };
}

function readSavedWorkflows(): WorkflowDefinition[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(WORKFLOW_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item?.id && Array.isArray(item?.nodes))
      .map((item) => normalizeWorkflow(item as WorkflowDefinition));
  } catch (_err) {
    return [];
  }
}

function writeSavedWorkflows(workflows: WorkflowDefinition[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(workflows));
}

function cloneNodes(nodes: WorkflowNodeDefinition[]): WorkflowNodeDefinition[] {
  return nodes.map((node) => normalizeWorkflowNode(node));
}

export function listModelWorkflows(): WorkflowDefinition[] {
  const saved = readSavedWorkflows();
  const merged: WorkflowDefinition[] = [...DEFAULT_MODEL_WORKFLOWS.map((item) => ({ ...item, nodes: cloneNodes(item.nodes) }))];

  for (const workflow of saved) {
    const index = merged.findIndex((item) => item.id === workflow.id);
    if (index >= 0) {
      merged[index] = {
        ...workflow,
        nodes: cloneNodes(workflow.nodes || []),
      };
    } else {
      merged.push({
        ...workflow,
        nodes: cloneNodes(workflow.nodes || []),
      });
    }
  }

  return merged;
}

export function saveModelWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const all = listModelWorkflows();
  const next = all.map((item) =>
    item.id === workflow.id
      ? {
          ...workflow,
          nodes: cloneNodes(workflow.nodes),
        }
      : item
  );
  if (!next.some((item) => item.id === workflow.id)) {
    next.push({ ...workflow, nodes: cloneNodes(workflow.nodes) });
  }
  writeSavedWorkflows(next);
  return workflow;
}

export function createModelWorkflowFromTemplate(baseId?: string): WorkflowDefinition {
  const source = listModelWorkflows().find((item) => item.id === baseId) || listModelWorkflows()[0];
  const id = `wf-custom-${Date.now()}`;
  const workflow: WorkflowDefinition = {
    ...source,
    id,
    name: `${source.name}-副本`,
    version: source.version + 1,
    shared: false,
    nodes: cloneNodes(source.nodes),
  };
  saveModelWorkflow(workflow);
  return workflow;
}

export function copyModelWorkflow(workflowId: string): WorkflowDefinition {
  const source = listModelWorkflows().find((item) => item.id === workflowId);
  if (!source) {
    return createModelWorkflowFromTemplate();
  }
  return createModelWorkflowFromTemplate(source.id);
}

export function toggleShareModelWorkflow(workflowId: string): WorkflowDefinition | null {
  const all = listModelWorkflows();
  const target = all.find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }
  const nextTarget: WorkflowDefinition = {
    ...target,
    shared: !target.shared,
  };
  saveModelWorkflow(nextTarget);
  return nextTarget;
}

export function updateWorkflowNodeParams(
  workflowId: string,
  nodeId: string,
  params: Record<string, unknown>,
): WorkflowDefinition | null {
  const target = listModelWorkflows().find((item) => item.id === workflowId);
  if (!target) {
    return null;
  }

  const next: WorkflowDefinition = {
    ...target,
    version: target.version + 1,
    nodes: target.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            params: { ...params },
          }
        : node
    ),
  };

  saveModelWorkflow(next);
  return next;
}
