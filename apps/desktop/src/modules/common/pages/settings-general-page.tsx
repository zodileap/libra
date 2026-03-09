import { useEffect, useState } from "react";
import { AriButton, AriContainer, AriFlex, AriInput, AriSelect, AriSwitch, AriTypography } from "aries_react";
import type { ColorThemeMode, ConsoleIdentityItem, DesktopBackendConfig } from "../types";
import { DeskPageHeader, DeskSectionTitle, DeskSettingsRow, DeskStatusText } from "../../../widgets/settings-primitives";
import {
  DESKTOP_LANGUAGE_PREFERENCES,
  getDesktopLanguageNativeLabel,
  useDesktopI18n,
} from "../../../shared/i18n";

// 描述：定义通用设置页组件入参。
interface SettingsGeneralPageProps {
  colorThemeMode: ColorThemeMode;
  onColorThemeModeChange: (value: ColorThemeMode) => void;
  backendConfig: DesktopBackendConfig;
  selectedIdentity: ConsoleIdentityItem | null;
  onBackendConfigChange: (value: DesktopBackendConfig) => DesktopBackendConfig;
  onBackendConfigReset: () => DesktopBackendConfig;
}

// 描述：判断后端地址是否为合法的 `http(s)://host:port` 形式；允许用户只输入 `ip:port`。
//
// Params:
//
//   - value: 后端地址输入值。
//
// Returns:
//
//   - true: 地址合法。
function isValidBackendAddress(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  const normalized = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(normalized);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.host);
  } catch (_err) {
    return false;
  }
}

// 描述：判断静态更新清单地址是否为合法的 HTTP(S) 完整 URL。
//
// Params:
//
//   - value: 静态更新清单地址输入值。
//
// Returns:
//
//   - true: 地址合法。
function isValidUpdateManifestUrl(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.host);
  } catch (_err) {
    return false;
  }
}

// 描述：渲染通用设置页，统一管理主题模式与桌面端后端接入配置。
export function SettingsGeneralPage({
  colorThemeMode,
  onColorThemeModeChange,
  backendConfig,
  selectedIdentity,
  onBackendConfigChange,
  onBackendConfigReset,
}: SettingsGeneralPageProps) {
  const { languagePreference, setLanguagePreference, t } = useDesktopI18n();
  const [opaqueWindow, setOpaqueWindow] = useState(false);
  const [pointerCursor, setPointerCursor] = useState(false);
  const [backendDraft, setBackendDraft] = useState<DesktopBackendConfig>(backendConfig);
  const [backendStatus, setBackendStatus] = useState("");

  useEffect(() => {
    setBackendDraft(backendConfig);
  }, [backendConfig]);

  // 描述：更新后端接入草稿字段，保证用户可以先编辑再统一保存。
  const patchBackendDraft = (patch: Partial<DesktopBackendConfig>) => {
    setBackendDraft((prev) => ({
      ...prev,
      ...patch,
    }));
    if (backendStatus) {
      setBackendStatus("");
    }
  };

  // 描述：保存后端接入配置；启用后端时会校验地址格式，避免把错误地址写入运行态。
  const handleSaveBackendConfig = () => {
    if (backendDraft.enabled && !isValidBackendAddress(backendDraft.baseUrl)) {
      setBackendStatus(t("请输入有效的后端地址，例如 http://127.0.0.1:10001。"));
      return;
    }
    if (backendDraft.updateManifestUrl.trim() && !isValidUpdateManifestUrl(backendDraft.updateManifestUrl)) {
      setBackendStatus(t("请输入有效的更新清单地址，例如 https://open.zodileap.com/libra/updates/latest.json。"));
      return;
    }
    const saved = onBackendConfigChange({
      enabled: backendDraft.enabled,
      baseUrl: backendDraft.baseUrl.trim(),
      updateManifestUrl: backendDraft.updateManifestUrl.trim(),
    });
    setBackendDraft(saved);
    if (saved.enabled) {
      setBackendStatus(t("后端与更新源配置已保存。"));
      return;
    }
    if (saved.updateManifestUrl) {
      setBackendStatus(t("更新源配置已保存；当前为本地模式。"));
      return;
    }
    setBackendStatus(t("已切换为本地模式，且未启用自动更新。"));
  };

  // 描述：恢复默认后端配置；恢复后 Desktop 会重新回到纯本地模式。
  const handleResetBackendConfig = () => {
    const restored = onBackendConfigReset();
    setBackendDraft(restored);
    setBackendStatus(t("后端与更新源配置已恢复为默认值。"));
  };

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      <AriContainer className="desk-settings-shell">
        <DeskPageHeader title={t("General")} description={t("统一管理主题、基础交互、更新源和后端接入。")} />

        <DeskSectionTitle title={t("Appearance")} />

        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow title={t("Theme")} description={t("Use light, dark, or match your system")}>
            <AriFlex className="desk-theme-group" align="center" space={8}>
              <AriButton
                size="sm"
                icon="light_mode"
                label={t("Light")}
                color={colorThemeMode === "light" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("light")}
              />
              <AriButton
                size="sm"
                icon="dark_mode"
                label={t("Dark")}
                color={colorThemeMode === "dark" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("dark")}
              />
              <AriButton
                size="sm"
                icon="desktop_windows"
                label={t("System")}
                color={colorThemeMode === "system" ? "primary" : "default"}
                onClick={() => onColorThemeModeChange("system")}
              />
            </AriFlex>
          </DeskSettingsRow>

          <DeskSettingsRow
            title={t("当前语言")}
            description={t("选择界面语言。首次启动默认跟随系统，未匹配时回退为英文。")}
          >
            <AriSelect
              value={languagePreference}
              options={DESKTOP_LANGUAGE_PREFERENCES.map((item) => ({
                value: item,
                label: item === "auto" ? t("自动检测") : getDesktopLanguageNativeLabel(item),
              }))}
              onChange={(value) => {
                if (value === "auto" || value === "zh-CN" || value === "en-US") {
                  setLanguagePreference(value);
                }
              }}
            />
          </DeskSettingsRow>

          <DeskSettingsRow
            title={t("Use opaque window background")}
            description={t("Make windows use a solid background rather than system translucency")}
          >
            <AriSwitch checked={opaqueWindow} onChange={setOpaqueWindow} />
          </DeskSettingsRow>

          <DeskSettingsRow
            title={t("Use pointer cursors")}
            description={t("Change the cursor to a pointer when hovering over interactive elements")}
          >
            <AriSwitch checked={pointerCursor} onChange={setPointerCursor} />
          </DeskSettingsRow>
        </AriContainer>

        <DeskSectionTitle title={t("Backend")} />

        <AriContainer className="desk-settings-panel">
          <DeskSettingsRow title={t("Current Identity")} description={t("登录后会自动选择身份，也可以在 Identities 页面手动切换。")}>
            <AriContainer padding={0}>
              <AriTypography variant="caption" value={selectedIdentity?.scopeName || t("未选定身份")} />
            </AriContainer>
          </DeskSettingsRow>

          <DeskSettingsRow title={t("Use Backend")} description={t("启用后可共享账号、工作流与会话存储。")}>
            <AriSwitch
              checked={backendDraft.enabled}
              onChange={(value) => patchBackendDraft({ enabled: value })}
            />
          </DeskSettingsRow>

          <DeskSettingsRow title={t("Backend URL")} description={t("输入统一后端入口地址，例如 http://127.0.0.1:10001。")}>
            <AriInput
              value={backendDraft.baseUrl}
              placeholder="http://127.0.0.1:10001"
              onChange={(value) => patchBackendDraft({ baseUrl: value })}
            />
          </DeskSettingsRow>

          <DeskSettingsRow
            title={t("Update Manifest URL")}
            description={t("默认使用官方静态 latest.json；你也可以改成自己私有部署的 HTTPS 地址。留空时：若已接入后端则回退到 Runtime 更新接口；未接入后端则不检查更新。")}
          >
            <AriInput
              value={backendDraft.updateManifestUrl}
              placeholder="https://open.zodileap.com/libra/updates/latest.json"
              onChange={(value) => patchBackendDraft({ updateManifestUrl: value })}
            />
          </DeskSettingsRow>

          <DeskSettingsRow title={t("Actions")} description={t("未接入后端时，Desktop 将只使用本地存储。")}>
            <AriFlex align="center" space={8}>
              <AriButton icon="save" label={t("保存设置")} color="primary" onClick={handleSaveBackendConfig} />
              <AriButton icon="settings_backup_restore" label={t("恢复默认")} onClick={handleResetBackendConfig} />
            </AriFlex>
          </DeskSettingsRow>
        </AriContainer>

        {backendStatus ? <DeskStatusText value={backendStatus} /> : null}
      </AriContainer>
    </AriContainer>
  );
}
