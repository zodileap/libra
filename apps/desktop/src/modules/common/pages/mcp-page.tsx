import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AriButton, AriCard, AriContainer, AriFlex, AriIcon, AriMessage, AriSwitch, AriTypography } from "aries_react";
import type { McpCatalogItem, McpOverview } from "../services";
import { listMcpOverview, updateMcpInstalledState } from "../services";
import { useDesktopHeaderSlot } from "../../../widgets/app-header/header-slot-context";
import { DeskEmptyState, DeskSectionTitle } from "../../../widgets/settings-primitives";

// 描述：
//
//   - MCP 总览默认状态，避免首屏渲染期间出现未定义访问。
const DEFAULT_MCP_OVERVIEW: McpOverview = {
  installed: [],
  marketplace: [],
};

// 描述：
//
//   - 渲染 MCP 页，展示“已安装/推荐”两类 MCP 并支持安装状态切换。
export function McpPage() {
  const headerSlotElement = useDesktopHeaderSlot();
  const [overview, setOverview] = useState<McpOverview>(DEFAULT_MCP_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [updatingMcpId, setUpdatingMcpId] = useState("");

  // 描述：
  //
  //   - 初始化加载 MCP 目录总览，后续切服务端时保持调用入口不变。
  useEffect(() => {
    const loadOverview = async () => {
      setLoading(true);
      try {
        const data = await listMcpOverview();
        setOverview(data);
      } finally {
        setLoading(false);
      }
    };
    void loadOverview();
  }, []);

  // 描述：
  //
  //   - 根据 MCP ID 更新安装状态，并刷新页面展示。
  //
  // Params:
  //
  //   - mcp: 目标 MCP。
  //   - installed: 是否安装。
  const handleUpdateMcpInstalledState = async (mcp: McpCatalogItem, installed: boolean) => {
    if (updatingMcpId) {
      return;
    }
    setUpdatingMcpId(mcp.id);
    try {
      const nextOverview = await updateMcpInstalledState(mcp.id, installed);
      setOverview(nextOverview);
      AriMessage.success({
        content: installed ? `已安装 ${mcp.name}` : `已卸载 ${mcp.name}`,
        duration: 1800,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err || "").trim();
      AriMessage.error({
        content: reason || (installed ? "安装 MCP 失败，请稍后重试。" : "卸载 MCP 失败，请稍后重试。"),
        duration: 2200,
      });
    } finally {
      setUpdatingMcpId("");
    }
  };

  // 描述：
  //
  //   - 生成标题栏内容并挂载到全局头部 slot，保持 Desktop 页面头部一致性。
  const headerNode = useMemo(() => (
    <AriContainer className="desk-project-settings-header" padding={0} data-tauri-drag-region>
      <AriTypography className="desk-project-settings-header-title" variant="h4" value="MCP" />
    </AriContainer>
  ), []);

  if (loading) {
    return (
      <AriContainer className="desk-content" showBorderRadius={false}>
        {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
        <AriContainer className="desk-settings-shell desk-skills-shell">
          <AriTypography variant="caption" value="MCP 列表加载中..." />
        </AriContainer>
      </AriContainer>
    );
  }

  return (
    <AriContainer className="desk-content" showBorderRadius={false}>
      {headerSlotElement ? createPortal(headerNode, headerSlotElement) : null}
      <AriContainer className="desk-settings-shell desk-skills-shell">
        <DeskSectionTitle title="已安装" />
        {overview.installed.length === 0 ? (
          <DeskEmptyState title="暂无已安装 MCP" description="可从推荐列表安装 MCP。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.installed.map((item) => (
              <AriCard key={item.id} className="desk-skill-card">
                <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
                  <AriFlex className="desk-skill-card-info" align="center" space={12}>
                    <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
                      <AriIcon name={item.icon} />
                    </AriContainer>
                    <AriContainer padding={0}>
                      <AriTypography variant="h4" value={item.name} />
                      <AriTypography variant="caption" value={item.description} />
                      {item.officialProvider ? (
                        <AriTypography variant="caption" value={`提供方：${item.officialProvider}`} />
                      ) : null}
                      {item.installCommand ? (
                        <AriTypography variant="caption" value={`安装命令：${item.installCommand}`} />
                      ) : null}
                      {item.docsUrl ? (
                        <AriTypography variant="caption" value={`文档：${item.docsUrl}`} />
                      ) : null}
                    </AriContainer>
                  </AriFlex>
                  <AriSwitch
                    checked
                    disabled={updatingMcpId === item.id}
                    onChange={(checked: boolean) => {
                      if (checked) {
                        return;
                      }
                      void handleUpdateMcpInstalledState(item, false);
                    }}
                  />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}

        <DeskSectionTitle title="推荐" />
        {overview.marketplace.length === 0 ? (
          <DeskEmptyState title="暂无可安装 MCP" description="当前目录中没有更多可用 MCP。" />
        ) : (
          <AriContainer className="desk-skill-grid">
            {overview.marketplace.map((item) => (
              <AriCard key={item.id} className="desk-skill-card">
                <AriFlex className="desk-skill-card-main" align="center" justify="space-between" space={12}>
                  <AriFlex className="desk-skill-card-info" align="center" space={12}>
                    <AriContainer className="desk-skill-card-icon-wrap" padding={0}>
                      <AriIcon name={item.icon} />
                    </AriContainer>
                    <AriContainer padding={0}>
                      <AriTypography variant="h4" value={item.name} />
                      <AriTypography variant="caption" value={item.description} />
                      {item.officialProvider ? (
                        <AriTypography variant="caption" value={`提供方：${item.officialProvider}`} />
                      ) : null}
                      {item.installCommand ? (
                        <AriTypography variant="caption" value={`安装命令：${item.installCommand}`} />
                      ) : null}
                      {item.docsUrl ? (
                        <AriTypography variant="caption" value={`文档：${item.docsUrl}`} />
                      ) : null}
                    </AriContainer>
                  </AriFlex>
                  <AriButton
                    type="text"
                    ghost
                    icon="add"
                    aria-label={`安装${item.name}`}
                    disabled={updatingMcpId === item.id}
                    onClick={() => {
                      void handleUpdateMcpInstalledState(item, true);
                    }}
                  />
                </AriFlex>
              </AriCard>
            ))}
          </AriContainer>
        )}
      </AriContainer>
    </AriContainer>
  );
}
