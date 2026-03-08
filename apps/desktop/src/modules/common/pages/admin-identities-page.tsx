import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriMessage, AriTypography } from "aries_react";
import { listAccountIdentities } from "../../../shared/services/backend-api";
import type { ConsoleIdentityItem } from "../../../shared/types";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskStatusText } from "../../../widgets/settings-primitives";

// 描述：身份管理页组件入参，补齐“当前身份”上下文切换能力。
interface AdminIdentitiesPageProps {
  selectedIdentity: ConsoleIdentityItem | null;
  onSelectIdentity: (value: ConsoleIdentityItem | null) => ConsoleIdentityItem | null;
}

// 描述：将身份类型转换为简洁中文文案，避免页面直接暴露后端原始枚举值。
//
// Params:
//
//   - type: 身份类型编码。
//
// Returns:
//
//   - 面向用户的身份类型说明。
function resolveIdentityTypeText(type: string): string {
  if (type === "organization_member") {
    return "公司成员";
  }
  if (type === "department_member") {
    return "部门成员";
  }
  if (type === "individual") {
    return "独立用户";
  }
  return type || "未分类";
}

// 描述：渲染 Desktop 身份管理页，展示当前账号可用身份与关联角色。
export function AdminIdentitiesPage({ selectedIdentity, onSelectIdentity }: AdminIdentitiesPageProps) {
  const headerSlotElement = useDesktopHeaderSlot();
  const [identities, setIdentities] = useState<ConsoleIdentityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");

  // 描述：加载身份列表；本地模式与后端模式共用同一入口，避免页面层分支。
  const loadIdentities = async () => {
    setLoading(true);
    setStatusText("");
    try {
      setIdentities(await listAccountIdentities());
    } catch (err) {
      const reason = err instanceof Error ? err.message : "身份列表加载失败，请稍后重试。";
      setStatusText(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadIdentities();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!identities.length) {
      if (selectedIdentity) {
        onSelectIdentity(null);
      }
      return;
    }
    const matchedIdentity = selectedIdentity
      ? identities.find((item) => item.id === selectedIdentity.id) || null
      : null;
    if (!matchedIdentity && identities.length === 1) {
      onSelectIdentity(identities[0]);
      return;
    }
    if (!matchedIdentity && selectedIdentity) {
      onSelectIdentity(null);
    }
  }, [identities, loading, onSelectIdentity, selectedIdentity]);

  // 描述：切换当前身份上下文，并给出轻量成功反馈。
  //
  // Params:
  //
  //   - identity: 需要切换到的身份。
  const handleSelectIdentity = (identity: ConsoleIdentityItem) => {
    onSelectIdentity(identity);
    AriMessage.success({
      content: `已切换到 ${identity.scopeName}。`,
      duration: 2200,
    });
  };

  // 描述：生成页面头部并挂载到 Desktop 标题栏 slot。
  const headerNode = useMemo(() => (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value="身份管理" />
    </AriContainer>
  ), []);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <AriContainer className="desk-settings-panel">
          <AriFlex align="center" justify="space-between" wrap space={12}>
            <AriContainer padding={0}>
              <AriTypography variant="h4" value="身份列表" />
              <AriTypography variant="caption" value="一个账号可以挂载多个身份与角色，用于区分共享范围。" />
            </AriContainer>
            <AriButton
              icon="refresh"
              label={loading ? "刷新中..." : "刷新"}
              disabled={loading}
              onClick={() => {
                void loadIdentities();
              }}
            />
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriTypography
            variant="caption"
            value={selectedIdentity ? `当前身份：${selectedIdentity.scopeName}` : "当前还未选定身份，将使用账号默认上下文。"}
          />
        </AriContainer>

        {identities.length === 0 && !loading ? (
          <DeskEmptyState title="暂无身份" description="当前账号下还没有可展示的身份信息。" />
        ) : (
          <AriContainer className="desk-admin-list">
            {identities.map((item) => (
              <AriCard key={item.id} className="desk-admin-list-card">
                <AriFlex vertical align="flex-start" justify="flex-start" space={8}>
                  <AriFlex align="center" justify="space-between" wrap space={12}>
                    <AriTypography variant="h4" value={item.scopeName || item.id} />
                    <AriTypography variant="caption" value={item.status || "unknown"} />
                  </AriFlex>
                  <AriTypography variant="caption" value={`身份类型：${resolveIdentityTypeText(item.type)}`} />
                  <AriTypography variant="caption" value={`角色：${item.roles.join("、") || "未配置"}`} />
                  <AriTypography variant="caption" value={`身份 ID：${item.id}`} />
                  <AriButton
                    icon={selectedIdentity?.id === item.id ? "check_circle" : "how_to_reg"}
                    color={selectedIdentity?.id === item.id ? "primary" : "default"}
                    label={selectedIdentity?.id === item.id ? "当前身份" : "设为当前"}
                    disabled={selectedIdentity?.id === item.id}
                    onClick={() => {
                      handleSelectIdentity(item);
                    }}
                  />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}

        {loading ? <DeskStatusText value="身份列表加载中..." /> : null}
        {statusText ? <DeskStatusText value={statusText} /> : null}
      </AriContainer>
    </AriContainer>
  );
}
