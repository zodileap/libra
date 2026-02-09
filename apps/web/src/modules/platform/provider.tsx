import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "aries_react";
import { PlatformContext } from "./context";
import { usePlatformMenu } from "./hooks/use-platform-menu";
import type { PlatformContextType } from "./types";

export function PlatformProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const { t } = useI18n(["router"]);
  const menuItems = usePlatformMenu(t);

  const value: PlatformContextType = {
    t,
    menuItems,
    currentPath: location.pathname
  };

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}
