import { useEffect, useRef, useState } from "react";
import { AriButton, AriCard, AriContainer, AriMessage, AriTypography } from "aries_react";

// 描述:
//
//   - 定义 Dev 调试浮窗组件入参。
interface DevDebugFloatProps {
  visible?: boolean;
}

// 描述:
//
//   - 定义会话调试快照结构，统一承载前端调试窗口展示数据。
interface SessionDebugSnapshot {
  sessionId?: string;
}

// 描述：
//
//   - 定义会话复制结果事件结构，供 Dev 调试窗口反馈复制结果。
interface SessionCopyResultPayload {
  sessionId?: string;
  ok?: boolean;
  message?: string;
  timestamp?: number;
}

// 描述:
//
//   - 在开发环境渲染调试浮层并订阅会话与后端调试事件。
export function DevDebugFloat({ visible = true }: DevDebugFloatProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [snapshot, setSnapshot] = useState<SessionDebugSnapshot | null>(null);
  const [copyingSessionId, setCopyingSessionId] = useState("");
  const copyingSessionIdRef = useRef("");
  const copyRequestTimeoutRef = useRef<number | null>(null);

  // 描述：
  //
  //   - 关闭当前复制请求超时定时器，避免重复触发失败提示。
  const clearCopyRequestTimeout = () => {
    if (copyRequestTimeoutRef.current !== null) {
      window.clearTimeout(copyRequestTimeoutRef.current);
      copyRequestTimeoutRef.current = null;
    }
  };

  // 描述：
  //
  //   - 从当前路由路径兜底解析会话 ID，兼容“先发送后打开 Dev 调试窗口”时尚未收到快照事件的场景。
  //
  // Returns:
  //
  //   - 路由中的会话 ID；未命中返回空字符串。
  const resolveSessionIdFromLocation = () => {
    if (!import.meta.env.DEV) {
      return "";
    }
    const pathname = String(window.location.pathname || "");
    const matched = pathname.match(/\/agents\/(?:code|model)\/session\/([^/?#]+)/i);
    if (!matched?.[1]) {
      return "";
    }
    try {
      return decodeURIComponent(matched[1]).trim();
    } catch {
      return String(matched[1]).trim();
    }
  };

  // 描述：
  //
  //   - 解析复制目标会话 ID，优先使用会话页快照，未命中时回退路由参数。
  //
  // Returns:
  //
  //   - 当前可复制的目标会话 ID。
  const resolveCopyTargetSessionId = () => {
    const snapshotSessionId = String(snapshot?.sessionId || "").trim();
    if (snapshotSessionId) {
      return snapshotSessionId;
    }
    return resolveSessionIdFromLocation();
  };

  useEffect(() => {
    if (!import.meta.env.DEV || !visible) {
      return undefined;
    }

    // 描述：接收页面调试广播并更新当前会话调试快照。
    const handleSessionDebug = (event: Event) => {
      const customEvent = event as CustomEvent<SessionDebugSnapshot>;
      setSnapshot(customEvent.detail || null);
    };
    const handleSessionCopyResult = (event: Event) => {
      const customEvent = event as CustomEvent<SessionCopyResultPayload>;
      const payload = customEvent.detail || {};
      const targetSessionId = String(payload.sessionId || "").trim();
      if (!targetSessionId || targetSessionId !== copyingSessionIdRef.current) {
        return;
      }
      clearCopyRequestTimeout();
      copyingSessionIdRef.current = "";
      setCopyingSessionId("");
      if (payload.ok) {
        AriMessage.success({
          content: payload.message || "会话内容已复制",
          duration: 1800,
        });
      } else {
        AriMessage.error({
          content: payload.message || "复制失败，请检查系统剪贴板权限",
          duration: 2200,
        });
      }
    };

    window.addEventListener("zodileap:session-debug", handleSessionDebug as EventListener);
    window.addEventListener("zodileap:session-copy-result", handleSessionCopyResult as EventListener);
    // 描述：打开 Dev 调试窗口时主动请求一次最新快照，避免“先发送后打开”导致按钮无法点击。
    window.dispatchEvent(
      new CustomEvent("zodileap:session-debug-request", {
        detail: {
          sessionId: resolveSessionIdFromLocation(),
        },
      }),
    );

    return () => {
      clearCopyRequestTimeout();
      window.removeEventListener("zodileap:session-debug", handleSessionDebug as EventListener);
      window.removeEventListener("zodileap:session-copy-result", handleSessionCopyResult as EventListener);
    };
  }, [visible]);

  // 描述：向会话页发起“复制会话内容（含过程）”请求，仅在存在已打开会话时可触发。
  const handleRequestCopySessionContent = () => {
    const targetSessionId = resolveCopyTargetSessionId();
    if (!targetSessionId) {
      AriMessage.warning({
        content: "请先打开一个会话再复制",
        duration: 1800,
      });
      return;
    }
    clearCopyRequestTimeout();
    copyingSessionIdRef.current = targetSessionId;
    setCopyingSessionId(targetSessionId);
    copyRequestTimeoutRef.current = window.setTimeout(() => {
      if (copyingSessionIdRef.current !== targetSessionId) {
        return;
      }
      copyingSessionIdRef.current = "";
      setCopyingSessionId("");
      AriMessage.error({
        content: "复制超时，请重试或确认当前会话页仍处于打开状态",
        duration: 2200,
      });
    }, 6000);
    window.dispatchEvent(
      new CustomEvent("zodileap:session-copy-request", {
        detail: {
          sessionId: targetSessionId,
        },
      }),
    );
  };

  if (!import.meta.env.DEV || !visible) {
    return null;
  }
  const copyTargetSessionId = resolveCopyTargetSessionId();

  return (
    <AriContainer
      className={`desk-dev-debug-float ${collapsed ? "collapsed" : ""}`}
      positionType="fixed"
    >
      <AriCard className="desk-dev-debug-card">
        <AriContainer className="desk-dev-debug-head">
          <AriTypography variant="h4" value="Dev 调试窗口" />
          <AriContainer className="desk-dev-debug-head-actions" padding={0}>
            <AriButton
              type="text"
              icon="content_copy"
              label="复制会话内容"
              disabled={!copyTargetSessionId || Boolean(copyingSessionId)}
              onClick={handleRequestCopySessionContent}
            />
            <AriButton
              type="text"
              icon={collapsed ? "unfold_more" : "unfold_less"}
              label={collapsed ? "展开" : "收起"}
              onClick={() => setCollapsed((value) => !value)}
            />
          </AriContainer>
        </AriContainer>
        {!collapsed ? (
          <AriContainer className="desk-dev-debug-body">
            <AriTypography
              className="desk-dev-debug-line"
              variant="caption"
              value={
                copyTargetSessionId
                  ? "当前会话已连接，点击“复制会话内容”可导出完整排查信息。"
                  : "请先打开一个会话，再复制会话内容。"
              }
            />
          </AriContainer>
        ) : null}
      </AriCard>
    </AriContainer>
  );
}
