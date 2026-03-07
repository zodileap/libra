package main

import (
	configs "git.zodileap.com/gemini/libra_billing/configs"

	// 注册 API 与 RPC
	_ "git.zodileap.com/gemini/libra_billing/api/v1"
	_ "git.zodileap.com/gemini/libra_billing/rpc/v1"

	zbootstrap "git.zodileap.com/taurus/zodileap_go_zbootstrap"
)

func main() {
	zbootstrap.InitService(configs.Config, nil)
}
