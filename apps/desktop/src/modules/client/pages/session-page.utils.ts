const OUTPUT_DIR_QUOTED_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*[“"']([^"”']+)[”"']/i;
const OUTPUT_DIR_PLAIN_REGEX =
  /(?:导出到|导出至|输出到|保存到|export\s+to|save\s+to)\s*(\/[^\s`"'，。；！？]+|[a-zA-Z]:\\[^\s`"'，。；！？]+)/i;

// 描述:
//
//   - 清理输出路径尾部标点和多余收尾字符，避免路径解析失败。
//
// Params:
//
//   - path: 原始路径字符串。
//
// Returns:
//
//   - 清理后的路径字符串。
function trimOutputSuffix(path: string): string {
  let result = path.trim().replace(/[，。；！？、]+$/u, "");
  result = result.replace(/[)"'`”]+$/u, "");
  if ((result.startsWith("/") || /^[a-zA-Z]:\\/.test(result)) && /[中里]$/.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
}

// 描述:
//
//   - 从用户输入中提取导出目录，支持中英文关键词与带引号/不带引号写法。
//
// Params:
//
//   - prompt: 用户输入文本。
//
// Returns:
//
//   - 解析到的目录；未命中则返回 undefined。
export function extractOutputDirFromPrompt(prompt: string): string | undefined {
  const quotedMatch = prompt.match(OUTPUT_DIR_QUOTED_REGEX);
  if (quotedMatch?.[1]) {
    const normalized = trimOutputSuffix(quotedMatch[1]);
    return normalized || undefined;
  }

  const plainMatch = prompt.match(OUTPUT_DIR_PLAIN_REGEX);
  if (plainMatch?.[1]) {
    const normalized = trimOutputSuffix(plainMatch[1]);
    return normalized || undefined;
  }

  return undefined;
}
