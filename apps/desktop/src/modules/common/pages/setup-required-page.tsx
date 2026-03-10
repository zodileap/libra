import { useEffect, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriTypography } from "aries_react";
import type { DesktopBackendConfig } from "../../../shared/types";
import { useDesktopI18n } from "../../../shared/i18n";

// 描述：初始化未完成阻断页组件入参。
interface SetupRequiredPageProps {
  checking: boolean;
  setupUrl: string;
  message: string;
  currentStep?: string;
  systemName?: string;
  backendConfig: DesktopBackendConfig;
  onOpenSetup: () => Promise<void>;
  onUseLocalMode: () => Promise<void>;
  onSaveBackendConfig: (config: DesktopBackendConfig) => Promise<void>;
}

// 描述：判断后端地址是否为合法的 HTTP(S) 地址；允许用户只输入 `ip:port` 形式。
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

// 描述：渲染 Desktop 后端初始化引导页，支持保存统一后端地址或直接切回本地模式。
export function SetupRequiredPage({
  checking,
  setupUrl,
  message,
  currentStep,
  systemName,
  backendConfig,
  onOpenSetup,
  onUseLocalMode,
  onSaveBackendConfig,
}: SetupRequiredPageProps) {
  const { t } = useDesktopI18n();
  const [backendBaseUrl, setBackendBaseUrl] = useState(backendConfig.baseUrl);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBackendBaseUrl(backendConfig.baseUrl);
    setDraftError("");
  }, [backendConfig.baseUrl]);

  // 描述：保存统一后端地址并立即重试初始化检测，避免用户必须先进入设置页再修复连接问题。
  const handleSaveBackendConfig = async () => {
    if (saving || checking) {
      return;
    }
    if (!isValidBackendAddress(backendBaseUrl)) {
      setDraftError(t("请输入有效的后端地址，例如 http://127.0.0.1:10001。"));
      return;
    }
    setDraftError("");
    setSaving(true);
    try {
      await onSaveBackendConfig({
        enabled: true,
        baseUrl: backendBaseUrl.trim(),
        updateManifestUrl: backendConfig.updateManifestUrl,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AriContainer className="desk-setup-required">
      <AriCard className="desk-setup-required-card">
        <AriFlex vertical align="flex-start" justify="flex-start" space={14}>
          <AriTypography variant="h1" value={checking ? t("检查后端状态") : t("后端尚未完成初始化")} />
          <AriTypography
            variant="caption"
            value={checking ? t("正在读取后端安装状态，请稍候。") : t("你可以先完成后端初始化，也可以继续以本地模式进入 Desktop。")}
          />
          <AriContainer className="desk-setup-required-status">
            <AriTypography variant="caption" value={message} />
            {currentStep ? <AriTypography variant="caption" value={t("当前步骤：{{step}}", { step: currentStep })} /> : null}
            {systemName ? <AriTypography variant="caption" value={t("系统名称：{{name}}", { name: systemName })} /> : null}
            <AriTypography variant="caption" value={t("初始化入口：{{url}}", { url: setupUrl })} />
          </AriContainer>
          <AriContainer className="desk-setup-required-form">
            <AriInput
              label={t("后端地址")}
              value={backendBaseUrl}
              placeholder="http://127.0.0.1:10001"
              onChange={setBackendBaseUrl}
            />
            {draftError ? <AriTypography className="desk-login-password-error" variant="caption" value={draftError} /> : null}
          </AriContainer>
          <AriFlex className="desk-setup-required-actions" align="center" justify="flex-start" wrap space={12}>
            <AriButton
              icon="open_in_browser"
              label={t("打开初始化")}
              color="primary"
              disabled={checking || saving}
              onClick={() => {
                void onOpenSetup();
              }}
            />
            <AriButton
              icon="arrow_forward"
              label={t("本地进入")}
              disabled={checking || saving}
              onClick={() => {
                void onUseLocalMode();
              }}
            />
            <AriButton
              icon="save"
              label={saving ? t("检查中...") : t("保存并检查")}
              loading={saving}
              disabled={checking}
              onClick={() => {
                void handleSaveBackendConfig();
              }}
            />
          </AriFlex>
        </AriFlex>
      </AriCard>
    </AriContainer>
  );
}
