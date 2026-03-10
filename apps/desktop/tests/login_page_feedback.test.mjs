import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述:
//
//   - 读取登录页源码，用于校验登录错误反馈与密码校验交互。
//
// Returns:
//
//   - UTF-8 编码的页面源码文本。
function readLoginPageSource() {
  const sourcePath = path.resolve(process.cwd(), "src/modules/common/pages/login-page.tsx");
  return fs.readFileSync(sourcePath, "utf8");
}

test("TestLoginPageUsesMessageOnlyForLoginFailure", () => {
  const source = readLoginPageSource();

  // 描述:
  //
  //   - 登录页失败提示应仅通过 AriMessage 呈现，不再渲染 AriModal。
  assert.match(source, /AriMessage\.error\(\{/);
  assert.equal(source.includes("<AriModal"), false, "登录页不应再渲染 AriModal 失败弹窗");
  assert.equal(source.includes("AriModal"), false, "登录页不应再引入 AriModal 组件");
});

test("TestLoginPageShowsInlinePasswordValidationHint", () => {
  const source = readLoginPageSource();

  // 描述:
  //
  //   - 密码为空时应给出输入框附近的内联提示，并通过 AriMessage.warning 同步提示。
  assert.match(source, /const \[passwordError, setPasswordError\] = useState\(""\);/);
  assert.match(source, /setPasswordError\(text\);/);
  assert.match(source, /AriMessage\.warning\(\{/);
  assert.match(source, /if \(normalizedPassword\.length < 6\)/);
  assert.match(source, /密码至少需要 6 位字符/);
  assert.match(source, /className="desk-login-password-error"/);
  assert.match(source, /value=\{passwordError\}/);
  assert.match(source, /onChange=\{handlePasswordChange\}/);
});
