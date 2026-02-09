#!/usr/bin/env bash
set -euo pipefail

# 按项目业务域初始化实体 server（示例命令，可按需拆分执行）

go run github.com/zodileap/taurus_go/entity/cmd new Account Billing License Enterprise AgentCode Agent3D Runtime -t "."
