import { createContext, useContext, type ReactNode } from "react";

// 描述:
//
//   - 定义桌面端标题栏插槽上下文，统一向页面下发 header slot 节点引用。
const DesktopHeaderSlotContext = createContext<HTMLElement | null>(null);

// 描述:
//
//   - 包装标题栏插槽上下文提供者，供布局层注入当前可用 slot 节点。
//
// Params:
//
//   - value: 当前标题栏插槽节点。
//   - children: 子树节点。
export function DesktopHeaderSlotProvider({
  value,
  children,
}: {
  value: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <DesktopHeaderSlotContext.Provider value={value}>
      {children}
    </DesktopHeaderSlotContext.Provider>
  );
}

// 描述:
//
//   - 读取桌面端标题栏 slot 节点，供页面通过 createPortal 挂载自定义头部内容。
//
// Returns:
//
//   - 当前标题栏 slot 节点；未就绪时返回 null。
export function useDesktopHeaderSlot() {
  return useContext(DesktopHeaderSlotContext);
}
