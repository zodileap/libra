import { useState } from "react";
import { AriButton, AriContainer, AriFlex, AriSwitch } from "aries_react";
import type { ColorThemeMode } from "../types";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow } from "../../../widgets/settings-primitives";

interface SettingsGeneralPageProps {
  colorThemeMode: ColorThemeMode;
  onColorThemeModeChange: (value: ColorThemeMode) => void;
}

// 描述:
//
//   - 渲染通用设置页，统一主题切换与基础交互开关。
export function SettingsGeneralPage({
  colorThemeMode,
  onColorThemeModeChange,
}: SettingsGeneralPageProps) {
  const [opaqueWindow, setOpaqueWindow] = useState(false);
  const [pointerCursor, setPointerCursor] = useState(false);

  return (
    <AriContainer className="desk-content">
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader
          title="General"
          description="统一管理主题与基础交互偏好。"
        />

        <DeskSectionTitle title="Appearance" />

        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow
            title="Theme"
            description="Use light, dark, or match your system"
          >
            <AriFlex className="desk-theme-group" align="center" space={8}>
              <AriButton
                size="sm"
                icon="light_mode"
                label="Light"
                color={colorThemeMode === "light" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("light")}
              />
              <AriButton
                size="sm"
                icon="dark_mode"
                label="Dark"
                color={colorThemeMode === "dark" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("dark")}
              />
              <AriButton
                size="sm"
                icon="desktop_windows"
                label="System"
                color={colorThemeMode === "system" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("system")}
              />
            </AriFlex>
          </DeskSettingsRow>

          <DeskSettingsRow
            title="Use opaque window background"
            description="Make windows use a solid background rather than system translucency"
          >
            <AriSwitch checked={opaqueWindow} onChange={setOpaqueWindow} />
          </DeskSettingsRow>

          <DeskSettingsRow
            title="Use pointer cursors"
            description="Change the cursor to a pointer when hovering over interactive elements"
          >
            <AriSwitch checked={pointerCursor} onChange={setPointerCursor} />
          </DeskSettingsRow>
        </AriContainer>
      </AriContainer>
    </AriContainer>
  );
}
