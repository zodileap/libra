import { createContext, useContext } from "react";
import type { ConsoleContextType } from "./types";

// 描述：控制台模块上下文对象。
export const ConsoleContext = createContext<ConsoleContextType | null>(null);

// 描述：读取控制台上下文，确保 Provider 已挂载。
export function useConsoleContext(): ConsoleContextType {
  const value = useContext(ConsoleContext);
  if (!value) {
    throw new Error("ConsoleContext 未初始化");
  }
  return value;
}
