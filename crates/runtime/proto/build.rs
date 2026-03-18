use std::path::PathBuf;

/// 描述：编译 runtime gRPC 协议，并使用 vendored protoc 规避宿主缺少 protoc 的构建问题。
fn main() {
    let protoc_path = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");
    std::env::set_var("PROTOC", protoc_path);

    let proto_root = PathBuf::from("proto");
    let proto_file = proto_root.join("runtime/v1/runtime.proto");
    println!("cargo:rerun-if-changed={}", proto_file.display());

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&[proto_file], &[proto_root])
        .expect("compile runtime proto");
}
