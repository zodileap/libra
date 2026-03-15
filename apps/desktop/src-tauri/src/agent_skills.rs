use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::Manager;

/// 描述：前端可消费的 Agent Skill 结构，统一输出技能标题、分组、来源、正文与可移除能力。
#[derive(Debug, Clone, Serialize)]
pub struct AgentSkillRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub example_prompt: String,
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

/// 描述：桌面端技能注册表文件结构，仅持久化用户手动启用的内置技能 ID。
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentSkillRegistryState {
    #[serde(default)]
    registered_ids: Vec<String>,
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
    group: String,
    icon: String,
}

/// 描述：`agents/libra.yaml` 的文档根结构，要求所有展示元数据都挂在 `libra` 根节点下。
#[derive(Debug, Deserialize)]
struct AgentSkillLibraMetadataDocument {
    libra: AgentSkillLibraMetadata,
}

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

/// 描述：规整技能注册 ID 列表，统一移除空值、裁剪空白并去重，避免旧注册表污染当前运行态。
///
/// Params:
///
///   - registered_ids: 原始注册 ID 列表。
///
/// Returns:
///
///   - 规整后的技能 ID 列表。
fn normalize_registered_skill_ids(registered_ids: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for skill_id in registered_ids {
        let trimmed = skill_id.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.clone()) {
            normalized.push(trimmed);
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
    let parsed = parsed.libra;

    if parsed.title.trim().is_empty() {
        return Err("skills 元数据缺少 title。".to_string());
    }
    if parsed.example_prompt.trim().is_empty() {
        return Err("skills 元数据缺少 example_prompt。".to_string());
    }
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
    state.registered_ids = normalize_registered_skill_ids(state.registered_ids);
    Ok(state)
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
    let content = serde_json::to_string_pretty(state)
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

/// 描述：基于完整内置技能列表和注册 ID 列表构建技能总览，确保页面与运行时共享同一套注册判断。
///
/// Params:
///
///   - all_skills: 全量内置技能。
///   - registered_ids: 当前注册的技能 ID 列表。
///
/// Returns:
///
///   - 结构化技能总览。
fn build_agent_skill_overview(
    all_skills: Vec<AgentSkillRecord>,
    registered_ids: &[String],
) -> AgentSkillOverview {
    let registered_id_set: HashSet<&str> = registered_ids.iter().map(String::as_str).collect();
    let mut registered = Vec::new();
    let mut unregistered = Vec::new();
    for item in &all_skills {
        if registered_id_set.contains(item.id.as_str()) {
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
    let mut registry_state = read_agent_skill_registry_state(&registry_path)?;
    let previous_registered_ids = registry_state.registered_ids.clone();
    let available_skill_ids: HashSet<String> =
        all_skills.iter().map(|item| item.id.clone()).collect();
    registry_state.registered_ids = previous_registered_ids
        .iter()
        .filter(|skill_id| available_skill_ids.contains(skill_id.as_str()))
        .cloned()
        .collect();
    if registry_state.registered_ids != previous_registered_ids {
        write_agent_skill_registry_state(&registry_path, &registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        registry_state.registered_ids.as_slice(),
    ))
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
    let registry_path = resolve_agent_skill_registry_path(app)?;
    let mut registry_state = read_agent_skill_registry_state(&registry_path)?;
    let next_registered_ids = normalize_registered_skill_ids(
        registry_state
            .registered_ids
            .iter()
            .cloned()
            .chain(std::iter::once(normalized_skill_id.to_string()))
            .collect(),
    );
    if next_registered_ids != registry_state.registered_ids {
        registry_state.registered_ids = next_registered_ids;
        write_agent_skill_registry_state(&registry_path, &registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        registry_state.registered_ids.as_slice(),
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
    let mut registry_state = read_agent_skill_registry_state(&registry_path)?;
    let next_registered_ids: Vec<String> = registry_state
        .registered_ids
        .iter()
        .filter(|item| item.as_str() != normalized_skill_id)
        .cloned()
        .collect();
    if next_registered_ids != registry_state.registered_ids {
        registry_state.registered_ids = next_registered_ids;
        write_agent_skill_registry_state(&registry_path, &registry_state)?;
    }
    Ok(build_agent_skill_overview(
        all_skills,
        registry_state.registered_ids.as_slice(),
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
        AgentSkillRecord, build_agent_skill_overview, is_hidden_skill_path,
        normalize_registered_skill_ids, parse_skill_libra_metadata, parse_skill_markdown,
        resolve_skill_description, validate_agent_skill_name,
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
  group: 代码
  icon: libra_skill
"#;
        let parsed = parse_skill_libra_metadata(metadata).expect("skill metadata should parse");
        assert_eq!(parsed.title, "需求分析");
        assert_eq!(parsed.description.as_deref(), Some("优先展示的技能描述"));
        assert_eq!(parsed.example_prompt, "帮我拆解需求并整理验收标准。");
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
    fn is_hidden_skill_path_should_detect_dot_prefixed_segments() {
        assert!(is_hidden_skill_path(Path::new(
            ".system/skill-creator/SKILL.md"
        )));
        assert!(!is_hidden_skill_path(Path::new(
            "requirements-analyst/SKILL.md"
        )));
    }

    #[test]
    fn normalize_registered_skill_ids_should_trim_and_dedupe() {
        let normalized = normalize_registered_skill_ids(vec![
            "".to_string(),
            " requirements-analyst ".to_string(),
            "dcc-modeling".to_string(),
            "requirements-analyst".to_string(),
        ]);
        assert_eq!(
            normalized,
            vec![
                "requirements-analyst".to_string(),
                "dcc-modeling".to_string()
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
            &vec![
                "requirements-analyst".to_string(),
                "missing-skill".to_string(),
            ],
        );
        assert_eq!(overview.all.len(), 2);
        assert_eq!(overview.registered.len(), 1);
        assert_eq!(overview.registered[0].id, "requirements-analyst");
        assert_eq!(overview.unregistered.len(), 1);
        assert_eq!(overview.unregistered[0].id, "dcc-modeling");
    }
}
