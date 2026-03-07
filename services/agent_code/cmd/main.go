package main

import (
	configs "git.zodileap.com/gemini/libra_agent_code/configs"

	// 注册 API 与 RPC
	_ "git.zodileap.com/gemini/libra_agent_code/api/v1"
	_ "git.zodileap.com/gemini/libra_agent_code/rpc/v1"

	zbootstrap "git.zodileap.com/taurus/zodileap_go_zbootstrap"
)

func main() {
	zbootstrap.InitService(configs.Config, nil)
}
