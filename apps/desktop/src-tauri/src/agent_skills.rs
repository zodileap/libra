use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

/// 描述：前端可消费的 Agent Skill 结构，统一输出技能元信息、来源、正文与可移除能力。
#[derive(Debug, Clone, Serialize)]
pub struct AgentSkillRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub root_path: String,
    pub skill_file_path: String,
    pub markdown_body: String,
    pub runtime_requirements: Value,
    pub removable: bool,
}

/// 描述：Agent Skills `SKILL.md` frontmatter 的最小标准字段，当前至少要求 name 与 description。
#[derive(Debug, Deserialize)]
struct AgentSkillFrontmatter {
    name: String,
    description: String,
    title: Option<String>,
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
    Err("未找到 CODEX_HOME 或用户主目录，无法解析技能目录。".to_string())
}

/// 描述：解析外部可写技能根目录，统一落在 `$CODEX_HOME/skills` 下，确保与 Agent Skills 生态目录一致。
///
/// Returns:
///
///   - 外部技能根目录路径。
fn resolve_external_skill_root() -> Result<PathBuf, String> {
    Ok(resolve_codex_home()?.join("skills"))
}

/// 描述：确保外部技能根目录存在，供导入本地技能时复用。
///
/// Returns:
///
///   - 已存在的外部技能根目录路径；创建失败时返回错误。
fn ensure_external_skill_root() -> Result<PathBuf, String> {
    let root = resolve_external_skill_root()?;
    fs::create_dir_all(&root).map_err(|err| format!("创建外部技能目录失败：{}", err))?;
    Ok(root)
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
    let runtime_requirements = read_optional_runtime_requirements(skill_root)?;
    Ok(AgentSkillRecord {
        id: frontmatter.name.clone(),
        name: frontmatter
            .title
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or(frontmatter.name),
        description: frontmatter.description.trim().to_string(),
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

/// 描述：扫描应用内置与外部技能目录，并按照“外部优先覆盖内置”的顺序生成技能注册表。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///
/// Returns:
///
///   - 按名称排序的技能列表。
fn list_agent_skills_inner(app: &tauri::AppHandle) -> Result<Vec<AgentSkillRecord>, String> {
    let mut skill_map: HashMap<String, AgentSkillRecord> = HashMap::new();

    for builtin_root in resolve_builtin_skill_roots(app) {
        let mut skill_files = Vec::new();
        collect_skill_markdown_files(&builtin_root, &mut skill_files)?;
        for skill_file in skill_files {
            let record = load_skill_record_from_file(&skill_file, "builtin", false)?;
            skill_map.insert(record.id.clone(), record);
        }
    }

    let external_root = resolve_external_skill_root()?;
    if external_root.exists() {
        let mut skill_files = Vec::new();
        collect_skill_markdown_files(&external_root, &mut skill_files)?;
        for skill_file in skill_files {
            let relative_path = skill_file
                .strip_prefix(&external_root)
                .unwrap_or(skill_file.as_path());
            let removable = !is_hidden_skill_path(relative_path);
            let record = load_skill_record_from_file(&skill_file, "external", removable)?;
            skill_map.insert(record.id.clone(), record);
        }
    }

    let mut skills: Vec<AgentSkillRecord> = skill_map.into_values().collect();
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

/// 描述：递归复制技能目录，保留 `references/`、`scripts/` 等附属资源，确保导入后的技能包完整可用。
///
/// Params:
///
///   - source: 源目录。
///   - destination: 目标目录。
///
/// Returns:
///
///   - 0: 复制成功。
fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| {
        format!(
            "创建技能目标目录 {} 失败：{}",
            destination.to_string_lossy(),
            err
        )
    })?;
    let entries = fs::read_dir(source)
        .map_err(|err| format!("读取技能源目录 {} 失败：{}", source.to_string_lossy(), err))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("读取技能源目录项失败：{}", err))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
            continue;
        }
        fs::copy(&source_path, &destination_path).map_err(|err| {
            format!(
                "复制技能文件 {} 失败：{}",
                source_path.to_string_lossy(),
                err
            )
        })?;
    }
    Ok(())
}

/// 描述：导入本地技能目录到 `$CODEX_HOME/skills`，并以 frontmatter.name 作为落盘目录名，避免目录名不规范。
///
/// Params:
///
///   - app: Tauri 应用句柄。
///   - source_path: 本地技能目录路径。
///
/// Returns:
///
///   - 导入后的技能记录。
fn import_agent_skill_from_path_inner(
    app: &tauri::AppHandle,
    source_path: &Path,
) -> Result<AgentSkillRecord, String> {
    if !source_path.exists() || !source_path.is_dir() {
        return Err("请选择包含 SKILL.md 的技能目录。".to_string());
    }
    let skill_file = source_path.join("SKILL.md");
    if !skill_file.exists() {
        return Err("所选目录缺少 SKILL.md，无法作为 Agent Skill 导入。".to_string());
    }
    let markdown =
        fs::read_to_string(&skill_file).map_err(|err| format!("读取所选技能目录失败：{}", err))?;
    let (frontmatter, _) = parse_skill_markdown(markdown.as_str())?;
    let external_root = ensure_external_skill_root()?;
    let destination_root = external_root.join(frontmatter.name.as_str());
    let source_canonical = source_path
        .canonicalize()
        .unwrap_or_else(|_| source_path.to_path_buf());
    let destination_canonical = destination_root
        .canonicalize()
        .unwrap_or_else(|_| destination_root.clone());
    if source_canonical != destination_canonical && destination_root.exists() {
        fs::remove_dir_all(&destination_root).map_err(|err| {
            format!(
                "覆盖已有技能目录 {} 失败：{}",
                destination_root.to_string_lossy(),
                err
            )
        })?;
    }
    if source_canonical != destination_canonical {
        copy_directory_recursive(source_path, &destination_root)?;
    }
    let destination_skill_file = destination_root.join("SKILL.md");
    let relative_path = destination_skill_file
        .strip_prefix(&external_root)
        .unwrap_or(destination_skill_file.as_path());
    let removable = !is_hidden_skill_path(relative_path);
    let record = load_skill_record_from_file(&destination_skill_file, "external", removable)?;
    let _ = list_agent_skills_inner(app)?;
    Ok(record)
}

/// 描述：按技能名称移除外部技能，仅允许删除 `$CODEX_HOME/skills` 下的非隐藏目录技能。
///
/// Params:
///
///   - skill_id: 技能名称。
///
/// Returns:
///
///   - true 表示已删除，false 表示目标不存在。
fn remove_user_agent_skill_inner(skill_id: &str) -> Result<bool, String> {
    let normalized_skill_id = skill_id.trim();
    validate_agent_skill_name(normalized_skill_id)?;
    let external_root = ensure_external_skill_root()?;
    let target_root = external_root.join(normalized_skill_id);
    let relative_path = target_root
        .strip_prefix(&external_root)
        .unwrap_or(target_root.as_path());
    if is_hidden_skill_path(relative_path) {
        return Err("系统技能不允许在桌面端直接移除。".to_string());
    }
    if !target_root.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(&target_root).map_err(|err| {
        format!(
            "移除技能目录 {} 失败：{}",
            target_root.to_string_lossy(),
            err
        )
    })?;
    Ok(true)
}

#[tauri::command]
pub async fn list_agent_skills(app: tauri::AppHandle) -> Result<Vec<AgentSkillRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || list_agent_skills_inner(&app))
        .await
        .map_err(|err| format!("扫描 Agent Skills 任务失败：{}", err))?
}

#[tauri::command]
pub async fn pick_agent_skill_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = rfd::FileDialog::new().pick_folder();
        Ok(selected.map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|err| format!("选择本地技能目录任务失败：{}", err))?
}

#[tauri::command]
pub async fn import_agent_skill_from_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<AgentSkillRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_agent_skill_from_path_inner(&app, PathBuf::from(path).as_path())
    })
    .await
    .map_err(|err| format!("导入 Agent Skill 任务失败：{}", err))?
}

#[tauri::command]
pub async fn remove_user_agent_skill(skill_id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || remove_user_agent_skill_inner(skill_id.as_str()))
        .await
        .map_err(|err| format!("移除 Agent Skill 任务失败：{}", err))?
}

#[cfg(test)]
mod tests {
    use super::{is_hidden_skill_path, parse_skill_markdown, validate_agent_skill_name};
    use std::path::Path;

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
}
