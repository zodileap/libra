use super::*;

/// 描述：测试用错误，支持重试能力标记。
#[derive(Debug, Clone)]
struct TestError {
    retryable: bool,
}

impl std::fmt::Display for TestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "test error")
    }
}

impl RetryClassifiedError for TestError {
    fn is_retryable(&self) -> bool {
        self.retryable
    }
}

/// 描述：自定义恢复挂钩，始终快速失败，用于覆盖 hook 分支。
struct AlwaysFailFastHook;

impl WorkflowRecoveryHook for AlwaysFailFastHook {
    fn on_failure(&self, _context: &WorkflowFailureContext) -> WorkflowRecoveryAction {
        WorkflowRecoveryAction::FailFast
    }
}

/// 描述：验证可重试错误在重试后恢复成功。
#[test]
fn should_retry_and_recover() {
    let policy = WorkflowRetryPolicy {
        max_retries: 2,
        backoff_millis: 0,
    };
    let mut calls = 0_u8;
    let result = run_step_with_retry(
        "llm.call",
        policy,
        &DefaultWorkflowRecoveryHook,
        |_attempt| {
            calls = calls.saturating_add(1);
            if calls < 2 {
                return Err(TestError { retryable: true });
            }
            Ok("ok")
        },
    );

    assert_eq!(result.state, AgentWorkflowState::Recovered);
    assert_eq!(result.attempts, 2);
    assert!(matches!(result.outcome, Ok("ok")));
}

/// 描述：验证不可重试错误会在首轮立即失败。
#[test]
fn should_fail_fast_for_non_retryable_error() {
    let policy = WorkflowRetryPolicy {
        max_retries: 3,
        backoff_millis: 0,
    };
    let result = run_step_with_retry::<(), _, _, _>(
        "llm.call",
        policy,
        &DefaultWorkflowRecoveryHook,
        |_attempt| Err(TestError { retryable: false }),
    );

    assert_eq!(result.state, AgentWorkflowState::Failed);
    assert_eq!(result.attempts, 1);
    assert!(result.outcome.is_err());
}

/// 描述：验证重试预算耗尽后会失败并记录最终尝试次数。
#[test]
fn should_fail_when_retry_budget_exhausted() {
    let policy = WorkflowRetryPolicy {
        max_retries: 1,
        backoff_millis: 0,
    };
    let result = run_step_with_retry::<(), _, _, _>(
        "llm.call",
        policy,
        &DefaultWorkflowRecoveryHook,
        |_attempt| Err(TestError { retryable: true }),
    );

    assert_eq!(result.state, AgentWorkflowState::Failed);
    assert_eq!(result.attempts, 2);
    assert!(result.outcome.is_err());
}

/// 描述：验证恢复挂钩可覆盖默认策略并提前失败。
#[test]
fn should_respect_custom_recovery_hook_fail_fast() {
    let policy = WorkflowRetryPolicy {
        max_retries: 3,
        backoff_millis: 0,
    };
    let result =
        run_step_with_retry::<(), _, _, _>("llm.call", policy, &AlwaysFailFastHook, |_attempt| {
            Err(TestError { retryable: true })
        });

    assert_eq!(result.state, AgentWorkflowState::Failed);
    assert_eq!(result.attempts, 1);
    assert!(result.outcome.is_err());
}
