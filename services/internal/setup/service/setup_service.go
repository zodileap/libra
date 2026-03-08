package service

import (
	"net/url"
	"strings"
	"time"

	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

// 描述：数据库连通性校验函数类型，便于在测试中注入桩实现。
type DatabasePinger func(specs.SetupDatabaseConfigReq) error

// 描述：数据库迁移执行函数类型，便于在测试中注入桩实现。
type MigrationRunner func(specs.SetupDatabaseConfigReq) ([]string, error)

// 描述：安装元数据写入函数类型，便于在 finalize 阶段持久化安装结果。
type MetadataWriter func(specs.SetupDatabaseConfigReq, specs.SetupStatusResp) error

// 描述：setup 服务创建参数，统一承载状态目录、版本、account 客户端和数据库执行器。
type SetupServiceOptions struct {
	DataDir         string
	Version         string
	AccountBaseURL  string
	SetupToken      string
	AccountClient   AccountClient
	DatabasePinger  DatabasePinger
	MigrationRunner MigrationRunner
	MetadataWriter  MetadataWriter
}

// 描述：初始化服务，负责串联数据库校验、系统设置、管理员创建和安装完成标记。
type SetupService struct {
	store           *stateStore
	version         string
	accountClient   AccountClient
	databasePinger  DatabasePinger
	migrationRunner MigrationRunner
	metadataWriter  MetadataWriter
}

// 描述：创建 setup 服务实例，并为未显式提供的依赖补齐默认实现。
func NewSetupService(options SetupServiceOptions) (*SetupService, error) {
	store, err := newStateStore(options.DataDir)
	if err != nil {
		return nil, err
	}
	accountClient := options.AccountClient
	if accountClient == nil {
		accountClient = NewHTTPAccountClient(options.AccountBaseURL, options.SetupToken, nil)
	}
	databasePinger := options.DatabasePinger
	if databasePinger == nil {
		databasePinger = defaultDatabasePinger
	}
	migrationRunner := options.MigrationRunner
	if migrationRunner == nil {
		migrationRunner = defaultMigrationRunner
	}
	metadataWriter := options.MetadataWriter
	if metadataWriter == nil {
		metadataWriter = defaultMetadataWriter
	}
	version := strings.TrimSpace(options.Version)
	if version == "" {
		version = "0.1.0"
	}
	return &SetupService{
		store:           store,
		version:         version,
		accountClient:   accountClient,
		databasePinger:  databasePinger,
		migrationRunner: migrationRunner,
		metadataWriter:  metadataWriter,
	}, nil
}

// 描述：返回当前初始化状态，并附带 account 服务可用性与管理员初始化信息。
func (s *SetupService) Status() (specs.SetupStatusResp, error) {
	resp, err := withRead(s.store, func(state *setupState) (specs.SetupStatusResp, error) {
		return buildStatusResp(state), nil
	})
	if err != nil {
		return specs.SetupStatusResp{}, err
	}
	accountStatus, err := s.accountClient.BootstrapStatus()
	if err != nil {
		resp.AccountAvailable = false
		resp.AccountInitialized = false
		resp.AccountMessage = AsServiceError(err).Message
		return resp, nil
	}
	resp.AccountAvailable = accountStatus.Available
	resp.AccountInitialized = accountStatus.Initialized
	resp.AccountMessage = accountStatus.Message
	if resp.Admin == nil && accountStatus.AdminUserID != "" {
		resp.Admin = &specs.SetupAdminSummary{AdminUserID: accountStatus.AdminUserID}
	}
	return resp, nil
}

// 描述：校验数据库配置，并在成功后保存当前初始化过程的数据库连接信息。
func (s *SetupService) ValidateDatabase(req specs.SetupDatabaseConfigReq) (specs.SetupDatabaseValidateResp, error) {
	if err := validateDatabaseConfig(req); err != nil {
		return specs.SetupDatabaseValidateResp{}, err
	}
	if _, err := withRead(s.store, func(state *setupState) (bool, error) {
		if state.Installed {
			return false, NewConflictError("系统已完成初始化，不能重复修改数据库配置。")
		}
		return true, nil
	}); err != nil {
		return specs.SetupDatabaseValidateResp{}, err
	}
	if err := s.databasePinger(req); err != nil {
		s.recordFailure(AsServiceError(err).Message)
		return specs.SetupDatabaseValidateResp{}, err
	}
	return withWrite(s.store, func(state *setupState) (specs.SetupDatabaseValidateResp, error) {
		now := nowRFC3339()
		state.SetupStatus = setupStatusPending
		state.LastError = ""
		state.Database = &databaseState{
			Type:        strings.ToLower(strings.TrimSpace(req.Type)),
			Host:        strings.TrimSpace(req.Host),
			Port:        req.Port,
			User:        strings.TrimSpace(req.User),
			Password:    req.Password,
			Database:    strings.TrimSpace(req.Database),
			SSLMode:     normalizeSSLMode(req.SSLMode),
			ValidatedAt: now,
			IsValidated: true,
		}
		return specs.SetupDatabaseValidateResp{Validated: true, Summary: summarizeDatabase(state.Database)}, nil
	})
}

// 描述：执行数据库初始化语句，并在成功后将当前步骤推进到 database_ready。
func (s *SetupService) MigrateDatabase() (specs.SetupDatabaseMigrateResp, error) {
	config, err := withRead(s.store, func(state *setupState) (specs.SetupDatabaseConfigReq, error) {
		if state.Installed {
			return specs.SetupDatabaseConfigReq{}, NewConflictError("系统已完成初始化，不能重复执行数据库迁移。")
		}
		if state.Database == nil || !state.Database.IsValidated {
			return specs.SetupDatabaseConfigReq{}, NewConflictError("请先完成数据库连接校验。")
		}
		return toDatabaseReq(state.Database), nil
	})
	if err != nil {
		return specs.SetupDatabaseMigrateResp{}, err
	}
	statements, err := s.migrationRunner(config)
	if err != nil {
		s.recordFailure(AsServiceError(err).Message)
		return specs.SetupDatabaseMigrateResp{}, err
	}
	return withWrite(s.store, func(state *setupState) (specs.SetupDatabaseMigrateResp, error) {
		state.SetupStatus = setupStatusPending
		state.CurrentStep = setupStepDatabaseReady
		state.LastError = ""
		state.Database.IsMigrated = true
		state.Database.MigratedAt = nowRFC3339()
		state.Database.LastMigrationReport = append([]string(nil), statements...)
		summary := summarizeDatabase(state.Database)
		return specs.SetupDatabaseMigrateResp{Migrated: true, ExecutedStatements: append([]string(nil), statements...), Summary: summary}, nil
	})
}

// 描述：保存系统设置，并在数据库迁移已完成后将当前步骤推进到 system_ready。
func (s *SetupService) SaveSystemConfig(req specs.SetupSystemConfigReq) (specs.SetupSystemConfigResp, error) {
	if err := validateSystemConfig(req); err != nil {
		return specs.SetupSystemConfigResp{}, err
	}
	return withWrite(s.store, func(state *setupState) (specs.SetupSystemConfigResp, error) {
		if state.Installed {
			return specs.SetupSystemConfigResp{}, NewConflictError("系统已完成初始化，不能重复修改系统设置。")
		}
		if state.Database == nil || !state.Database.IsMigrated {
			return specs.SetupSystemConfigResp{}, NewConflictError("请先完成数据库迁移。")
		}
		state.SetupStatus = setupStatusPending
		state.CurrentStep = setupStepSystemReady
		state.LastError = ""
		config := specs.SetupSystemConfigReq{
			SystemName:        strings.TrimSpace(req.SystemName),
			BaseURL:           strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
			DefaultLanguage:   strings.TrimSpace(req.DefaultLanguage),
			Timezone:          strings.TrimSpace(req.Timezone),
			AllowPublicSignup: req.AllowPublicSignup,
		}
		state.SystemConfig = &config
		return specs.SetupSystemConfigResp{Saved: true, Config: config}, nil
	})
}

// 描述：通过 account 服务创建首个管理员，并在成功后将当前步骤推进到 admin_ready。
func (s *SetupService) CreateAdmin(req specs.SetupAdminReq) (specs.SetupAdminResp, error) {
	if err := validateAdmin(req); err != nil {
		return specs.SetupAdminResp{}, err
	}
	if _, err := withRead(s.store, func(state *setupState) (bool, error) {
		if state.Installed {
			return false, NewConflictError("系统已完成初始化，不能重复创建管理员。")
		}
		if state.SystemConfig == nil {
			return false, NewConflictError("请先保存系统设置。")
		}
		return true, nil
	}); err != nil {
		return specs.SetupAdminResp{}, err
	}
	accountStatus, err := s.accountClient.BootstrapStatus()
	if err != nil {
		s.recordFailure(AsServiceError(err).Message)
		return specs.SetupAdminResp{}, err
	}
	if accountStatus.Initialized {
		return withWrite(s.store, func(state *setupState) (specs.SetupAdminResp, error) {
			state.SetupStatus = setupStatusPending
			state.CurrentStep = setupStepAdminReady
			state.LastError = ""
			state.Admin = &specs.SetupAdminSummary{AdminUserID: accountStatus.AdminUserID}
			return specs.SetupAdminResp{Created: false, Admin: *state.Admin}, nil
		})
	}
	admin, created, err := s.accountClient.BootstrapAdmin(req)
	if err != nil {
		s.recordFailure(AsServiceError(err).Message)
		return specs.SetupAdminResp{}, err
	}
	return withWrite(s.store, func(state *setupState) (specs.SetupAdminResp, error) {
		state.SetupStatus = setupStatusPending
		state.CurrentStep = setupStepAdminReady
		state.LastError = ""
		state.Admin = &admin
		return specs.SetupAdminResp{Created: created, Admin: admin}, nil
	})
}

// 描述：完成首次安装，并将最终状态写入数据库元数据表和本地状态文件。
func (s *SetupService) Finalize(req specs.SetupFinalizeReq) (specs.SetupFinalizeResp, error) {
	result, err := withWrite(s.store, func(state *setupState) (specs.SetupFinalizeResp, error) {
		if state.Installed {
			return specs.SetupFinalizeResp{}, NewConflictError("系统已完成初始化，不能重复执行 finalize。")
		}
		if state.Database == nil || !state.Database.IsMigrated {
			return specs.SetupFinalizeResp{}, NewConflictError("请先完成数据库迁移。")
		}
		if state.SystemConfig == nil {
			return specs.SetupFinalizeResp{}, NewConflictError("请先保存系统设置。")
		}
		if state.Admin == nil || strings.TrimSpace(state.Admin.AdminUserID) == "" {
			return specs.SetupFinalizeResp{}, NewConflictError("请先创建管理员。")
		}
		state.SetupStatus = setupStatusCompleted
		state.CurrentStep = setupStepCompleted
		state.Installed = true
		state.InstalledAt = nowRFC3339()
		state.InstalledVersion = strings.TrimSpace(req.InstalledVersion)
		if state.InstalledVersion == "" {
			state.InstalledVersion = s.version
		}
		state.LastError = ""
		status := buildStatusResp(state)
		if err := s.metadataWriter(toDatabaseReq(state.Database), status); err != nil {
			return specs.SetupFinalizeResp{}, err
		}
		return specs.SetupFinalizeResp{Completed: true, Status: status}, nil
	})
	if err != nil {
		s.recordFailure(AsServiceError(err).Message)
		return specs.SetupFinalizeResp{}, err
	}
	return result, nil
}

// 描述：记录失败信息到本地状态，供 Web 首装向导在刷新后继续展示错误上下文。
func (s *SetupService) recordFailure(message string) {
	_, _ = withWrite(s.store, func(state *setupState) (bool, error) {
		state.SetupStatus = setupStatusFailed
		state.LastError = strings.TrimSpace(message)
		return true, nil
	})
}

// 描述：将内部状态转换为对外响应结构，避免暴露数据库密码等敏感字段。
func buildStatusResp(state *setupState) specs.SetupStatusResp {
	resp := specs.SetupStatusResp{
		SetupStatus:      state.SetupStatus,
		CurrentStep:      state.CurrentStep,
		Installed:        state.Installed,
		InstalledAt:      state.InstalledAt,
		InstalledVersion: state.InstalledVersion,
		LastError:        state.LastError,
	}
	if state.Database != nil {
		summary := summarizeDatabase(state.Database)
		resp.Database = &summary
	}
	if state.SystemConfig != nil {
		config := *state.SystemConfig
		resp.SystemConfig = &config
	}
	if state.Admin != nil {
		admin := *state.Admin
		resp.Admin = &admin
	}
	return resp
}

// 描述：将数据库状态转换为脱敏摘要结构，避免在响应中返回密码。
func summarizeDatabase(state *databaseState) specs.SetupDatabaseSummary {
	if state == nil {
		return specs.SetupDatabaseSummary{}
	}
	return specs.SetupDatabaseSummary{
		Type:         state.Type,
		Host:         state.Host,
		Port:         state.Port,
		User:         state.User,
		Database:     state.Database,
		SSLMode:      state.SSLMode,
		ValidatedAt:  state.ValidatedAt,
		MigratedAt:   state.MigratedAt,
		IsValidated:  state.IsValidated,
		IsMigrated:   state.IsMigrated,
		DriverRemark: "postgres",
	}
}

// 描述：将数据库状态还原为数据库请求结构，供迁移和 finalize 写库复用。
func toDatabaseReq(state *databaseState) specs.SetupDatabaseConfigReq {
	return specs.SetupDatabaseConfigReq{
		Type:     state.Type,
		Host:     state.Host,
		Port:     state.Port,
		User:     state.User,
		Password: state.Password,
		Database: state.Database,
		SSLMode:  state.SSLMode,
	}
}

// 描述：校验数据库配置，当前阶段要求完整的 PostgreSQL 连接信息。
func validateDatabaseConfig(req specs.SetupDatabaseConfigReq) error {
	if strings.ToLower(strings.TrimSpace(req.Type)) != "postgres" {
		return NewInvalidParamError("当前仅支持 PostgreSQL 初始化。")
	}
	if strings.TrimSpace(req.Host) == "" || req.Port <= 0 || strings.TrimSpace(req.User) == "" || strings.TrimSpace(req.Database) == "" {
		return NewInvalidParamError("数据库连接信息不完整，请检查后重试。")
	}
	if strings.TrimSpace(req.Password) == "" {
		return NewInvalidParamError("数据库密码不能为空。")
	}
	return nil
}

// 描述：校验系统设置，要求站点名称、访问地址、默认语言和时区均存在且地址合法。
func validateSystemConfig(req specs.SetupSystemConfigReq) error {
	if strings.TrimSpace(req.SystemName) == "" || strings.TrimSpace(req.DefaultLanguage) == "" || strings.TrimSpace(req.Timezone) == "" {
		return NewInvalidParamError("系统设置不完整，请检查后重试。")
	}
	baseURL := strings.TrimSpace(req.BaseURL)
	if baseURL == "" {
		return NewInvalidParamError("平台访问地址不能为空。")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return NewInvalidParamError("平台访问地址格式不正确，请检查后重试。")
	}
	return nil
}

// 描述：校验管理员初始化参数，要求姓名、邮箱和密码均合法。
func validateAdmin(req specs.SetupAdminReq) error {
	if strings.TrimSpace(req.Name) == "" {
		return NewInvalidParamError("管理员名称不能为空。")
	}
	if strings.TrimSpace(req.Email) == "" || !strings.Contains(req.Email, "@") {
		return NewInvalidParamError("管理员邮箱格式不正确，请检查后重试。")
	}
	if len(strings.TrimSpace(req.Password)) < 6 {
		return NewInvalidParamError("管理员密码长度至少为 6 位。")
	}
	return nil
}

// 描述：生成统一的当前时间字符串，保证状态文件与响应字段格式一致。
func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
