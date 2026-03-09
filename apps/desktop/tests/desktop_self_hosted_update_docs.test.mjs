import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readRepoSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestDesktopSelfHostedUpdateDocsShouldDescribeOfficialUpdaterFlow", () => {
  const rootReadme = readRepoSource("README.md");
  const desktopReadme = readRepoSource("apps/desktop/README.md");
  const docSource = readRepoSource("docs/desktop-self-hosted-updates.md");
  const releaseScriptSource = readRepoSource("scripts/package-desktop-release.sh");

  assert.match(rootReadme, /默认读取官方静态更新源，也允许改成私有自托管 `latest\.json`/);
  assert.match(rootReadme, /docs\/desktop-self-hosted-updates\.md/);
  assert.match(rootReadme, /pnpm run release:desktop -- 0\.1\.1/);
  assert.match(rootReadme, /\.dmg/);
  assert.match(rootReadme, /\.app\.tar\.gz/);
  assert.match(rootReadme, /releases\/<version>\/macos/);

  assert.match(desktopReadme, /Desktop 默认静态更新源：`https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json`/);
  assert.match(desktopReadme, /Settings > General > Update Manifest URL/);
  assert.match(desktopReadme, /\.app\.tar\.gz \+ \.sig/);

  assert.match(docSource, /默认官方更新源：`https:\/\/open\.zodileap\.com\/libra\/updates\/latest\.json`/);
  assert.match(docSource, /Settings > General > Update Manifest URL/);
  assert.match(docSource, /latest\.json/);
  assert.match(docSource, /downloads\/\{version\}/);
  assert.match(docSource, /windows-x86_64/);
  assert.match(docSource, /darwin-aarch64/);
  assert.match(docSource, /linux-x86_64/);
  assert.match(docSource, /\.dmg/);
  assert.match(docSource, /\.app\.tar\.gz/);
  assert.match(docSource, /\.sig/);
  assert.match(docSource, /安装完成后，应用会自动重启/);
  assert.match(docSource, /releases\/<version>\/macos/);

  assert.match(releaseScriptSource, /Usage:\s+\.\/scripts\/package-desktop-release\.sh <x\.y\.z>/s);
  assert.match(releaseScriptSource, /tauri signer generate --ci -w/);
  assert.match(releaseScriptSource, /tauri build/);
  assert.match(releaseScriptSource, /releases\/<version>\/<platform>\//);
});
