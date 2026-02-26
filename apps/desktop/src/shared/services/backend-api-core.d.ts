// 描述：构建请求头，按需附带身份令牌。
export function buildAuthHeaders(
  token: string,
  authEnabled: boolean,
): {
  "Content-Type": string;
  Authorization?: string;
};

// 描述：判断是否命中未授权响应。
export function isUnauthorizedResponse(httpStatus: number, code: number): boolean;

// 描述：构建标准化错误文案。
export function buildBackendErrorMessage(code: number, message: string, fallback: string): string;

// 描述：构建网络层失败文案。
export function buildNetworkFailureMessage(url: string, detail: string): string;

// 描述：将对象转换为查询字符串。
export function toQueryString(params: Record<string, unknown>): string;
