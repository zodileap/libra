// 描述：根据鉴权开关与 token 构建请求头。
export function buildAuthHeaders(token, authEnabled) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (authEnabled && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

// 描述：判断响应是否属于未授权场景。
export function isUnauthorizedResponse(httpStatus, code) {
  return httpStatus === 401 || code === 100001001;
}

// 描述：构建标准化后端错误信息。
export function buildBackendErrorMessage(code, message, fallback) {
  if (message && String(message).trim().length > 0) {
    return `[${code}] ${message}`;
  }
  return fallback;
}

// 描述：将对象转换为查询字符串。
export function toQueryString(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
}
