use crate::dcc_runtime::{
    check_dcc_runtime_status_inner, normalize_dcc_software_name, prepare_dcc_runtime_inner,
};
use crate::dcc_runtime_support::{probe_runtime_bridge_protocol, probe_runtime_tcp_bridge};

/// 描述：验证 DCC Runtime 路由层会将软件标识统一规整为小写，避免前端输入大小写差异导致无法命中。
#[test]
fn should_normalize_dcc_software_name() {
    assert_eq!(normalize_dcc_software_name(" Blender "), "blender");
    assert_eq!(normalize_dcc_software_name("MAYA"), "maya");
    assert_eq!(normalize_dcc_software_name(" C4D "), "c4d");
}

/// 描述：验证 Maya Runtime 在当前阶段会返回明确的手动准备提示，而不是假装已经自动接通。
#[test]
fn should_return_manual_prepare_status_for_maya_runtime() {
    let status = prepare_dcc_runtime_inner("maya".to_string(), None).expect("maya status");
    assert_eq!(status.software, "maya");
    assert!(!status.available);
    assert!(status.message.contains("Maya"));
    assert_eq!(status.required_env_keys, vec!["MAYA_BIN".to_string()]);
    assert!(!status.supports_auto_prepare);
}

/// 描述：验证 C4D Runtime 在当前阶段会返回明确的手动校验提示，保证前端状态与真实能力一致。
#[test]
fn should_return_manual_check_status_for_c4d_runtime() {
    let status = check_dcc_runtime_status_inner("c4d".to_string(), None).expect("c4d status");
    assert_eq!(status.software, "c4d");
    assert!(!status.available);
    assert!(status.message.contains("C4D") || status.message.contains("Cinema 4D"));
    assert_eq!(status.required_env_keys, vec!["C4D_BIN".to_string()]);
    assert!(!status.supports_auto_prepare);
}

/// 描述：验证未注册的软件会落到通用兜底分支，避免后续新增模板前出现 panic。
#[test]
fn should_return_generic_status_for_unknown_dcc_runtime() {
    let status = prepare_dcc_runtime_inner("houdini".to_string(), None).expect("houdini status");
    assert_eq!(status.software, "houdini");
    assert!(!status.available);
    assert!(status.message.contains("houdini Runtime"));
    assert!(status.required_env_keys.is_empty());
    assert!(!status.supports_auto_prepare);
}

/// 描述：验证 Blender Runtime 会暴露“支持自动准备”的结构化元数据，便于前端模板卡片展示一键准备能力。
#[test]
fn should_expose_blender_auto_prepare_capability() {
    let status =
        check_dcc_runtime_status_inner("blender".to_string(), None).expect("blender status");
    assert_eq!(status.software, "blender");
    assert!(status.supports_auto_prepare);
    assert!(status.required_env_keys.is_empty());
}

/// 描述：验证通用 DCC Bridge TCP 探测在未提供地址时会稳定返回空结果，避免运行时对空地址抛出误报。
#[test]
fn should_return_none_when_runtime_bridge_addr_missing() {
    let result = probe_runtime_tcp_bridge(None, 1).expect("probe bridge");
    assert!(result.is_none());
}

/// 描述：验证通用 DCC Bridge TCP 探测在地址格式非法时会返回错误，避免前端把非法地址当成可用 Runtime。
#[test]
fn should_reject_invalid_runtime_bridge_addr() {
    let result = probe_runtime_tcp_bridge(Some("not-a-socket".to_string()), 1);
    assert!(result.is_err());
}

/// 描述：验证 DCC Bridge 协议探测在未提供地址时稳定返回空结果，避免会话或 MCP 页误报握手失败。
#[test]
fn should_return_none_when_protocol_bridge_addr_missing() {
    let result = probe_runtime_bridge_protocol(None, 1).expect("probe protocol");
    assert!(result.is_none());
}

/// 描述：验证 DCC Bridge 协议探测在地址格式非法时返回错误，避免把非法地址当成可用 Bridge。
#[test]
fn should_reject_invalid_protocol_bridge_addr() {
    let result = probe_runtime_bridge_protocol(Some("not-a-socket".to_string()), 1);
    assert!(result.is_err());
}
