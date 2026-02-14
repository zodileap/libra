use std::thread;
use std::time::Duration;

/// 描述：工作流步骤在执行过程中的状态机。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentWorkflowState {
    Ready,
    Running,
    Retrying,
    Succeeded,
    Recovered,
    Failed,
}

/// 描述：步骤执行重试策略，控制最大重试次数与重试等待时间。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkflowRetryPolicy {
    pub max_retries: u8,
    pub backoff_millis: u64,
}

impl Default for WorkflowRetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 1,
            backoff_millis: 300,
        }
    }
}

/// 描述：可分类重试错误的抽象接口，供工作流统一判断是否可重试。
pub trait RetryClassifiedError: std::fmt::Display {
    fn is_retryable(&self) -> bool;
}

/// 描述：步骤失败上下文，提供给恢复挂钩用于决策。
#[derive(Debug, Clone)]
pub struct WorkflowFailureContext {
    pub step_code: String,
    pub attempt: u8,
    pub retryable: bool,
    pub message: String,
}

/// 描述：恢复挂钩返回动作，决定失败后是继续重试还是立即失败。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRecoveryAction {
    Retry,
    FailFast,
}

/// 描述：失败恢复挂钩接口，允许按步骤错误动态调整恢复策略。
pub trait WorkflowRecoveryHook {
    fn on_failure(&self, context: &WorkflowFailureContext) -> WorkflowRecoveryAction;
}

/// 描述：默认失败恢复挂钩，仅在错误可重试时返回重试。
#[derive(Debug, Clone, Copy, Default)]
pub struct DefaultWorkflowRecoveryHook;

impl WorkflowRecoveryHook for DefaultWorkflowRecoveryHook {
    fn on_failure(&self, context: &WorkflowFailureContext) -> WorkflowRecoveryAction {
        if context.retryable {
            WorkflowRecoveryAction::Retry
        } else {
            WorkflowRecoveryAction::FailFast
        }
    }
}

/// 描述：单步骤执行结果，包含最终状态、尝试次数和执行产出。
#[derive(Debug)]
pub struct WorkflowRunResult<T, E> {
    pub state: AgentWorkflowState,
    pub attempts: u8,
    pub outcome: Result<T, E>,
}

/// 描述：按“状态机 + 重试 + 恢复挂钩”执行一个步骤。
///
/// Params:
///
///   - step_code: 步骤编码。
///   - policy: 重试策略。
///   - recovery_hook: 恢复挂钩。
///   - executor: 实际执行函数，入参是第几次尝试（从 1 开始）。
pub fn run_step_with_retry<T, E, F, H>(
    step_code: &str,
    policy: WorkflowRetryPolicy,
    recovery_hook: &H,
    mut executor: F,
) -> WorkflowRunResult<T, E>
where
    E: RetryClassifiedError,
    F: FnMut(u8) -> Result<T, E>,
    H: WorkflowRecoveryHook,
{
    let mut attempts: u8 = 0;

    loop {
        attempts = attempts.saturating_add(1);
        let running_state = if attempts == 1 {
            AgentWorkflowState::Running
        } else {
            AgentWorkflowState::Retrying
        };

        let result = executor(attempts);
        match result {
            Ok(value) => {
                let state = if attempts == 1 {
                    AgentWorkflowState::Succeeded
                } else {
                    AgentWorkflowState::Recovered
                };
                return WorkflowRunResult {
                    state,
                    attempts,
                    outcome: Ok(value),
                };
            }
            Err(err) => {
                let failure_context = WorkflowFailureContext {
                    step_code: step_code.to_string(),
                    attempt: attempts,
                    retryable: err.is_retryable(),
                    message: err.to_string(),
                };

                let has_retry_budget = attempts <= policy.max_retries;
                let recover_action = if has_retry_budget {
                    recovery_hook.on_failure(&failure_context)
                } else {
                    WorkflowRecoveryAction::FailFast
                };

                if running_state == AgentWorkflowState::Retrying
                    && policy.backoff_millis > 0
                    && matches!(recover_action, WorkflowRecoveryAction::Retry)
                {
                    thread::sleep(Duration::from_millis(policy.backoff_millis));
                }

                if has_retry_budget && matches!(recover_action, WorkflowRecoveryAction::Retry) {
                    continue;
                }

                return WorkflowRunResult {
                    state: AgentWorkflowState::Failed,
                    attempts,
                    outcome: Err(err),
                };
            }
        }
    }
}

#[cfg(test)]
#[path = "workflow_tests.rs"]
mod tests;
