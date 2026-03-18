/// 描述：导出 runtime v1 gRPC 协议定义，供服务端、客户端、SDK 与 CLI 共享。
pub mod runtime {
    tonic::include_proto!("libra.runtime.v1");
}
