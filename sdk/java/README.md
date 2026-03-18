# Libra Runtime Java Placeholder

当前阶段 `sdk/java` 只预留统一 runtime 的 proto / gRPC 接入方式，不提供完整业务包装。

## 当前交付

- 统一协议来源：[`crates/runtime/proto/proto/runtime/v1/runtime.proto`](/Users/yoho/code/libra/crates/runtime/proto/proto/runtime/v1/runtime.proto)
- Java package 约定：`com.libra.runtime.v1`
- 示例工程：[`sdk/java/example`](/Users/yoho/code/libra/sdk/java/example)
- 生成脚本占位：[`sdk/java/generate-stubs.sh`](/Users/yoho/code/libra/sdk/java/generate-stubs.sh)

## 接入约定

- Java 宿主通过本地 sidecar 方式连接 runtime，不做 JNI/FFI。
- 对外长期稳定边界是 gRPC，服务定义以 `runtime.proto` 为准。
- Java SDK 完整包装暂不在本轮交付范围内；当前仅提供示例与生成入口。
