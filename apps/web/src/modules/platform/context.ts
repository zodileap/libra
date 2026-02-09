import { createContext, useContext } from "react";
import type { PlatformContextType } from "./types";

export const PlatformContext = createContext<PlatformContextType | undefined>(undefined);

export function usePlatformContext(): PlatformContextType {
  const context = useContext(PlatformContext);
  if (context === undefined) {
    throw new Error("usePlatformContext must be used within PlatformProvider");
  }
  return context;
}
