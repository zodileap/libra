import { useCallback, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import { AriMessage, useI18n } from "aries_react";
import { ConsoleContext } from "./context";
import { useConsoleMenu } from "./hooks/use-console-menu";
import type {
  ConsoleContextType,
  ConsoleGrantPermissionReq,
  ConsoleIdentityItem,
  ConsolePermissionGrantItem,
  ConsolePermissionTemplate,
  ConsoleUserInfo
} from "./types";

const authStorageKey = "libra_web_console_auth_token";
const selectedIdentityStorageKey = "libra_web_console_selected_identity";

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface LoginData {
  token: string;
  user: {
    id: string;
    name: string;
    email?: string;
  };
}

interface IdentityListData {
  list: Array<{
    identityId: string;
    identityType: string;
    scopeName: string;
    roleCodes: string[];
    status: string;
  }>;
}

interface PermissionTemplateListData {
  list: Array<{
    code: string;
    name: string;
    description: string;
    resourceType: string;
  }>;
}

interface PermissionGrantListData {
  list: Array<{
    grantId: string;
    targetUserId: string;
    targetUserName: string;
    permissionCode: string;
    resourceType: string;
    resourceName: string;
    grantedBy: string;
    status: string;
    expiresAt?: string;
  }>;
}

// 描述：按运行环境解析 account 服务地址；开发态默认走 Vite 同源代理，避免端口不一致导致 404。
function resolveAccountBaseUrl(envValue: string | undefined): string {
  if (envValue && envValue.trim().length > 0) {
    return envValue.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "/__api/account";
  }
  return "http://127.0.0.1:18080";
}

const accountBaseUrl = resolveAccountBaseUrl(import.meta.env.VITE_APP_API_URL as string | undefined);

// 描述：统一请求 account 服务并返回 data 字段。
async function requestAccountApi<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", token);
  }

  const response = await fetch(`${accountBaseUrl}/auth/v1${path}`, {
    ...options,
    headers
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.code !== 200) {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

// 描述：将后端错误转换为用户友好文案。
function mapFriendlyError(err: unknown, fallbackText: string): string {
  const text = err instanceof Error ? err.message : "";
  if (text.includes("email") || text.includes("password") || text.includes("用户名") || text.includes("密码")) {
    return "账号或密码错误，请检查后重试。";
  }
  if (text.includes("token") || text.includes("身份令牌")) {
    return "登录状态已失效，请重新登录。";
  }
  if (text.includes("权限") || text.includes("permission")) {
    return "当前无操作权限，请联系管理员。";
  }
  return fallbackText;
}

// 描述：控制台 Provider，统一承载登录态、身份信息与权限授权管理。
export function ConsoleProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const { t } = useI18n(["router"]);
  const menuItems = useConsoleMenu(t);
  const [user, setUser] = useState<ConsoleUserInfo | undefined>();
  const [identities, setIdentities] = useState<ConsoleIdentityItem[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | undefined>(() =>
    localStorage.getItem(selectedIdentityStorageKey) || undefined
  );
  const [permissionTemplates, setPermissionTemplates] = useState<ConsolePermissionTemplate[]>([]);
  const [permissionGrants, setPermissionGrants] = useState<ConsolePermissionGrantItem[]>([]);

  // 描述：根据选中身份 ID 解析当前身份对象，供界面与路由守卫复用。
  const selectedIdentity = useMemo(
    () => identities.find((item) => item.id === selectedIdentityId),
    [identities, selectedIdentityId]
  );

  // 描述：读取本地 token，用于刷新身份与权限数据。
  const readToken = useCallback(() => localStorage.getItem(authStorageKey) || "", []);

  // 描述：刷新当前登录用户的身份与权限数据。
  const refreshAccessData = useCallback(async () => {
    const token = readToken();
    if (!token) {
      return;
    }

    try {
      const [identityData, templateData, grantData] = await Promise.all([
        requestAccountApi<IdentityListData>("/identities", { method: "GET" }, token),
        requestAccountApi<PermissionTemplateListData>("/permission-templates", { method: "GET" }, token),
        requestAccountApi<PermissionGrantListData>("/permission-grants", { method: "GET" }, token)
      ]);

      const mappedIdentities = identityData.list.map((item) => ({
        id: item.identityId,
        type: item.identityType,
        scopeName: item.scopeName,
        roles: item.roleCodes,
        status: item.status
      }));
      setIdentities(mappedIdentities);
      setSelectedIdentityId((prevId) => {
        if (mappedIdentities.length === 0) {
          localStorage.removeItem(selectedIdentityStorageKey);
          return undefined;
        }

        if (prevId && mappedIdentities.some((item) => item.id === prevId)) {
          localStorage.setItem(selectedIdentityStorageKey, prevId);
          return prevId;
        }

        const storedId = localStorage.getItem(selectedIdentityStorageKey) || "";
        if (storedId && mappedIdentities.some((item) => item.id === storedId)) {
          localStorage.setItem(selectedIdentityStorageKey, storedId);
          return storedId;
        }

        if (mappedIdentities.length === 1) {
          const autoSelectedId = mappedIdentities[0].id;
          localStorage.setItem(selectedIdentityStorageKey, autoSelectedId);
          return autoSelectedId;
        }

        localStorage.removeItem(selectedIdentityStorageKey);
        return undefined;
      });
      setPermissionTemplates(templateData.list);
      setPermissionGrants(
        grantData.list.map((item) => ({
          id: item.grantId,
          targetUserId: item.targetUserId,
          targetUserName: item.targetUserName,
          permissionCode: item.permissionCode,
          resourceType: item.resourceType,
          resourceName: item.resourceName,
          grantedBy: item.grantedBy,
          status: item.status,
          expiresAt: item.expiresAt
        }))
      );
    } catch (err) {
      AriMessage.warning({
        content: mapFriendlyError(err, "权限数据加载失败，请稍后重试。"),
        duration: 3000
      });
    }
  }, [readToken]);

  // 描述：执行登录并在成功后加载管理控制台数据。
  const login = useCallback(
    async (account: string, password: string) => {
      try {
        const data = await requestAccountApi<LoginData>("/login", {
          method: "POST",
          body: JSON.stringify({ email: account, password })
        });
        localStorage.setItem(authStorageKey, data.token);
        localStorage.removeItem(selectedIdentityStorageKey);
        setUser({ id: data.user.id, name: data.user.name, email: data.user.email });
        setSelectedIdentityId(undefined);
        await refreshAccessData();
        AriMessage.success({
          content: "登录成功。",
          duration: 2000
        });
      } catch (err) {
        throw new Error(mapFriendlyError(err, "登录失败，请稍后重试。"));
      }
    },
    [refreshAccessData]
  );

  // 描述：清理登录态并返回登录页。
  const logout = useCallback(() => {
    localStorage.removeItem(authStorageKey);
    localStorage.removeItem(selectedIdentityStorageKey);
    setUser(undefined);
    setIdentities([]);
    setSelectedIdentityId(undefined);
    setPermissionTemplates([]);
    setPermissionGrants([]);
    AriMessage.info({
      content: "你已退出登录。",
      duration: 1800
    });
  }, []);

  // 描述：手动选择进入身份，并持久化到本地以支持刷新恢复。
  const selectIdentity = useCallback(
    (identityId: string) => {
      if (!identities.some((item) => item.id === identityId)) {
        AriMessage.warning({ content: "选择的身份无效，请刷新后重试。", duration: 2500 });
        return;
      }
      localStorage.setItem(selectedIdentityStorageKey, identityId);
      setSelectedIdentityId(identityId);
    },
    [identities]
  );

  // 描述：新增权限授权记录并刷新权限列表。
  const grantPermission = useCallback(
    async (req: ConsoleGrantPermissionReq) => {
      const token = readToken();
      if (!token) {
        AriMessage.warning({ content: "登录状态失效，请重新登录。", duration: 2500 });
        return;
      }
      await requestAccountApi(
        "/permission-grant",
        {
          method: "POST",
          body: JSON.stringify(req)
        },
        token
      );
      await refreshAccessData();
      AriMessage.success({ content: "授权成功。", duration: 1800 });
    },
    [readToken, refreshAccessData]
  );

  // 描述：撤销权限授权记录并刷新权限列表。
  const revokePermission = useCallback(
    async (grantId: string) => {
      const token = readToken();
      if (!token) {
        AriMessage.warning({ content: "登录状态失效，请重新登录。", duration: 2500 });
        return;
      }
      await requestAccountApi(
        "/permission-grant",
        {
          method: "DELETE",
          body: JSON.stringify({ grantId })
        },
        token
      );
      await refreshAccessData();
      AriMessage.success({ content: "撤销成功。", duration: 1800 });
    },
    [readToken, refreshAccessData]
  );

  const value: ConsoleContextType = useMemo(
    () => ({
      t,
      currentPath: location.pathname,
      isAuthenticated: Boolean(user),
      user,
      menuItems,
      identities,
      selectedIdentity,
      permissionTemplates,
      permissionGrants,
      login,
      selectIdentity,
      logout,
      refreshAccessData,
      grantPermission,
      revokePermission
    }),
    [
      t,
      location.pathname,
      user,
      menuItems,
      identities,
      selectedIdentity,
      permissionTemplates,
      permissionGrants,
      login,
      selectIdentity,
      logout,
      refreshAccessData,
      grantPermission,
      revokePermission
    ]
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}
