package service

import (
	"errors"
	"testing"

	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

// 描述：测试用 account 客户端桩，实现初始化状态与管理员创建响应控制。
type fakeAccountClient struct {
	status AccountBootstrapStatus
	admin  specs.SetupAdminSummary
	err    error
}

// 描述：返回测试用的 account bootstrap 状态。
func (f *fakeAccountClient) BootstrapStatus() (AccountBootstrapStatus, error) {
	if f.err != nil {
		return AccountBootstrapStatus{}, f.err
	}
	return f.status, nil
}

// 描述：返回测试用的管理员创建结果。
func (f *fakeAccountClient) BootstrapAdmin(specs.SetupAdminReq) (specs.SetupAdminSummary, bool, error) {
	if f.err != nil {
		return specs.SetupAdminSummary{}, false, f.err
	}
	return f.admin, true, nil
}

// 描述：创建测试用 setup 服务实例，并允许覆盖依赖函数和 account 客户端。
func newTestSetupService(t *testing.T, accountClient AccountClient, pinger DatabasePinger, runner MigrationRunner, writer MetadataWriter) *SetupService {
	t.Helper()
	service, err := NewSetupService(SetupServiceOptions{
		DataDir:         t.TempDir(),
		Version:         "0.1.0",
		AccountClient:   accountClient,
		DatabasePinger:  pinger,
		MigrationRunner: runner,
		MetadataWriter:  writer,
	})
	if err != nil {
		t.Fatalf("创建测试用 setup 服务失败: %v", err)
	}
	return service
}

// 描述：校验 setup 服务完整初始化链路，包括数据库、系统设置、管理员和 finalize。
func TestSetupServiceLifecycle(t *testing.T) {
	t.Parallel()

	accountClient := &fakeAccountClient{
		status: AccountBootstrapStatus{Available: true, Initialized: false},
		admin:  specs.SetupAdminSummary{AdminUserID: "usr_admin", Name: "Admin", Email: "admin@example.com"},
	}
	metadataWritten := false
	service := newTestSetupService(
		t,
		accountClient,
		func(specs.SetupDatabaseConfigReq) error { return nil },
		func(specs.SetupDatabaseConfigReq) ([]string, error) { return []string{"CREATE TABLE test"}, nil },
		func(req specs.SetupDatabaseConfigReq, status specs.SetupStatusResp) error {
			metadataWritten = true
			if req.Password != "secret" {
				t.Fatalf("metadata writer 应接收到原始数据库密码")
			}
			if !status.Installed || status.SetupStatus != setupStatusCompleted {
				t.Fatalf("metadata writer 应收到完成态状态")
			}
			return nil
		},
	)

	validateResp, err := service.ValidateDatabase(specs.SetupDatabaseConfigReq{
		Type:     "postgres",
		Host:     "127.0.0.1",
		Port:     5432,
		User:     "postgres",
		Password: "secret",
		Database: "libra",
	})
	if err != nil {
		t.Fatalf("数据库校验失败: %v", err)
	}
	if !validateResp.Validated || !validateResp.Summary.IsValidated {
		t.Fatalf("数据库校验后应返回 validated=true")
	}

	migrateResp, err := service.MigrateDatabase()
	if err != nil {
		t.Fatalf("数据库迁移失败: %v", err)
	}
	if !migrateResp.Migrated || !migrateResp.Summary.IsMigrated {
		t.Fatalf("数据库迁移后应返回 migrated=true")
	}

	_, err = service.SaveSystemConfig(specs.SetupSystemConfigReq{
		SystemName:        "Libra",
		BaseURL:           "http://127.0.0.1:5173",
		DefaultLanguage:   "zh-CN",
		Timezone:          "Asia/Shanghai",
		AllowPublicSignup: false,
	})
	if err != nil {
		t.Fatalf("保存系统设置失败: %v", err)
	}

	adminResp, err := service.CreateAdmin(specs.SetupAdminReq{
		Name:             "Admin",
		Email:            "admin@example.com",
		Password:         "secret123",
		OrganizationName: "Libra",
	})
	if err != nil {
		t.Fatalf("创建管理员失败: %v", err)
	}
	if !adminResp.Created || adminResp.Admin.AdminUserID != "usr_admin" {
		t.Fatalf("管理员创建结果不正确: %+v", adminResp)
	}

	finalizeResp, err := service.Finalize(specs.SetupFinalizeReq{})
	if err != nil {
		t.Fatalf("完成初始化失败: %v", err)
	}
	if !finalizeResp.Completed || !finalizeResp.Status.Installed {
		t.Fatalf("finalize 后应标记安装完成")
	}
	if !metadataWritten {
		t.Fatalf("finalize 应调用 metadata writer")
	}

	statusResp, err := service.Status()
	if err != nil {
		t.Fatalf("查询状态失败: %v", err)
	}
	if statusResp.CurrentStep != setupStepCompleted {
		t.Fatalf("当前步骤应为 completed，got=%s", statusResp.CurrentStep)
	}
}

// 描述：校验 setup 服务会拒绝乱序步骤，例如未迁移数据库前保存系统设置。
func TestSetupServiceShouldRejectOutOfOrderSteps(t *testing.T) {
	t.Parallel()

	service := newTestSetupService(
		t,
		&fakeAccountClient{status: AccountBootstrapStatus{Available: true}},
		func(specs.SetupDatabaseConfigReq) error { return nil },
		func(specs.SetupDatabaseConfigReq) ([]string, error) { return []string{"CREATE TABLE test"}, nil },
		func(specs.SetupDatabaseConfigReq, specs.SetupStatusResp) error { return nil },
	)

	if _, err := service.SaveSystemConfig(specs.SetupSystemConfigReq{SystemName: "Libra", BaseURL: "http://127.0.0.1", DefaultLanguage: "zh-CN", Timezone: "Asia/Shanghai"}); err == nil {
		t.Fatalf("未迁移数据库前保存系统设置应失败")
	}
	if _, err := service.CreateAdmin(specs.SetupAdminReq{Name: "Admin", Email: "admin@example.com", Password: "secret123"}); err == nil {
		t.Fatalf("未保存系统设置前创建管理员应失败")
	}
}

// 描述：校验依赖服务异常时会写入失败状态，供前端继续展示错误信息。
func TestSetupServiceShouldRecordDependencyFailure(t *testing.T) {
	t.Parallel()

	service := newTestSetupService(
		t,
		&fakeAccountClient{err: errors.New("account down")},
		func(specs.SetupDatabaseConfigReq) error { return nil },
		func(specs.SetupDatabaseConfigReq) ([]string, error) { return []string{"CREATE TABLE test"}, nil },
		func(specs.SetupDatabaseConfigReq, specs.SetupStatusResp) error { return nil },
	)

	_, err := service.ValidateDatabase(specs.SetupDatabaseConfigReq{
		Type:     "postgres",
		Host:     "127.0.0.1",
		Port:     5432,
		User:     "postgres",
		Password: "secret",
		Database: "libra",
	})
	if err != nil {
		t.Fatalf("数据库校验不应依赖 account")
	}
	_, err = service.MigrateDatabase()
	if err != nil {
		t.Fatalf("数据库迁移不应失败: %v", err)
	}
	_, err = service.SaveSystemConfig(specs.SetupSystemConfigReq{SystemName: "Libra", BaseURL: "http://127.0.0.1", DefaultLanguage: "zh-CN", Timezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatalf("保存系统设置不应失败: %v", err)
	}
	if _, err = service.CreateAdmin(specs.SetupAdminReq{Name: "Admin", Email: "admin@example.com", Password: "secret123"}); err == nil {
		t.Fatalf("account 异常时创建管理员应失败")
	}
	statusResp, err := service.Status()
	if err != nil {
		t.Fatalf("查询状态失败: %v", err)
	}
	if statusResp.SetupStatus != setupStatusFailed || statusResp.LastError == "" {
		t.Fatalf("依赖失败后应记录失败状态和错误信息")
	}
}
