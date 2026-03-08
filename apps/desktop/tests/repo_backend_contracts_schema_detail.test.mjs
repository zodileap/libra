import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 描述：根据当前执行目录推导仓库根路径，兼容在仓库根和 apps/desktop 下运行测试。
//
// Returns:
//
//   - 仓库根目录绝对路径。
function resolveRepoRoot() {
  const currentDir = process.cwd();
  if (currentDir.endsWith(path.join("apps", "desktop"))) {
    return path.resolve(currentDir, "..", "..");
  }
  return currentDir;
}

// 描述：读取契约文档文本，用于做结构级断言。
//
// Params:
//
//   - relativePath: 相对仓库根目录的路径。
//
// Returns:
//
//   - UTF-8 文本内容。
function readContract(relativePath) {
  return fs.readFileSync(path.resolve(resolveRepoRoot(), relativePath), "utf8");
}

test("TestBackendContractShouldDefineUnifiedEnvelopeAndSyncRules", () => {
  const backendSource = readContract("services/contracts/backend.yaml");

  // 描述:
  //
  //   - 统一后端契约必须定义统一响应包、单地址入口和契约同步规则。
  assert.match(backendSource, /service:/);
  assert.match(backendSource, /command: go run \.\/cmd\/server/);
  assert.match(backendSource, /external_address_count: 1/);
  assert.match(backendSource, /schemas:/);
  assert.match(backendSource, /SuccessEnvelope:/);
  assert.match(backendSource, /ErrorEnvelope:/);
  assert.match(backendSource, /examples:/);
  assert.match(backendSource, /route_dispatch:/);
  assert.match(backendSource, /contract_sync_rules:/);
  assert.match(backendSource, /must_update_same_change_when:/);
});

test("TestAccountContractShouldDefineEnumsSchemasAndErrors", () => {
  const accountSource = readContract("services/contracts/account.yaml");

  // 描述:
  //
  //   - account 契约必须具备字段级 schema、错误码表、枚举和端点级错误映射。
  assert.match(accountSource, /enums:/);
  assert.match(accountSource, /permission_code:/);
  assert.match(accountSource, /error_catalog:/);
  assert.match(accountSource, /invalid_credential:/);
  assert.match(accountSource, /schemas:/);
  assert.match(accountSource, /AuthLoginReq:/);
  assert.match(accountSource, /required: \[email, password\]/);
  assert.match(accountSource, /AuthBootstrapAdminReq:/);
  assert.match(accountSource, /AuthPermissionGrantItem:/);
  assert.match(accountSource, /endpoints:/);
  assert.match(accountSource, /operation_id: login/);
  assert.match(accountSource, /examples:/);
  assert.match(accountSource, /Authorization: Bearer atk_example_token/);
  assert.match(accountSource, /case: invalid_credential/);
  assert.match(accountSource, /errors:\n      - invalid_email\n      - invalid_param\n      - invalid_credential/s);
});

test("TestRuntimeContractShouldDefinePaginationSchemasAndErrors", () => {
  const runtimeSource = readContract("services/contracts/runtime.yaml");

  // 描述:
  //
  //   - runtime 契约必须明确分页规则、字段级 schema 和错误码表。
  assert.match(runtimeSource, /runtime_rules:/);
  assert.match(runtimeSource, /pagination:/);
  assert.match(runtimeSource, /page_size_max: 200/);
  assert.match(runtimeSource, /error_catalog:/);
  assert.match(runtimeSource, /bad_request:/);
  assert.match(runtimeSource, /schemas:/);
  assert.match(runtimeSource, /WorkflowSessionCreateReq:/);
  assert.match(runtimeSource, /WorkflowSessionMessageListResp:/);
  assert.match(runtimeSource, /one_of_required:/);
  assert.match(runtimeSource, /examples:/);
  assert.match(runtimeSource, /sessionId: sess_example_01/);
  assert.match(runtimeSource, /case: not_found/);
  assert.match(runtimeSource, /operation_id: checkDesktopUpdate/);
});

test("TestSetupContractShouldDefineDatabaseTablesSchemasAndErrors", () => {
  const setupSource = readContract("services/contracts/setup.yaml");

  // 描述:
  //
  //   - setup 契约必须定义初始化状态机、数据库表结构、字段级 schema 和错误码表。
  assert.match(setupSource, /postgres_metadata_tables:/);
  assert.match(setupSource, /libra_installation:/);
  assert.match(setupSource, /libra_system_settings:/);
  assert.match(setupSource, /enums:/);
  assert.match(setupSource, /setup_status:/);
  assert.match(setupSource, /setup_step:/);
  assert.match(setupSource, /error_catalog:/);
  assert.match(setupSource, /dependency_error:/);
  assert.match(setupSource, /schemas:/);
  assert.match(setupSource, /SetupDatabaseConfigReq:/);
  assert.match(setupSource, /required: \[type, host, port, user, password, database\]/);
  assert.match(setupSource, /workflow_constraints:/);
  assert.match(setupSource, /examples:/);
  assert.match(setupSource, /Location: \/setup/);
  assert.match(setupSource, /case: conflict/);
  assert.match(setupSource, /operation_id: finalize/);
});
