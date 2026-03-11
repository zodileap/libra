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
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_GLOB_WALK_DEPTH: usize = 64;
const REWRITE_DIFF_CONTEXT_RADIUS: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RewriteDiffSummary {
    added_lines: usize,
    removed_lines: usize,
    diff_preview: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RewriteDiffOp<'a> {
    Equal(&'a str),
    Add(&'a str),
    Remove(&'a str),
}

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
        let diff_summary = build_rewrite_diff_summary(
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
            "added_lines": diff_summary.added_lines,
            "removed_lines": diff_summary.removed_lines,
            "diff_preview": diff_summary.diff_preview,
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
        let diff_summary = build_rewrite_diff_summary(
            target.to_string_lossy().as_ref(),
            previous.as_deref(),
            pretty.as_str(),
        );
        Ok(json!({
            "path": target.to_string_lossy().to_string(),
            "bytes": pretty.len(),
            "success": true,
            "added_lines": diff_summary.added_lines,
            "removed_lines": diff_summary.removed_lines,
            "diff_preview": diff_summary.diff_preview,
        }))
    }
}

/// 描述：按文本真实内容拆分行，保留空白行但忽略“空串无内容”的伪行。
///
/// Params:
///
///   - text: 原始文本。
///
/// Returns:
///
///   - 0: 拆分后的逐行文本切片。
fn split_text_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    text.lines().collect()
}

/// 描述：构建整文件重写的差异摘要，优先使用 Git 生成标准 unified diff，失败时回退内置逐行 diff。
///
/// Params:
///
///   - path: 当前编辑文件路径。
///   - previous: 编辑前文本。
///   - next: 编辑后文本。
///
/// Returns:
///
///   - 0: 结构化差异摘要，包含真实新增/删除行数与 diff 预览。
fn build_rewrite_diff_summary(
    path: &str,
    previous: Option<&str>,
    next: &str,
) -> RewriteDiffSummary {
    let previous_text = previous.unwrap_or("");
    if let Some(git_bin) = resolve_executable_binary("git", "--version") {
        if let Some(summary) =
            build_rewrite_diff_summary_with_git(git_bin.as_str(), path, previous_text, next)
        {
            return summary;
        }
    }
    build_rewrite_diff_summary_fallback(path, previous_text, next)
}

/// 描述：借助 Git `diff --no-index` 生成标准 unified diff，保证 hunk 行号和新增/删除统计准确。
///
/// Params:
///
///   - git_bin: Git 可执行文件路径。
///   - path: 当前编辑文件路径。
///   - previous: 编辑前文本。
///   - next: 编辑后文本。
///
/// Returns:
///
///   - 0: 生成成功时返回结构化差异摘要；失败返回 None，交由内置算法兜底。
fn build_rewrite_diff_summary_with_git(
    git_bin: &str,
    path: &str,
    previous: &str,
    next: &str,
) -> Option<RewriteDiffSummary> {
    let runtime_dir = build_rewrite_diff_runtime_dir()?;
    let previous_path = runtime_dir.join("before.txt");
    let next_path = runtime_dir.join("after.txt");
    if fs::write(&previous_path, previous.as_bytes()).is_err()
        || fs::write(&next_path, next.as_bytes()).is_err()
    {
        let _ = fs::remove_dir_all(&runtime_dir);
        return None;
    }

    let output = Command::new(git_bin)
        .arg("diff")
        .arg("--no-index")
        .arg("--no-color")
        .arg("--text")
        .arg(format!("--unified={}", REWRITE_DIFF_CONTEXT_RADIUS))
        .arg("--label")
        .arg(path)
        .arg("--label")
        .arg(path)
        .arg("--")
        .arg(previous_path.as_os_str())
        .arg(next_path.as_os_str())
        .output()
        .ok();

    let _ = fs::remove_dir_all(&runtime_dir);
    let output = output?;
    if !output.status.success() && output.status.code() != Some(1) {
        return None;
    }

    let diff_preview = String::from_utf8_lossy(output.stdout.as_slice())
        .trim_end_matches('\n')
        .to_string();
    let (added_lines, removed_lines) = count_unified_diff_change_lines(diff_preview.as_str());
    Some(RewriteDiffSummary {
        added_lines,
        removed_lines,
        diff_preview,
    })
}

/// 描述：在无法使用 Git 时，基于逐行 LCS 结果构建 unified diff，保证重写场景仍能得到稳定行号。
///
/// Params:
///
///   - path: 当前编辑文件路径。
///   - previous: 编辑前文本。
///   - next: 编辑后文本。
///
/// Returns:
///
///   - 0: 结构化差异摘要。
fn build_rewrite_diff_summary_fallback(
    path: &str,
    previous: &str,
    next: &str,
) -> RewriteDiffSummary {
    let previous_lines = split_text_lines(previous);
    let next_lines = split_text_lines(next);
    let operations =
        build_rewrite_diff_operations(previous_lines.as_slice(), next_lines.as_slice());
    let diff_preview = build_unified_diff_preview(path, operations.as_slice());
    let (added_lines, removed_lines) = count_unified_diff_change_lines(diff_preview.as_str());
    RewriteDiffSummary {
        added_lines,
        removed_lines,
        diff_preview,
    }
}

/// 描述：为重写 diff 创建临时目录，避免覆盖用户工作区文件。
///
/// Returns:
///
///   - 0: 成功时返回临时目录路径；失败返回 None。
fn build_rewrite_diff_runtime_dir() -> Option<std::path::PathBuf> {
    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let runtime_dir = std::env::temp_dir().join(format!(
        "libra-agent-write-diff-{}-{}",
        std::process::id(),
        now_nanos
    ));
    fs::create_dir_all(&runtime_dir).ok()?;
    Some(runtime_dir)
}

/// 描述：根据统一 diff 文本统计真实新增/删除行数，忽略头部元信息与 hunk 标记。
///
/// Params:
///
///   - diff_preview: unified diff 文本。
///
/// Returns:
///
///   - 0: 新增行数。
///   - 1: 删除行数。
fn count_unified_diff_change_lines(diff_preview: &str) -> (usize, usize) {
    diff_preview
        .lines()
        .fold((0usize, 0usize), |(added, removed), line| {
            if line.starts_with("+++ ")
                || line.starts_with("--- ")
                || line.starts_with("@@ ")
                || line.starts_with("diff --git ")
                || line.starts_with("index ")
                || line.starts_with("\\ No newline at end of file")
            {
                return (added, removed);
            }
            if line.starts_with('+') {
                return (added.saturating_add(1), removed);
            }
            if line.starts_with('-') {
                return (added, removed.saturating_add(1));
            }
            (added, removed)
        })
}

/// 描述：基于前后文本的最长公共子序列生成逐行操作列表，供 unified diff 渲染使用。
///
/// Params:
///
///   - previous_lines: 编辑前逐行文本。
///   - next_lines: 编辑后逐行文本。
///
/// Returns:
///
///   - 0: 逐行差异操作列表。
fn build_rewrite_diff_operations<'a>(
    previous_lines: &[&'a str],
    next_lines: &[&'a str],
) -> Vec<RewriteDiffOp<'a>> {
    let previous_len = previous_lines.len();
    let next_len = next_lines.len();
    let mut lcs = vec![vec![0usize; next_len + 1]; previous_len + 1];

    for previous_index in (0..previous_len).rev() {
        for next_index in (0..next_len).rev() {
            lcs[previous_index][next_index] =
                if previous_lines[previous_index] == next_lines[next_index] {
                    lcs[previous_index + 1][next_index + 1].saturating_add(1)
                } else {
                    lcs[previous_index + 1][next_index].max(lcs[previous_index][next_index + 1])
                };
        }
    }

    let mut operations: Vec<RewriteDiffOp<'a>> = Vec::new();
    let mut previous_index = 0usize;
    let mut next_index = 0usize;
    while previous_index < previous_len && next_index < next_len {
        if previous_lines[previous_index] == next_lines[next_index] {
            operations.push(RewriteDiffOp::Equal(previous_lines[previous_index]));
            previous_index += 1;
            next_index += 1;
            continue;
        }

        if lcs[previous_index + 1][next_index] >= lcs[previous_index][next_index + 1] {
            operations.push(RewriteDiffOp::Remove(previous_lines[previous_index]));
            previous_index += 1;
            continue;
        }

        operations.push(RewriteDiffOp::Add(next_lines[next_index]));
        next_index += 1;
    }

    while previous_index < previous_len {
        operations.push(RewriteDiffOp::Remove(previous_lines[previous_index]));
        previous_index += 1;
    }
    while next_index < next_len {
        operations.push(RewriteDiffOp::Add(next_lines[next_index]));
        next_index += 1;
    }
    operations
}

/// 描述：把逐行操作转换为 unified diff 文本，并附带真实 hunk 行号，供前端显示局部变更。
///
/// Params:
///
///   - path: 当前编辑文件路径。
///   - operations: 逐行差异操作。
///
/// Returns:
///
///   - 0: unified diff 文本；无差异时返回空串。
fn build_unified_diff_preview(path: &str, operations: &[RewriteDiffOp<'_>]) -> String {
    let changed_indexes = operations
        .iter()
        .enumerate()
        .filter_map(|(index, operation)| match operation {
            RewriteDiffOp::Add(_) | RewriteDiffOp::Remove(_) => Some(index),
            RewriteDiffOp::Equal(_) => None,
        })
        .collect::<Vec<usize>>();
    if changed_indexes.is_empty() {
        return String::new();
    }

    let mut hunk_ranges: Vec<(usize, usize)> = Vec::new();
    for changed_index in changed_indexes {
        let range_start = changed_index.saturating_sub(REWRITE_DIFF_CONTEXT_RADIUS);
        let range_end = (changed_index + REWRITE_DIFF_CONTEXT_RADIUS + 1).min(operations.len());
        if let Some((_, last_end)) = hunk_ranges.last_mut() {
            if range_start <= *last_end {
                *last_end = (*last_end).max(range_end);
                continue;
            }
        }
        hunk_ranges.push((range_start, range_end));
    }

    let mut old_prefix_counts = vec![0usize; operations.len() + 1];
    let mut new_prefix_counts = vec![0usize; operations.len() + 1];
    for (index, operation) in operations.iter().enumerate() {
        old_prefix_counts[index + 1] = old_prefix_counts[index]
            + usize::from(matches!(
                operation,
                RewriteDiffOp::Equal(_) | RewriteDiffOp::Remove(_)
            ));
        new_prefix_counts[index + 1] = new_prefix_counts[index]
            + usize::from(matches!(
                operation,
                RewriteDiffOp::Equal(_) | RewriteDiffOp::Add(_)
            ));
    }

    let mut diff_lines = vec![format!("--- {}", path), format!("+++ {}", path)];
    for (range_start, range_end) in hunk_ranges {
        let old_count = old_prefix_counts[range_end].saturating_sub(old_prefix_counts[range_start]);
        let new_count = new_prefix_counts[range_end].saturating_sub(new_prefix_counts[range_start]);
        let old_start = if old_count == 0 {
            old_prefix_counts[range_start]
        } else {
            old_prefix_counts[range_start].saturating_add(1)
        };
        let new_start = if new_count == 0 {
            new_prefix_counts[range_start]
        } else {
            new_prefix_counts[range_start].saturating_add(1)
        };
        diff_lines.push(format!(
            "@@ -{},{} +{},{} @@",
            old_start, old_count, new_start, new_count
        ));
        for operation in &operations[range_start..range_end] {
            match operation {
                RewriteDiffOp::Equal(line) => diff_lines.push(format!(" {}", line)),
                RewriteDiffOp::Add(line) => diff_lines.push(format!("+{}", line)),
                RewriteDiffOp::Remove(line) => diff_lines.push(format!("-{}", line)),
            }
        }
    }

    diff_lines.join("\n")
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
            None => run_recursive_search(
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

/// 描述：在未安装 ripgrep 时回退到纯 Rust 递归搜索，避免依赖 `grep` 等平台外部命令。
fn run_recursive_search(
    sandbox_root: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
) -> Result<Vec<Value>, ProtocolError> {
    let mut matches: Vec<Value> = Vec::new();
    collect_recursive_search_matches(
        sandbox_root,
        sandbox_root,
        query,
        glob,
        max_results,
        0,
        &mut matches,
    )?;
    Ok(matches)
}

/// 描述：递归执行文本搜索并收集结果，统一各平台在无 ripgrep 环境下的检索行为。
fn collect_recursive_search_matches(
    sandbox_root: &Path,
    current: &Path,
    query: &str,
    glob: &str,
    max_results: usize,
    depth: usize,
    matches: &mut Vec<Value>,
) -> Result<(), ProtocolError> {
    if matches.len() >= max_results || depth > MAX_GLOB_WALK_DEPTH {
        return Ok(());
    }

    let read_dir = fs::read_dir(current).map_err(|err| {
        ProtocolError::new(
            "core.agent.python.search_files.read_dir_failed",
            format!("读取目录失败: {}", err),
        )
    })?;

    for item in read_dir {
        if matches.len() >= max_results {
            return Ok(());
        }

        let entry = item.map_err(|err| {
            ProtocolError::new(
                "core.agent.python.search_files.read_entry_failed",
                format!("读取目录项失败: {}", err),
            )
        })?;
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path).map_err(|err| {
            ProtocolError::new(
                "core.agent.python.search_files.stat_failed",
                format!("读取文件状态失败: {}", err),
            )
        })?;
        let file_name = entry.file_name();
        if file_name.to_string_lossy() == ".git" {
            continue;
        }
        let is_symlink = metadata.file_type().is_symlink();
        if metadata.is_dir() && !is_symlink {
            collect_recursive_search_matches(
                sandbox_root,
                entry_path.as_path(),
                query,
                glob,
                max_results,
                depth + 1,
                matches,
            )?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }

        let relative = entry_path
            .strip_prefix(sandbox_root)
            .unwrap_or(entry_path.as_path());
        let relative_text = relative.to_string_lossy().replace('\\', "/");
        if !glob.trim().is_empty() && !glob_match(glob, relative_text.as_str()) {
            continue;
        }

        let content = match fs::read_to_string(&entry_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for (line_index, line) in content.lines().enumerate() {
            if !line.contains(query) {
                continue;
            }
            matches.push(json!({
                "path": relative_text,
                "line": line_index + 1,
                "content": line.trim(),
            }));
            if matches.len() >= max_results {
                return Ok(());
            }
        }
    }

    Ok(())
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

    /// 描述：验证覆盖写入即使前后总行数一致，也会按真实变更统计新增和删除行数。
    #[test]
    fn should_count_real_changed_lines_for_full_rewrite() {
        let summary = build_rewrite_diff_summary_fallback(
            "requirements.md",
            "# 旧标题\n## 旧章节\n- 旧需求 A\n- 旧需求 B\n",
            "# 新标题\n## 新章节\n- 新需求 A\n- 新需求 B\n",
        );

        assert_eq!(
            summary,
            RewriteDiffSummary {
                added_lines: 4,
                removed_lines: 4,
                diff_preview: [
                    "--- requirements.md",
                    "+++ requirements.md",
                    "@@ -1,4 +1,4 @@",
                    "-# 旧标题",
                    "-## 旧章节",
                    "-- 旧需求 A",
                    "-- 旧需求 B",
                    "+# 新标题",
                    "+## 新章节",
                    "+- 新需求 A",
                    "+- 新需求 B",
                ]
                .join("\n"),
            }
        );
    }

    /// 描述：验证整文件替换时 unified diff hunk 会同时从旧文本和新文本的真实起始行号开始。
    #[test]
    fn should_build_unified_diff_with_real_hunk_line_numbers() {
        let summary = build_rewrite_diff_summary_fallback(
            "requirements.md",
            "# 需求分析 - 用户管理系统\n## 1. 业务目标与角色\n- 目标\n- 角色\n",
            "# 需求分析 - 用户管理系统 (Vben Admin)\n## 1. 需求拆解清单\n- 用户列表查询\n- 用户新增/编辑\n",
        );

        assert_eq!(summary.added_lines, 4);
        assert_eq!(summary.removed_lines, 4);
        assert!(summary.diff_preview.contains("@@ -1,4 +1,4 @@"));
        assert!(summary.diff_preview.contains("-# 需求分析 - 用户管理系统"));
        assert!(summary
            .diff_preview
            .contains("+# 需求分析 - 用户管理系统 (Vben Admin)"));
    }

    /// 描述：验证新增文件场景会生成从新文本第一行开始的 hunk 行号，而不是错误地沿用旧文件尾部行号。
    #[test]
    fn should_build_addition_hunk_from_new_file_start() {
        let summary =
            build_rewrite_diff_summary_fallback("requirements.md", "", "# 初始化\n- 新增内容\n");

        assert_eq!(summary.added_lines, 2);
        assert_eq!(summary.removed_lines, 0);
        assert!(summary.diff_preview.contains("@@ -0,0 +1,2 @@"));
        assert!(summary.diff_preview.contains("+# 初始化"));
        assert!(summary.diff_preview.contains("+- 新增内容"));
    }

    /// 描述：验证在未安装 ripgrep 时，纯 Rust 递归搜索仍能返回结构化匹配结果。
    #[test]
    fn should_search_files_with_recursive_fallback() {
        let root = std::env::temp_dir().join(format!(
            "libra-agent-recursive-search-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should be monotonic")
                .as_millis()
        ));
        fs::create_dir_all(root.join("src")).expect("create search sandbox");
        fs::write(
            root.join("src").join("user.ts"),
            "export const name = 'user';\nexport const role = 'admin';\n",
        )
        .expect("write search fixture");
        fs::write(root.join("README.md"), "hello world\n").expect("write readme fixture");

        let matches = run_recursive_search(root.as_path(), "role", "src/*.ts", 10)
            .expect("recursive search should succeed");
        assert_eq!(matches.len(), 1);
        assert_eq!(
            matches[0].get("path").and_then(|value| value.as_str()),
            Some("src/user.ts")
        );
        assert_eq!(
            matches[0].get("line").and_then(|value| value.as_u64()),
            Some(2)
        );
    }
}
