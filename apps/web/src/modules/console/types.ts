import type { I18nTranslates } from "aries_react";

// 描述：控制台菜单项定义，支持通过 children 构建层级菜单。
export interface ConsoleMenuItem {
  key: string;
  label: string;
  path: string;
  children?: ConsoleMenuItem[];
}

// 描述：登录用户基础信息。
export interface ConsoleUserInfo {
  id: string;
  name: string;
  email?: string;
}

// 描述：用户身份信息，支持公司成员、部门成员与独立用户等形态。
export interface ConsoleIdentityItem {
  id: string;
  type: string;
  scopeName: string;
  roles: string[];
  status: string;
}

// 描述：权限模板定义，用于控制台授权操作。
export interface ConsolePermissionTemplate {
  code: string;
  name: string;
  description: string;
  resourceType: string;
}

// 描述：权限授权记录。
export interface ConsolePermissionGrantItem {
  id: string;
  targetUserId: string;
  targetUserName: string;
  permissionCode: string;
  resourceType: string;
  resourceName: string;
  grantedBy: string;
  status: string;
  expiresAt?: string;
}

// 描述：新增权限授权请求。
export interface ConsoleGrantPermissionReq {
  targetUserId: string;
  targetUserName: string;
  permissionCode: string;
  resourceType: string;
  resourceName: string;
  expiresAt?: string;
}

// 描述：控制台上下文数据模型。
export interface ConsoleContextType {
  t: I18nTranslates;
  currentPath: string;
  isAuthenticated: boolean;
  user?: ConsoleUserInfo;
  menuItems: ConsoleMenuItem[];
  identities: ConsoleIdentityItem[];
  selectedIdentity?: ConsoleIdentityItem;
  permissionTemplates: ConsolePermissionTemplate[];
  permissionGrants: ConsolePermissionGrantItem[];
  login: (account: string, password: string) => Promise<void>;
  selectIdentity: (identityId: string) => void;
  logout: () => void;
  refreshAccessData: () => Promise<void>;
  grantPermission: (req: ConsoleGrantPermissionReq) => Promise<void>;
  revokePermission: (grantId: string) => Promise<void>;
}
