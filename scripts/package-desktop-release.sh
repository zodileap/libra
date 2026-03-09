#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"
BUNDLE_DIR="$TAURI_DIR/target/release/bundle"
RELEASES_DIR="$ROOT_DIR/releases"
PUBLIC_KEY_DEST="$TAURI_DIR/updater/public.key"
PRIVATE_KEY_PATH="${TAURI_UPDATER_PRIVATE_KEY_PATH:-$HOME/.tauri/libra-desktop-updater.key}"
PUBLIC_KEY_PATH="${PRIVATE_KEY_PATH}.pub"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/package-desktop-release.sh <x.y.z>

Description:
  1. Sync Libra Desktop version files to the requested release version
  2. Generate or reuse the official Tauri updater signing key
  3. Sync the updater public key into src-tauri/updater/public.key
  4. Run `tauri build` to produce:
     - full install bundles (for example .dmg)
     - updater artifacts (for example .app.tar.gz + .sig)
  5. Stage upload-ready folders under:
     releases/<version>/<platform>/

Notes:
  - This script does not upload files
  - This script does not generate latest.json
  - Upload the staged platform folder to your update server manually after packaging

Examples:
  ./scripts/package-desktop-release.sh 0.1.1
  pnpm run release:desktop -- 0.1.1
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    exit 1
  fi
}

assert_release_version() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "invalid version: $version (expected Major.Minor.Patch)" >&2
    exit 1
  fi
}

read_package_version() {
  local file_path="$1"
  node -e 'const pkg = require(process.argv[1]); process.stdout.write(String(pkg.version || ""));' "$file_path"
}

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

read_tauri_version() {
  local file_path="$1"
  node -e 'const fs = require("fs"); const conf = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(conf.version || ""));' "$file_path"
}

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

sync_desktop_versions() {
  local version="$1"
  write_package_version "$ROOT_DIR/package.json" "$version"
  write_package_version "$DESKTOP_DIR/package.json" "$version"
  write_tauri_version "$TAURI_DIR/tauri.conf.json" "$version"
  write_cargo_version "$TAURI_DIR/Cargo.toml" "$version"
}

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
EOF
    exit 1
  fi

  printf '%s' "$root_version"
}

ensure_tauri_cli() {
  if ! pnpm --dir "$DESKTOP_DIR" exec tauri --help >/dev/null 2>&1; then
    cat >&2 <<EOF
tauri CLI was not found in apps/desktop.

Before packaging on the build host, run:
  cd $ROOT_DIR
  pnpm install
EOF
    exit 1
  fi
}

ensure_updater_signing_key() {
  mkdir -p "$(dirname "$PRIVATE_KEY_PATH")"
  if [[ -f "$PRIVATE_KEY_PATH" && -f "$PUBLIC_KEY_PATH" ]]; then
    return 0
  fi

  echo "Generating Tauri updater signing key at $PRIVATE_KEY_PATH"
  pnpm --dir "$DESKTOP_DIR" exec tauri signer generate --ci -w "$PRIVATE_KEY_PATH"

  if [[ ! -f "$PRIVATE_KEY_PATH" || ! -f "$PUBLIC_KEY_PATH" ]]; then
    echo "failed to generate updater signing key pair" >&2
    exit 1
  fi
}

sync_updater_public_key() {
  if [[ ! -f "$PUBLIC_KEY_PATH" ]]; then
    echo "missing updater public key: $PUBLIC_KEY_PATH" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$PUBLIC_KEY_DEST")"
  cp "$PUBLIC_KEY_PATH" "$PUBLIC_KEY_DEST"
}

is_release_artifact() {
  local artifact_name
  artifact_name="$(basename "$1")"
  case "$artifact_name" in
    *.dmg|*.pkg|*.app.tar.gz|*.sig|*.exe|*.msi|*.AppImage|*.appimage|*.deb|*.rpm|*.zip)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

platform_dir_for_artifact() {
  local artifact_path="$1"
  local normalized_path
  normalized_path="${artifact_path#$BUNDLE_DIR/}"

  case "$normalized_path" in
    dmg/*|macos/*|app/*)
      printf '%s' "macos"
      ;;
    nsis/*|msi/*)
      printf '%s' "windows"
      ;;
    appimage/*|deb/*|rpm/*)
      printf '%s' "linux"
      ;;
    *)
      return 1
      ;;
  esac
}

collect_release_artifacts() {
  local -n output_ref="$1"
  output_ref=()
  if [[ ! -d "$BUNDLE_DIR" ]]; then
    return 0
  fi

  while IFS= read -r -d '' artifact_path; do
    if is_release_artifact "$artifact_path"; then
      output_ref+=("$artifact_path")
    fi
  done < <(find "$BUNDLE_DIR" -mindepth 2 -maxdepth 2 \( -type f -o -type d \) -print0)
}

stage_release_artifacts() {
  local version="$1"
  shift
  local artifacts=("$@")
  local release_root="$RELEASES_DIR/$version"

  rm -rf "$release_root"
  mkdir -p "$release_root"

  for artifact_path in "${artifacts[@]}"; do
    local platform_dir
    local artifact_name
    platform_dir="$(platform_dir_for_artifact "$artifact_path" || true)"
    if [[ -z "$platform_dir" ]]; then
      continue
    fi
    artifact_name="$(basename "$artifact_path")"
    mkdir -p "$release_root/$platform_dir"
    cp -R "$artifact_path" "$release_root/$platform_dir/$artifact_name"
  done
}

main() {
  if [[ $# -ne 1 || "$1" == "--help" || "$1" == "-h" ]]; then
    usage
    [[ $# -eq 1 ]] && exit 0
    [[ $# -eq 0 ]] && exit 1
    exit 1
  fi

  local target_version="$1"
  local aligned_version
  local -a artifacts

  require_command node
  require_command pnpm
  assert_release_version "$target_version"
  ensure_tauri_cli

  sync_desktop_versions "$target_version"
  aligned_version="$(require_aligned_desktop_version)"
  ensure_updater_signing_key
  sync_updater_public_key

  export TAURI_SIGNING_PRIVATE_KEY="$PRIVATE_KEY_PATH"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

  echo "Packaging Libra Desktop $aligned_version"
  echo "Updater private key: $PRIVATE_KEY_PATH"
  echo "Updater public key:  $PUBLIC_KEY_PATH"
  echo "Embedded pubkey:     $PUBLIC_KEY_DEST"

  rm -rf "$BUNDLE_DIR"
  pnpm --dir "$DESKTOP_DIR" exec tauri build

  collect_release_artifacts artifacts
  if [[ ${#artifacts[@]} -eq 0 ]]; then
    echo "no release artifacts found under $BUNDLE_DIR" >&2
    exit 1
  fi

  stage_release_artifacts "$aligned_version" "${artifacts[@]}"

  echo
  echo "Release artifacts:"
  for artifact_path in "${artifacts[@]}"; do
    echo "  - ${artifact_path#$BUNDLE_DIR/}"
  done

  echo
  echo "Staged upload folders:"
  for platform_dir in macos windows linux; do
    if [[ -d "$RELEASES_DIR/$aligned_version/$platform_dir" ]]; then
      echo "  - $RELEASES_DIR/$aligned_version/$platform_dir"
    fi
  done

  echo
  echo "Next:"
  echo "  1. Copy the needed platform folder to your server downloads/$aligned_version/ directory."
  echo "  2. For first-time macOS downloads, use files under macos/ ending in .dmg."
  echo "  3. For updater, use files under macos/ ending in .app.tar.gz and .sig."
  echo "  4. Update latest.json on the server manually."
}

main "$@"
