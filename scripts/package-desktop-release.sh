#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

COPY_TO_ROOT=""
TARGET_VERSION=""
SYNC_ONLY=0
declare -a TAURI_BUILD_ARGS=()

# 描述：
#
#   - 输出脚本帮助信息，说明版本同步、打包与产物复制的参数语义。
usage() {
  cat <<'EOF'
Usage:
  ./scripts/package-desktop-release.sh [--version <x.y.z>] [--sync-only] [--copy-to <downloads-root>] [-- <extra tauri build args>]

Description:
  Sync Libra Desktop version files and optionally build release bundles with `tauri build`.

  When `--version` is provided, the script will update these files before validation:
    - package.json
    - apps/desktop/package.json
    - apps/desktop/src-tauri/tauri.conf.json
    - apps/desktop/src-tauri/Cargo.toml

  If `--copy-to` is provided, bundled artifacts will be copied to:
    <downloads-root>/<version>/

  The script does not generate or upload latest.json.

Examples:
  ./scripts/package-desktop-release.sh
  ./scripts/package-desktop-release.sh --version 0.1.1
  ./scripts/package-desktop-release.sh --version 0.1.1 --sync-only
  ./scripts/package-desktop-release.sh --version 0.1.1 --copy-to /tmp/libra-updates/downloads
  ./scripts/package-desktop-release.sh -- --bundles app
EOF
}

# 描述：
#
#   - 校验命令是否存在，避免脚本执行到中途才因为缺少依赖失败。
#
# Params:
#
#   - command_name: 需要检查的命令名。
require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
}

# 描述：
#
#   - 校验版本号格式是否符合三段式规范，避免把非法版本写入发布文件。
#
# Params:
#
#   - version: 目标版本号。
assert_release_version() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "invalid version: $version (expected Major.Minor.Patch)" >&2
    exit 1
  fi
}

# 描述：
#
#   - 从 package.json 中读取 version 字段。
#
# Params:
#
#   - file_path: package.json 文件路径。
#
# Returns:
#
#   - version 字段内容。
read_package_version() {
  local file_path="$1"
  node -e 'const pkg = require(process.argv[1]); process.stdout.write(String(pkg.version || ""));' "$file_path"
}

# 描述：
#
#   - 将 package.json 的 version 字段更新为指定版本并保留 JSON 缩进。
#
# Params:
#
#   - file_path: package.json 文件路径。
#   - version: 目标版本号。
write_package_version() {
  local file_path="$1"
  local version="$2"
  node -e '
    const fs = require("fs");
    const filePath = process.argv[1];
    const version = process.argv[2];
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
    pkg.version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
  ' "$file_path" "$version"
}

# 描述：
#
#   - 从 tauri.conf.json 中读取 version 字段。
#
# Params:
#
#   - file_path: tauri.conf.json 文件路径。
#
# Returns:
#
#   - version 字段内容。
read_tauri_version() {
  local file_path="$1"
  node -e 'const fs = require("fs"); const conf = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(conf.version || ""));' "$file_path"
}

# 描述：
#
#   - 将 tauri.conf.json 的 version 字段更新为指定版本。
#
# Params:
#
#   - file_path: tauri.conf.json 文件路径。
#   - version: 目标版本号。
write_tauri_version() {
  local file_path="$1"
  local version="$2"
  node -e '
    const fs = require("fs");
    const filePath = process.argv[1];
    const version = process.argv[2];
    const conf = JSON.parse(fs.readFileSync(filePath, "utf8"));
    conf.version = version;
    fs.writeFileSync(filePath, `${JSON.stringify(conf, null, 2)}\n`);
  ' "$file_path" "$version"
}

# 描述：
#
#   - 从 Cargo.toml 的 [package] 段读取 version 字段，避免误读依赖版本。
#
# Params:
#
#   - file_path: Cargo.toml 文件路径。
#
# Returns:
#
#   - [package] 段 version 内容。
read_cargo_version() {
  local file_path="$1"
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const lines = text.split(/\r?\n/);
    let inPackage = false;
    for (const line of lines) {
      if (/^\[package\]\s*$/.test(line)) {
        inPackage = true;
        continue;
      }
      if (inPackage && /^\[[^\]]+\]\s*$/.test(line)) {
        break;
      }
      if (inPackage) {
        const match = line.match(/^\s*version\s*=\s*"([^"]+)"/);
        if (match) {
          process.stdout.write(match[1]);
          process.exit(0);
        }
      }
    }
    process.exit(1);
  ' "$file_path"
}

# 描述：
#
#   - 更新 Cargo.toml 的 [package] 段 version 字段，并保留其余配置内容不变。
#
# Params:
#
#   - file_path: Cargo.toml 文件路径。
#   - version: 目标版本号。
write_cargo_version() {
  local file_path="$1"
  local version="$2"
  node -e '
    const fs = require("fs");
    const filePath = process.argv[1];
    const version = process.argv[2];
    const text = fs.readFileSync(filePath, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    let inPackage = false;
    let updated = false;
    const nextLines = lines.map((line) => {
      if (/^\[package\]\s*$/.test(line)) {
        inPackage = true;
        return line;
      }
      if (inPackage && /^\[[^\]]+\]\s*$/.test(line)) {
        inPackage = false;
        return line;
      }
      if (inPackage && /^\s*version\s*=\s*"[^"]+"/.test(line) && !updated) {
        updated = true;
        return line.replace(/^\s*version\s*=\s*"[^"]+"/, `version = "${version}"`);
      }
      return line;
    });
    if (!updated) {
      process.exit(1);
    }
    fs.writeFileSync(filePath, `${nextLines.join(eol)}${eol}`);
  ' "$file_path" "$version"
}

# 描述：
#
#   - 将桌面端相关版本文件统一写入指定版本号，避免手工逐个同步。
#
# Params:
#
#   - version: 目标版本号。
sync_desktop_versions() {
  local version="$1"
  write_package_version "$ROOT_DIR/package.json" "$version"
  write_package_version "$DESKTOP_DIR/package.json" "$version"
  write_tauri_version "$TAURI_DIR/tauri.conf.json" "$version"
  write_cargo_version "$TAURI_DIR/Cargo.toml" "$version"
}

# 描述：
#
#   - 读取并校验 Desktop 发布所需的几个版本文件是否一致；一致时返回统一版本号。
#
# Returns:
#
#   - 对齐后的 Desktop 版本号。
require_aligned_desktop_version() {
  local root_version desktop_version tauri_version cargo_version

  root_version="$(read_package_version "$ROOT_DIR/package.json")"
  desktop_version="$(read_package_version "$DESKTOP_DIR/package.json")"
  tauri_version="$(read_tauri_version "$TAURI_DIR/tauri.conf.json")"
  cargo_version="$(read_cargo_version "$TAURI_DIR/Cargo.toml")"

  if [[ -z "$root_version" || -z "$desktop_version" || -z "$tauri_version" || -z "$cargo_version" ]]; then
    echo "failed to read version from project files" >&2
    exit 1
  fi

  if [[ "$root_version" != "$desktop_version" || "$root_version" != "$tauri_version" || "$root_version" != "$cargo_version" ]]; then
    cat >&2 <<EOF
desktop version mismatch detected:
  root package.json:      $root_version
  apps/desktop/package:   $desktop_version
  tauri.conf.json:        $tauri_version
  src-tauri/Cargo.toml:   $cargo_version

Please align the Desktop version before packaging, or rerun with --version <x.y.z>.
EOF
    exit 1
  fi

  printf '%s' "$root_version"
}

# 描述：
#
#   - 收集 Tauri bundle 目录下的安装包与目录产物，供控制台展示和复制逻辑复用。
#
# Params:
#
#   - bundle_dir: Tauri bundle 输出目录。
#   - output_ref: 以 nameref 形式接收产物路径列表的数组变量名。
collect_bundle_artifacts() {
  local bundle_dir="$1"
  local -n output_ref="$2"

  output_ref=()
  if [[ ! -d "$bundle_dir" ]]; then
    return 0
  fi

  while IFS= read -r -d '' artifact_path; do
    output_ref+=("$artifact_path")
  done < <(find "$bundle_dir" -mindepth 2 -maxdepth 2 \( -type f -o -type d \) -print0)
}

# 描述：
#
#   - 解析命令行参数，统一处理版本同步、仅同步与打包扩展参数。
#
# Params:
#
#   - "$@": 传入脚本的完整参数。
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        if [[ $# -lt 2 ]]; then
          echo "missing value for --version" >&2
          usage >&2
          exit 1
        fi
        TARGET_VERSION="$2"
        shift 2
        ;;
      --sync-only)
        SYNC_ONLY=1
        shift
        ;;
      --copy-to)
        if [[ $# -lt 2 ]]; then
          echo "missing value for --copy-to" >&2
          usage >&2
          exit 1
        fi
        COPY_TO_ROOT="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      --)
        shift
        TAURI_BUILD_ARGS=("$@")
        break
        ;;
      *)
        echo "unknown option: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

# 描述：
#
#   - 校验参数组合是否合法，避免仅同步模式下仍传入构建相关参数造成歧义。
validate_args() {
  if [[ "$SYNC_ONLY" == "1" && -n "$COPY_TO_ROOT" ]]; then
    echo "--copy-to cannot be used with --sync-only" >&2
    exit 1
  fi
  if [[ "$SYNC_ONLY" == "1" && ${#TAURI_BUILD_ARGS[@]} -gt 0 ]]; then
    echo "extra tauri build args cannot be used with --sync-only" >&2
    exit 1
  fi
}

# 描述：
#
#   - 执行脚本主流程：按需同步版本，校验版本一致性，并在非仅同步模式下完成打包与产物复制。
#
# Params:
#
#   - "$@": 传入脚本的完整参数。
main() {
  parse_args "$@"
  validate_args

  require_command node

  if [[ -n "$TARGET_VERSION" ]]; then
    assert_release_version "$TARGET_VERSION"
    sync_desktop_versions "$TARGET_VERSION"
    echo "Synced Desktop version to $TARGET_VERSION"
  fi

  local version
  version="$(require_aligned_desktop_version)"

  if [[ "$SYNC_ONLY" == "1" ]]; then
    echo "Version sync completed. Skipped packaging."
    return 0
  fi

  require_command pnpm

  echo "Packaging Libra Desktop $version"
  echo "Desktop workspace: $DESKTOP_DIR"

  local -a build_cmd
  build_cmd=(pnpm --dir "$DESKTOP_DIR" exec tauri build)
  if [[ ${#TAURI_BUILD_ARGS[@]} -gt 0 ]]; then
    build_cmd+=("${TAURI_BUILD_ARGS[@]}")
  fi

  "${build_cmd[@]}"

  local -a artifact_paths
  collect_bundle_artifacts "$BUNDLE_DIR" artifact_paths

  if [[ ${#artifact_paths[@]} -eq 0 ]]; then
    echo "no bundled artifacts found under $BUNDLE_DIR" >&2
    exit 1
  fi

  echo
  echo "Bundled artifacts:"
  local artifact_path artifact_label
  for artifact_path in "${artifact_paths[@]}"; do
    artifact_label="${artifact_path#$BUNDLE_DIR/}"
    echo "  - $artifact_label"
  done

  if [[ -n "$COPY_TO_ROOT" ]]; then
    local target_dir
    target_dir="$COPY_TO_ROOT/$version"
    mkdir -p "$target_dir"
    for artifact_path in "${artifact_paths[@]}"; do
      cp -R "$artifact_path" "$target_dir/"
    done
    echo
    echo "Copied packaged artifacts to: $target_dir"
  fi

  echo
  echo "Next:"
  echo "  1. Upload packaged files to the server downloads directory for version $version."
  echo "  2. Update the server-side latest.json manually."
  echo "  3. Keep latest.json and uploaded filenames consistent."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
