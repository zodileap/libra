import { useState } from "react";
import { AriButton, AriContainer, AriFlex, AriSwitch, AriTypography } from "aries_react";
import type { ColorThemeMode } from "../types";

interface SettingsGeneralPageProps {
  colorThemeMode: ColorThemeMode;
  onColorThemeModeChange: (value: ColorThemeMode) => void;
}

export function SettingsGeneralPage({
  colorThemeMode,
  onColorThemeModeChange,
}: SettingsGeneralPageProps) {
  const [opaqueWindow, setOpaqueWindow] = useState(false);
  const [pointerCursor, setPointerCursor] = useState(false);

  return (
    <AriContainer className="desk-content">
      <div className="desk-settings-shell">
        <AriTypography variant="h1" value="General" />

        <AriTypography className="desk-settings-title" variant="h2" value="Appearance" />

        <div className="desk-settings-panel">
          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="Theme" />
              <AriTypography
                variant="caption"
                value="Use light, dark, or match your system"
              />
            </div>
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
          </div>

          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="Use opaque window background" />
              <AriTypography
                variant="caption"
                value="Make windows use a solid background rather than system translucency"
              />
            </div>
            <AriSwitch checked={opaqueWindow} onChange={setOpaqueWindow} />
          </div>

          <div className="desk-settings-row">
            <div className="desk-settings-meta">
              <AriTypography variant="h4" value="Use pointer cursors" />
              <AriTypography
                variant="caption"
                value="Change the cursor to a pointer when hovering over interactive elements"
              />
            </div>
            <AriSwitch checked={pointerCursor} onChange={setPointerCursor} />
          </div>
        </div>
      </div>
    </AriContainer>
  );
}
