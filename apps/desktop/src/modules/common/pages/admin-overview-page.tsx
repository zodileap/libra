import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriTypography } from "@aries-kit/react";
import {
  listAccountIdentities,
  listManageableUsers,
  listPermissionGrants,
  listPermissionTemplates,
} from "../../../shared/services/backend-api";
import type {
  ConsoleIdentityItem,
  ConsoleManageableUserItem,
  ConsolePermissionGrantItem,
  ConsolePermissionTemplate,
} from "../../../shared/types";
import { useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskStatusText } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 桌面端管理概览默认数据，避免首屏渲染期间访问未定义状态。
const DEFAULT_OVERVIEW = {
  identities: [] as ConsoleIdentityItem[],
  manageableUsers: [] as ConsoleManageableUserItem[],
  permissionTemplates: [] as ConsolePermissionTemplate[],
  permissionGrants: [] as ConsolePermissionGrantItem[],
};

// 描述：根据概览卡片点击动作生成权限页查询参数，保持跳转入口与权限页筛选上下文一致。
//
// Params:
//
//   - values: 需要带入权限页的查询参数。
//
// Returns:
//
//   - 适合拼接在权限页路由后的查询字符串。
function buildPermissionSearch(values: Record<string, string>): string {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    const nextValue = value.trim();
    if (nextValue) {
      search.set(key, nextValue);
    }
  });
  return search.toString();
}

// 描述：将授权记录时间转换为简短可读文案；无效值时回退原始文本。
//
// Params:
//
//   - value: ISO 时间文本。
//   - formatDateTime: 国际化时间格式化函数。
//
// Returns:
//
//   - 适合管理概览展示的时间文本。
function formatGrantTime(
  value: string,
  formatDateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string,
): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value || "--";
  }
  return formatDateTime(timestamp, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 描述：渲染 Desktop 管理概览页，集中展示身份、授权和模板数量。
export function AdminOverviewPage() {
  const navigate = useNavigate();
  const headerSlotElement = useDesktopHeaderSlot();
  const { t, formatDateTime } = useDesktopI18n();
  const [overview, setOverview] = useState(DEFAULT_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("");
  const recentPermissionGrants = useMemo(() => overview.permissionGrants.slice(0, 3), [overview.permissionGrants]);
  const recentIdentities = useMemo(() => overview.identities.slice(0, 3), [overview.identities]);
  const recentManageableUsers = useMemo(() => overview.manageableUsers.slice(0, 3), [overview.manageableUsers]);

  // 描述：加载管理概览数据，后续后端能力迁移到 Desktop 时保持调用入口稳定。
  const loadOverview = async () => {
    setLoading(true);
    setStatusText("");
    try {
      const [identities, manageableUsers, permissionTemplates, permissionGrants] = await Promise.all([
        listAccountIdentities(),
        listManageableUsers(),
        listPermissionTemplates(),
        listPermissionGrants(),
      ]);
      setOverview({
        identities,
        manageableUsers,
        permissionTemplates,
        permissionGrants,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : t("加载管理概览失败，请稍后重试。");
      setStatusText(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  // 描述：生成页面头部并挂载到全局标题栏 slot，保持 Desktop 主内容区头部一致性。
  const headerNode = useMemo(() => (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value={t("管理概览")} />
    </AriContainer>
  ), [t]);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <AriContainer className="desk-settings-panel">
          <AriFlex className="desk-admin-summary-grid" align="stretch" justify="flex-start" wrap space="var(--z-inset)">
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value={t("身份数量")} />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.identities.length)} />
              <AriTypography variant="caption" value={t("查看当前账号在本地或后端中的身份集合。")} />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value={t("可管理用户")} />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.manageableUsers.length)} />
              <AriTypography variant="caption" value={t("新增授权时可直接选择这些账号或协作者。")} />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value={t("授权记录")} />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.permissionGrants.length)} />
              <AriTypography variant="caption" value={t("用于追踪共享会话、工作流与模型能力分配。")} />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value={t("权限模板")} />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.permissionTemplates.length)} />
              <AriTypography variant="caption" value={t("后续新增授权时从这里选择权限能力。")} />
            </AriCard>
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
            <AriContainer padding={0}>
              <AriTypography variant="h4" value={t("同步状态")} />
              <AriTypography
                variant="caption"
                value={loading ? t("正在同步管理数据...") : t("当前页已迁移到 Desktop，可直接在本地或后端模式使用。")}
              />
            </AriContainer>
            <AriFlex align="center" justify="flex-end" wrap space="var(--z-inset-sm)">
              <AriButton
                icon="badge"
                label={t("身份管理")}
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
              <AriButton
                icon="verified_user"
                label={t("权限管理")}
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
              <AriButton
                icon="refresh"
                label={loading ? t("刷新中...") : t("刷新")}
                disabled={loading}
                onClick={() => {
                  void loadOverview();
                }}
              />
            </AriFlex>
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset)">
            <AriTypography variant="h4" value={t("快速操作")} />
            <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
              <AriButton
                icon="verified_user"
                color="primary"
                label={t("新增授权")}
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
              <AriButton
                icon="badge"
                label={t("切换身份")}
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
              <AriButton
                icon="tune"
                label={t("通用设置")}
                onClick={() => {
                  navigate("/settings/general");
                }}
              />
              <AriButton
                icon="home"
                label={t("返回工作台")}
                onClick={() => {
                  navigate("/home");
                }}
              />
            </AriFlex>
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset)">
            <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
              <AriContainer padding={0}>
                <AriTypography variant="h4" value={t("最近授权")} />
                <AriTypography variant="caption" value={t("优先展示最新授权记录，便于快速追踪共享动作。")} />
              </AriContainer>
              <AriButton
                icon="open_in_new"
                label={t("查看全部")}
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
            </AriFlex>
            {recentPermissionGrants.length === 0 && !loading ? (
              <DeskEmptyState title={t("暂无授权记录")} description={t("新增授权后会优先出现在这里。")} />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentPermissionGrants.map((grant) => (
                  <AriCard key={grant.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
                        <AriTypography variant="h4" value={`${grant.targetUserName} · ${grant.permissionCode}`} />
                        <AriTypography variant="caption" value={formatGrantTime(grant.createdAt || grant.lastAt || "", formatDateTime)} />
                      </AriFlex>
                      <AriTypography variant="caption" value={t("资源：{{resourceType}} / {{resourceName}}", {
                        resourceType: grant.resourceType,
                        resourceName: grant.resourceName,
                      })} />
                      <AriTypography variant="caption" value={t("授权人：{{grantedBy}} · 状态：{{status}}", {
                        grantedBy: grant.grantedBy,
                        status: grant.status,
                      })} />
                      <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
                        <AriButton
                          icon="open_in_new"
                          label={t("查看记录")}
                          onClick={() => {
                            const search = buildPermissionSearch({
                              grantId: grant.id,
                              targetUserId: grant.targetUserId,
                              permissionCode: grant.permissionCode,
                            });
                            navigate(`/settings/permissions?${search}`);
                          }}
                        />
                      </AriFlex>
                    </AriFlex>
                  </AriCard>
                ))}
              </AriContainer>
            )}
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset)">
            <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
              <AriContainer padding={0}>
                <AriTypography variant="h4" value={t("身份上下文")} />
                <AriTypography variant="caption" value={t("当前账号可切换的身份与角色会在这里给出预览。")} />
              </AriContainer>
              <AriButton
                icon="badge"
                label={t("管理身份")}
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
            </AriFlex>
            {recentIdentities.length === 0 && !loading ? (
              <DeskEmptyState title={t("暂无身份")} description={t("当前账号还没有可用身份。")} />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentIdentities.map((identity) => (
                  <AriCard key={identity.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriTypography variant="h4" value={identity.scopeName || identity.id} />
                      <AriTypography variant="caption" value={t("类型：{{type}} · 状态：{{status}}", {
                        type: identity.type,
                        status: identity.status,
                      })} />
                      <AriTypography variant="caption" value={t("角色：{{roles}}", {
                        roles: identity.roles.join("、") || t("未配置"),
                      })} />
                    </AriFlex>
                  </AriCard>
                ))}
              </AriContainer>
            )}
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset)">
            <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
              <AriContainer padding={0}>
                <AriTypography variant="h4" value={t("协作者预览")} />
                <AriTypography variant="caption" value={t("优先展示最近可管理用户，方便快速确认共享对象。")} />
              </AriContainer>
              <AriButton
                icon="verified_user"
                label={t("去授权")}
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
            </AriFlex>
            {recentManageableUsers.length === 0 && !loading ? (
              <DeskEmptyState title={t("暂无协作者")} description={t("当前还没有可直接授权的协作者账号。")} />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentManageableUsers.map((item) => (
                  <AriCard key={item.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriTypography variant="h4" value={item.self ? t("{{name}}（当前账号）", { name: item.name }) : item.name} />
                      <AriTypography variant="caption" value={t("状态：{{status}}{{email}}", {
                        status: item.status,
                        email: item.email ? ` · ${item.email}` : "",
                      })} />
                      <AriTypography variant="caption" value={t("身份范围：{{scopes}}", {
                        scopes: item.identityScopes.join("、") || t("未配置身份"),
                      })} />
                      <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
                        <AriButton
                          icon="add_task"
                          label={t("授权给他")}
                          onClick={() => {
                            const search = buildPermissionSearch({
                              targetUserId: item.id,
                            });
                            navigate(`/settings/permissions?${search}`);
                          }}
                        />
                      </AriFlex>
                    </AriFlex>
                  </AriCard>
                ))}
              </AriContainer>
            )}
          </AriFlex>
        </AriContainer>

        {statusText ? <DeskStatusText value={statusText} /> : null}
      </AriContainer>
    </AriContainer>
  );
}
