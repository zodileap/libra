package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq"
	specs "github.com/zodileap/libra/services/internal/setup/specs"
)

var (
	// 描述：setup 默认执行的 PostgreSQL 初始化语句，用于创建安装元数据和系统设置表。
	defaultMigrationStatements = []string{
		`CREATE TABLE IF NOT EXISTS libra_installation (
			id INTEGER PRIMARY KEY,
			setup_status TEXT NOT NULL,
			current_step TEXT NOT NULL,
			system_name TEXT NOT NULL DEFAULT '',
			admin_user_id TEXT NOT NULL DEFAULT '',
			installed BOOLEAN NOT NULL DEFAULT FALSE,
			installed_at TIMESTAMPTZ NULL,
			installed_version TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS libra_system_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
	}
)

// 描述：对数据库配置执行可达性校验，当前阶段只支持 PostgreSQL。
func defaultDatabasePinger(req specs.SetupDatabaseConfigReq) error {
	if strings.ToLower(strings.TrimSpace(req.Type)) != "postgres" {
		return NewInvalidParamError("当前仅支持 PostgreSQL 初始化。")
	}
	db, err := openPostgres(req)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return NewDependencyError("无法连接数据库，请检查地址、账号和密码后重试。", err)
	}
	return nil
}

// 描述：执行 PostgreSQL 初始化语句，创建安装元数据和系统设置表。
func defaultMigrationRunner(req specs.SetupDatabaseConfigReq) ([]string, error) {
	db, err := openPostgres(req)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	for _, statement := range defaultMigrationStatements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return nil, NewDependencyError("执行数据库迁移失败，请检查数据库权限和目标 schema。", err)
		}
	}
	return append([]string(nil), defaultMigrationStatements...), nil
}

// 描述：将最终安装结果写入 PostgreSQL 安装元数据表和系统设置表。
func defaultMetadataWriter(req specs.SetupDatabaseConfigReq, status specs.SetupStatusResp) error {
	db, err := openPostgres(req)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if _, err := db.ExecContext(
		ctx,
		`INSERT INTO libra_installation (id, setup_status, current_step, system_name, admin_user_id, installed, installed_at, installed_version, updated_at)
		 VALUES (1, $1, $2, $3, $4, $5, NULLIF($6, ''), $7, NOW())
		 ON CONFLICT (id) DO UPDATE SET
		   setup_status = EXCLUDED.setup_status,
		   current_step = EXCLUDED.current_step,
		   system_name = EXCLUDED.system_name,
		   admin_user_id = EXCLUDED.admin_user_id,
		   installed = EXCLUDED.installed,
		   installed_at = EXCLUDED.installed_at,
		   installed_version = EXCLUDED.installed_version,
		   updated_at = NOW()`,
		status.SetupStatus,
		status.CurrentStep,
		stringOrEmpty(status.SystemConfig, func(config *specs.SetupSystemConfigReq) string { return config.SystemName }),
		stringOrEmpty(status.Admin, func(admin *specs.SetupAdminSummary) string { return admin.AdminUserID }),
		status.Installed,
		status.InstalledAt,
		status.InstalledVersion,
	); err != nil {
		return NewDependencyError("写入安装元数据失败，请检查数据库权限。", err)
	}
	if status.SystemConfig == nil {
		return nil
	}
	settings := map[string]string{
		"system_name":         status.SystemConfig.SystemName,
		"base_url":            status.SystemConfig.BaseURL,
		"default_language":    status.SystemConfig.DefaultLanguage,
		"timezone":            status.SystemConfig.Timezone,
		"allow_public_signup": fmt.Sprintf("%t", status.SystemConfig.AllowPublicSignup),
	}
	for key, value := range settings {
		if _, err := db.ExecContext(
			ctx,
			`INSERT INTO libra_system_settings (key, value, updated_at)
			 VALUES ($1, $2, NOW())
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
			key,
			value,
		); err != nil {
			return NewDependencyError("写入系统设置失败，请检查数据库权限。", err)
		}
	}
	return nil
}

// 描述：打开 PostgreSQL 连接，并根据请求拼装 DSN。
func openPostgres(req specs.SetupDatabaseConfigReq) (*sql.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		strings.TrimSpace(req.Host),
		req.Port,
		strings.TrimSpace(req.User),
		req.Password,
		strings.TrimSpace(req.Database),
		normalizeSSLMode(req.SSLMode),
	)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, NewDependencyError("初始化数据库连接失败，请检查驱动配置。", err)
	}
	return db, nil
}

// 描述：归一化 SSL Mode 配置，空值时回退为 disable，便于本地 PostgreSQL 首装。
func normalizeSSLMode(raw string) string {
	sslMode := strings.TrimSpace(raw)
	if sslMode == "" {
		return "disable"
	}
	return sslMode
}

// 描述：从可选指针结构中安全提取字符串，避免 finalize 持久化时空指针访问。
func stringOrEmpty[T any](value *T, fn func(*T) string) string {
	if value == nil {
		return ""
	}
	return fn(value)
}
