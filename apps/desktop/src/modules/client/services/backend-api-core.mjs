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
  const normalizedMessage = message && String(message).trim().length > 0 ? String(message).trim() : "";

  if (code === 100001001) {
    return "登录状态已失效，请重新登录。";
  }
  if (code === 100002001) {
    return "邮箱格式不正确，请检查后重试。";
  }
  if (code === 100002002 || code === 1008001004) {
    return "登录信息不完整或格式不正确，请检查后重试。";
  }

  const lowerMessage = normalizedMessage.toLowerCase();
  if (
    lowerMessage.includes("password") ||
    lowerMessage.includes("请求数据不合法") ||
    lowerMessage.includes("参数:")
  ) {
    return "请求参数不正确，请检查输入后重试。";
  }

  if (normalizedMessage.length > 0) {
    return fallback;
  }
  return fallback;
}

// 描述：构建网络层失败文案，统一提示服务可达性与跨域配置问题。
export function buildNetworkFailureMessage(url, detail) {
  void url;
  void detail;
  return "无法连接后端服务，请确认服务已启动后重试。";
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
