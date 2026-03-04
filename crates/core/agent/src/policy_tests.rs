use crate::policy::AgentPolicy;

/// 描述：验证默认策略中审批超时存在安全默认值，避免高危操作等待无限挂起。
#[test]
fn should_have_default_approval_timeout() {
    let policy = AgentPolicy::default();
    assert!(policy.approval_timeout_secs > 0);
}

/// 描述：验证环境变量可覆盖审批超时配置，便于不同部署环境调整策略。
#[test]
fn should_load_approval_timeout_from_env() {
    std::env::set_var("ZODILEAP_APPROVAL_TIMEOUT_SECS", "45");
    let policy = AgentPolicy::from_env();
    assert_eq!(policy.approval_timeout_secs, 45);
    std::env::remove_var("ZODILEAP_APPROVAL_TIMEOUT_SECS");
}
