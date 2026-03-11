import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AriButton, AriCard, AriContainer, AriIcon, AriMessage } from "@aries-kit/react";
import { useDesktopI18n } from "../shared/i18n";

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
//   - 定义调试浮窗在视口中的固定坐标，供拖拽后持续复用。
interface DebugFloatPosition {
  left: number;
  top: number;
}

// 描述:
//
//   - 定义调试浮窗拖拽中的运行态，统一记录鼠标偏移与浮窗尺寸。
interface DevDebugFloatDragState {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

// 描述:
//
//   - Dev 调试浮窗根节点 ID，供拖拽逻辑读取当前浮窗边界。
const DEV_DEBUG_FLOAT_ELEMENT_ID = "desk-dev-debug-float" as const;

// 描述:
//
//   - 在开发环境渲染调试浮层并订阅会话与后端调试事件。
export function DevDebugFloat({ visible = true }: DevDebugFloatProps) {
  const { t } = useDesktopI18n();
  const [snapshot, setSnapshot] = useState<SessionDebugSnapshot | null>(null);
  const [copyingSessionId, setCopyingSessionId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<DebugFloatPosition | null>(null);
  const copyingSessionIdRef = useRef("");
  const copyRequestTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef<DevDebugFloatDragState | null>(null);

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
  //   - 读取当前调试浮窗根节点，供拖拽开始与窗口缩放时复用边界信息。
  //
  // Returns:
  //
  //   - 调试浮窗根节点；未挂载时返回 null。
  const resolveDebugFloatElement = () => {
    return document.getElementById(DEV_DEBUG_FLOAT_ELEMENT_ID);
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
    const matched = pathname.match(/\/session\/([^/?#]+)/i);
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

  // 描述：
  //
  //   - 将拖拽后的浮窗坐标限制在当前视口中，避免面板被拖出屏幕。
  //
  // Params:
  //
  //   - nextPosition: 目标坐标。
  //   - width: 当前浮窗宽度。
  //   - height: 当前浮窗高度。
  //
  // Returns:
  //
  //   - 经过视口裁剪后的安全坐标。
  const clampFloatPosition = (nextPosition: DebugFloatPosition, width: number, height: number): DebugFloatPosition => {
    const maxLeft = Math.max(window.innerWidth - width, 0);
    const maxTop = Math.max(window.innerHeight - height, 0);
    return {
      left: Math.min(Math.max(nextPosition.left, 0), maxLeft),
      top: Math.min(Math.max(nextPosition.top, 0), maxTop),
    };
  };

  // 描述：
  //
  //   - 清理当前拖拽状态，确保鼠标释放后浮窗恢复静止态。
  const clearDragState = () => {
    dragStateRef.current = null;
    setDragging(false);
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
          content: payload.message || t("会话内容已复制"),
          duration: 1800,
        });
      } else {
        AriMessage.error({
          content: payload.message || t("复制失败，请检查系统剪贴板权限"),
          duration: 2200,
        });
      }
    };

    window.addEventListener("libra:session-debug", handleSessionDebug as EventListener);
    window.addEventListener("libra:session-copy-result", handleSessionCopyResult as EventListener);
    // 描述：打开 Dev 调试窗口时主动请求一次最新快照，避免“先发送后打开”导致按钮无法点击。
    window.dispatchEvent(
      new CustomEvent("libra:session-debug-request", {
        detail: {
          sessionId: resolveSessionIdFromLocation(),
        },
      }),
    );

    return () => {
      clearCopyRequestTimeout();
      clearDragState();
      window.removeEventListener("libra:session-debug", handleSessionDebug as EventListener);
      window.removeEventListener("libra:session-copy-result", handleSessionCopyResult as EventListener);
    };
  }, [t, visible]);

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    // 描述：拖拽中根据鼠标位置实时更新浮窗坐标，并把位置限制在当前视口内。
    const handleDragMove = (event: globalThis.MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      setPosition(
        clampFloatPosition(
          {
            left: event.clientX - dragState.offsetX,
            top: event.clientY - dragState.offsetY,
          },
          dragState.width,
          dragState.height,
        ),
      );
    };

    // 描述：鼠标释放或窗口失焦时结束拖拽，避免浮窗持续跟随光标。
    const handleDragEnd = () => {
      clearDragState();
    };

    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
    window.addEventListener("blur", handleDragEnd);
    return () => {
      window.removeEventListener("mousemove", handleDragMove);
      window.removeEventListener("mouseup", handleDragEnd);
      window.removeEventListener("blur", handleDragEnd);
    };
  }, [dragging]);

  useEffect(() => {
    if (!position) {
      return undefined;
    }

    // 描述：窗口尺寸变化后重新裁剪浮窗坐标，避免缩窗后调试面板留在可视区之外。
    const handleResize = () => {
      const panelElement = resolveDebugFloatElement();
      const width = panelElement?.offsetWidth || 0;
      const height = panelElement?.offsetHeight || 0;
      setPosition((current) => {
        if (!current) {
          return current;
        }
        return clampFloatPosition(current, width, height);
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [position]);

  // 描述：向会话页发起“复制会话内容（含过程）”请求，仅在存在已打开会话时可触发。
  const handleRequestCopySessionContent = () => {
    const targetSessionId = resolveCopyTargetSessionId();
    if (!targetSessionId) {
      AriMessage.warning({
        content: t("请先打开一个会话再复制"),
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
        content: t("复制超时，请重试或确认当前会话页仍处于打开状态"),
        duration: 2200,
      });
    }, 6000);
    window.dispatchEvent(
      new CustomEvent("libra:session-copy-request", {
        detail: {
          sessionId: targetSessionId,
        },
      }),
    );
  };

  // 描述：按下拖拽手柄后记录当前浮窗位置与鼠标偏移，后续由全局 mousemove 驱动浮窗移动。
  //
  // Params:
  //
  //   - event: 拖拽手柄的鼠标按下事件。
  const handleStartDrag = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    const panelElement = resolveDebugFloatElement();
    if (!panelElement) {
      return;
    }
    const panelRect = panelElement.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      width: panelRect.width,
      height: panelRect.height,
    };
    setPosition({
      left: panelRect.left,
      top: panelRect.top,
    });
    setDragging(true);
    event.preventDefault();
  };

  if (!import.meta.env.DEV || !visible) {
    return null;
  }
  const copyTargetSessionId = resolveCopyTargetSessionId();
  const floatStyle = position
    ? {
        left: position.left,
        top: position.top,
        right: "auto" as const,
      }
    : undefined;

  return (
    <AriContainer
      id={DEV_DEBUG_FLOAT_ELEMENT_ID}
      className={`desk-dev-debug-float${dragging ? " is-dragging" : ""}`}
      positionType="fixed"
      style={floatStyle}
    >
      <AriCard className="desk-dev-debug-card">
        <AriContainer className="desk-dev-debug-head">
          <AriContainer className="desk-dev-debug-head-leading" padding={0}>
            <button
              type="button"
              className="desk-dev-debug-drag-handle"
              aria-label={t("拖动调试窗口")}
              onMouseDown={handleStartDrag}
            >
              <AriIcon name="drag_indicator" />
            </button>
          </AriContainer>
          <AriContainer className="desk-dev-debug-head-actions" padding={0}>
            <AriButton
              type="text"
              icon="content_copy"
              label={t("复制会话内容")}
              disabled={!copyTargetSessionId || Boolean(copyingSessionId)}
              onClick={handleRequestCopySessionContent}
            />
          </AriContainer>
        </AriContainer>
      </AriCard>
    </AriContainer>
  );
}
