use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::path::Component;
use std::process::Command;
use tauri::Manager;

/// 描述：前端可消费的 Agent Skill 结构，统一输出技能标题、分组、来源、正文与可移除能力。
#[derive(Debug, Clone, Serialize)]
pub struct AgentSkillRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub example_prompt: String,
    pub version: String,
    pub status: String,
    pub group: String,
    pub icon: String,
    pub source: String,
    pub root_path: String,
    pub skill_file_path: String,
    pub markdown_body: String,
    pub runtime_requirements: Value,
    pub removable: bool,
}

/// 描述：技能页总览结构，统一拆分“已注册 / 未注册 / 全部内置技能”三类数据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillOverview {
    pub registered: Vec<AgentSkillRecord>,
    pub unregistered: Vec<AgentSkillRecord>,
    pub all: Vec<AgentSkillRecord>,
}

/// 描述：桌面端技能注册表条目结构，统一记录技能 ID 与已安装版本，供升级替换和未注册提示复用。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AgentSkillRegistryEntry {
    id: String,
    version: String,
}

/// 描述：桌面端技能注册表文件结构，兼容旧版 `registered_ids` 并逐步迁移到带版本的注册条目。
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentSkillRegistryState {
    #[serde(default)]
    registered_ids: Vec<String>,
    #[serde(default)]
    registered: Vec<AgentSkillRegistryEntry>,
}

/// 描述：Agent Skills `SKILL.md` frontmatter 的最小标准字段，当前至少要求 name 与 description。
#[derive(Debug, Deserialize)]
struct AgentSkillFrontmatter {
    name: String,
    description: String,
}

/// 描述：`agents/libra.yaml` 中 `libra` 根节点下的技能展示元数据，统一承载标题、分组、描述、示例提示与图标键。
#[derive(Debug, Deserialize)]
struct AgentSkillLibraMetadata {
    title: String,
    description: Option<String>,
    example_prompt: String,
    version: String,
    status: Option<String>,
    group: String,
    icon: String,
}

/// 描述：`agents/libra.yaml` 的文档根结构，要求所有展示元数据都挂在 `libra` 根节点下。
#[derive(Debug, Deserialize)]
struct AgentSkillLibraMetadataDocument {
    libra: AgentSkillLibraMetadata,
}

const AGENT_SKILL_STATUS_STABLE: &str = "stable";
const AGENT_SKILL_STATUS_TESTING: &str = "testing";

/// 描述：将多来源技能根目录规整为可扫描列表，并移除重复路径，避免开发态与打包态目录被重复解析。
///
/// Params:
///
///   - roots: 待规整的原始目录列表。
///
/// Returns:
///
///   - 去重后的技能根目录列表。
fn dedupe_skill_roots(roots: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut normalized: Vec<PathBuf> = Vec::new();
    for root in roots {
        let candidate = root.canonicalize().unwrap_or(root);
        if normalized.iter().any(|item| item == &candidate) {
            continue;
        }
        normalized.push(candidate);
    }
    normalized
}

/// 描述：解析应用内置技能目录；开发态优先读取源码 `resources/skills`，打包态补充读取资源目录下的 `skills`。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///
/// Returns:
///
///   - 可用的内置技能目录列表。
fn resolve_builtin_skill_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("skills");
    if manifest_root.exists() {
        roots.push(manifest_root);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let resource_root = resource_dir.join("skills");
        if resource_root.exists() {
            roots.push(resource_root);
        }
    }
    dedupe_skill_roots(roots)
}

/// 描述：解析桌面端技能注册表路径，统一持久化到应用私有目录的 `agent_skills/registry.json`。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///
/// Returns:
///
///   - 技能注册表文件路径。
fn resolve_agent_skill_registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("解析技能注册表目录失败：{}", err))?;
    Ok(app_data_dir.join("agent_skills").join("registry.json"))
}

/// 描述：确保技能注册表父目录存在，供后续写入注册状态复用。
///
/// Params:
///
///   - registry_path: 技能注册表文件路径。
///
/// Returns:
///
///   - 0: 目录准备成功。
fn ensure_skill_registry_parent(registry_path: &Path) -> Result<(), String> {
    let parent = registry_path
        .parent()
        .ok_or_else(|| "技能注册表路径缺少父目录。".to_string())?;
    fs::create_dir_all(parent).map_err(|err| format!("创建技能注册表目录失败：{}", err))?;
    Ok(())
}

/// 描述：校验技能名称是否符合 Agent Skills 命名约束，仅允许小写字母、数字与连字符。
///
/// Params:
///
///   - name: frontmatter 中声明的技能名称。
///
/// Returns:
///
///   - 0: 名称合法。
fn validate_agent_skill_name(name: &str) -> Result<(), String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err("技能 frontmatter.name 不能为空。".to_string());
    }
    if normalized.starts_with('-') || normalized.ends_with('-') {
        return Err(format!("技能名称 {} 不能以连字符开头或结尾。", normalized));
    }
    if normalized
        .chars()
        .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-')
    {
        return Ok(());
    }
    Err(format!(
        "技能名称 {} 不符合 Agent Skills 规范，仅允许小写字母、数字与连字符。",
        normalized
    ))
}

/// 描述：校验技能版本是否符合三段式语义化版本，避免注册态与展示态出现无法比较的脏值。
///
/// Params:
///
///   - version: 原始版本号。
///
/// Returns:
///
///   - 0: 版本合法。
fn validate_agent_skill_version(version: &str) -> Result<(), String> {
    let normalized = version.trim();
    if normalized.is_empty() {
        return Err("skills 元数据缺少 version。".to_string());
    }
    let segments: Vec<&str> = normalized.split('.').collect();
    if segments.len() != 3 || segments.iter().any(|segment| {
        segment.is_empty() || !segment.chars().all(|char| char.is_ascii_digit())
    }) {
        return Err(format!(
            "skills 元数据 version {} 非法，仅支持 Major.Minor.Patch。",
            normalized
        ));
    }
    Ok(())
}

/// 描述：将技能状态规整为稳定枚举值；当前仅支持 stable / testing 两种状态。
///
/// Params:
///
///   - status: 原始状态值。
///
/// Returns:
///
///   - 归一化后的技能状态。
fn normalize_agent_skill_status(status: Option<&str>) -> Result<String, String> {
    let normalized = status
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(AGENT_SKILL_STATUS_STABLE)
        .to_lowercase();
    if normalized == AGENT_SKILL_STATUS_STABLE || normalized == AGENT_SKILL_STATUS_TESTING {
        return Ok(normalized);
    }
    Err(format!(
        "skills 元数据 status {} 非法，仅支持 stable / testing。",
        normalized
    ))
}

/// 描述：规整带版本的技能注册条目，统一移除空值、裁剪空白并按 `id + version` 去重。
///
/// Params:
///
///   - entries: 原始注册条目列表。
///
/// Returns:
///
///   - 规整后的注册条目列表。
fn normalize_registered_skill_entries(
    entries: Vec<AgentSkillRegistryEntry>,
) -> Vec<AgentSkillRegistryEntry> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let normalized_id = entry.id.trim().to_string();
        let normalized_version = entry.version.trim().to_string();
        if normalized_id.is_empty() {
            continue;
        }
        let dedupe_key = format!("{}@{}", normalized_id, normalized_version);
        if seen.insert(dedupe_key) {
            normalized.push(AgentSkillRegistryEntry {
                id: normalized_id,
                version: normalized_version,
            });
        }
    }
    normalized
}

/// 描述：从 `SKILL.md` 中解析 YAML frontmatter 与 Markdown 正文，确保技能包满足最小标准。
///
/// Params:
///
///   - markdown: `SKILL.md` 原始文本。
///
/// Returns:
///
///   - frontmatter 与 Markdown 正文。
fn parse_skill_markdown(markdown: &str) -> Result<(AgentSkillFrontmatter, String), String> {
    let normalized = markdown.replace("\r\n", "\n");
    let Some(frontmatter_source) = normalized.strip_prefix("---\n") else {
        return Err("SKILL.md 缺少 YAML frontmatter。".to_string());
    };
    let Some((raw_frontmatter, body)) = frontmatter_source.split_once("\n---\n") else {
        return Err("SKILL.md frontmatter 结束标记不完整。".to_string());
    };
    let frontmatter: AgentSkillFrontmatter = serde_yaml::from_str(raw_frontmatter)
        .map_err(|err| format!("解析 SKILL.md frontmatter 失败：{}", err))?;
    validate_agent_skill_name(frontmatter.name.as_str())?;
    let normalized_description = frontmatter.description.trim();
    if normalized_description.is_empty() {
        return Err("技能 frontmatter.description 不能为空。".to_string());
    }
    let normalized_body = body.trim().to_string();
    if normalized_body.is_empty() {
        return Err("SKILL.md 正文不能为空。".to_string());
    }
    Ok((frontmatter, normalized_body))
}

/// 描述：从 `agents/libra.yaml` 中解析 `libra` 根节点下的技能展示元数据，并校验标题、分组、示例提示与图标键均已提供。
///
/// Params:
///
///   - metadata: `agents/libra.yaml` 原始文本。
///
/// Returns:
///
///   - 解析后的技能展示元数据。
fn parse_skill_libra_metadata(metadata: &str) -> Result<AgentSkillLibraMetadata, String> {
    let parsed: AgentSkillLibraMetadataDocument = serde_yaml::from_str(metadata)
        .map_err(|err| format!("解析 agents/libra.yaml 失败：{}", err))?;
    let mut parsed = parsed.libra;

    if parsed.title.trim().is_empty() {
        return Err("skills 元数据缺少 title。".to_string());
    }
    if parsed.example_prompt.trim().is_empty() {
        return Err("skills 元数据缺少 example_prompt。".to_string());
    }
    validate_agent_skill_version(parsed.version.as_str())?;
    parsed.status = Some(normalize_agent_skill_status(parsed.status.as_deref())?);
    if parsed.group.trim().is_empty() {
        return Err("skills 元数据缺少 group。".to_string());
    }
    if parsed.icon.trim().is_empty() {
        return Err("skills 元数据缺少 icon。".to_string());
    }

    Ok(parsed)
}

/// 描述：读取技能目录中的 `agents/libra.yaml`，作为桌面端技能展示元数据的标准来源。
///
/// Params:
///
///   - skill_root: 技能根目录。
///
/// Returns:
///
///   - 解析后的技能展示元数据。
fn read_skill_libra_metadata(skill_root: &Path) -> Result<AgentSkillLibraMetadata, String> {
    let metadata_path = skill_root.join("agents").join("libra.yaml");
    let metadata = fs::read_to_string(&metadata_path).map_err(|err| {
        format!(
            "读取技能元数据失败（{}）：{}",
            metadata_path.to_string_lossy(),
            err
        )
    })?;
    parse_skill_libra_metadata(metadata.as_str())
}

/// 描述：解析技能展示描述，优先使用 `agents/libra.yaml.description`，缺失时回退到 `SKILL.md` frontmatter.description。
///
/// Params:
///
///   - frontmatter_description: `SKILL.md` frontmatter 中的描述。
///   - metadata_description: `agents/libra.yaml` 中可选的展示描述。
///
/// Returns:
///
///   - 最终用于桌面端展示的技能描述。
fn resolve_skill_description(
    frontmatter_description: &str,
    metadata_description: Option<&str>,
) -> String {
    let preferred_description = metadata_description
        .map(str::trim)
        .filter(|value| !value.is_empty());
    preferred_description
        .unwrap_or(frontmatter_description.trim())
        .to_string()
}

/// 描述：递归收集技能根目录下的 `SKILL.md` 文件，支持 `.system/<skill>/SKILL.md` 这类嵌套结构。
///
/// Params:
///
///   - root: 技能根目录。
///   - output: 结果写入容器。
///
/// Returns:
///
///   - 0: 收集成功。
fn collect_skill_markdown_files(root: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(root)
        .map_err(|err| format!("读取技能目录 {} 失败：{}", root.to_string_lossy(), err))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取技能目录项失败：{}", err))?;
        let path = entry.path();
        if path.is_dir() {
            collect_skill_markdown_files(&path, output)?;
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value == "SKILL.md")
            .unwrap_or(false)
        {
            output.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
/// 描述：判断指定路径是否位于隐藏系统目录下；系统目录允许展示但不允许在桌面端直接移除。
///
/// Params:
///
///   - relative_path: 相对于外部技能根目录的路径。
///
/// Returns:
///
///   - true 表示命中 `.system` 等隐藏目录。
fn is_hidden_skill_path(relative_path: &Path) -> bool {
    relative_path.components().any(|component| match component {
        Component::Normal(value) => value.to_string_lossy().starts_with('.'),
        _ => false,
    })
}

/// 描述：将单个 `SKILL.md` 文件解析为前端可消费的技能记录。
///
/// Params:
///
///   - skill_file_path: `SKILL.md` 文件路径。
///   - source: 技能来源类型。
///   - removable: 当前技能是否允许移除。
///
/// Returns:
///
///   - 解析成功的技能记录。
fn load_skill_record_from_file(
    skill_file_path: &Path,
    source: &str,
    removable: bool,
) -> Result<AgentSkillRecord, String> {
    let markdown = fs::read_to_string(skill_file_path).map_err(|err| {
        format!(
            "读取技能文件 {} 失败：{}",
            skill_file_path.to_string_lossy(),
            err
        )
    })?;
    let (frontmatter, markdown_body) = parse_skill_markdown(markdown.as_str())?;
    let skill_root = skill_file_path
        .parent()
        .ok_or_else(|| "技能文件路径无父目录。".to_string())?;
    let metadata = read_skill_libra_metadata(skill_root)?;
    let runtime_requirements = read_optional_runtime_requirements(skill_root)?;
    Ok(AgentSkillRecord {
        id: frontmatter.name.clone(),
        title: metadata.title.trim().to_string(),
        description: resolve_skill_description(
            frontmatter.description.as_str(),
            metadata.description.as_deref(),
        ),
        example_prompt: metadata.example_prompt.trim().to_string(),
        version: metadata.version.trim().to_string(),
        status: metadata
            .status
            .as_deref()
            .unwrap_or(AGENT_SKILL_STATUS_STABLE)
            .trim()
            .to_string(),
        group: metadata.group.trim().to_string(),
        icon: metadata.icon.trim().to_string(),
        source: source.to_string(),
        root_path: skill_root.to_string_lossy().to_string(),
        skill_file_path: skill_file_path.to_string_lossy().to_string(),
        markdown_body,
        runtime_requirements,
        removable,
    })
}

/// 描述：读取技能包可选的运行时元数据；未提供时返回空对象，避免前端因为缺少扩展文件而报错。
///
/// Params:
///
///   - skill_root: 技能根目录。
///
/// Returns:
///
///   - 解析后的运行时元数据 JSON。
fn read_optional_runtime_requirements(skill_root: &Path) -> Result<Value, String> {
    let runtime_requirements_path = skill_root.join("runtime").join("requirements.json");
    if !runtime_requirements_path.exists() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(&runtime_requirements_path).map_err(|err| {
        format!(
            "读取运行时元数据失败（{}）：{}",
            runtime_requirements_path.to_string_lossy(),
            err
        )
    })?;
    serde_json::from_str::<Value>(raw.as_str()).map_err(|err| {
        format!(
            "解析运行时元数据失败（{}）：{}",
            runtime_requirements_path.to_string_lossy(),
            err
        )
    })
}

/// 描述：判断技能是否应在当前构建环境中对外展示；`testing` 仅允许开发态出现，避免进入正式构建。
///
/// Params:
///
///   - status: 技能状态。
///
/// Returns:
///
///   - true: 当前环境允许展示该技能。
fn should_expose_skill_in_current_build(status: &str) -> bool {
    cfg!(debug_assertions) || status.trim() != AGENT_SKILL_STATUS_TESTING
}

/// 描述：读取技能注册表文件；当文件不存在时返回空注册状态，避免首次启动因缺少文件报错。
///
/// Params:
///
///   - registry_path: 技能注册表文件路径。
///
/// Returns:
///
///   - 解析后的技能注册状态。
fn read_agent_skill_registry_state(
    registry_path: &Path,
) -> Result<AgentSkillRegistryState, String> {
    if !registry_path.exists() {
        return Ok(AgentSkillRegistryState::default());
    }
    let content = fs::read_to_string(registry_path).map_err(|err| {
        format!(
            "读取技能注册表失败（{}）：{}",
            registry_path.to_string_lossy(),
            err
        )
    })?;
    let mut state =
        serde_json::from_str::<AgentSkillRegistryState>(content.as_str()).map_err(|err| {
            format!(
                "解析技能注册表失败（{}）：{}",
                registry_path.to_string_lossy(),
                err
            )
        })?;
    state.registered = normalize_registered_skill_entries(state.registered);
    state.registered_ids = state
        .registered_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    Ok(state)
}

/// 描述：按当前可用内置技能清单规整注册表状态；旧版 `registered_ids` 会迁移到当前版本，显式旧版本则保留待升级语义。
///
/// Params:
///
///   - state: 原始注册表状态。
///   - all_skills: 当前可见的全部技能。
///
/// Returns:
///
///   - 按当前技能版本清单规整后的注册表状态。
fn resolve_registry_state_with_available_skills(
    state: AgentSkillRegistryState,
    all_skills: &[AgentSkillRecord],
) -> AgentSkillRegistryState {
    let mut entries = normalize_registered_skill_entries(state.registered);
    let existing_ids: HashSet<String> = entries.iter().map(|item| item.id.clone()).collect();
    for legacy_id in state.registered_ids {
        if existing_ids.contains(legacy_id.as_str()) {
            continue;
        }
        if let Some(current_skill) = all_skills.iter().find(|item| item.id == legacy_id) {
            entries.push(AgentSkillRegistryEntry {
                id: current_skill.id.clone(),
                version: current_skill.version.clone(),
            });
        }
    }

    let available_pairs: HashSet<String> = all_skills
        .iter()
        .map(|item| format!("{}@{}", item.id, item.version))
        .collect();
    let normalized_entries = normalize_registered_skill_entries(
        entries
            .into_iter()
            .filter(|entry| available_pairs.contains(format!("{}@{}", entry.id, entry.version).as_str()))
            .collect(),
    );
    AgentSkillRegistryState {
        registered_ids: Vec::new(),
        registered: normalized_entries,
    }
}

/// 描述：写回技能注册表文件，统一使用易读 JSON 结构，便于排查当前注册状态。
///
/// Params:
///
///   - registry_path: 技能注册表文件路径。
///   - state: 待写入的技能注册状态。
///
/// Returns:
///
///   - 0: 写入成功。
fn write_agent_skill_registry_state(
    registry_path: &Path,
    state: &AgentSkillRegistryState,
) -> Result<(), String> {
    ensure_skill_registry_parent(registry_path)?;
    let normalized_state = AgentSkillRegistryState {
        registered_ids: Vec::new(),
        registered: normalize_registered_skill_entries(state.registered.clone()),
    };
    let content = serde_json::to_string_pretty(&normalized_state)
        .map_err(|err| format!("序列化技能注册表失败：{}", err))?;
    fs::write(registry_path, format!("{}\n", content)).map_err(|err| {
        format!(
            "写入技能注册表失败（{}）：{}",
            registry_path.to_string_lossy(),
            err
        )
    })?;
    Ok(())
}

/// 描述：扫描应用内置技能目录，生成桌面端允许暴露的完整内置技能清单。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///
/// Returns:
///
///   - 按组与展示标题排序的内置技能列表。
fn list_builtin_agent_skills_inner(
    app: &tauri::AppHandle,
) -> Result<Vec<AgentSkillRecord>, String> {
    let mut skill_map: HashMap<String, AgentSkillRecord> = HashMap::new();

    for builtin_root in resolve_builtin_skill_roots(app) {
        let mut skill_files = Vec::new();
        collect_skill_markdown_files(&builtin_root, &mut skill_files)?;
        for skill_file in skill_files {
            let record = load_skill_record_from_file(&skill_file, "builtin", false)?;
            if !should_expose_skill_in_current_build(record.status.as_str()) {
                continue;
            }
            skill_map.insert(record.id.clone(), record);
        }
    }

    let mut skills: Vec<AgentSkillRecord> = skill_map.into_values().collect();
    skills.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then(left.title.cmp(&right.title))
    });
    Ok(skills)
}

/// 描述：基于完整内置技能列表和带版本注册条目构建技能总览，确保页面与运行时共享同一套升级判断。
///
/// Params:
///
///   - all_skills: 全量内置技能。
///   - registered_entries: 当前注册的技能条目列表。
///
/// Returns:
///
///   - 结构化技能总览。
fn build_agent_skill_overview(
    all_skills: Vec<AgentSkillRecord>,
    registered_entries: &[AgentSkillRegistryEntry],
) -> AgentSkillOverview {
    let registered_key_set: HashSet<String> = registered_entries
        .iter()
        .map(|entry| format!("{}@{}", entry.id, entry.version))
        .collect();
    let mut registered = Vec::new();
    let mut unregistered = Vec::new();
    for item in &all_skills {
        let registry_key = format!("{}@{}", item.id, item.version);
        if registered_key_set.contains(registry_key.as_str()) {
            registered.push(item.clone());
            continue;
        }
        unregistered.push(item.clone());
    }
    AgentSkillOverview {
        registered,
        unregistered,
        all: all_skills,
    }
}

/// 描述：读取技能总览，并自动裁剪已经不存在的注册 ID，避免资源变更后出现悬空注册项。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///
/// Returns:
///
///   - 技能总览结构。
fn list_agent_skill_overview_inner(app: &tauri::AppHandle) -> Result<AgentSkillOverview, String> {
    let all_skills = list_builtin_agent_skills_inner(app)?;
    let registry_path = resolve_agent_skill_registry_path(app)?;
    let registry_state = read_agent_skill_registry_state(&registry_path)?;
    let normalized_registry_state =
        resolve_registry_state_with_available_skills(registry_state.clone(), all_skills.as_slice());
    if should_rewrite_registry_state(&registry_state, &normalized_registry_state) {
        write_agent_skill_registry_state(&registry_path, &normalized_registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        normalized_registry_state.registered.as_slice(),
    ))
}

/// 描述：读取技能总览时判断注册表是否需要回写，避免每次都重复读取同一路径造成状态判断分散。
///
/// Params:
///
///   - current: 原始注册表状态。
///   - normalized: 规整后的注册表状态。
///
/// Returns:
///
///   - true: 需要回写到磁盘。
fn should_rewrite_registry_state(
    current: &AgentSkillRegistryState,
    normalized: &AgentSkillRegistryState,
) -> bool {
    if !current.registered_ids.is_empty() {
        return true;
    }
    current.registered != normalized.registered
}

/// 描述：校验指定技能是否属于当前应用内置技能，避免前端提交任意 ID 直接污染注册表。
///
/// Params:
///
///   - skill_id: 待校验的技能 ID。
///   - all_skills: 全量内置技能列表。
///
/// Returns:
///
///   - 0: 技能存在且允许注册。
fn ensure_builtin_skill_exists(
    skill_id: &str,
    all_skills: &[AgentSkillRecord],
) -> Result<(), String> {
    if all_skills.iter().any(|item| item.id == skill_id) {
        return Ok(());
    }
    Err(format!("未找到内置技能 {}。", skill_id))
}

/// 描述：注册指定内置技能，并返回最新总览；重复注册会自动幂等处理。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - skill_id: 待注册的技能 ID。
///
/// Returns:
///
///   - 注册后的技能总览。
fn register_builtin_agent_skill_inner(
    app: &tauri::AppHandle,
    skill_id: &str,
) -> Result<AgentSkillOverview, String> {
    let normalized_skill_id = skill_id.trim();
    if normalized_skill_id.is_empty() {
        return Err("技能 ID 不能为空。".to_string());
    }
    let all_skills = list_builtin_agent_skills_inner(app)?;
    ensure_builtin_skill_exists(normalized_skill_id, all_skills.as_slice())?;
    let target_skill = all_skills
        .iter()
        .find(|item| item.id == normalized_skill_id)
        .ok_or_else(|| format!("未找到内置技能 {}。", normalized_skill_id))?;
    let registry_path = resolve_agent_skill_registry_path(app)?;
    let current_registry_state = read_agent_skill_registry_state(&registry_path)?;
    let mut registry_state =
        resolve_registry_state_with_available_skills(current_registry_state, all_skills.as_slice());
    let next_registered_entries = normalize_registered_skill_entries(
        registry_state
            .registered
            .iter()
            .cloned()
            .filter(|entry| entry.id != normalized_skill_id)
            .chain(std::iter::once(AgentSkillRegistryEntry {
                id: target_skill.id.clone(),
                version: target_skill.version.clone(),
            }))
            .collect(),
    );
    if next_registered_entries != registry_state.registered {
        registry_state.registered = next_registered_entries;
        registry_state.registered_ids.clear();
        write_agent_skill_registry_state(&registry_path, &registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        registry_state.registered.as_slice(),
    ))
}

/// 描述：取消注册指定内置技能，并返回最新总览；若技能未注册则保持幂等返回。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - skill_id: 待取消注册的技能 ID。
///
/// Returns:
///
///   - 取消注册后的技能总览。
fn unregister_builtin_agent_skill_inner(
    app: &tauri::AppHandle,
    skill_id: &str,
) -> Result<AgentSkillOverview, String> {
    let normalized_skill_id = skill_id.trim();
    if normalized_skill_id.is_empty() {
        return Err("技能 ID 不能为空。".to_string());
    }
    let all_skills = list_builtin_agent_skills_inner(app)?;
    ensure_builtin_skill_exists(normalized_skill_id, all_skills.as_slice())?;
    let registry_path = resolve_agent_skill_registry_path(app)?;
    let current_registry_state = read_agent_skill_registry_state(&registry_path)?;
    let mut registry_state =
        resolve_registry_state_with_available_skills(current_registry_state, all_skills.as_slice());
    let next_registered_entries: Vec<AgentSkillRegistryEntry> = registry_state
        .registered
        .iter()
        .filter(|item| item.id != normalized_skill_id)
        .cloned()
        .collect();
    if next_registered_entries != registry_state.registered {
        registry_state.registered = next_registered_entries;
        registry_state.registered_ids.clear();
        write_agent_skill_registry_state(&registry_path, &registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        registry_state.registered.as_slice(),
    ))
}

/// 描述：打开指定目录，触发系统文件管理器定位到技能包文件夹。
///
/// Params:
///
///   - path: 待打开的目录路径。
///
/// Returns:
///
///   - true: 系统打开命令已成功发起。
fn open_directory_path(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Err("技能目录不存在，无法打开文件夹。".to_string());
    }
    if !path.is_dir() {
        return Err("目标路径不是文件夹，无法打开。".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(path).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path.to_string_lossy().to_string())
        .status();

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = Command::new("xdg-open").arg(path).status();

    let status = status.map_err(|err| format!("打开技能文件夹失败：{}", err))?;
    if !status.success() {
        return Err(format!(
            "打开技能文件夹失败，系统返回状态码：{:?}",
            status.code()
        ));
    }
    Ok(true)
}

/// 描述：打开指定内置技能所在目录，供前端详情弹窗直接跳转到本地文件夹。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - skill_id: 技能 ID。
///
/// Returns:
///
///   - true: 系统打开命令已成功发起。
fn open_builtin_agent_skill_folder_inner(
    app: &tauri::AppHandle,
    skill_id: &str,
) -> Result<bool, String> {
    let normalized_skill_id = skill_id.trim();
    if normalized_skill_id.is_empty() {
        return Err("技能 ID 不能为空。".to_string());
    }
    let all_skills = list_builtin_agent_skills_inner(app)?;
    let target = all_skills
        .iter()
        .find(|item| item.id == normalized_skill_id)
        .ok_or_else(|| format!("未找到内置技能 {}。", normalized_skill_id))?;
    open_directory_path(Path::new(target.root_path.as_str()))
}

/// 描述：统一返回外部技能导入能力已关闭的错误，避免桌面端继续暴露不受控的本地技能执行面。
///
/// Returns:
///
///   - 统一错误消息。
fn external_skill_operations_disabled_error() -> String {
    "当前版本仅允许使用应用内置技能，暂不支持导入、选择或移除外部技能。".to_string()
}

#[tauri::command]
pub async fn list_agent_skills(app: tauri::AppHandle) -> Result<Vec<AgentSkillRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let overview = list_agent_skill_overview_inner(&app)?;
        Ok(overview.registered)
    })
    .await
    .map_err(|err| format!("扫描 Agent Skills 任务失败：{}", err))?
}

#[tauri::command]
pub async fn list_agent_skill_overview(
    app: tauri::AppHandle,
) -> Result<AgentSkillOverview, String> {
    tauri::async_runtime::spawn_blocking(move || list_agent_skill_overview_inner(&app))
        .await
        .map_err(|err| format!("读取技能总览任务失败：{}", err))?
}

#[tauri::command]
pub async fn register_builtin_agent_skill(
    app: tauri::AppHandle,
    skill_id: String,
) -> Result<AgentSkillOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        register_builtin_agent_skill_inner(&app, skill_id.as_str())
    })
    .await
    .map_err(|err| format!("注册内置技能任务失败：{}", err))?
}

#[tauri::command]
pub async fn unregister_builtin_agent_skill(
    app: tauri::AppHandle,
    skill_id: String,
) -> Result<AgentSkillOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unregister_builtin_agent_skill_inner(&app, skill_id.as_str())
    })
    .await
    .map_err(|err| format!("移除内置技能注册任务失败：{}", err))?
}

#[tauri::command]
pub async fn open_builtin_agent_skill_folder(
    app: tauri::AppHandle,
    skill_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_builtin_agent_skill_folder_inner(&app, skill_id.as_str())
    })
    .await
    .map_err(|err| format!("打开技能文件夹任务失败：{}", err))?
}

#[tauri::command]
pub async fn pick_agent_skill_folder() -> Result<Option<String>, String> {
    Err(external_skill_operations_disabled_error())
}

#[tauri::command]
pub async fn import_agent_skill_from_path(
    _app: tauri::AppHandle,
    _path: String,
) -> Result<AgentSkillRecord, String> {
    Err(external_skill_operations_disabled_error())
}

#[tauri::command]
pub async fn remove_user_agent_skill(_skill_id: String) -> Result<bool, String> {
    Err(external_skill_operations_disabled_error())
}

#[cfg(test)]
mod tests {
    use super::{
        AgentSkillRecord, AgentSkillRegistryEntry, build_agent_skill_overview,
        is_hidden_skill_path, normalize_registered_skill_entries, parse_skill_libra_metadata,
        parse_skill_markdown, resolve_skill_description, validate_agent_skill_name,
        validate_agent_skill_version,
    };
    use serde_json::json;
    use std::path::Path;

    /// 描述：构造最小技能记录，供纯函数测试复用，避免每个断言重复拼装完整结构。
    ///
    /// Params:
    ///
    ///   - id: 技能 ID。
    ///   - title: 技能展示标题。
    ///
    /// Returns:
    ///
    ///   - 可参与总览拆分测试的技能记录。
    fn build_test_skill_record(id: &str, title: &str) -> AgentSkillRecord {
        AgentSkillRecord {
            id: id.to_string(),
            title: title.to_string(),
            description: format!("{} 的描述", title),
            example_prompt: format!("{} 的示例提示", title),
            version: "1.0.0".to_string(),
            status: "stable".to_string(),
            group: "测试分组".to_string(),
            icon: "libra_skill".to_string(),
            source: "builtin".to_string(),
            root_path: format!("/tmp/{}", id),
            skill_file_path: format!("/tmp/{}/SKILL.md", id),
            markdown_body: "# test".to_string(),
            runtime_requirements: json!({}),
            removable: false,
        }
    }

    #[test]
    fn parse_skill_markdown_should_extract_frontmatter_and_body() {
        let markdown = r#"---
name: requirements-analyst
description: 拆解需求与验收项
---
# 技能正文

- 第一步
"#;
        let (frontmatter, body) =
            parse_skill_markdown(markdown).expect("skill markdown should parse");
        assert_eq!(frontmatter.name, "requirements-analyst");
        assert_eq!(frontmatter.description, "拆解需求与验收项");
        assert!(body.contains("技能正文"));
    }

    #[test]
    fn parse_skill_libra_metadata_should_extract_required_fields() {
        let metadata = r#"libra:
  title: 需求分析
  description: 优先展示的技能描述
  example_prompt: 帮我拆解需求并整理验收标准。
  version: 1.0.0
  status: stable
  group: 代码
  icon: libra_skill
"#;
        let parsed = parse_skill_libra_metadata(metadata).expect("skill metadata should parse");
        assert_eq!(parsed.title, "需求分析");
        assert_eq!(parsed.description.as_deref(), Some("优先展示的技能描述"));
        assert_eq!(parsed.example_prompt, "帮我拆解需求并整理验收标准。");
        assert_eq!(parsed.version, "1.0.0");
        assert_eq!(parsed.status.as_deref(), Some("stable"));
        assert_eq!(parsed.group, "代码");
        assert_eq!(parsed.icon, "libra_skill");
    }

    #[test]
    fn parse_skill_libra_metadata_should_reject_missing_required_fields() {
        let missing_prompt = r#"libra:
  title: 需求分析
  icon: libra_skill
"#;
        let error = parse_skill_libra_metadata(missing_prompt)
            .expect_err("metadata without example prompt should fail");
        assert!(error.contains("example_prompt"));
    }

    #[test]
    fn parse_skill_libra_metadata_should_reject_missing_root_node() {
        let metadata = r#"title: 需求分析
description: 优先展示的技能描述
example_prompt: 帮我拆解需求并整理验收标准。
icon: libra_skill
"#;
        let error = parse_skill_libra_metadata(metadata)
            .expect_err("metadata without libra root should fail");
        assert!(error.contains("libra"));
    }

    #[test]
    fn resolve_skill_description_should_prefer_metadata_description() {
        assert_eq!(
            resolve_skill_description("frontmatter 描述", Some("元数据描述")),
            "元数据描述".to_string()
        );
        assert_eq!(
            resolve_skill_description("frontmatter 描述", Some("   ")),
            "frontmatter 描述".to_string()
        );
        assert_eq!(
            resolve_skill_description("frontmatter 描述", None),
            "frontmatter 描述".to_string()
        );
    }

    #[test]
    fn validate_agent_skill_name_should_reject_invalid_chars() {
        assert!(validate_agent_skill_name("requirements-analyst").is_ok());
        assert!(validate_agent_skill_name("requirements_analyst").is_err());
        assert!(validate_agent_skill_name("Requirements-Analyst").is_err());
    }

    #[test]
    fn validate_agent_skill_version_should_require_major_minor_patch() {
        assert!(validate_agent_skill_version("1.0.0").is_ok());
        assert!(validate_agent_skill_version("1.0").is_err());
        assert!(validate_agent_skill_version("v1.0.0").is_err());
    }

    #[test]
    fn is_hidden_skill_path_should_detect_dot_prefixed_segments() {
        assert!(is_hidden_skill_path(Path::new(
            ".system/skill-creator/SKILL.md"
        )));
        assert!(!is_hidden_skill_path(Path::new(
            "requirements-analyst/SKILL.md"
        )));
    }

    #[test]
    fn normalize_registered_skill_entries_should_trim_and_dedupe() {
        let normalized = normalize_registered_skill_entries(vec![
            AgentSkillRegistryEntry {
                id: "".to_string(),
                version: "1.0.0".to_string(),
            },
            AgentSkillRegistryEntry {
                id: " requirements-analyst ".to_string(),
                version: " 1.0.0 ".to_string(),
            },
            AgentSkillRegistryEntry {
                id: "dcc-modeling".to_string(),
                version: "2.0.0".to_string(),
            },
            AgentSkillRegistryEntry {
                id: "requirements-analyst".to_string(),
                version: "1.0.0".to_string(),
            },
        ]);
        assert_eq!(
            normalized,
            vec![
                AgentSkillRegistryEntry {
                    id: "requirements-analyst".to_string(),
                    version: "1.0.0".to_string()
                },
                AgentSkillRegistryEntry {
                    id: "dcc-modeling".to_string(),
                    version: "2.0.0".to_string()
                }
            ]
        );
    }

    #[test]
    fn build_agent_skill_overview_should_split_registered_and_unregistered() {
        let overview = build_agent_skill_overview(
            vec![
                build_test_skill_record("requirements-analyst", "需求分析"),
                build_test_skill_record("dcc-modeling", "建模执行"),
            ],
            &[AgentSkillRegistryEntry {
                id: "requirements-analyst".to_string(),
                version: "1.0.0".to_string(),
            }],
        );
        assert_eq!(overview.all.len(), 2);
        assert_eq!(overview.registered.len(), 1);
        assert_eq!(overview.registered[0].id, "requirements-analyst");
        assert_eq!(overview.unregistered.len(), 1);
        assert_eq!(overview.unregistered[0].id, "dcc-modeling");
    }
}
