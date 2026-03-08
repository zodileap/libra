import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriTypography } from "aries_react";
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
//
// Returns:
//
//   - 适合管理概览展示的时间文本。
function formatGrantTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value || "--";
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
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
      const reason = err instanceof Error ? err.message : "加载管理概览失败，请稍后重试。";
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
      <AriTypography className="desk-project-settings-header-title" variant="h4" value="管理概览" />
    </AriContainer>
  ), []);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <AriContainer className="desk-settings-panel">
          <AriFlex className="desk-admin-summary-grid" align="stretch" justify="flex-start" wrap space="var(--z-inset)">
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value="身份数量" />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.identities.length)} />
              <AriTypography variant="caption" value="查看当前账号在本地或后端中的身份集合。" />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value="可管理用户" />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.manageableUsers.length)} />
              <AriTypography variant="caption" value="新增授权时可直接选择这些账号或协作者。" />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value="授权记录" />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.permissionGrants.length)} />
              <AriTypography variant="caption" value="用于追踪共享会话、工作流与模型能力分配。" />
            </AriCard>
            <AriCard className="desk-admin-summary-card">
              <AriTypography variant="h4" value="权限模板" />
              <AriTypography variant="h2" value={loading ? "--" : String(overview.permissionTemplates.length)} />
              <AriTypography variant="caption" value="后续新增授权时从这里选择权限能力。" />
            </AriCard>
          </AriFlex>
        </AriContainer>

        <AriContainer className="desk-settings-panel">
          <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
            <AriContainer padding={0}>
              <AriTypography variant="h4" value="同步状态" />
              <AriTypography
                variant="caption"
                value={loading ? "正在同步管理数据..." : "当前页已迁移到 Desktop，可直接在本地或后端模式使用。"}
              />
            </AriContainer>
            <AriFlex align="center" justify="flex-end" wrap space="var(--z-inset-sm)">
              <AriButton
                icon="badge"
                label="身份管理"
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
              <AriButton
                icon="verified_user"
                label="权限管理"
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
              <AriButton
                icon="refresh"
                label={loading ? "刷新中..." : "刷新"}
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
            <AriTypography variant="h4" value="快速操作" />
            <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
              <AriButton
                icon="verified_user"
                color="primary"
                label="新增授权"
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
              <AriButton
                icon="badge"
                label="切换身份"
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
              <AriButton
                icon="tune"
                label="通用设置"
                onClick={() => {
                  navigate("/settings/general");
                }}
              />
              <AriButton
                icon="home"
                label="返回工作台"
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
                <AriTypography variant="h4" value="最近授权" />
                <AriTypography variant="caption" value="优先展示最新授权记录，便于快速追踪共享动作。" />
              </AriContainer>
              <AriButton
                icon="open_in_new"
                label="查看全部"
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
            </AriFlex>
            {recentPermissionGrants.length === 0 && !loading ? (
              <DeskEmptyState title="暂无授权记录" description="新增授权后会优先出现在这里。" />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentPermissionGrants.map((grant) => (
                  <AriCard key={grant.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
                        <AriTypography variant="h4" value={`${grant.targetUserName} · ${grant.permissionCode}`} />
                        <AriTypography variant="caption" value={formatGrantTime(grant.createdAt || grant.lastAt || "")} />
                      </AriFlex>
                      <AriTypography variant="caption" value={`资源：${grant.resourceType} / ${grant.resourceName}`} />
                      <AriTypography variant="caption" value={`授权人：${grant.grantedBy} · 状态：${grant.status}`} />
                      <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
                        <AriButton
                          icon="open_in_new"
                          label="查看记录"
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
                <AriTypography variant="h4" value="身份上下文" />
                <AriTypography variant="caption" value="当前账号可切换的身份与角色会在这里给出预览。" />
              </AriContainer>
              <AriButton
                icon="badge"
                label="管理身份"
                onClick={() => {
                  navigate("/settings/identities");
                }}
              />
            </AriFlex>
            {recentIdentities.length === 0 && !loading ? (
              <DeskEmptyState title="暂无身份" description="当前账号还没有可用身份。" />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentIdentities.map((identity) => (
                  <AriCard key={identity.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriTypography variant="h4" value={identity.scopeName || identity.id} />
                      <AriTypography variant="caption" value={`类型：${identity.type} · 状态：${identity.status}`} />
                      <AriTypography variant="caption" value={`角色：${identity.roles.join("、") || "未配置"}`} />
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
                <AriTypography variant="h4" value="协作者预览" />
                <AriTypography variant="caption" value="优先展示最近可管理用户，方便快速确认共享对象。" />
              </AriContainer>
              <AriButton
                icon="verified_user"
                label="去授权"
                onClick={() => {
                  navigate("/settings/permissions");
                }}
              />
            </AriFlex>
            {recentManageableUsers.length === 0 && !loading ? (
              <DeskEmptyState title="暂无协作者" description="当前还没有可直接授权的协作者账号。" />
            ) : (
              <AriContainer className="desk-admin-list">
                {recentManageableUsers.map((item) => (
                  <AriCard key={item.id} className="desk-admin-list-card">
                    <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                      <AriTypography variant="h4" value={item.self ? `${item.name}（当前账号）` : item.name} />
                      <AriTypography variant="caption" value={`状态：${item.status}${item.email ? ` · ${item.email}` : ""}`} />
                      <AriTypography variant="caption" value={`身份范围：${item.identityScopes.join("、") || "未配置身份"}`} />
                      <AriFlex align="center" justify="flex-start" wrap space="var(--z-inset-sm)">
                        <AriButton
                          icon="add_task"
                          label="授权给他"
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
