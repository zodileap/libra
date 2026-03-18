#!/usr/bin/env bash
set -euo pipefail

# 描述：
#
#   - 预留 Java gRPC stub 生成入口；当前仓库未内置 grpc-java 生成插件，
#     使用方可在安装 `protoc-gen-grpc-java` 后执行本脚本。

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROTO_ROOT="$ROOT_DIR/crates/runtime/proto/proto"
OUT_DIR="$ROOT_DIR/sdk/java/example/src/main/java"

echo "请先安装 protoc-gen-grpc-java，然后执行："
echo "protoc -I \"$PROTO_ROOT\" --java_out=\"$OUT_DIR\" --grpc-java_out=\"$OUT_DIR\" \"$PROTO_ROOT/runtime/v1/runtime.proto\""
