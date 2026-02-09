import { Outlet } from "react-router-dom";
import { AriLayout } from "aries_react";
import { PlatformProvider } from "./provider";
import { MenuPanel } from "./components/menu-panel";

export function PlatformLayout() {
  return (
    <PlatformProvider>
      <AriLayout
        defaultVisibleAreas={["left", "center"]}
        leftWidth="300px"
        left={<MenuPanel />}
        center={<Outlet />}
      />
    </PlatformProvider>
  );
}
