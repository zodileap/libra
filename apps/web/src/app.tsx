import { StrictMode } from "react";
import { AriApp, setAppConfig } from "aries_react";
import { AppRouter } from "./routes";

const appConfig = setAppConfig({
  baseUrl: import.meta.env.VITE_APP_API_URL || "http://localhost:11001",
  localImgSrc: import.meta.env.VITE_APP_LOCAL_IMG_SRC || "",
  theme: "brand"
});

export default function App() {
  return (
    <StrictMode>
      <AriApp appConfig={appConfig}>
        <div className="web-app-root">
          <AppRouter />
        </div>
      </AriApp>
    </StrictMode>
  );
}
