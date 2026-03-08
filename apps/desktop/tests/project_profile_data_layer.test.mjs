import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：
//
//   - 读取 Desktop 源码文件，用于项目结构化信息数据层回归测试。
//
// Params:
//
//   - relativePath: 基于 apps/desktop 的相对路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readDesktopSource(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

test("TestProjectProfileDataShouldProvideCrudAndRevisionConflictGuard", () => {
  const source = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 数据层应暴露 get/save/upsert/patch/bootstrap 全量接口，支持项目级共享结构化信息维护。
  assert.match(source, /export function getProjectWorkspaceProfile\(/);
  assert.match(source, /export function saveProjectWorkspaceProfile\(/);
  assert.match(source, /export function upsertProjectWorkspaceProfile\(/);
  assert.match(source, /export function patchProjectWorkspaceProfile\(/);
  assert.match(source, /export function bootstrapProjectWorkspaceProfile\(/);

  // 描述：
  //
  //   - 保存时应执行 expectedRevision 乐观锁校验，版本不一致返回冲突提示。
  assert.match(source, /const expectedRevision = options\?\.expectedRevision;/);
  assert.match(source, /if \(current\.revision !== expectedRevision\) \{/);
  assert.match(source, /conflict: true/);
  assert.match(source, /结构化信息已被其他会话更新，请刷新后重试。/);
  assert.match(source, /revision: hasCurrent \? current\.revision \+ 1 : 1,/);
});

test("TestProjectProfileBootstrapShouldRemainIdempotentWhenNotForced", () => {
  const source = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - bootstrap 在已有 profile 且未 force 时应直接返回，保证重复执行不脏写。
  assert.match(source, /const current = profiles\[workspaceId\];/);
  assert.match(source, /if \(current && !options\?\.force\) \{\s*return current;\s*\}/s);
  assert.match(source, /revision: current\?\.revision \? current\.revision \+ 1 : bootstrap\.revision,/);
});

test("TestProjectProfileNormalizeShouldUpgradeSchemaAndKeepEmptyLists", () => {
  const source = readDesktopSource("src/shared/data.ts");

  // 描述：
  //
  //   - 归一化时应自动提升 schemaVersion 到当前版本，避免旧版本签名长期滞留。
  assert.match(source, /Math\.max\(PROJECT_WORKSPACE_PROFILE_SCHEMA_VERSION, Math\.trunc\(sourceSchemaVersion\)\)/);

  // 描述：
  //
  //   - 新字段与旧字段兼容迁移时，应使用 ?? 保留“用户主动清空数组”的结果，避免被旧字段回填。
  assert.match(source, /apiDataModel\.entities \?\? legacyApiSpec\.services/);
  assert.match(source, /frontendPageLayout\.pages \?\? legacyUiSpec\.pages/);
  assert.match(source, /frontendCodeStructure\.directories \?\? legacyArchitecture\.modules/);
  assert.match(source, /value\.codingConventions \?\? value\.domainRules/);
});
