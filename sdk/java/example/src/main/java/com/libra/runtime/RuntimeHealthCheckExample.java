package com.libra.runtime;

// 描述：
//
//   - Java SDK 当前阶段只预留最小接入示例；真实生成的 gRPC stub 需由 `runtime.proto`
//     配合 grpc-java 插件生成后再在这里接入。
public final class RuntimeHealthCheckExample {

    // 描述：
    //
    //   - 示例入口，当前仅输出接入说明，避免在未生成 stub 前提供误导性的伪实现。
    public static void main(String[] args) {
        System.out.println("Generate Java stubs from crates/runtime/proto/proto/runtime/v1/runtime.proto before wiring the runtime client.");
    }
}
