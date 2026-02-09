#!/usr/bin/env bash
set -euo pipefail

for server in account billing license enterprise agent_code agent_3d runtime; do
  (
    cd "$(dirname "$0")/${server}"
    ./generate.sh
  )
done
