import { AriButton, AriCallout, AriContainer, AriTypography } from "aries_react";
import { useState } from "react";
import type { ModelTask } from "../types";

const initialTasks: ModelTask[] = [
  {
    id: "t1",
    prompt: "A futuristic drone with hard-surface details",
    status: "queued",
    createdAt: "2026-02-07 17:30"
  }
];

function nextStatus(status: ModelTask["status"]): ModelTask["status"] {
  if (status === "queued") return "running";
  if (status === "running") return "success";
  return status;
}

// 描述:
//
//   - 渲染模型智能体 Web 页面，提供任务创建、状态推进与查看器占位。
export function ModelAgentPage() {
  const [tasks, setTasks] = useState<ModelTask[]>(initialTasks);
  const [prompt, setPrompt] = useState("");

  const submitTask = () => {
    const text = prompt.trim();
    if (!text) return;
    setTasks((prev) => [
      {
        id: `task-${Date.now()}`,
        prompt: text,
        status: "queued",
        createdAt: new Date().toISOString().slice(0, 16).replace("T", " ")
      },
      ...prev
    ]);
    setPrompt("");
  };

  const progressTask = (id: string) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, status: nextStatus(task.status) } : task)));
  };

  return (
    <AriContainer className="web-page">
      <AriTypography className="web-page-title" variant="h2" value="三维模型智能体" />
      <AriCallout type="tip" title="端能力差异">
        Web 端当前用于任务提交和结果展示；Desktop 端后续补充 Blender 与 ZBrush 联动操作。
      </AriCallout>

      <div className="web-model-layout">
        <div className="web-panel">
          <AriTypography className="web-page-title" variant="h3" value="任务创建" />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入建模需求描述..."
            className="web-form-field textarea"
          />
          <div className="web-inline-row end">
            <AriButton color="primary" label="提交任务" onClick={submitTask} />
          </div>

          <AriTypography variant="h3" value="任务列表" />
          <div className="web-assets-list">
            {tasks.map((task) => (
              <div key={task.id} className="web-asset-card">
                <AriTypography variant="h4" value={task.prompt} />
                <AriTypography variant="caption" value={task.createdAt} />
                <div className="web-inline-row between">
                  <AriTypography variant="caption" value={`状态：${task.status}`} />
                  <AriButton
                    size="sm"
                    type="default"
                    label="推进状态"
                    onClick={() => progressTask(task.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="web-panel">
          <AriTypography className="web-page-title" variant="h3" value="模型查看器" />
          <div className="web-viewer-placeholder">
            <AriTypography variant="caption" value="WebGL Viewer 占位（后续接 glb/fbx/obj）" />
          </div>
        </div>
      </div>
    </AriContainer>
  );
}
