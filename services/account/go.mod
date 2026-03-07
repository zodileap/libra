module git.zodileap.com/gemini/libra_account

go 1.24.2

toolchain go1.24.5

require (
	git.zodileap.com/entity/account_v1 v0.0.0-00010101000000-000000000000
	git.zodileap.com/taurus/zodileap_go_zapi v1.3.2
	git.zodileap.com/taurus/zodileap_go_zbootstrap v1.2.1
	git.zodileap.com/taurus/zodileap_go_zerr v1.5.12
	git.zodileap.com/taurus/zodileap_go_zlog v1.2.0
	git.zodileap.com/taurus/zodileap_go_zspecs v1.7.26
	git.zodileap.com/taurus/zodileap_go_zstatuscode v1.2.2
	github.com/gin-contrib/cors v1.7.6
	github.com/gin-gonic/gin v1.11.0
)

require (
	code.gitea.io/sdk/gitea v0.21.0 // indirect
	git.zodileap.com/entity/permission_v1 v1.2.0 // indirect
	git.zodileap.com/entity/redis_user_v1 v1.1.1 // indirect
	git.zodileap.com/taurus/zodileap_go_grpc v1.0.1 // indirect
	git.zodileap.com/taurus/zodileap_go_zgit v1.3.1 // indirect
	git.zodileap.com/taurus/zodileap_go_zrpc v1.2.9 // indirect
	git.zodileap.com/taurus/zodileap_go_zsecure v1.0.1 // indirect
	git.zodileap.com/taurus/zodileap_go_zwebhook v1.0.1 // indirect
	git.zodileap.com/taurus/zodileap_go_zwebsocket v1.0.3 // indirect
	github.com/42wim/httpsig v1.2.3 // indirect
	github.com/bytedance/sonic v1.14.0 // indirect
	github.com/bytedance/sonic/loader v0.3.0 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cloudwego/base64x v0.1.6 // indirect
	github.com/davidmz/go-pageant v1.0.2 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/gabriel-vasile/mimetype v1.4.9 // indirect
	github.com/gin-contrib/sse v1.1.0 // indirect
	github.com/go-fed/httpsig v1.1.0 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.27.0 // indirect
	github.com/goccy/go-json v0.10.5 // indirect
	github.com/goccy/go-yaml v1.18.0 // indirect
	github.com/golang-jwt/jwt/v5 v5.2.2 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/hashicorp/go-version v1.7.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/cpuid/v2 v2.3.0 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/lib/pq v1.10.9 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/pelletier/go-toml/v2 v2.2.4 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/quic-go/qpack v0.5.1 // indirect
	github.com/quic-go/quic-go v0.54.0 // indirect
	github.com/redis/go-redis/v9 v9.11.0 // indirect
	github.com/twitchyliquid64/golang-asm v0.15.1 // indirect
	github.com/ugorji/go/codec v1.3.0 // indirect
	github.com/zodileap/taurus_go v0.9.22 // indirect
	go.uber.org/mock v0.5.0 // indirect
	golang.org/x/arch v0.20.0 // indirect
	golang.org/x/crypto v0.40.0 // indirect
	golang.org/x/mod v0.25.0 // indirect
	golang.org/x/net v0.42.0 // indirect
	golang.org/x/sync v0.16.0 // indirect
	golang.org/x/sys v0.35.0 // indirect
	golang.org/x/text v0.27.0 // indirect
	golang.org/x/tools v0.34.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20250707201910-8d1bb00bc6a7 // indirect
	google.golang.org/grpc v1.73.0 // indirect
	google.golang.org/protobuf v1.36.9 // indirect
)

replace git.zodileap.com/taurus/zodileap_go_zapi v1.3.2 => /Users/yoho/code/go/zodileap_go/zapi

replace git.zodileap.com/taurus/zodileap_go_zbootstrap v1.2.1 => /Users/yoho/code/go/zodileap_go/zbootstrap

replace git.zodileap.com/taurus/zodileap_go_zlog v1.2.0 => /Users/yoho/code/go/zodileap_go/zlog

replace git.zodileap.com/taurus/zodileap_go_zspecs v1.7.26 => /Users/yoho/code/go/zodileap_go/zspecs

replace git.zodileap.com/taurus/zodileap_go_zstatuscode v1.2.2 => /Users/yoho/code/go/zodileap_go/zstatuscode

replace git.zodileap.com/taurus/zodileap_go_zerr v1.5.12 => /Users/yoho/code/go/zodileap_go/zerr

replace git.zodileap.com/entity/account_v1 => ../entity/v1/account
