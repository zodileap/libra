use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

/// 描述：前端可消费的 MCP 注册项结构，统一输出注册配置、运行时模式与可移除能力。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrationRecord {
    pub id: String,
    #[serde(default)]
    pub template_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_mcp_domain")]
    pub domain: String,
    #[serde(default)]
    pub software: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub supports_import: bool,
    #[serde(default)]
    pub supports_export: bool,
    pub transport: String,
    pub scope: String,
    pub enabled: bool,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub docs_url: String,
    #[serde(default)]
    pub official_provider: String,
    #[serde(default)]
    pub runtime_kind: String,
    #[serde(default)]
    pub removable: bool,
}

/// 描述：前端可消费的 MCP 模板结构，用于“推荐模板”区域展示与预填。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTemplateRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub domain: String,
    pub software: String,
    pub capabilities: Vec<String>,
    pub priority: i64,
    pub supports_import: bool,
    pub supports_export: bool,
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub docs_url: String,
    pub official_provider: String,
    pub runtime_kind: String,
}

/// 描述：MCP 注册表总览结构，供前端同时渲染“已注册”和“推荐模板”。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryOverview {
    pub registered: Vec<McpRegistrationRecord>,
    pub templates: Vec<McpTemplateRecord>,
}

/// 描述：前端提交的 MCP 注册草稿，支持新建和编辑两类场景。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrationPayload {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub template_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub software: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub supports_import: bool,
    #[serde(default)]
    pub supports_export: bool,
    #[serde(default)]
    pub transport: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub docs_url: String,
    #[serde(default)]
    pub official_provider: String,
    #[serde(default)]
    pub runtime_kind: String,
}

/// 描述：MCP 预校验结果，用于页面上的“校验”动作反馈。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpValidationResult {
    pub ok: bool,
    pub message: String,
    pub resolved_path: String,
}

/// 描述：返回默认 MCP 领域值，供旧注册表缺失字段时自动回退到通用模式。
fn default_mcp_domain() -> String {
    "general".to_string()
}

/// 描述：解析 Codex Home 根目录，优先读取 `CODEX_HOME`，未配置时回退到当前用户主目录下的 `.codex`。
///
/// Returns:
///
///   - Codex Home 路径；若环境变量与主目录均不可用则返回错误。
fn resolve_codex_home() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("CODEX_HOME") {
        let candidate = PathBuf::from(value);
        if !candidate.as_os_str().is_empty() {
            return Ok(candidate);
        }
    }
    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home).join(".codex"));
    }
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(user_profile).join(".codex"));
    }
    Err("未找到 CODEX_HOME 或用户主目录，无法解析 MCP 注册表目录。".to_string())
}

/// 描述：解析用户级 MCP 注册表文件路径，统一持久化到 `$CODEX_HOME/mcps/registry.json`。
///
/// Returns:
///
///   - MCP 注册表文件路径。
fn resolve_user_mcp_registry_path() -> Result<PathBuf, String> {
    Ok(resolve_codex_home()?.join("mcps").join("registry.json"))
}

/// 描述：解析 workspace 级 MCP 注册表路径，统一收敛到 `<workspace>/.zodileap/mcps/registry.json`。
///
/// Params:
///
///   - workspace_root: 项目根目录。
///
/// Returns:
///
///   - workspace 级 MCP 注册表路径。
fn resolve_workspace_mcp_registry_path(workspace_root: &str) -> Result<PathBuf, String> {
    let normalized = workspace_root.trim();
    if normalized.is_empty() {
        return Err("workspace 级 MCP 需要提供项目根目录。".to_string());
    }
    Ok(PathBuf::from(normalized)
        .join(".zodileap")
        .join("mcps")
        .join("registry.json"))
}

/// 描述：确保指定注册表目录存在，供写入时复用。
///
/// Params:
///
///   - registry_path: 注册表文件路径。
///
/// Returns:
///
///   - 0: 目录准备成功。
fn ensure_registry_parent(registry_path: &Path) -> Result<(), String> {
    let parent = registry_path
        .parent()
        .ok_or_else(|| "MCP 注册表路径缺少父目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|err| format!("创建 MCP 注册表目录失败：{}", err))?;
    Ok(())
}

/// 描述：返回内置 MCP 模板清单，供页面从标准模板快速创建注册项。
///
/// Returns:
///
///   - MCP 模板列表。
fn builtin_mcp_templates() -> Vec<McpTemplateRecord> {
    vec![
        McpTemplateRecord {
            id: "playwright-mcp".to_string(),
            name: "Playwright 浏览器自动化".to_string(),
            description: "连接 Microsoft Playwright MCP，提供页面浏览、交互和自动化测试能力。".to_string(),
            domain: "general".to_string(),
            software: "playwright".to_string(),
            capabilities: vec![
                "browser.navigate".to_string(),
                "browser.snapshot".to_string(),
                "browser.click".to_string(),
                "browser.type".to_string(),
                "browser.wait".to_string(),
                "browser.screenshot".to_string(),
            ],
            priority: 70,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@playwright/mcp@latest".to_string()],
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://github.com/microsoft/playwright-mcp".to_string(),
            official_provider: "Microsoft".to_string(),
            runtime_kind: "".to_string(),
        },
        McpTemplateRecord {
            id: "blender-local-bridge".to_string(),
            name: "Blender 建模桥接".to_string(),
            description: "连接 Blender，提供场景检查、编辑和导入导出能力。".to_string(),
            domain: "dcc".to_string(),
            software: "blender".to_string(),
            capabilities: vec![
                "scene.inspect".to_string(),
                "selection.read".to_string(),
                "object.transform".to_string(),
                "mesh.edit".to_string(),
                "material.apply".to_string(),
                "file.import".to_string(),
                "file.export".to_string(),
                "cross_dcc.transfer".to_string(),
            ],
            priority: 100,
            supports_import: true,
            supports_export: true,
            transport: "stdio".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://www.blender.org/download/".to_string(),
            official_provider: "Blender".to_string(),
            runtime_kind: "dcc_bridge".to_string(),
        },
        McpTemplateRecord {
            id: "maya-local-bridge".to_string(),
            name: "Maya 建模桥接".to_string(),
            description: "连接 Maya，提供场景编辑、材质处理和导入导出能力。".to_string(),
            domain: "dcc".to_string(),
            software: "maya".to_string(),
            capabilities: vec![
                "scene.inspect".to_string(),
                "selection.read".to_string(),
                "object.transform".to_string(),
                "mesh.edit".to_string(),
                "material.apply".to_string(),
                "file.import".to_string(),
                "file.export".to_string(),
                "cross_dcc.transfer".to_string(),
            ],
            priority: 90,
            supports_import: true,
            supports_export: true,
            transport: "stdio".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://www.autodesk.com/products/maya/buy".to_string(),
            official_provider: "Autodesk Maya".to_string(),
            runtime_kind: "dcc_bridge".to_string(),
        },
        McpTemplateRecord {
            id: "c4d-local-bridge".to_string(),
            name: "C4D 建模桥接".to_string(),
            description: "连接 Cinema 4D，提供场景编辑、材质处理和导入导出能力。".to_string(),
            domain: "dcc".to_string(),
            software: "c4d".to_string(),
            capabilities: vec![
                "scene.inspect".to_string(),
                "selection.read".to_string(),
                "object.transform".to_string(),
                "mesh.edit".to_string(),
                "material.apply".to_string(),
                "file.import".to_string(),
                "file.export".to_string(),
                "cross_dcc.transfer".to_string(),
            ],
            priority: 80,
            supports_import: true,
            supports_export: true,
            transport: "stdio".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://www.maxon.net/en/cinema-4d".to_string(),
            official_provider: "Cinema 4D".to_string(),
            runtime_kind: "dcc_bridge".to_string(),
        },
    ]
}

/// 描述：按模板 ID 查找桌面端允许使用的内置 MCP 模板。
///
/// Params:
///
///   - template_id: 模板标识。
///
/// Returns:
///
///   - 命中的内置模板；未命中时返回 None。
fn find_builtin_mcp_template(template_id: &str) -> Option<McpTemplateRecord> {
    let normalized_template_id = template_id.trim();
    if normalized_template_id.is_empty() {
        return None;
    }
    builtin_mcp_templates()
        .into_iter()
        .find(|item| item.id == normalized_template_id)
}

/// 描述：将已持久化的注册项重新投影到内置模板定义，避免桌面端继续暴露外部或被篡改的 MCP 配置。
///
/// Params:
///
///   - record: 已持久化的注册项。
///
/// Returns:
///
///   - 命中的安全注册项；未匹配内置模板时返回 None。
fn normalize_builtin_registration_record(
    record: McpRegistrationRecord,
) -> Option<McpRegistrationRecord> {
    let template = find_builtin_mcp_template(record.template_id.as_str())?;
    Some(McpRegistrationRecord {
        id: record.id,
        template_id: template.id,
        name: template.name,
        description: template.description,
        domain: template.domain,
        software: template.software,
        capabilities: template.capabilities,
        priority: template.priority,
        supports_import: template.supports_import,
        supports_export: template.supports_export,
        transport: template.transport,
        scope: if record.scope.trim() == "workspace" {
            "workspace".to_string()
        } else {
            "user".to_string()
        },
        enabled: record.enabled,
        command: template.command,
        args: template.args,
        env: template.env,
        cwd: template.cwd,
        url: template.url,
        headers: template.headers,
        docs_url: template.docs_url,
        official_provider: template.official_provider,
        runtime_kind: template.runtime_kind,
        removable: true,
    })
}

/// 描述：过滤并规整注册项，仅保留桌面端允许启用的内置 MCP 模板实例。
///
/// Params:
///
///   - records: 原始注册项列表。
///
/// Returns:
///
///   - 仅包含内置模板实例的注册项列表。
fn filter_supported_registration_records(
    records: Vec<McpRegistrationRecord>,
) -> Vec<McpRegistrationRecord> {
    records
        .into_iter()
        .filter_map(normalize_builtin_registration_record)
        .collect()
}

/// 描述：从指定路径读取 MCP 注册表；文件不存在时返回空列表，便于首启直接进入新增流程。
///
/// Params:
///
///   - registry_path: 待读取的注册表文件路径。
///
/// Returns:
///
///   - 已持久化的 MCP 注册项列表。
fn read_mcp_registry_from_path(registry_path: &Path) -> Result<Vec<McpRegistrationRecord>, String> {
    if !registry_path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(registry_path).map_err(|err| {
        format!(
            "读取 MCP 注册表失败（{}）：{}",
            registry_path.to_string_lossy(),
            err
        )
    })?;
    let mut records: Vec<McpRegistrationRecord> = filter_supported_registration_records(
        serde_json::from_str(raw.as_str())
            .map_err(|err| format!("解析 MCP 注册表失败：{}", err))?,
    );
    records.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(records)
}

/// 描述：读取用户级 MCP 注册表。
///
/// Returns:
///
///   - 用户级注册项列表。
fn read_user_mcp_registry() -> Result<Vec<McpRegistrationRecord>, String> {
    let registry_path = resolve_user_mcp_registry_path()?;
    read_mcp_registry_from_path(registry_path.as_path())
}

/// 描述：读取 workspace 级 MCP 注册表；若未绑定项目目录则直接返回空列表。
///
/// Params:
///
///   - workspace_root: 项目根目录。
///
/// Returns:
///
///   - workspace 级注册项列表。
fn read_workspace_mcp_registry(
    workspace_root: Option<&str>,
) -> Result<Vec<McpRegistrationRecord>, String> {
    let Some(normalized_workspace_root) = workspace_root.filter(|value| !value.trim().is_empty())
    else {
        return Ok(Vec::new());
    };
    let registry_path = resolve_workspace_mcp_registry_path(normalized_workspace_root)?;
    read_mcp_registry_from_path(registry_path.as_path())
}

/// 描述：按 `id` 合并用户级与 workspace 级注册项，同名时 workspace 优先，供页面展示与运行时构建共享。
///
/// Params:
///
///   - user_records: 用户级注册项。
///   - workspace_records: workspace 级注册项。
///
/// Returns:
///
///   - 覆盖合并后的注册项列表。
fn merge_registry_records(
    user_records: Vec<McpRegistrationRecord>,
    workspace_records: Vec<McpRegistrationRecord>,
) -> Vec<McpRegistrationRecord> {
    let mut merged: HashMap<String, McpRegistrationRecord> = HashMap::new();
    for item in user_records {
        merged.insert(item.id.clone(), item);
    }
    for item in workspace_records {
        merged.insert(item.id.clone(), item);
    }
    let mut records = merged.into_values().collect::<Vec<McpRegistrationRecord>>();
    records.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    records
}

/// 描述：读取当前启用中的 MCP 注册项，供运行时在执行前构建可用能力快照；workspace 级配置会覆盖同名 user 级配置。
///
/// Params:
///
///   - workspace_root: 项目根目录。
///
/// Returns:
///
///   - 已启用的 MCP 注册项列表。
pub(crate) fn list_enabled_mcp_registrations(
    workspace_root: Option<&str>,
) -> Result<Vec<McpRegistrationRecord>, String> {
    Ok(merge_registry_records(
        read_user_mcp_registry()?,
        read_workspace_mcp_registry(workspace_root)?,
    )
    .into_iter()
    .filter(|item| item.enabled)
    .collect())
}

/// 描述：将 MCP 注册表写回指定路径，使用格式化 JSON 便于调试和人工排查。
///
/// Params:
///
///   - registry_path: 待写入的注册表路径。
///   - records: 待写入的注册项列表。
///
/// Returns:
///
///   - 0: 写入成功。
fn write_mcp_registry_to_path(
    registry_path: &Path,
    records: &[McpRegistrationRecord],
) -> Result<(), String> {
    ensure_registry_parent(registry_path)?;
    let content = serde_json::to_string_pretty(records)
        .map_err(|err| format!("序列化 MCP 注册表失败：{}", err))?;
    fs::write(registry_path, format!("{}\n", content)).map_err(|err| {
        format!(
            "写入 MCP 注册表失败（{}）：{}",
            registry_path.to_string_lossy(),
            err
        )
    })
}

/// 描述：删除指定注册表文件；仅在空数组场景下用于避免遗留空配置文件。
///
/// Params:
///
///   - registry_path: 待删除的注册表路径。
///
/// Returns:
///
///   - 0: 删除成功或文件不存在。
fn remove_registry_file_if_exists(registry_path: &Path) -> Result<(), String> {
    if !registry_path.exists() {
        return Ok(());
    }
    fs::remove_file(registry_path).map_err(|err| {
        format!(
            "删除 MCP 注册表失败（{}）：{}",
            registry_path.to_string_lossy(),
            err
        )
    })
}

/// 描述：按目标路径写回 MCP 注册表；空列表会清理注册表文件，避免在 workspace 下制造无意义空文件。
///
/// Params:
///
///   - registry_path: 注册表文件路径。
///   - records: 待写入的注册项列表。
///
/// Returns:
///
///   - 0: 写入成功。
fn persist_registry_records(
    registry_path: &Path,
    records: &[McpRegistrationRecord],
) -> Result<(), String> {
    if records.is_empty() {
        return remove_registry_file_if_exists(registry_path);
    }
    write_mcp_registry_to_path(registry_path, records)
}

/// 描述：将名称转换为稳定的 kebab-case 标识，供自定义 MCP 自动生成注册 ID。
///
/// Params:
///
///   - raw: 原始名称或标识。
///
/// Returns:
///
///   - 规整后的标识字符串。
fn slugify_identifier(raw: &str) -> String {
    let mut result = String::new();
    let mut last_was_dash = false;
    for char in raw.trim().chars() {
        if char.is_ascii_alphanumeric() {
            result.push(char.to_ascii_lowercase());
            last_was_dash = false;
            continue;
        }
        if (char.is_ascii_whitespace() || char == '-' || char == '_')
            && !last_was_dash
            && !result.is_empty()
        {
            result.push('-');
            last_was_dash = true;
        }
    }
    result.trim_matches('-').to_string()
}

/// 描述：确保注册 ID 在当前注册表中唯一；若已存在则自动追加递增后缀。
///
/// Params:
///
///   - candidate: 原始候选 ID。
///   - current_id: 编辑场景下的当前 ID，命中时允许复用。
///   - records: 当前注册表。
///
/// Returns:
///
///   - 可安全写入的唯一 ID。
fn ensure_unique_registration_id(
    candidate: &str,
    current_id: &str,
    records: &[McpRegistrationRecord],
) -> String {
    let base = if candidate.trim().is_empty() {
        "custom-mcp".to_string()
    } else {
        candidate.trim().to_string()
    };
    if !records
        .iter()
        .any(|item| item.id == base && item.id != current_id)
    {
        return base;
    }
    let mut suffix: usize = 2;
    loop {
        let next = format!("{}-{}", base, suffix);
        if !records
            .iter()
            .any(|item| item.id == next && item.id != current_id)
        {
            return next;
        }
        suffix += 1;
    }
}

/// 描述：基础校验 MCP 草稿，确保传输方式、必填字段和 URL/命令格式满足最小要求。
///
/// Params:
///
///   - payload: 待校验的注册草稿。
///
/// Returns:
///
///   - 规整后的字段元组。
fn normalize_registration_payload(
    payload: McpRegistrationPayload,
    _workspace_root: Option<&str>,
) -> Result<McpRegistrationPayload, String> {
    let template = find_builtin_mcp_template(payload.template_id.as_str()).ok_or_else(|| {
        "当前版本仅允许添加应用内置 MCP，暂不支持自定义命令或外部 HTTP MCP。".to_string()
    })?;
    let normalized_scope = match payload.scope.trim() {
        "" | "user" => "user".to_string(),
        "workspace" => "workspace".to_string(),
        _ => return Err("MCP 作用域仅支持 user 或 workspace。".to_string()),
    };
    Ok(McpRegistrationPayload {
        id: payload.id.trim().to_string(),
        template_id: template.id,
        name: template.name,
        description: template.description,
        domain: template.domain,
        software: template.software,
        capabilities: template.capabilities,
        priority: template.priority,
        supports_import: template.supports_import,
        supports_export: template.supports_export,
        transport: template.transport,
        scope: normalized_scope,
        enabled: payload.enabled,
        command: template.command,
        args: template.args,
        env: template.env,
        cwd: template.cwd,
        url: template.url,
        headers: template.headers,
        docs_url: template.docs_url,
        official_provider: template.official_provider,
        runtime_kind: template.runtime_kind,
    })
}

/// 描述：将草稿转换为可持久化的 MCP 注册项，并处理新建场景下的 ID 生成与冲突规避。
///
/// Params:
///
///   - payload: 已通过基础校验的草稿。
///   - records: 当前注册表。
///
/// Returns:
///
///   - 规整后的 MCP 注册项。
fn build_registration_record(
    payload: McpRegistrationPayload,
    records: &[McpRegistrationRecord],
) -> McpRegistrationRecord {
    let candidate_id = if payload.id.is_empty() {
        let from_template = slugify_identifier(payload.template_id.as_str());
        if !from_template.is_empty() {
            from_template
        } else {
            slugify_identifier(payload.name.as_str())
        }
    } else {
        slugify_identifier(payload.id.as_str())
    };
    let unique_id =
        ensure_unique_registration_id(candidate_id.as_str(), payload.id.as_str(), records);
    McpRegistrationRecord {
        id: unique_id,
        template_id: payload.template_id,
        name: payload.name,
        description: payload.description,
        domain: payload.domain,
        software: payload.software,
        capabilities: payload.capabilities,
        priority: payload.priority,
        supports_import: payload.supports_import,
        supports_export: payload.supports_export,
        transport: payload.transport,
        scope: payload.scope,
        enabled: payload.enabled,
        command: payload.command,
        args: payload.args,
        env: payload.env,
        cwd: payload.cwd,
        url: payload.url,
        headers: payload.headers,
        docs_url: payload.docs_url,
        official_provider: payload.official_provider,
        runtime_kind: payload.runtime_kind,
        removable: true,
    }
}

/// 描述：按命令名解析本地可执行文件路径，用于 stdio MCP 的基础可用性预检查。
///
/// Params:
///
///   - command: 可执行文件名或绝对路径。
///
/// Returns:
///
///   - 命中的可执行路径；未命中时返回 None。
fn resolve_local_command_path(command: &str) -> Option<PathBuf> {
    let normalized = command.trim();
    if normalized.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(normalized);
    if candidate.is_absolute() || normalized.contains(std::path::MAIN_SEPARATOR) {
        if candidate.exists() {
            return Some(candidate);
        }
        return None;
    }
    let path_value = env::var_os("PATH")?;
    for directory in env::split_paths(&path_value) {
        let full_path = directory.join(normalized);
        if full_path.exists() {
            return Some(full_path);
        }
        #[cfg(target_os = "windows")]
        {
            let cmd_path = directory.join(format!("{}.cmd", normalized));
            if cmd_path.exists() {
                return Some(cmd_path);
            }
            let exe_path = directory.join(format!("{}.exe", normalized));
            if exe_path.exists() {
                return Some(exe_path);
            }
        }
    }
    None
}

/// 描述：判断当前内置模板是否需要在校验阶段执行真实的 stdio 预检命令。
///
/// Params:
///
///   - payload: 已归一化的 MCP 注册草稿。
///
/// Returns:
///
///   - 需要执行的预检参数；当前仅对 Playwright 模板返回参数。
fn resolve_stdio_probe_args(payload: &McpRegistrationPayload) -> Option<Vec<String>> {
    if payload.transport != "stdio" {
        return None;
    }
    if payload.template_id.trim() != "playwright-mcp" {
        return None;
    }
    let mut probe_args = payload.args.clone();
    if !probe_args
        .iter()
        .any(|item| item == "--help" || item == "-h")
    {
        probe_args.push("--help".to_string());
    }
    Some(probe_args)
}

/// 描述：构建 stdio MCP 预检命令的缓存目录，避免 `npx` 首次拉包时写入不可控的默认用户缓存目录。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - template_id: 模板标识。
///
/// Returns:
///
///   - 预检缓存目录路径。
fn resolve_stdio_probe_cache_dir(
    app: &tauri::AppHandle,
    template_id: &str,
) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录：{}", err))?;
    let template_segment = slugify_identifier(template_id);
    Ok(app_data_dir
        .join("mcp_runtime_probe")
        .join(if template_segment.is_empty() {
            "generic".to_string()
        } else {
            template_segment
        }))
}

/// 描述：执行 stdio MCP 的真实预检命令，用于确认模板在当前环境下可以被正确拉起。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - payload: 已归一化的 MCP 注册草稿。
///   - command_path: 已解析出的本地命令路径。
///   - probe_args: 预检命令参数。
///
/// Returns:
///
///   - 成功时返回面向用户的友好提示。
fn probe_stdio_registration_command(
    app: &tauri::AppHandle,
    payload: &McpRegistrationPayload,
    command_path: &Path,
    probe_args: &[String],
) -> Result<String, String> {
    let cache_dir = resolve_stdio_probe_cache_dir(app, payload.template_id.as_str())?;
    fs::create_dir_all(cache_dir.as_path())
        .map_err(|err| format!("创建 MCP 预检缓存目录失败：{}", err))?;

    let mut command = Command::new(command_path);
    command.args(probe_args);
    if !payload.cwd.trim().is_empty() {
        command.current_dir(payload.cwd.trim());
    }
    for (key, value) in payload.env.iter() {
        command.env(key, value);
    }
    command.env("npm_config_cache", cache_dir.as_os_str());

    let output = command
        .output()
        .map_err(|err| format!("执行 MCP 预检命令失败：{}", err))?;
    if output.status.success() {
        let package_name = payload
            .args
            .iter()
            .find(|item| !item.trim().starts_with('-'))
            .cloned()
            .unwrap_or_else(|| payload.name.clone());
        return Ok(format!(
            "已通过运行预检，可自动拉起 {}。",
            package_name
        ));
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "未返回额外输出。".to_string()
    };
    Err(format!("执行 MCP 预检失败：{}", detail))
}

/// 描述：构建前端可消费的 MCP 注册表总览。
///
/// Params:
///
///   - workspace_root: 项目根目录；存在时将把 workspace 级注册项覆盖合并到 user 级结果之上。
///
/// Returns:
///
///   - MCP 注册总览数据。
fn build_registry_overview(workspace_root: Option<&str>) -> Result<McpRegistryOverview, String> {
    Ok(McpRegistryOverview {
        registered: merge_registry_records(
            read_user_mcp_registry()?,
            read_workspace_mcp_registry(workspace_root)?,
        ),
        templates: builtin_mcp_templates(),
    })
}

/// 描述：列出当前用户已注册的 MCP 和内置模板，供前端渲染管理页。
#[tauri::command]
pub async fn list_registered_mcps(
    workspace_root: Option<String>,
) -> Result<McpRegistryOverview, String> {
    build_registry_overview(workspace_root.as_deref())
}

/// 描述：保存 MCP 注册项；新建时自动生成稳定 ID，编辑时按现有 ID 覆盖。
///
/// Params:
///
///   - payload: 待保存的注册草稿。
///
/// Returns:
///
///   - 已持久化的 MCP 注册项。
#[tauri::command]
pub async fn save_mcp_registration(
    payload: McpRegistrationPayload,
    workspace_root: Option<String>,
) -> Result<McpRegistrationRecord, String> {
    let normalized_workspace_root = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_payload = normalize_registration_payload(payload, normalized_workspace_root)?;
    let target_scope = normalized_payload.scope.clone();
    let user_registry_path = resolve_user_mcp_registry_path()?;
    let mut user_records = read_user_mcp_registry()?;
    let mut workspace_records = read_workspace_mcp_registry(normalized_workspace_root)?;
    let current_id = normalized_payload.id.clone();

    user_records.retain(|item| item.id != current_id);
    workspace_records.retain(|item| item.id != current_id);

    let target_records = if target_scope == "workspace" {
        if normalized_workspace_root.is_none() {
            return Err("保存 workspace 级 MCP 时必须绑定项目目录。".to_string());
        }
        &mut workspace_records
    } else {
        &mut user_records
    };

    let record = build_registration_record(normalized_payload, target_records.as_slice());
    target_records.push(record.clone());
    target_records.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    persist_registry_records(user_registry_path.as_path(), user_records.as_slice())?;
    if let Some(workspace_root_value) = normalized_workspace_root {
        let workspace_registry_path = resolve_workspace_mcp_registry_path(workspace_root_value)?;
        persist_registry_records(
            workspace_registry_path.as_path(),
            workspace_records.as_slice(),
        )?;
    }
    Ok(record)
}

/// 描述：移除指定 MCP 注册项；当前仅处理已保存的内置模板实例。
///
/// Params:
///
///   - id: 待移除的 MCP 注册 ID。
///
/// Returns:
///
///   - true 表示已成功移除。
#[tauri::command]
pub async fn remove_mcp_registration(
    id: String,
    scope: Option<String>,
    workspace_root: Option<String>,
) -> Result<bool, String> {
    let normalized_id = id.trim().to_string();
    if normalized_id.is_empty() {
        return Err("MCP 注册 ID 不能为空。".to_string());
    }
    let normalized_scope = scope
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user");
    let user_registry_path = resolve_user_mcp_registry_path()?;

    if normalized_scope == "user" {
        let mut user_records = read_user_mcp_registry()?;
        let before_len = user_records.len();
        user_records.retain(|item| item.id != normalized_id);
        let removed = user_records.len() != before_len;
        persist_registry_records(user_registry_path.as_path(), user_records.as_slice())?;
        return Ok(removed);
    }

    if normalized_scope != "workspace" {
        return Err("移除 MCP 时 scope 仅支持 user 或 workspace。".to_string());
    }
    let normalized_workspace_root = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "移除 workspace 级 MCP 时必须绑定项目目录。".to_string())?;
    let workspace_registry_path = resolve_workspace_mcp_registry_path(normalized_workspace_root)?;
    let mut workspace_records = read_workspace_mcp_registry(Some(normalized_workspace_root))?;
    let before_len = workspace_records.len();
    workspace_records.retain(|item| item.id != normalized_id);
    let removed = workspace_records.len() != before_len;
    persist_registry_records(
        workspace_registry_path.as_path(),
        workspace_records.as_slice(),
    )?;
    Ok(removed)
}

/// 描述：执行内置 MCP 注册项的基础环境校验；DCC 模板走内置参数校验，其余内置模板走命令或地址检查。
///
/// Params:
///
///   - payload: 待校验的注册草稿。
///
/// Returns:
///
///   - MCP 校验结果。
#[tauri::command]
pub async fn validate_mcp_registration(
    app: tauri::AppHandle,
    payload: McpRegistrationPayload,
    workspace_root: Option<String>,
) -> Result<McpValidationResult, String> {
    let normalized_workspace_root = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let normalized_payload = normalize_registration_payload(payload, normalized_workspace_root)?;
    if normalized_payload.scope == "workspace" && normalized_workspace_root.is_none() {
        return Err("校验 workspace 级 MCP 时必须绑定项目目录。".to_string());
    }
    if normalized_payload.transport == "http" {
        return Ok(McpValidationResult {
            ok: true,
            message: format!("HTTP MCP 地址格式合法：{}", normalized_payload.url),
            resolved_path: normalized_payload.url,
        });
    }
    if let Some(path) = resolve_local_command_path(normalized_payload.command.as_str()) {
        if let Some(probe_args) = resolve_stdio_probe_args(&normalized_payload) {
            return match probe_stdio_registration_command(
                &app,
                &normalized_payload,
                path.as_path(),
                probe_args.as_slice(),
            ) {
                Ok(message) => Ok(McpValidationResult {
                    ok: true,
                    message,
                    resolved_path: path.to_string_lossy().to_string(),
                }),
                Err(message) => Ok(McpValidationResult {
                    ok: false,
                    message,
                    resolved_path: path.to_string_lossy().to_string(),
                }),
            };
        }
        return Ok(McpValidationResult {
            ok: true,
            message: format!("已找到可执行命令：{}", path.to_string_lossy()),
            resolved_path: path.to_string_lossy().to_string(),
        });
    }
    Ok(McpValidationResult {
        ok: false,
        message: "未在当前环境中找到可执行命令，请检查 PATH 或改用绝对路径。".to_string(),
        resolved_path: "".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        McpRegistrationPayload, McpRegistrationRecord, merge_registry_records,
        normalize_registration_payload, resolve_stdio_probe_args, slugify_identifier,
    };
    use std::collections::HashMap;

    /// 描述：验证 slugify 逻辑会将空白、下划线和大小写统一规整为 kebab-case。
    #[test]
    fn slugify_identifier_should_normalize_common_input() {
        assert_eq!(slugify_identifier("  My_Custom MCP  "), "my-custom-mcp");
        assert_eq!(slugify_identifier("blender-local-bridge"), "blender-local-bridge");
    }

    /// 描述：验证桌面端会拒绝非内置模板的 MCP 草稿，避免把任意外部命令写入注册表。
    #[test]
    fn normalize_registration_payload_should_reject_non_builtin_template() {
        let payload = McpRegistrationPayload {
            id: "".to_string(),
            template_id: "generic-stdio".to_string(),
            name: "Test".to_string(),
            description: "desc".to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            scope: "user".to_string(),
            enabled: true,
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "".to_string(),
            runtime_kind: "".to_string(),
        };
        let error = normalize_registration_payload(payload, None).unwrap_err();
        assert!(error.contains("应用内置 MCP"));
    }

    /// 描述：验证内置模板保存时会回退到模板定义，避免前端篡改 transport、command 等安全字段。
    #[test]
    fn normalize_registration_payload_should_project_to_builtin_template() {
        let payload = McpRegistrationPayload {
            id: "".to_string(),
            template_id: "blender-local-bridge".to_string(),
            name: "Custom Name".to_string(),
            description: "custom desc".to_string(),
            domain: "dcc".to_string(),
            software: "maya".to_string(),
            capabilities: vec!["custom.capability".to_string()],
            priority: 99,
            supports_import: true,
            supports_export: true,
            transport: "http".to_string(),
            scope: "workspace".to_string(),
            enabled: true,
            command: "custom-command".to_string(),
            args: vec!["--custom".to_string()],
            env: HashMap::from([("TOKEN".to_string(), "123".to_string())]),
            cwd: "/tmp/custom".to_string(),
            url: "https://example.com/mcp".to_string(),
            headers: HashMap::from([("Authorization".to_string(), "Bearer demo".to_string())]),
            docs_url: "https://example.com/docs".to_string(),
            official_provider: "Custom".to_string(),
            runtime_kind: "custom_runtime".to_string(),
        };

        let normalized = normalize_registration_payload(payload, Some("/tmp/workspace"))
            .expect("builtin template");

        assert_eq!(normalized.template_id, "blender-local-bridge");
        assert_eq!(normalized.name, "Blender 建模桥接");
        assert_eq!(normalized.transport, "stdio");
        assert_eq!(normalized.scope, "workspace");
        assert_eq!(normalized.command, "");
        assert!(normalized.args.is_empty());
        assert!(normalized.env.is_empty());
        assert!(normalized.headers.is_empty());
        assert_eq!(normalized.runtime_kind, "dcc_bridge");
    }

    /// 描述：验证 Playwright 模板会派生真实运行预检参数，避免新增模板时只检查 `npx` 是否存在。
    #[test]
    fn resolve_stdio_probe_args_should_enable_playwright_runtime_probe() {
        let payload = McpRegistrationPayload {
            id: "".to_string(),
            template_id: "playwright-mcp".to_string(),
            name: "Playwright 浏览器自动化".to_string(),
            description: "".to_string(),
            domain: "general".to_string(),
            software: "playwright".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            scope: "user".to_string(),
            enabled: true,
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@playwright/mcp@latest".to_string()],
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "Microsoft".to_string(),
            runtime_kind: "".to_string(),
        };

        let probe_args = resolve_stdio_probe_args(&payload).expect("playwright probe args");
        assert_eq!(
            probe_args,
            vec![
                "-y".to_string(),
                "@playwright/mcp@latest".to_string(),
                "--help".to_string()
            ]
        );
    }

    /// 描述：验证非 Playwright 模板不会触发真实预检，避免影响其他 MCP 的校验口径。
    #[test]
    fn resolve_stdio_probe_args_should_ignore_other_templates() {
        let payload = McpRegistrationPayload {
            id: "".to_string(),
            template_id: "blender-local-bridge".to_string(),
            name: "Blender".to_string(),
            description: "".to_string(),
            domain: "dcc".to_string(),
            software: "blender".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            scope: "user".to_string(),
            enabled: true,
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "".to_string(),
            runtime_kind: "dcc_bridge".to_string(),
        };

        assert!(resolve_stdio_probe_args(&payload).is_none());
    }

    /// 描述：验证 workspace 级注册项会覆盖同名 user 级注册项，确保运行时和管理页看到的是最终生效结果。
    #[test]
    fn merge_registry_records_should_prefer_workspace_scope() {
        let user = McpRegistrationRecord {
            id: "design-tools".to_string(),
            template_id: "blender-local-bridge".to_string(),
            name: "Design Tools User".to_string(),
            description: "bridge".to_string(),
            domain: "dcc".to_string(),
            software: "blender".to_string(),
            capabilities: vec!["scene.inspect".to_string()],
            priority: 100,
            supports_import: true,
            supports_export: true,
            transport: "stdio".to_string(),
            scope: "user".to_string(),
            enabled: true,
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://www.blender.org/download/".to_string(),
            official_provider: "Blender".to_string(),
            runtime_kind: "dcc_bridge".to_string(),
            removable: true,
        };
        let workspace = McpRegistrationRecord {
            name: "Design Tools Workspace".to_string(),
            scope: "workspace".to_string(),
            ..user.clone()
        };
        let merged = merge_registry_records(vec![user], vec![workspace]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].name, "Design Tools Workspace");
        assert_eq!(merged[0].scope, "workspace");
    }
}
