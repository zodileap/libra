import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriSelect, AriTypography } from "@aries-kit/react";
import {
  grantPermission,
  listManageableUsers,
  listPermissionGrants,
  listPermissionTemplates,
  revokePermission,
} from "../../../shared/services/backend-api";
import type {
  ConsoleGrantPermissionReq,
  ConsoleManageableUserItem,
  ConsolePermissionGrantItem,
  ConsolePermissionTemplate,
} from "../../../shared/types";
import { translateDesktopText, useDesktopI18n } from "../../../shared/i18n";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskStatusText } from "../../../widgets/settings-primitives";

// 描述：
//
//   - 权限表单默认值；保留一组最小示例，便于本地模式下直接完成授权演示。
const DEFAULT_PERMISSION_FORM: ConsoleGrantPermissionReq = {
  targetUserId: "local-user-2",
  targetUserName: translateDesktopText("协作者"),
  permissionCode: "",
  resourceType: "",
  resourceName: translateDesktopText("共享工作流空间"),
  expiresAt: "",
};

// 描述：渲染 Desktop 权限管理页，支持新增授权与撤销已存在记录。
export function AdminPermissionsPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const { t } = useDesktopI18n();
  const [searchParams] = useSearchParams();
  const [manageableUsers, setManageableUsers] = useState<ConsoleManageableUserItem[]>([]);
  const [permissionTemplates, setPermissionTemplates] = useState<ConsolePermissionTemplate[]>([]);
  const [permissionGrants, setPermissionGrants] = useState<ConsolePermissionGrantItem[]>([]);
  const [form, setForm] = useState<ConsoleGrantPermissionReq>(DEFAULT_PERMISSION_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingGrantId, setRevokingGrantId] = useState("");
  const [statusText, setStatusText] = useState("");
  // 描述：从概览页读取授权记录高亮参数，进入权限页后优先定位对应记录。
  const highlightedGrantId = useMemo(() => searchParams.get("grantId")?.trim() || "", [searchParams]);
  // 描述：从概览页读取目标用户参数，进入权限页时优先预选该协作者。
  const preferredTargetUserId = useMemo(() => searchParams.get("targetUserId")?.trim() || "", [searchParams]);
  // 描述：从概览页读取权限编码参数，进入权限页后同步填入授权表单。
  const preferredPermissionCode = useMemo(() => searchParams.get("permissionCode")?.trim() || "", [searchParams]);
  // 描述：根据概览跳转上下文生成轻量提示，避免页面出现额外解释块。
  const searchHintText = useMemo(() => {
    if (highlightedGrantId) {
      return t("已定位到指定授权记录。");
    }
    if (preferredTargetUserId) {
      return t("已预选授权目标。");
    }
    return "";
  }, [highlightedGrantId, preferredTargetUserId, t]);

  // 描述：根据当前输入的权限编码匹配模板，用于自动填充资源类型。
  const selectedTemplate = useMemo(
    () => permissionTemplates.find((item) => item.code === form.permissionCode.trim()),
    [permissionTemplates, form.permissionCode],
  );
  const selectedUser = useMemo(
    () => manageableUsers.find((item) => item.id === form.targetUserId.trim()) || null,
    [manageableUsers, form.targetUserId],
  );

  // 描述：加载权限模板与授权记录；页面层只关心渲染，不直接拼接后端请求。
  const loadPermissionData = async () => {
    setLoading(true);
    setStatusText("");
    try {
      const [users, templates, grants] = await Promise.all([
        listManageableUsers(),
        listPermissionTemplates(),
        listPermissionGrants(),
      ]);
      setManageableUsers(users);
      setPermissionTemplates(templates);
      setPermissionGrants(grants);
      setForm((prev) => {
        const matchedUser = users.find((item) => item.id === preferredTargetUserId)
          || users.find((item) => item.id === prev.targetUserId.trim())
          || users.find((item) => !item.self)
          || users[0];
        if (!matchedUser) {
          return prev;
        }
        const nextPermissionCode = preferredPermissionCode || prev.permissionCode;
        const matchedTemplate = templates.find((item) => item.code === nextPermissionCode.trim()) || null;
        return {
          ...prev,
          targetUserId: matchedUser.id,
          targetUserName: matchedUser.name,
          permissionCode: nextPermissionCode,
          resourceType: matchedTemplate?.resourceType || prev.resourceType,
        };
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : t("权限数据加载失败，请稍后重试。");
      setStatusText(reason);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPermissionData();
  }, [preferredPermissionCode, preferredTargetUserId]);

  // 描述：更新权限表单字段，并在切换权限编码时自动同步资源类型。
  //
  // Params:
  //
  //   - patch: 表单增量字段。
  const patchForm = (patch: Partial<ConsoleGrantPermissionReq>) => {
    setForm((prev) => {
      const next = {
        ...prev,
        ...patch,
      };
      const matchedTemplate = permissionTemplates.find((item) => item.code === next.permissionCode.trim());
      if (matchedTemplate) {
        next.resourceType = matchedTemplate.resourceType;
      }
      return next;
    });
  };

  // 描述：更新授权目标用户，并同步写入目标用户名称，避免继续要求手动输入账号信息。
  //
  // Params:
  //
  //   - value: 选择器返回的目标用户 ID。
  const handleChangeTargetUser = (value: string | number | (string | number)[] | undefined) => {
    const nextUserId = String(value || "").trim();
    const matchedUser = manageableUsers.find((item) => item.id === nextUserId) || null;
    patchForm({
      targetUserId: matchedUser?.id || "",
      targetUserName: matchedUser?.name || "",
    });
  };

  // 描述：执行新增授权请求；成功后刷新列表并保持本地模式/后端模式行为一致。
  const handleGrantPermission = async () => {
    if (submitting) {
      return;
    }
    if (!form.targetUserId.trim() || !form.targetUserName.trim() || !form.resourceName.trim() || !selectedTemplate) {
      AriMessage.warning({
        content: t("请完整填写目标用户、资源名称并选择有效权限编码。"),
        duration: 2600,
      });
      return;
    }
    setSubmitting(true);
    try {
      await grantPermission({
        targetUserId: form.targetUserId.trim(),
        targetUserName: form.targetUserName.trim(),
        permissionCode: selectedTemplate.code,
        resourceType: selectedTemplate.resourceType,
        resourceName: form.resourceName.trim(),
        expiresAt: form.expiresAt?.trim() || undefined,
      });
      AriMessage.success({
        content: t("授权成功。"),
        duration: 2200,
      });
      await loadPermissionData();
    } catch (err) {
      AriMessage.error({
        content: err instanceof Error ? err.message : t("授权失败，请稍后重试。"),
        duration: 2800,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // 描述：撤销指定授权记录；操作完成后立即刷新当前列表。
  //
  // Params:
  //
  //   - grantId: 授权记录 ID。
  const handleRevokePermission = async (grantId: string) => {
    if (!grantId || revokingGrantId) {
      return;
    }
    setRevokingGrantId(grantId);
    try {
      await revokePermission(grantId);
      AriMessage.success({
        content: t("撤销成功。"),
        duration: 2200,
      });
      await loadPermissionData();
    } catch (err) {
      AriMessage.error({
        content: err instanceof Error ? err.message : t("撤销失败，请稍后重试。"),
        duration: 2800,
      });
    } finally {
      setRevokingGrantId("");
    }
  };

  // 描述：生成页面头部并挂载到全局标题栏 slot。
  const headerNode = useMemo(() => (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value={t("权限管理")} />
    </AriContainer>
  ), [t]);

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell">
        <AriContainer className="desk-settings-panel">
          <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset)">
            <AriContainer padding={0}>
              <AriTypography variant="h4" value={t("新增授权")} />
              <AriTypography variant="caption" value={t("接入后端时可共享给其他账号；本地模式下会写入本地授权记录。")} />
            </AriContainer>
            <AriContainer className="desk-admin-form-grid">
              <AriContainer padding={0}>
                <AriTypography variant="caption" value={t("授权目标")} />
                <AriSelect
                  value={form.targetUserId || undefined}
                  options={manageableUsers.map((item) => ({
                    label: item.self ? t("{{name}}（当前账号）", { name: item.name }) : item.name,
                    value: item.id,
                  }))}
                  placeholder={t("请选择授权目标")}
                  searchable
                  allowClear
                  onChange={handleChangeTargetUser}
                />
              </AriContainer>
              <AriInput
                label={t("目标用户名称")}
                value={selectedUser?.name || form.targetUserName}
                placeholder={t("请选择授权目标")}
                disabled
              />
              <AriInput
                label={t("目标用户邮箱")}
                value={selectedUser?.email || t("未设置邮箱")}
                disabled
              />
              <AriInput
                label={t("权限编码")}
                value={form.permissionCode}
                placeholder={t("例如 workflow.manage")}
                onChange={(value: string) => patchForm({ permissionCode: value })}
              />
              <AriInput
                label={t("资源名称")}
                value={form.resourceName}
                placeholder={t("例如共享工作流空间")}
                onChange={(value: string) => patchForm({ resourceName: value })}
              />
            </AriContainer>
            <AriTypography
              variant="caption"
              value={selectedUser
                ? t("身份范围：{{scopes}} · 状态：{{status}}{{currentAccount}}", {
                  scopes: selectedUser.identityScopes.join("、") || t("未配置身份"),
                  status: selectedUser.status,
                  currentAccount: selectedUser.self ? t(" · 当前账号") : "",
                })
                : t("请选择授权目标后查看身份范围与状态。")}
            />
            <AriTypography
              variant="caption"
              value={t("可用模板：{{templates}}", {
                templates: permissionTemplates.map((item) => item.code).join("、") || t("暂无可用模板"),
              })}
            />
            <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
              <AriTypography
                variant="caption"
                value={selectedTemplate
                  ? t("资源类型：{{resourceType}}", { resourceType: selectedTemplate.resourceType })
                  : t("请输入有效权限编码后自动填充资源类型。")}
              />
              <AriButton
                icon="add_task"
                color="primary"
                label={submitting ? t("提交中...") : t("新增授权")}
                disabled={submitting}
                onClick={() => {
                  void handleGrantPermission();
                }}
              />
            </AriFlex>
          </AriFlex>
        </AriContainer>

        {permissionGrants.length === 0 && !loading ? (
          <DeskEmptyState title={t("暂无授权记录")} description={t("可通过上方表单为其他账号新增共享权限。")} />
        ) : (
          <AriContainer className="desk-admin-list">
            {permissionGrants.map((grant) => (
              <AriCard
                key={grant.id}
                className={highlightedGrantId === grant.id
                  ? "desk-admin-list-card desk-admin-list-card-active"
                  : "desk-admin-list-card"}
              >
                <AriFlex vertical align="flex-start" justify="flex-start" space="var(--z-inset-sm)">
                  <AriFlex align="center" justify="space-between" wrap space="var(--z-inset)">
                    <AriTypography variant="h4" value={`${grant.targetUserName} (${grant.targetUserId})`} />
                    <AriButton
                      icon="delete"
                      label={revokingGrantId === grant.id ? t("撤销中...") : t("撤销")}
                      disabled={Boolean(revokingGrantId)}
                      onClick={() => {
                        void handleRevokePermission(grant.id);
                      }}
                    />
                  </AriFlex>
                  <AriTypography variant="caption" value={t("权限：{{permissionCode}}", { permissionCode: grant.permissionCode })} />
                  <AriTypography variant="caption" value={t("资源：{{resourceType}} / {{resourceName}}", {
                    resourceType: grant.resourceType,
                    resourceName: grant.resourceName,
                  })} />
                  <AriTypography variant="caption" value={t("授权人：{{grantedBy}}，状态：{{status}}", {
                    grantedBy: grant.grantedBy,
                    status: grant.status,
                  })} />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}

        {loading ? <DeskStatusText value={t("权限数据加载中...")} /> : null}
        {searchHintText ? <DeskStatusText value={searchHintText} /> : null}
        {statusText ? <DeskStatusText value={statusText} /> : null}
      </AriContainer>
    </AriContainer>
  );
}
