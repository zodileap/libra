use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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
            id: "apifox-official".to_string(),
            name: "Apifox 官方 MCP".to_string(),
            description: "通过应用私有 Runtime 启动 Apifox 官方 MCP Server。".to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "https://docs.apifox.com/apifox-mcp-server".to_string(),
            official_provider: "Apifox".to_string(),
            runtime_kind: "apifox_runtime".to_string(),
        },
        McpTemplateRecord {
            id: "generic-stdio".to_string(),
            name: "通用 Stdio MCP".to_string(),
            description: "适合通过本地命令拉起的 MCP Server，例如 uvx、npx 或已安装二进制。"
                .to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "stdio".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "".to_string(),
            runtime_kind: "".to_string(),
        },
        McpTemplateRecord {
            id: "generic-http".to_string(),
            name: "通用 HTTP MCP".to_string(),
            description: "适合通过 HTTP 地址接入的 MCP Server。".to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "http".to_string(),
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "http://127.0.0.1:3000/mcp".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "".to_string(),
            runtime_kind: "".to_string(),
        },
        McpTemplateRecord {
            id: "blender-local-bridge".to_string(),
            name: "Blender 本地 Bridge".to_string(),
            description: "通过本地 Bridge 接入 Blender 的场景检查、几何编辑与导入导出能力。"
                .to_string(),
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
            name: "Maya 本地 Bridge".to_string(),
            description: "通过本地 Bridge 接入 Maya 的场景编辑、材质处理与导入导出能力。"
                .to_string(),
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
            name: "C4D 本地 Bridge".to_string(),
            description: "通过本地 Bridge 接入 Cinema 4D 的场景编辑、材质处理与导入导出能力。"
                .to_string(),
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
    let mut records: Vec<McpRegistrationRecord> = serde_json::from_str(raw.as_str())
        .map_err(|err| format!("解析 MCP 注册表失败：{}", err))?;
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

/// 描述：清理键值映射，移除空键和空值，避免将无效环境变量或 Header 持久化到注册表。
///
/// Params:
///
///   - source: 原始键值映射。
///
/// Returns:
///
///   - 归一化后的键值映射。
fn normalize_string_map(source: HashMap<String, String>) -> HashMap<String, String> {
    source
        .into_iter()
        .filter_map(|(key, value)| {
            let normalized_key = key.trim().to_string();
            let normalized_value = value.trim().to_string();
            if normalized_key.is_empty() || normalized_value.is_empty() {
                return None;
            }
            Some((normalized_key, normalized_value))
        })
        .collect()
}

/// 描述：清理字符串列表，移除空值与重复项，保持能力列表可预测且便于运行时消费。
///
/// Params:
///
///   - source: 原始字符串列表。
///
/// Returns:
///
///   - 规整后的字符串列表。
fn normalize_string_list(source: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for item in source {
        let value = item.trim().to_string();
        if value.is_empty() || normalized.iter().any(|existing| existing == &value) {
            continue;
        }
        normalized.push(value);
    }
    normalized
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
) -> Result<McpRegistrationPayload, String> {
    let normalized_name = payload.name.trim().to_string();
    if normalized_name.is_empty() {
        return Err("MCP 名称不能为空。".to_string());
    }
    let normalized_transport = payload.transport.trim().to_lowercase();
    if normalized_transport != "stdio" && normalized_transport != "http" {
        return Err("MCP 传输方式仅支持 stdio 或 http。".to_string());
    }
    let normalized_runtime_kind = payload.runtime_kind.trim().to_string();
    let normalized_command = payload.command.trim().to_string();
    let normalized_url = payload.url.trim().to_string();
    if normalized_transport == "stdio"
        && normalized_runtime_kind != "apifox_runtime"
        && normalized_command.is_empty()
    {
        return Err("Stdio MCP 必须填写启动命令。".to_string());
    }
    if normalized_transport == "http"
        && !(normalized_url.starts_with("http://") || normalized_url.starts_with("https://"))
    {
        return Err("HTTP MCP 地址必须以 http:// 或 https:// 开头。".to_string());
    }
    let normalized_scope = match payload.scope.trim() {
        "" | "user" => "user".to_string(),
        "workspace" => "workspace".to_string(),
        _ => return Err("MCP 作用域仅支持 user 或 workspace。".to_string()),
    };
    let normalized_domain = match payload.domain.trim().to_lowercase().as_str() {
        "" | "general" => "general".to_string(),
        "dcc" => "dcc".to_string(),
        _ => return Err("MCP 领域仅支持 general 或 dcc。".to_string()),
    };
    let normalized_software = payload.software.trim().to_lowercase();
    if normalized_domain == "dcc" && normalized_software.is_empty() {
        return Err("DCC MCP 必须填写软件标识（例如 blender、maya、c4d）。".to_string());
    }
    Ok(McpRegistrationPayload {
        id: payload.id.trim().to_string(),
        template_id: payload.template_id.trim().to_string(),
        name: normalized_name,
        description: payload.description.trim().to_string(),
        domain: normalized_domain,
        software: normalized_software,
        capabilities: normalize_string_list(payload.capabilities),
        priority: payload.priority,
        supports_import: payload.supports_import,
        supports_export: payload.supports_export,
        transport: normalized_transport,
        scope: normalized_scope,
        enabled: payload.enabled,
        command: normalized_command,
        args: payload
            .args
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        env: normalize_string_map(payload.env),
        cwd: payload.cwd.trim().to_string(),
        url: normalized_url,
        headers: normalize_string_map(payload.headers),
        docs_url: payload.docs_url.trim().to_string(),
        official_provider: payload.official_provider.trim().to_string(),
        runtime_kind: normalized_runtime_kind,
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
    let normalized_payload = normalize_registration_payload(payload)?;
    let target_scope = normalized_payload.scope.clone();
    let normalized_workspace_root = workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
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

/// 描述：移除指定 MCP 注册项；仅允许移除用户自定义注册。
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

/// 描述：执行 MCP 注册项的基础环境校验；stdio 校验本地命令是否可解析，http 校验 URL 格式。
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
    payload: McpRegistrationPayload,
    workspace_root: Option<String>,
) -> Result<McpValidationResult, String> {
    let normalized_payload = normalize_registration_payload(payload)?;
    if normalized_payload.scope == "workspace"
        && workspace_root.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err("校验 workspace 级 MCP 时必须绑定项目目录。".to_string());
    }
    if normalized_payload.runtime_kind == "apifox_runtime" {
        return Ok(McpValidationResult {
            ok: true,
            message:
                "Apifox Runtime 由独立安装器管理，请在页面中使用“安装 Runtime”按钮完成运行时准备。"
                    .to_string(),
            resolved_path: "".to_string(),
        });
    }
    if normalized_payload.transport == "http" {
        return Ok(McpValidationResult {
            ok: true,
            message: format!("HTTP MCP 地址格式合法：{}", normalized_payload.url),
            resolved_path: normalized_payload.url,
        });
    }
    if let Some(path) = resolve_local_command_path(normalized_payload.command.as_str()) {
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
        merge_registry_records, normalize_registration_payload, slugify_identifier,
        McpRegistrationPayload, McpRegistrationRecord,
    };
    use std::collections::HashMap;

    /// 描述：验证 slugify 逻辑会将空白、下划线和大小写统一规整为 kebab-case。
    #[test]
    fn slugify_identifier_should_normalize_common_input() {
        assert_eq!(slugify_identifier("  My_Custom MCP  "), "my-custom-mcp");
        assert_eq!(slugify_identifier("apifox-official"), "apifox-official");
    }

    /// 描述：验证 stdio MCP 在缺少命令时会被拦截，避免写入无法运行的注册项。
    #[test]
    fn normalize_registration_payload_should_reject_stdio_without_command() {
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
        let error = normalize_registration_payload(payload).unwrap_err();
        assert!(error.contains("启动命令"));
    }

    /// 描述：验证 workspace 级注册项会覆盖同名 user 级注册项，确保运行时和管理页看到的是最终生效结果。
    #[test]
    fn merge_registry_records_should_prefer_workspace_scope() {
        let user = McpRegistrationRecord {
            id: "design-tools".to_string(),
            template_id: "".to_string(),
            name: "Design Tools User".to_string(),
            description: "".to_string(),
            domain: "general".to_string(),
            software: "".to_string(),
            capabilities: Vec::new(),
            priority: 0,
            supports_import: false,
            supports_export: false,
            transport: "http".to_string(),
            scope: "user".to_string(),
            enabled: true,
            command: "".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            cwd: "".to_string(),
            url: "http://127.0.0.1:3000/mcp".to_string(),
            headers: HashMap::new(),
            docs_url: "".to_string(),
            official_provider: "".to_string(),
            runtime_kind: "".to_string(),
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
