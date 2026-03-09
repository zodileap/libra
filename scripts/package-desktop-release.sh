#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"

COPY_TO_ROOT=""
declare -a TAURI_BUILD_ARGS=()

usage() {
  cat <<'EOF'
Usage:
  ./scripts/package-desktop-release.sh [--copy-to <downloads-root>] [-- <extra tauri build args>]

Description:
  Build Libra Desktop with `tauri build`.
  If `--copy-to` is provided, bundled artifacts will be copied to:

    <downloads-root>/<version>/

  The script does not generate or upload latest.json.

Examples:
  ./scripts/package-desktop-release.sh
  ./scripts/package-desktop-release.sh --copy-to /tmp/libra-updates/downloads
  ./scripts/package-desktop-release.sh -- --bundles app
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

read_package_version() {
  local file_path="$1"
  node -e 'const pkg = require(process.argv[1]); process.stdout.write(String(pkg.version || ""));' "$file_path"
}

read_tauri_version() {
  local file_path="$1"
  node -e 'const fs = require("fs"); const conf = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(conf.version || ""));' "$file_path"
}

read_cargo_version() {
  local file_path="$1"
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const match = text.match(/^version\s*=\s*"([^"]+)"/m);
    if (!match) {
      process.exit(1);
    }
    process.stdout.write(match[1]);
  ' "$file_path"
}

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

while [[ $# -gt 0 ]]; do
  case "$1" in
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

require_command node
require_command pnpm

ROOT_VERSION="$(read_package_version "$ROOT_DIR/package.json")"
DESKTOP_VERSION="$(read_package_version "$DESKTOP_DIR/package.json")"
TAURI_VERSION="$(read_tauri_version "$TAURI_DIR/tauri.conf.json")"
CARGO_VERSION="$(read_cargo_version "$TAURI_DIR/Cargo.toml")"

if [[ -z "$ROOT_VERSION" || -z "$DESKTOP_VERSION" || -z "$TAURI_VERSION" || -z "$CARGO_VERSION" ]]; then
  echo "failed to read version from project files" >&2
  exit 1
fi

if [[ "$ROOT_VERSION" != "$DESKTOP_VERSION" || "$ROOT_VERSION" != "$TAURI_VERSION" || "$ROOT_VERSION" != "$CARGO_VERSION" ]]; then
  cat >&2 <<EOF
desktop version mismatch detected:
  root package.json:      $ROOT_VERSION
  apps/desktop/package:   $DESKTOP_VERSION
  tauri.conf.json:        $TAURI_VERSION
  src-tauri/Cargo.toml:   $CARGO_VERSION

Please align the Desktop version before packaging.
EOF
  exit 1
fi

VERSION="$ROOT_VERSION"

echo "Packaging Libra Desktop $VERSION"
echo "Desktop workspace: $DESKTOP_DIR"

declare -a BUILD_CMD
BUILD_CMD=(pnpm --dir "$DESKTOP_DIR" exec tauri build)
if [[ ${#TAURI_BUILD_ARGS[@]} -gt 0 ]]; then
  BUILD_CMD+=("${TAURI_BUILD_ARGS[@]}")
fi

"${BUILD_CMD[@]}"

declare -a ARTIFACT_PATHS
collect_bundle_artifacts "$BUNDLE_DIR" ARTIFACT_PATHS

if [[ ${#ARTIFACT_PATHS[@]} -eq 0 ]]; then
  echo "no bundled artifacts found under $BUNDLE_DIR" >&2
  exit 1
fi

echo
echo "Bundled artifacts:"
for artifact_path in "${ARTIFACT_PATHS[@]}"; do
  artifact_label="${artifact_path#$BUNDLE_DIR/}"
  echo "  - $artifact_label"
done

if [[ -n "$COPY_TO_ROOT" ]]; then
  TARGET_DIR="$COPY_TO_ROOT/$VERSION"
  mkdir -p "$TARGET_DIR"
  for artifact_path in "${ARTIFACT_PATHS[@]}"; do
    cp -R "$artifact_path" "$TARGET_DIR/"
  done
  echo
  echo "Copied packaged artifacts to: $TARGET_DIR"
fi

echo
echo "Next:"
echo "  1. Upload packaged files to the server downloads directory for version $VERSION."
echo "  2. Update the server-side latest.json manually."
echo "  3. Keep latest.json and uploaded filenames consistent."
