fn main() {
    // 描述：声明构建脚本对 Tauri 配置与图标资源的依赖，确保资源改动时触发重新构建。
    //
    // Params:
    //
    //   - 无。
    //
    // Returns:
    //
    //   0: 正常输出 cargo 指令并完成构建脚本。
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=icons");

    // 描述：执行 Tauri 默认构建流程，生成运行时所需上下文与打包元数据。
    tauri_build::build()
}
