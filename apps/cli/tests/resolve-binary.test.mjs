import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeBinary, resolveRuntimeBinaryName } from "../scripts/resolve-binary.mjs";

// 描述：
//
//   - 验证 npm CLI 在 Windows 上会解析 `.exe` 二进制名。
test("resolveRuntimeBinaryName should use exe on windows", () => {
  assert.equal(resolveRuntimeBinaryName("win32"), "libra-runtime.exe");
  assert.equal(resolveRuntimeBinaryName("darwin"), "libra-runtime");
});

// 描述：
//
//   - 验证显式环境变量应优先覆盖本地 vendor 与 PATH 回退逻辑。
test("resolveRuntimeBinary should prefer explicit env path", () => {
  const resolved = resolveRuntimeBinary({ LIBRA_RUNTIME_BIN: "/tmp/custom-libra-runtime" });
  assert.equal(resolved, "/tmp/custom-libra-runtime");
});
