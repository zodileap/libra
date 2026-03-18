module github.com/zodileap/libra/services

go 1.24.2

toolchain go1.24.5

require (
	github.com/gorilla/websocket v1.5.3
	github.com/zodileap/libra/sdk/go v0.0.0
	github.com/lib/pq v1.10.9
	golang.org/x/crypto v0.40.0
	google.golang.org/protobuf v1.36.6
)

replace github.com/zodileap/libra/sdk/go => ../sdk/go
