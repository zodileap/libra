import { StrictMode } from "react";
import { AriApp, AriContainer, setAppConfig } from "aries_react";
import { AppRouter } from "./routes";

const appConfig = setAppConfig({
  baseUrl: import.meta.env.VITE_APP_API_URL || "http://localhost:11001",
  localImgSrc: import.meta.env.VITE_APP_LOCAL_IMG_SRC || "",
  theme: "brand"
});

// 描述：应用根组件，承载 AriApp 与全局路由。
export default function App() {
  return (
    <StrictMode>
      <AriApp appConfig={appConfig}>
        <AriContainer className="web-app-root">
          <AppRouter />
        </AriContainer>
      </AriApp>
    </StrictMode>
  );
}
