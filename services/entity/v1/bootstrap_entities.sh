#!/usr/bin/env bash
set -euo pipefail

# 逐个 server 初始化（网络可用时执行）
# go run github.com/zodileap/taurus_go/entity/cmd new Account -e User,Agent,AgentAccess -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new Billing -e Subscription,OrderInfo,OrderItem -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new License -e ActivationCode,ActivationRecord -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new Enterprise -e Enterprise,EnterpriseMember,EnterpriseRole -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new AgentCode -e FrameworkAsset,ComponentAsset,ModuleAsset -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new Agent3D -e ModelTask,ModelResult,DccBinding -t "."
# go run github.com/zodileap/taurus_go/entity/cmd new Runtime -e AgentSession,SandboxInstance,PreviewEndpoint -t "."

echo "bootstrap_entities.sh prepared."
