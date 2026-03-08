use super::utils::{
    get_required_raw_string, get_required_string, parse_positive_usize_arg,
    resolve_executable_binary, resolve_sandbox_path,
};
use super::{AgentTool, ToolContext};
use libra_mcp_common::ProtocolError;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Command;

const MAX_GLOB_WALK_DEPTH: usize = 64;

pub struct ReadTextTool;

impl AgentTool for ReadTextTool {
    fn name(&self) -> &'static str {
        "read_text"
    }

    fn description(&self) -> &'static str {
        "读取文本文件，返回文件内容。参数：{\"path\": \"文件相对路径\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.read_text.path_missing")?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        let content = fs::read_to_string(&target).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.read_text_failed",
                format!("读取文件失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "content": content,
        }))
    }
}

pub struct ReadJsonTool;

impl AgentTool for ReadJsonTool {
    fn name(&self) -> &'static str {
        "read_json"
    }

    fn description(&self) -> &'static str {
        "读取并解析 JSON 文件。参数：{\"path\": \"相对路径\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.read_json.path_missing")?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        let content = fs::read_to_string(&target).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.read_json_failed",
                format!("读取文件失败: {}", err),
            )
        })?;
        let parsed: Value = serde_json::from_str(&content).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.read_json_parse_failed",
                format!("解析 JSON 失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "data": parsed,
        }))
    }
}

pub struct WriteTextTool;

impl AgentTool for WriteTextTool {
    fn name(&self) -> &'static str {
        "write_text"
    }

    fn description(&self) -> &'static str {
        "写入文本文件（支持创建不存在的父目录）。参数：{\"path\": \"相对路径\", \"content\": \"完整文件内容\"}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.write_text.path_missing")?;
        let content = get_required_raw_string(
            args,
            "content",
            "core.agent.python.write_text.content_missing",
        )?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        let previous = fs::read_to_string(&target).ok();
        let previous_line_count = count_text_lines(previous.as_deref().unwrap_or(""));
        let next_line_count = count_text_lines(content.as_str());
        let (added_lines, removed_lines) =
            calculate_line_delta(previous_line_count, next_line_count);
        let diff_preview = build_rewrite_diff_preview(
            target.to_string_lossy().as_ref(),
            previous.as_deref(),
            content.as_str(),
        );
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&target, content.as_bytes()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.write_text_failed",
                format!("写入文件失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "bytes": content.len(),
            "added_lines": added_lines,
            "removed_lines": removed_lines,
            "diff_preview": diff_preview,
        }))
    }
}

pub struct WriteJsonTool;

impl AgentTool for WriteJsonTool {
    fn name(&self) -> &'static str {
        "write_json"
    }

    fn description(&self) -> &'static str {
        "将结构化数据写入 JSON 文件。参数：{\"path\": \"相对路径\", \"data\": {\"任意\": \"结构\"}}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.write_json.path_missing")?;
        let data = args.get("data").ok_or_else(|| {
            ProtocolError::new(
                "core.agent.python.write_json.data_missing",
                "缺少 data 参数",
            )
        })?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        let previous = fs::read_to_string(&target).ok();
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let pretty = serde_json::to_string_pretty(data).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.write_json.serialize_failed",
                format!("序列化 JSON 失败: {}", err),
            )
        })?;
        fs::write(&target, pretty.as_bytes()).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.write_json.write_failed",
                format!("写入 JSON 文件失败: {}", err),
            )
        })?;
        let previous_line_count = count_text_lines(previous.as_deref().unwrap_or(""));
        let next_line_count = count_text_lines(pretty.as_str());
        let (added_lines, removed_lines) =
            calculate_line_delta(previous_line_count, next_line_count);
        let diff_preview = build_rewrite_diff_preview(
            target.to_string_lossy().as_ref(),
            previous.as_deref(),
            pretty.as_str(),
        );
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "bytes": pretty.len(),
            "success": true,
            "added_lines": added_lines,
            "removed_lines": removed_lines,
            "diff_preview": diff_preview,
        }))
    }
}

/// 描述：计算文本总行数，空文本返回 0，避免 `lines()` 对空串返回 1 的歧义。
fn count_text_lines(text: &str) -> usize {
    let normalized = text.trim_end_matches('\n');
    if normalized.trim().is_empty() {
        return 0;
    }
    normalized.lines().count()
}

/// 描述：根据前后行数估算新增/删除行数，用于前端展示 `+/-` 编辑摘要。
fn calculate_line_delta(previous_lines: usize, next_lines: usize) -> (usize, usize) {
    if next_lines >= previous_lines {
        (next_lines - previous_lines, 0)
    } else {
        (0, previous_lines - next_lines)
    }
}

/// 描述：构建“整文件重写”场景的差异预览，供执行流展开查看。
fn build_rewrite_diff_preview(path: &str, previous: Option<&str>, next: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("--- {}", path));
    lines.push(format!("+++ {}", path));
    let previous_lines = previous
        .unwrap_or("")
        .lines()
        .map(|line| format!("-{}", line))
        .collect::<Vec<String>>();
    let next_lines = next
        .lines()
        .map(|line| format!("+{}", line))
        .collect::<Vec<String>>();
    let preview_limit = 120usize;
    let mut merged = previous_lines;
    merged.extend(next_lines);
    if merged.len() > preview_limit {
        merged.truncate(preview_limit);
        merged.push("...".to_string());
    }
    lines.extend(merged);
    lines.join("\n")
}

pub struct ListDirTool;

impl AgentTool for ListDirTool {
    fn name(&self) -> &'static str {
        "list_dir"
    }

    fn description(&self) -> &'static str {
        "列出指定目录的文件和子目录信息。参数：{\"path\": \"目录相对路径（可选，默认为当前目录）\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = args
            .get("path")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(".");
        let target = resolve_sandbox_path(context.sandbox_root, path)?;
        let mut entries: Vec<Value> = Vec::new();
        let read_dir = fs::read_dir(&target).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.list_dir_failed",
                format!("读取目录失败: {}", err),
            )
        })?;
        for item in read_dir {
            let entry = item.map_err(|err| {
                ProtocolError::new(
                    "core.agent.python.list_dir_entry_failed",
                    format!("读取目录项失败: {}", err),
                )
            })?;
            let path = entry.path();
            let metadata = entry.metadata().ok();
            entries.push(json!({
                "name": path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default(),
                "path": path.to_string_lossy().to_string(),
                "is_dir": metadata.as_ref().map(|meta| meta.is_dir()).unwrap_or(false),
                "is_file": metadata.as_ref().map(|meta| meta.is_file()).unwrap_or(false),
            }));
        }
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "entries": entries,
        }))
    }
}

pub struct MkdirTool;

impl AgentTool for MkdirTool {
    fn name(&self) -> &'static str {
        "mkdir"
    }

    fn description(&self) -> &'static str {
        "创建目录，支持自动创建不存在的父目录。参数：{\"path\": \"相对路径\"}"
    }

    fn risk_level(&self) -> crate::tools::RiskLevel {
        crate::tools::RiskLevel::High
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.mkdir.path_missing")?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        fs::create_dir_all(&target).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.mkdir.failed",
                format!("创建目录失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "success": true,
        }))
    }
}

pub struct StatTool;

impl AgentTool for StatTool {
    fn name(&self) -> &'static str {
        "stat"
    }

    fn description(&self) -> &'static str {
        "获取文件或目录的基础元数据。参数：{\"path\": \"相对路径\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let path = get_required_string(args, "path", "core.agent.python.stat.path_missing")?;
        let target = resolve_sandbox_path(context.sandbox_root, path.as_str())?;
        let meta = fs::metadata(&target).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.stat.failed",
                format!("读取文件元数据失败: {}", err),
            )
        })?;
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "is_file": meta.is_file(),
            "is_dir": meta.is_dir(),
            "size_bytes": meta.len(),
            "readonly": meta.permissions().readonly(),
        }))
    }
}

pub struct GlobTool;

impl AgentTool for GlobTool {
    fn name(&self) -> &'static str {
        "glob"
    }

    fn description(&self) -> &'static str {
        "按 glob 模式匹配沙盒内文件/目录。参数：{\"pattern\": \"匹配模式，如 src/**/*.rs\", \"max_results\": 100}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let pattern =
            get_required_string(args, "pattern", "core.agent.python.glob.pattern_missing")?;
        let max_results = parse_positive_usize_arg(args, "max_results", 100, 2_000)?;

        let matches = match resolve_executable_binary("rg", "--version") {
            Some(rg_bin) => run_rg_glob(
                rg_bin.as_str(),
                context.sandbox_root,
                pattern.as_str(),
                max_results,
            )?,
            None => run_recursive_glob(context.sandbox_root, pattern.as_str(), max_results)?,
        };

        Ok(json!({
            "pattern": pattern,
            "count": matches.len(),
            "matches": matches,
        }))
    }
}

pub struct SearchFilesTool;

impl AgentTool for SearchFilesTool {
    fn name(&self) -> &'static str {
        "search_files"
    }

    fn description(&self) -> &'static str {
        "在项目中执行全文检索，支持 glob 过滤。参数：{\"query\": \"检索关键词\", \"glob\": \"可选的文件匹配模式，如 *.rs\"}"
    }

    fn execute(&self, args: &Value, context: ToolContext) -> Result<Value, ProtocolError> {
        let query = get_required_string(
            args,
            "query",
            "core.agent.python.search_files.query_missing",
        )?;
        let glob = args
            .get("glob")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let max_results = parse_positive_usize_arg(args, "max_results", 50, 500)?;

        let matches = match resolve_executable_binary("rg", "--version") {
            Some(rg_bin) => run_rg_search(
                rg_bin.as_str(),
                context.sandbox_root,
                query.as_str(),
                glob.as_str(),
                max_results,
            )?,
            None => run_grep_search(
                context.sandbox_root,
                query.as_str(),
                glob.as_str(),
                max_results,
            )?,
        };
        Ok(json!({
            "query": query,
            "glob": glob,
            "count": matches.len(),
            "matches": matches,
        }))
    }
}

/// 描述：通过 ripgrep 的文件模式匹配能力执行 glob，性能更高且跨平台行为稳定。
fn run_rg_glob(
    rg_bin: &str,
    sandbox_root: &Path,
    pattern: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut command = Command::new(rg_bin);
    command
        .arg("--files")
        .arg("-g")
        .arg(pattern)
        .arg(".")
        .current_dir(sandbox_root);
    let output = command.output().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.glob.exec_failed",
            format!("执行 glob 搜索失败: {}", err),
        )
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(ProtocolError::new(
            "core.agent.python.glob.failed",
            String::from_utf8_lossy(output.stderr.as_slice())
                .trim()
                .to_string(),
        ));
    }

    let mut matches: Vec<Value> = String::from_utf8_lossy(output.stdout.as_slice())
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            json!({
                "path": line,
                "is_file": true,
                "is_dir": false,
            })
        })
        .collect();
    if matches.len() > max_results {
        matches.truncate(max_results);
    }
    Ok(matches)
}

/// 描述：在未安装 ripgrep 时递归遍历目录并做 glob 匹配，保障工具能力可用性。
fn run_recursive_glob(
    sandbox_root: &Path,
    pattern: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut matches: Vec<Value> = Vec::new();
    collect_recursive_glob_entries(
        sandbox_root,
        sandbox_root,
        pattern,
        max_results,
        0,
        &mut matches,
    )?;
    Ok(matches)
}

/// 描述：递归收集匹配条目并在命中上限后提前返回，避免大仓库遍历过慢。
fn collect_recursive_glob_entries(
    sandbox_root: &Path,
    current: &Path,
    pattern: &str,
    max_results: usize,
    depth: usize,
    matches: &mut Vec<Value>,
) -> Result<(), ProtocolError> {
    if matches.len() >= max_results {
        return Ok(());
    }
    if depth > MAX_GLOB_WALK_DEPTH {
        return Ok(());
    }
    let read_dir = fs::read_dir(current).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.glob.read_dir_failed",
            format!("读取目录失败: {}", err),
        )
    })?;

    for item in read_dir {
        if matches.len() >= max_results {
            return Ok(());
        }

        let entry = item.map_err(|err| {
            ProtocolError::new(
                "core.agent.python.glob.read_entry_failed",
                format!("读取目录项失败: {}", err),
            )
        })?;
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.glob.stat_failed",
                format!("读取文件状态失败: {}", err),
            )
        })?;
        let is_symlink = metadata.file_type().is_symlink();

        let relative = entry_path
            .strip_prefix(sandbox_root)
            .unwrap_or(entry_path.as_path());
        let relative_text = relative.to_string_lossy().replace('\\', "/");

        if glob_match(pattern, relative_text.as_str()) {
            matches.push(json!({
                "path": relative_text,
                "is_file": metadata.is_file(),
                "is_dir": metadata.is_dir(),
                "is_symlink": is_symlink,
            }));
        }

        if metadata.is_dir() && !is_symlink {
            collect_recursive_glob_entries(
                sandbox_root,
                entry_path.as_path(),
                pattern,
                max_results,
                depth + 1,
                matches,
            )?;
        }
    }

    Ok(())
}

/// 描述：执行基础 glob 匹配，支持 `*` 与 `?` 通配符。
fn glob_match(pattern: &str, text: &str) -> bool {
    let pat: Vec<char> = pattern.chars().collect();
    let txt: Vec<char> = text.chars().collect();
    let mut dp = vec![vec![false; txt.len() + 1]; pat.len() + 1];
    dp[0][0] = true;

    for i in 1..=pat.len() {
        if pat[i - 1] == '*' {
            dp[i][0] = dp[i - 1][0];
        }
    }

    for i in 1..=pat.len() {
        for j in 1..=txt.len() {
            if pat[i - 1] == '*' {
                dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
            } else if pat[i - 1] == '?' || pat[i - 1] == txt[j - 1] {
                dp[i][j] = dp[i - 1][j - 1];
            }
        }
    }

    dp[pat.len()][txt.len()]
}

/// 描述：执行 ripgrep 搜索并返回结构化结果。
fn run_rg_search(
    rg_bin: &str,
    sandbox_root: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut command = Command::new(rg_bin);
    command
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--color")
        .arg("never")
        .arg(query);
    if !glob.trim().is_empty() {
        command.arg("-g").arg(glob);
    }
    command.arg(".").current_dir(sandbox_root);
    let output = command.output().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.search_files.exec_failed",
            format!("执行 rg 搜索失败: {}", err),
        )
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(ProtocolError::new(
            "core.agent.python.search_files.failed",
            String::from_utf8_lossy(output.stderr.as_slice())
                .trim()
                .to_string(),
        ));
    }
    let text = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let mut matches = text
        .lines()
        .filter_map(parse_search_line)
        .collect::<Vec<Value>>();
    if matches.len() > max_results {
        matches.truncate(max_results);
    }
    Ok(matches)
}

/// 描述：在未安装 ripgrep 时回退 grep 实现，保障基础检索可用。
fn run_grep_search(
    sandbox_root: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut command = Command::new("grep");
    command
        .arg("-R")
        .arg("-n")
        .arg("--exclude-dir")
        .arg(".git")
        .arg(query)
        .arg(".");
    if !glob.trim().is_empty() {
        command.arg(format!("--include={}", glob));
    }
    command.current_dir(sandbox_root);
    let output = command.output().map_err(|err| {
        ProtocolError::new(
            "core.agent.python.search_files.exec_failed",
            format!("执行 grep 搜索失败: {}", err),
        )
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(ProtocolError::new(
            "core.agent.python.search_files.failed",
            String::from_utf8_lossy(output.stderr.as_slice())
                .trim()
                .to_string(),
        ));
    }
    let text = String::from_utf8_lossy(output.stdout.as_slice()).to_string();
    let mut matches = text
        .lines()
        .filter_map(parse_search_line)
        .collect::<Vec<Value>>();
    if matches.len() > max_results {
        matches.truncate(max_results);
    }
    Ok(matches)
}

/// 描述：解析单行 grep/rg 输出为统一结构，格式为 `path:line:content`。
pub fn parse_search_line(raw_line: &str) -> Option<Value> {
    let mut parts = raw_line.splitn(3, ':');
    let path = parts.next()?.trim();
    let line = parts.next()?.trim().parse::<usize>().ok()?;
    let content = parts.next().unwrap_or("").trim().to_string();
    Some(json!({
        "path": path,
        "line": line,
        "content": content,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 描述：验证 mkdir 被标记为高风险，确保目录写操作进入审批链路。
    #[test]
    fn should_mark_mkdir_as_high_risk() {
        assert!(matches!(
            MkdirTool.risk_level(),
            crate::tools::RiskLevel::High
        ));
    }

    /// 描述：验证 glob 匹配支持基础星号通配符。
    #[test]
    fn should_match_glob_pattern() {
        assert!(glob_match("src/*.rs", "src/lib.rs"));
        assert!(!glob_match("src/*.ts", "src/lib.rs"));
    }
}
