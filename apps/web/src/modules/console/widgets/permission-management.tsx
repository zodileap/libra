import { useMemo, useState } from "react";
import { AriButton, AriCard, AriContainer, AriFlex, AriInput, AriMessage, AriTypography } from "aries_react";
import { useConsoleContext } from "../context";

// 描述：权限管理页，支持授权与撤销权限。
export function ConsolePermissionManagementPage() {
  const { permissionTemplates, permissionGrants, grantPermission, revokePermission } = useConsoleContext();
  const [targetUserId, setTargetUserId] = useState("123e4567-e89b-12d3-a456-426614174001");
  const [targetUserName, setTargetUserName] = useState("Demo User");
  const [resourceName, setResourceName] = useState("基础模型池");
  const [selectedPermissionCode, setSelectedPermissionCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedTemplate = useMemo(
    () => permissionTemplates.find((item) => item.code === selectedPermissionCode),
    [permissionTemplates, selectedPermissionCode]
  );

  // 描述：提交授权请求。
  const handleGrant = async () => {
    if (submitting) {
      return;
    }
    if (!targetUserId.trim() || !targetUserName.trim() || !resourceName.trim() || !selectedTemplate) {
      AriMessage.warning({ content: "请完整填写授权信息。", duration: 2200 });
      return;
    }
    setSubmitting(true);
    try {
      await grantPermission({
        targetUserId: targetUserId.trim(),
        targetUserName: targetUserName.trim(),
        permissionCode: selectedTemplate.code,
        resourceType: selectedTemplate.resourceType,
        resourceName: resourceName.trim()
      });
    } catch (err) {
      AriMessage.error({
        content: err instanceof Error ? err.message : "授权失败，请稍后重试。",
        duration: 2800
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AriContainer className="web-console-page">
      <AriTypography variant="h3" value="权限管理" />
      <AriTypography variant="caption" value="支持向其他用户授权模型能力，并可随时撤销。" />

      <AriCard className="web-console-form-card">
        <AriContainer className="web-console-form-grid">
          <AriInput label="目标用户 ID" value={targetUserId} onChange={setTargetUserId} placeholder="请输入用户ID" />
          <AriInput label="目标用户名称" value={targetUserName} onChange={setTargetUserName} placeholder="请输入用户名称" />
          <AriInput label="资源名称" value={resourceName} onChange={setResourceName} placeholder="如：基础模型池" />
          <AriInput
            label="权限编码"
            value={selectedPermissionCode}
            onChange={setSelectedPermissionCode}
            placeholder="例如：model.access.grant"
          />
        </AriContainer>
        <AriTypography
          variant="caption"
          value={`可用权限模板：${permissionTemplates.map((item) => item.code).join("、") || "暂无"}`}
        />
        <AriFlex justify="flex-end" align="center">
          <AriButton color="primary" label={submitting ? "提交中..." : "提交授权"} onClick={() => void handleGrant()} />
        </AriFlex>
      </AriCard>

      <AriContainer className="web-console-list">
        {permissionGrants.map((grant) => (
          <AriCard key={grant.id} className="web-console-list-card">
            <AriFlex justify="space-between" align="center">
              <AriTypography variant="h4" value={`${grant.targetUserName} (${grant.targetUserId})`} />
              <AriButton label="撤销" onClick={() => void revokePermission(grant.id)} />
            </AriFlex>
            <AriTypography variant="caption" value={`权限：${grant.permissionCode}`} />
            <AriTypography variant="caption" value={`资源：${grant.resourceType} / ${grant.resourceName}`} />
            <AriTypography variant="caption" value={`授权人：${grant.grantedBy}，状态：${grant.status}`} />
          </AriCard>
        ))}
      </AriContainer>
    </AriContainer>
  );
}
