import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：读取仓库文件文本，供文档与 README 回归测试复用。
//
// Params:
//
//   - relativePath: 基于仓库根目录的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readRepoSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestDesktopSelfHostedUpdateDocsShouldDescribeStaticManifestFlow", () => {
  const rootReadme = readRepoSource("README.md");
  const desktopReadme = readRepoSource("apps/desktop/README.md");
  const docSource = readRepoSource("docs/desktop-self-hosted-updates.md");

  // 描述：
  //
  //   - 仓库文档应明确说明默认官方更新源、设置页可覆盖、以及私有自托管的静态更新目录结构。
  assert.match(rootReadme, /默认读取官方静态更新源，也允许改成私有自托管 `latest\.json`/);
  assert.match(rootReadme, /docs\/desktop-self-hosted-updates\.md/);
  assert.match(desktopReadme, /Desktop 默认静态更新源：`https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json`/);
  assert.match(desktopReadme, /Settings > General > Update Manifest URL/);
  assert.match(docSource, /默认官方更新源：`https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json`/);
  assert.match(docSource, /Settings > General > Update Manifest URL/);
  assert.match(docSource, /\/workflow\/v1\/desktop-update\/check/);
  assert.match(docSource, /latest\.json/);
  assert.match(docSource, /downloads\/\{version\}/);
  assert.match(docSource, /windows-x86_64/);
  assert.match(docSource, /darwin-aarch64/);
  assert.match(docSource, /linux-x86_64/);
});
