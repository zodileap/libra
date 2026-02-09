import { StrictMode, useEffect, useMemo, useState } from "react";
import { AriApp, setAppConfig, setColorTheme } from "aries_react";
import { HashRouter } from "react-router-dom";
import { DesktopRouter } from "./modules/client/router";
import type { ColorThemeMode, LoginUser } from "./modules/client/types";

const appConfig = setAppConfig({
  baseUrl: import.meta.env.VITE_APP_API_URL || "http://localhost:11001",
  localImgSrc: import.meta.env.VITE_APP_LOCAL_IMG_SRC || "",
  theme: "brand"
});

export default function App() {
  const [user, setUser] = useState<LoginUser | null>(null);
  const [colorThemeMode, setColorThemeMode] = useState<ColorThemeMode>(() => {
    const saved = localStorage.getItem("zodileap.desktop.colorThemeMode");
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
    return "system";
  });

  useEffect(() => {
    localStorage.setItem("zodileap.desktop.colorThemeMode", colorThemeMode);

    const applyMode = () => {
      if (colorThemeMode === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setColorTheme(isDark ? "dark" : "light");
        return;
      }
      setColorTheme(colorThemeMode);
    };

    applyMode();

    if (colorThemeMode !== "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => setColorTheme(colorThemeMode);
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    return undefined;
  }, [colorThemeMode]);

  const auth = useMemo(
    () => ({
      user,
      login: (account: string) => {
        setUser({
          id: "u-demo",
          name: account.split("@")[0] || "demo",
          email: account || "demo@zodileap.com"
        });
      },
      logout: () => setUser(null),
      colorThemeMode,
      setColorThemeMode
    }),
    [user, colorThemeMode]
  );

  return (
    <StrictMode>
      <AriApp appConfig={appConfig}>
        <HashRouter>
          <DesktopRouter auth={auth} />
        </HashRouter>
      </AriApp>
    </StrictMode>
  );
}
