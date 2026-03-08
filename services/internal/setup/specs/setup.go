package specs

// 描述：数据库配置请求，首期仅支持 PostgreSQL。
type SetupDatabaseConfigReq struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
	SSLMode  string `json:"sslMode,omitempty"`
}

// 描述：数据库配置脱敏摘要，用于状态展示和响应返回。
type SetupDatabaseSummary struct {
	Type         string `json:"type"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	Database     string `json:"database"`
	SSLMode      string `json:"sslMode,omitempty"`
	ValidatedAt  string `json:"validatedAt,omitempty"`
	MigratedAt   string `json:"migratedAt,omitempty"`
	IsValidated  bool   `json:"isValidated"`
	IsMigrated   bool   `json:"isMigrated"`
	DriverRemark string `json:"driverRemark,omitempty"`
}

// 描述：数据库校验返回结构。
type SetupDatabaseValidateResp struct {
	Validated bool                 `json:"validated"`
	Summary   SetupDatabaseSummary `json:"summary"`
}

// 描述：数据库迁移返回结构。
type SetupDatabaseMigrateResp struct {
	Migrated           bool                 `json:"migrated"`
	ExecutedStatements []string             `json:"executedStatements"`
	Summary            SetupDatabaseSummary `json:"summary"`
}

// 描述：系统设置请求，定义安装完成后的基础站点配置。
type SetupSystemConfigReq struct {
	SystemName        string `json:"systemName"`
	BaseURL           string `json:"baseUrl"`
	DefaultLanguage   string `json:"defaultLanguage"`
	Timezone          string `json:"timezone"`
	AllowPublicSignup bool   `json:"allowPublicSignup"`
}

// 描述：系统设置返回结构。
type SetupSystemConfigResp struct {
	Saved  bool                 `json:"saved"`
	Config SetupSystemConfigReq `json:"config"`
}

// 描述：创建首个管理员请求，供 setup 服务转发给 account 服务。
type SetupAdminReq struct {
	Name             string `json:"name"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	OrganizationName string `json:"organizationName,omitempty"`
}

// 描述：管理员摘要结构，供状态和响应展示。
type SetupAdminSummary struct {
	AdminUserID string `json:"adminUserId,omitempty"`
	Name        string `json:"name,omitempty"`
	Email       string `json:"email,omitempty"`
}

// 描述：管理员创建返回结构。
type SetupAdminResp struct {
	Created bool              `json:"created"`
	Admin   SetupAdminSummary `json:"admin"`
}

// 描述：初始化状态返回结构，统一给 Web 向导和 Desktop 检测逻辑使用。
type SetupStatusResp struct {
	SetupStatus        string                `json:"setupStatus"`
	CurrentStep        string                `json:"currentStep"`
	Installed          bool                  `json:"installed"`
	InstalledAt        string                `json:"installedAt,omitempty"`
	InstalledVersion   string                `json:"installedVersion,omitempty"`
	LastError          string                `json:"lastError,omitempty"`
	Database           *SetupDatabaseSummary `json:"database,omitempty"`
	SystemConfig       *SetupSystemConfigReq `json:"systemConfig,omitempty"`
	Admin              *SetupAdminSummary    `json:"admin,omitempty"`
	AccountAvailable   bool                  `json:"accountAvailable"`
	AccountInitialized bool                  `json:"accountInitialized"`
	AccountMessage     string                `json:"accountMessage,omitempty"`
}

// 描述：完成初始化请求，允许附带版本说明以覆盖默认版本号。
type SetupFinalizeReq struct {
	InstalledVersion string `json:"installedVersion,omitempty"`
}

// 描述：完成初始化返回结构。
type SetupFinalizeResp struct {
	Completed bool            `json:"completed"`
	Status    SetupStatusResp `json:"status"`
}
