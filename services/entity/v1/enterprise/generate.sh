#!/usr/bin/env bash
set -euo pipefail

Server="enterprise"

# 描述：
#
#   - 通过脚本所在目录反解 services 根目录，避免仓库目录改名后生成输出路径失效。
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SERVICES_DIR=$(cd -- "${SCRIPT_DIR}/../../.." && pwd)

go run github.com/zodileap/taurus_go/entity/cmd generate \
  -p=${Server} \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/entity/*.tmpl \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/api/*.tmpl:${SERVICES_DIR}/${Server}/api \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/service/*.tmpl:${SERVICES_DIR}/${Server}/service \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/specs/*.tmpl:${SERVICES_DIR}/${Server}/specs \
  ./schema
