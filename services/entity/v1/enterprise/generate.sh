#!/usr/bin/env bash
set -euo pipefail

Server="enterprise"

go run github.com/zodileap/taurus_go/entity/cmd generate \
  -p=${Server} \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/entity/*.tmpl \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/api/*.tmpl:/Users/yoho/code/zodileap-agen/services/${Server}/api \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/service/*.tmpl:/Users/yoho/code/zodileap-agen/services/${Server}/service \
  --template glob=/Users/yoho/code/go/dao/entity/v1/entity_instance_template/specs/*.tmpl:/Users/yoho/code/zodileap-agen/services/${Server}/specs \
  ./schema
