import { AriCallout, AriContainer } from "aries_react";
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
    <AriContainer style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>三维模型智能体</h2>
      <AriCallout type="tip" title="端能力差异">
        Web 端当前用于任务提交和结果展示；Desktop 端后续补充 Blender 与 ZBrush 联动操作。
      </AriCallout>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>任务创建</h3>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入建模需求描述..."
            style={{ width: "100%", minHeight: 120, borderRadius: 8, border: "1px solid #d1d5db", padding: 10 }}
          />
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={submitTask} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #2f6fdd", background: "#2f6fdd", color: "#fff" }}>
              提交任务
            </button>
          </div>

          <h3>任务列表</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {tasks.map((task) => (
              <div key={task.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                <div style={{ fontWeight: 600 }}>{task.prompt}</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{task.createdAt}</div>
                <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>状态：{task.status}</span>
                  <button onClick={() => progressTask(task.id)} style={{ borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", padding: "4px 8px" }}>
                    推进状态
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>模型查看器</h3>
          <div style={{
            height: 420,
            border: "1px dashed #cbd5e1",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#64748b"
          }}>
            WebGL Viewer 占位（后续接 glb/fbx/obj）
          </div>
        </div>
      </div>
    </AriContainer>
  );
}
