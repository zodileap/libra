import { Navigate, Route, Routes } from "react-router-dom";
import { DesktopLayout } from "./layout";
import { LoginPage } from "./pages/login-page";
import { HomePage } from "./pages/home-page";
import { AgentPage } from "./pages/agent-page";
import { SessionPage } from "./pages/session-page";
import { AiKeyPage } from "./pages/ai-key-page";
import { SettingsGeneralPage } from "./pages/settings-general-page";
import { ModelAgentSettingsPage } from "./pages/model-agent-settings-page";
import type {
  AiKeyItem,
  BlenderBridgeEnsureResult,
  BlenderBridgeRuntime,
  ColorThemeMode,
  LoginUser,
  ModelMcpCapabilities,
} from "./types";

interface AuthState {
  user: LoginUser | null;
  login: (account: string) => void;
  logout: () => void;
  colorThemeMode: ColorThemeMode;
  setColorThemeMode: (value: ColorThemeMode) => void;
  modelMcpCapabilities: ModelMcpCapabilities;
  setModelMcpCapabilities: (value: ModelMcpCapabilities) => void;
  aiKeys: AiKeyItem[];
  setAiKeys: (value: AiKeyItem[]) => void;
  blenderBridgeRuntime: BlenderBridgeRuntime;
  ensureBlenderBridge: () => Promise<BlenderBridgeEnsureResult>;
}

export function DesktopRouter({ auth }: { auth: AuthState }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          auth.user ? <Navigate to="/home" replace /> : <LoginPage onLogin={auth.login} />
        }
      />

      <Route
        path="/"
        element={
          auth.user ? (
            <DesktopLayout user={auth.user} onLogout={auth.logout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="settings" element={<Navigate to="/settings/general" replace />} />
        <Route
          path="settings/general"
          element={
            <SettingsGeneralPage
              colorThemeMode={auth.colorThemeMode}
              onColorThemeModeChange={auth.setColorThemeMode}
            />
          }
        />
        <Route
          path="ai-keys"
          element={<AiKeyPage aiKeys={auth.aiKeys} onAiKeysChange={auth.setAiKeys} />}
        />
        <Route
          path="agents/:agentKey"
          element={<AgentPage modelMcpCapabilities={auth.modelMcpCapabilities} />}
        />
        <Route
          path="agents/:agentKey/session/:sessionId"
          element={
            <SessionPage
              modelMcpCapabilities={auth.modelMcpCapabilities}
              blenderBridgeRuntime={auth.blenderBridgeRuntime}
              ensureBlenderBridge={auth.ensureBlenderBridge}
              aiKeys={auth.aiKeys}
            />
          }
        />
        <Route
          path="agents/model/settings"
          element={
            <ModelAgentSettingsPage
              modelMcpCapabilities={auth.modelMcpCapabilities}
              onModelMcpCapabilitiesChange={auth.setModelMcpCapabilities}
              blenderBridgeRuntime={auth.blenderBridgeRuntime}
              ensureBlenderBridge={auth.ensureBlenderBridge}
            />
          }
        />
      </Route>

      <Route path="*" element={<Navigate to={auth.user ? "/home" : "/login"} replace />} />
    </Routes>
  );
}
