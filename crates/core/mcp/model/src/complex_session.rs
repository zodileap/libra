use crate::ModelToolAction;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use zodileap_mcp_common::{
    McpError, McpResult, ProtocolError, ProtocolUiHint, ProtocolUiHintAction,
    ProtocolUiHintActionIntent, ProtocolUiHintLevel,
};

/// 描述：复杂模型步骤的风险等级，用于安全确认和交互提示。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelPlanRiskLevel {
    Low,
    Medium,
    High,
}

impl ModelPlanRiskLevel {
    /// 描述：将风险等级转换为稳定字符串，便于写入协议上下文。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

/// 描述：复杂步骤所属的能力抽象类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelPlanOperationKind {
    Basic,
    BooleanChain,
    ModifierChain,
    BatchTransform,
    BatchMaterial,
    SceneFileOps,
}

impl ModelPlanOperationKind {
    /// 描述：将能力抽象类型转换为稳定字符串，便于跨端展示。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::BooleanChain => "boolean_chain",
            Self::ModifierChain => "modifier_chain",
            Self::BatchTransform => "batch_transform",
            Self::BatchMaterial => "batch_material",
            Self::SceneFileOps => "scene_file_ops",
        }
    }
}

/// 描述：复杂步骤在执行图中的分支归属。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelPlanBranch {
    Primary,
    Fallback,
}

impl ModelPlanBranch {
    /// 描述：将分支类型转换为稳定字符串。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Fallback => "fallback",
        }
    }
}

/// 描述：模型会话计划步骤，支持导出步骤和工具动作步骤。
#[derive(Debug, Clone)]
pub enum ModelSessionPlannedStep {
    Export {
        input: String,
        operation_kind: ModelPlanOperationKind,
        branch: ModelPlanBranch,
        recoverable: bool,
        risk: ModelPlanRiskLevel,
        condition: Option<String>,
    },
    Tool {
        action: ModelToolAction,
        input: String,
        params: Value,
        operation_kind: ModelPlanOperationKind,
        branch: ModelPlanBranch,
        recoverable: bool,
        risk: ModelPlanRiskLevel,
        condition: Option<String>,
    },
}

impl ModelSessionPlannedStep {
    /// 描述：获取步骤代码，供执行层和追踪面板展示。
    pub fn code(&self) -> String {
        match self {
            Self::Export { .. } => "export_glb".to_string(),
            Self::Tool { action, .. } => action.as_str().to_string(),
        }
    }

    /// 描述：获取步骤输入描述。
    pub fn input(&self) -> &str {
        match self {
            Self::Export { input, .. } => input.as_str(),
            Self::Tool { input, .. } => input.as_str(),
        }
    }

    /// 描述：获取步骤参数，仅工具动作步骤可用。
    pub fn params(&self) -> Option<&Value> {
        match self {
            Self::Export { .. } => None,
            Self::Tool { params, .. } => Some(params),
        }
    }

    /// 描述：获取步骤风险等级。
    pub fn risk_level(&self) -> ModelPlanRiskLevel {
        match self {
            Self::Export { risk, .. } => *risk,
            Self::Tool { risk, .. } => *risk,
        }
    }

    /// 描述：获取步骤能力抽象类型。
    pub fn operation_kind(&self) -> ModelPlanOperationKind {
        match self {
            Self::Export { operation_kind, .. } => *operation_kind,
            Self::Tool { operation_kind, .. } => *operation_kind,
        }
    }

    /// 描述：获取步骤分支信息。
    pub fn branch(&self) -> ModelPlanBranch {
        match self {
            Self::Export { branch, .. } => *branch,
            Self::Tool { branch, .. } => *branch,
        }
    }

    /// 描述：标记当前步骤是否支持失败恢复。
    pub fn recoverable(&self) -> bool {
        match self {
            Self::Export { recoverable, .. } => *recoverable,
            Self::Tool { recoverable, .. } => *recoverable,
        }
    }

    /// 描述：获取步骤触发条件，主要用于条件分支和回滚步骤展示。
    pub fn condition(&self) -> Option<&str> {
        match self {
            Self::Export { condition, .. } => condition.as_deref(),
            Self::Tool { condition, .. } => condition.as_deref(),
        }
    }

    /// 描述：获取工具动作类型，仅工具步骤可用。
    pub fn action(&self) -> Option<ModelToolAction> {
        match self {
            Self::Export { .. } => None,
            Self::Tool { action, .. } => Some(*action),
        }
    }

    /// 描述：构建步骤观测数据，用于 trace、调试面板和日志一致展示。
    pub fn trace_payload(&self) -> Value {
        json!({
            "step_code": self.code(),
            "operation_kind": self.operation_kind().as_str(),
            "branch": self.branch().as_str(),
            "risk_level": self.risk_level().as_str(),
            "recoverable": self.recoverable(),
            "condition": self.condition(),
        })
    }
}

/// 描述：复杂模型会话能力开关矩阵，默认全部开启。
#[derive(Debug, Clone, Copy)]
pub struct ModelSessionCapabilityMatrix {
    pub export: bool,
    pub scene: bool,
    pub transform: bool,
    pub geometry: bool,
    pub mesh_opt: bool,
    pub material: bool,
    pub file: bool,
}

impl Default for ModelSessionCapabilityMatrix {
    fn default() -> Self {
        Self {
            export: true,
            scene: true,
            transform: true,
            geometry: true,
            mesh_opt: true,
            material: true,
            file: true,
        }
    }
}

/// 描述：规划模型会话步骤，支持批量动作、条件分支和可恢复失败点标记。
pub fn plan_model_session_steps(prompt: &str) -> Vec<ModelSessionPlannedStep> {
    let normalized = prompt.trim();
    if normalized.is_empty() {
        return Vec::new();
    }
    let lower = normalized.to_lowercase();

    let mut steps = plan_explicit_complex_steps(normalized, &lower);
    if steps.is_empty() {
        steps = plan_basic_steps(normalized, &lower);
    }
    if has_rollback_branch_intent(&lower) && !steps.is_empty() {
        let operation_kind = steps
            .last()
            .map(|item| item.operation_kind())
            .unwrap_or(ModelPlanOperationKind::Basic);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Undo,
            input: "失败后回滚（Undo）".to_string(),
            params: json!({}),
            operation_kind,
            branch: ModelPlanBranch::Fallback,
            recoverable: false,
            risk: ModelPlanRiskLevel::Low,
            condition: Some("on_primary_failed".to_string()),
        });
    }
    steps
}

/// 描述：判断当前计划是否需要一次性安全确认。
pub fn requires_safety_confirmation(steps: &[ModelSessionPlannedStep]) -> bool {
    steps
        .iter()
        .any(|item| item.risk_level() == ModelPlanRiskLevel::High)
}

/// 描述：基于 prompt 构建一次性确认令牌（同一指令可在确认后重放一次）。
pub fn build_safety_confirmation_token(trace_id: &str, prompt: &str) -> String {
    let mut hasher = DefaultHasher::new();
    let _ = trace_id;
    "zodileap-complex-confirm".hash(&mut hasher);
    prompt.trim().to_lowercase().hash(&mut hasher);
    format!("confirm-{:016x}", hasher.finish())
}

/// 描述：校验一次性确认令牌是否匹配当前执行上下文。
pub fn validate_safety_confirmation_token(trace_id: &str, prompt: &str, token: &str) -> bool {
    let expected = build_safety_confirmation_token(trace_id, prompt);
    !token.trim().is_empty() && token.trim() == expected
}

/// 描述：构建安全确认 UI Hint，承载一次性确认令牌和风险上下文。
pub fn build_safety_confirmation_ui_hint(
    trace_id: &str,
    prompt: &str,
    steps: &[ModelSessionPlannedStep],
) -> ProtocolUiHint {
    let token = build_safety_confirmation_token(trace_id, prompt);
    let reasons = collect_risk_reasons(steps);
    ProtocolUiHint {
        key: "dangerous-operation-confirm".to_string(),
        level: ProtocolUiHintLevel::Warning,
        title: "检测到高风险复杂操作".to_string(),
        message: "本次操作包含高风险步骤（如布尔链/场景级文件操作）。请确认后仅执行一次。".to_string(),
        actions: vec![
            ProtocolUiHintAction {
                key: "allow_once".to_string(),
                label: "允许一次并执行".to_string(),
                intent: ProtocolUiHintActionIntent::Primary,
            },
            ProtocolUiHintAction {
                key: "deny".to_string(),
                label: "取消本次操作".to_string(),
                intent: ProtocolUiHintActionIntent::Danger,
            },
        ],
        context: Some(json!({
            "prompt": prompt,
            "confirmation_token": token,
            "risk_level": "high",
            "risk_reasons": reasons,
        })),
    }
}

/// 描述：构建复杂会话失败恢复 UI Hint，统一“重试/恢复计划”交互入口。
pub fn build_recovery_ui_hint(
    failed_step: &ModelSessionPlannedStep,
    error: &ProtocolError,
) -> ProtocolUiHint {
    ProtocolUiHint {
        key: "complex-operation-recovery".to_string(),
        level: ProtocolUiHintLevel::Warning,
        title: "复杂操作执行失败".to_string(),
        message: format!(
            "失败步骤：{}。原因：{}。可选择重试或应用恢复策略。",
            failed_step.code(),
            error.message
        ),
        actions: vec![
            ProtocolUiHintAction {
                key: "retry_last_step".to_string(),
                label: "重试最近一步".to_string(),
                intent: ProtocolUiHintActionIntent::Primary,
            },
            ProtocolUiHintAction {
                key: "apply_recovery_plan".to_string(),
                label: "应用恢复策略".to_string(),
                intent: ProtocolUiHintActionIntent::Default,
            },
            ProtocolUiHintAction {
                key: "dismiss".to_string(),
                label: "暂不处理".to_string(),
                intent: ProtocolUiHintActionIntent::Default,
            },
        ],
        context: Some(json!({
            "step_code": failed_step.code(),
            "operation_kind": failed_step.operation_kind().as_str(),
            "branch": failed_step.branch().as_str(),
            "recoverable": failed_step.recoverable(),
        })),
    }
}

/// 描述：按能力开关检查步骤是否允许执行。
pub fn check_capability_for_session_step(
    capabilities: &ModelSessionCapabilityMatrix,
    step: &ModelSessionPlannedStep,
) -> McpResult<()> {
    match step {
        ModelSessionPlannedStep::Export { .. } => {
            if !capabilities.export {
                return Err(McpError::new(
                    "mcp.model.session.capability_disabled",
                    "导出能力已关闭",
                ));
            }
        }
        ModelSessionPlannedStep::Tool { action, .. } => {
            let allowed = match action {
                ModelToolAction::ListObjects
                | ModelToolAction::SelectObjects
                | ModelToolAction::RenameObject
                | ModelToolAction::OrganizeHierarchy => capabilities.scene,
                ModelToolAction::TranslateObjects
                | ModelToolAction::RotateObjects
                | ModelToolAction::ScaleObjects
                | ModelToolAction::AlignOrigin
                | ModelToolAction::NormalizeScale
                | ModelToolAction::NormalizeAxis => capabilities.transform,
                ModelToolAction::Solidify
                | ModelToolAction::AddCube
                | ModelToolAction::Bevel
                | ModelToolAction::Mirror
                | ModelToolAction::Array
                | ModelToolAction::Boolean => capabilities.geometry,
                ModelToolAction::AutoSmooth
                | ModelToolAction::WeightedNormal
                | ModelToolAction::Decimate => capabilities.mesh_opt,
                ModelToolAction::TidyMaterialSlots
                | ModelToolAction::CheckTexturePaths
                | ModelToolAction::ApplyTextureImage
                | ModelToolAction::PackTextures => capabilities.material,
                ModelToolAction::NewFile
                | ModelToolAction::OpenFile
                | ModelToolAction::SaveFile
                | ModelToolAction::Undo
                | ModelToolAction::Redo => capabilities.file,
            };
            if !allowed {
                return Err(McpError::new(
                    "mcp.model.session.capability_disabled",
                    format!("能力 `{}` 已关闭", action),
                ));
            }
        }
    }
    Ok(())
}

/// 描述：构建步骤追踪数据，供调用方统一写入 `ProtocolStepRecord.data`。
pub fn build_step_trace_payload(step: &ModelSessionPlannedStep) -> Value {
    step.trace_payload()
}

/// 描述：规划显式复杂指令（布尔链、修改器链、批量动作、场景级文件操作）。
fn plan_explicit_complex_steps(prompt: &str, lower: &str) -> Vec<ModelSessionPlannedStep> {
    let mut steps: Vec<ModelSessionPlannedStep> = Vec::new();

    if lower.contains("布尔链") || lower.contains("boolean chain") {
        let count = parse_first_number(prompt)
            .map(|value| value as u64)
            .unwrap_or(2)
            .clamp(1, 8);
        for index in 0..count {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::Boolean,
                input: format!("布尔链步骤 {}", index + 1),
                params: json!({ "operation": "DIFFERENCE", "times": 1 }),
                operation_kind: ModelPlanOperationKind::BooleanChain,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::High,
                condition: None,
            });
        }
    }

    if lower.contains("修改器链") || lower.contains("modifier chain") {
        let base_steps = vec![
            (
                ModelToolAction::Solidify,
                "修改器链：加厚",
                json!({"thickness": 0.02}),
            ),
            (
                ModelToolAction::Bevel,
                "修改器链：倒角",
                json!({"width": 0.01, "segments": 2}),
            ),
            (
                ModelToolAction::Decimate,
                "修改器链：减面",
                json!({"ratio": 0.6}),
            ),
            (
                ModelToolAction::WeightedNormal,
                "修改器链：法线加权",
                json!({"selected_only": true}),
            ),
        ];
        for (action, input, params) in base_steps {
            steps.push(ModelSessionPlannedStep::Tool {
                action,
                input: input.to_string(),
                params,
                operation_kind: ModelPlanOperationKind::ModifierChain,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Medium,
                condition: None,
            });
        }
    }

    if lower.contains("批量变换") || lower.contains("batch transform") {
        for (action, input, params) in [
            (
                ModelToolAction::TranslateObjects,
                "批量变换：平移对象",
                json!({"delta":[0.2,0.0,0.0], "selection_scope":"selected", "selected_only": true}),
            ),
            (
                ModelToolAction::RotateObjects,
                "批量变换：旋转对象",
                json!({"delta_euler":[0.0,0.0,0.1745329252], "selection_scope":"selected", "selected_only": true}),
            ),
            (
                ModelToolAction::ScaleObjects,
                "批量变换：缩放对象",
                json!({"factor":1.05, "selection_scope":"selected", "selected_only": true}),
            ),
            (
                ModelToolAction::AlignOrigin,
                "批量变换：对齐原点",
                json!({"selected_only": true}),
            ),
            (
                ModelToolAction::NormalizeScale,
                "批量变换：统一尺度",
                json!({"selected_only": true}),
            ),
            (
                ModelToolAction::NormalizeAxis,
                "批量变换：统一坐标方向",
                json!({"selected_only": true}),
            ),
        ] {
            steps.push(ModelSessionPlannedStep::Tool {
                action,
                input: input.to_string(),
                params,
                operation_kind: ModelPlanOperationKind::BatchTransform,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Medium,
                condition: None,
            });
        }
    }

    if lower.contains("批量材质") || lower.contains("batch material") {
        for (action, input, params) in [
            (
                ModelToolAction::TidyMaterialSlots,
                "批量材质：整理材质槽",
                json!({"selected_only": false}),
            ),
            (
                ModelToolAction::CheckTexturePaths,
                "批量材质：检查贴图路径",
                json!({}),
            ),
            (ModelToolAction::PackTextures, "批量材质：打包贴图", json!({})),
        ] {
            steps.push(ModelSessionPlannedStep::Tool {
                action,
                input: input.to_string(),
                params,
                operation_kind: ModelPlanOperationKind::BatchMaterial,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            });
        }
        if let Some(path) = parse_path_in_prompt(prompt) {
            if is_apply_texture_intent(prompt, lower, path.as_str()) {
                steps.push(ModelSessionPlannedStep::Tool {
                    action: ModelToolAction::ApplyTextureImage,
                    input: format!("批量材质：应用贴图 {}", path),
                    params: json!({ "path": path }),
                    operation_kind: ModelPlanOperationKind::BatchMaterial,
                    branch: ModelPlanBranch::Primary,
                    recoverable: true,
                    risk: ModelPlanRiskLevel::Low,
                    condition: None,
                });
            }
        }
    }

    if lower.contains("场景级操作") || lower.contains("scene file ops") || lower.contains("scene pipeline") {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::SaveFile,
            input: "场景级操作：保存当前文件".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::High,
            condition: None,
        });
        if let Some(path) = parse_path_in_prompt(prompt) {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::OpenFile,
                input: format!("场景级操作：打开文件 {}", path),
                params: json!({ "path": path }),
                operation_kind: ModelPlanOperationKind::SceneFileOps,
                branch: ModelPlanBranch::Primary,
                recoverable: false,
                risk: ModelPlanRiskLevel::High,
                condition: None,
            });
        }
        steps.push(ModelSessionPlannedStep::Export {
            input: "场景级操作：导出 GLB".to_string(),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }

    steps
}

/// 描述：规划基础步骤，保持与历史行为兼容。
fn plan_basic_steps(prompt: &str, lower: &str) -> Vec<ModelSessionPlannedStep> {
    let mut steps: Vec<ModelSessionPlannedStep> = Vec::new();
    if ["导出", "export", "输出glb", "导出模型"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Export {
            input: "导出 GLB".to_string(),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["列出对象", "查看对象", "list objects"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ListObjects,
            input: "列出对象".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::Basic,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if lower.contains("选择对象") || lower.contains("select object") {
        let names_text = prompt
            .split_once("选择对象")
            .map(|(_, right)| right)
            .or_else(|| prompt.split_once("select object").map(|(_, right)| right))
            .unwrap_or("")
            .trim();
        let names = names_text
            .split(|value: char| value == ',' || value == '，' || value.is_whitespace())
            .filter_map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect::<Vec<_>>();
        if !names.is_empty() {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::SelectObjects,
                input: format!("选择对象 {:?}", names),
                params: json!({ "names": names }),
                operation_kind: ModelPlanOperationKind::Basic,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            });
        }
    }
    if lower.contains("重命名") || lower.contains("rename") {
        if let Some((left, right)) = prompt.split_once("为") {
            let old_name = left
                .replace("重命名", "")
                .replace("对象", "")
                .trim()
                .to_string();
            let new_name = right.trim().to_string();
            if !old_name.is_empty() && !new_name.is_empty() {
                steps.push(ModelSessionPlannedStep::Tool {
                    action: ModelToolAction::RenameObject,
                    input: format!("重命名 {} -> {}", old_name, new_name),
                    params: json!({ "old_name": old_name, "new_name": new_name }),
                    operation_kind: ModelPlanOperationKind::Basic,
                    branch: ModelPlanBranch::Primary,
                    recoverable: true,
                    risk: ModelPlanRiskLevel::Low,
                    condition: None,
                });
            }
        }
    }
    if lower.contains("设为父级") || lower.contains("parent") {
        let normalized = prompt.replace("设为父级", " ");
        let parts = normalized
            .split_whitespace()
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>();
        if parts.len() >= 2 {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::OrganizeHierarchy,
                input: format!("层级整理 {} -> {}", parts[0], parts[1]),
                params: json!({ "child": parts[0], "parent": parts[1] }),
                operation_kind: ModelPlanOperationKind::Basic,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            });
        }
    }
    if ["新建", "new file"].iter().any(|key| lower.contains(key)) {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::NewFile,
            input: "新建 Blender 文件".to_string(),
            params: json!({"use_empty": true}),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::High,
            condition: None,
        });
    }
    if ["打开", "导入", "open file"]
        .iter()
        .any(|key| lower.contains(key))
    {
        if let Some(path) = parse_path_in_prompt(prompt) {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::OpenFile,
                input: format!("打开文件 {}", path),
                params: json!({ "path": path }),
                operation_kind: ModelPlanOperationKind::SceneFileOps,
                branch: ModelPlanBranch::Primary,
                recoverable: false,
                risk: ModelPlanRiskLevel::High,
                condition: None,
            });
        }
    }
    if ["保存", "save file"].iter().any(|key| lower.contains(key)) {
        let path = parse_path_in_prompt(prompt);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::SaveFile,
            input: "保存文件".to_string(),
            params: path
                .map(|value| json!({ "path": value }))
                .unwrap_or_else(|| json!({})),
            operation_kind: ModelPlanOperationKind::SceneFileOps,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["撤销", "undo"].iter().any(|key| lower.contains(key)) {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Undo,
            input: "撤销".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::Basic,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["重做", "redo"].iter().any(|key| lower.contains(key)) {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Redo,
            input: "重做".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::Basic,
            branch: ModelPlanBranch::Primary,
            recoverable: false,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["对齐原点", "原点", "align origin"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::AlignOrigin,
            input: "对齐到原点".to_string(),
            params: json!({ "selected_only": true }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if is_translate_intent(lower) {
        let delta = parse_translate_delta(prompt, lower);
        let selection_scope = derive_selection_scope(lower);
        let selected_only = selection_scope != "all";
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TranslateObjects,
            input: "平移对象".to_string(),
            params: json!({
                "delta": [delta.0, delta.1, delta.2],
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if is_rotate_intent(lower) {
        let delta = parse_rotate_delta(prompt, lower);
        let selection_scope = derive_selection_scope(lower);
        let selected_only = selection_scope != "all";
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::RotateObjects,
            input: "旋转对象".to_string(),
            params: json!({
                "delta_euler": [delta.0, delta.1, delta.2],
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if is_scale_intent(lower) {
        let factor = parse_scale_factor(prompt);
        let selection_scope = derive_selection_scope(lower);
        let selected_only = selection_scope != "all";
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::ScaleObjects,
            input: "缩放对象".to_string(),
            params: json!({
                "factor": factor,
                "selection_scope": selection_scope,
                "selected_only": selected_only,
            }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["统一尺度", "normalize scale", "应用缩放"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::NormalizeScale,
            input: "统一尺度".to_string(),
            params: json!({ "selected_only": true, "apply": true }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["旋转方向", "坐标系", "normalize axis"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::NormalizeAxis,
            input: "旋转方向标准化".to_string(),
            params: json!({ "selected_only": true }),
            operation_kind: ModelPlanOperationKind::BatchTransform,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if is_add_cube_intent(prompt, lower) {
        let size = parse_first_number(prompt).unwrap_or(2.0).clamp(0.001, 1000.0);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::AddCube,
            input: format!("添加正方体 size={}", size),
            params: json!({ "size": size }),
            operation_kind: ModelPlanOperationKind::Basic,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["加厚", "solidify"].iter().any(|key| lower.contains(key)) {
        let thickness = parse_first_number(prompt).unwrap_or(0.02).clamp(0.0001, 10.0);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Solidify,
            input: format!("加厚 {}", thickness),
            params: json!({ "thickness": thickness }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["倒角", "bevel"].iter().any(|key| lower.contains(key)) {
        let width = parse_first_number(prompt).unwrap_or(0.02).clamp(0.0001, 10.0);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Bevel,
            input: format!("倒角 {}", width),
            params: json!({ "width": width, "segments": 2 }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["镜像", "mirror"].iter().any(|key| lower.contains(key)) {
        let axis = if lower.contains(" y ") || lower.contains("y轴") || lower.contains(" y轴") {
            "Y"
        } else if lower.contains(" z ") || lower.contains("z轴") || lower.contains(" z轴") {
            "Z"
        } else {
            "X"
        };
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Mirror,
            input: format!("镜像 {}", axis),
            params: json!({ "axis": axis }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["阵列", "array"].iter().any(|key| lower.contains(key)) {
        let count = parse_first_number(prompt)
            .map(|value| value as u64)
            .unwrap_or(3)
            .clamp(1, 128);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Array,
            input: format!("阵列 {}", count),
            params: json!({ "count": count, "offset": 1.0 }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["布尔", "boolean"].iter().any(|key| lower.contains(key)) {
        let operation = if lower.contains("并") || lower.contains("union") {
            "UNION"
        } else if lower.contains("交") || lower.contains("intersect") {
            "INTERSECT"
        } else {
            "DIFFERENCE"
        };
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Boolean,
            input: format!("布尔 {}", operation),
            params: json!({ "operation": operation, "times": 1 }),
            operation_kind: ModelPlanOperationKind::BooleanChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::High,
            condition: None,
        });
    }
    if ["自动平滑", "auto smooth", "smooth"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::AutoSmooth,
            input: "自动平滑".to_string(),
            params: json!({ "angle": 0.5235987756, "selected_only": true }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["weighted normal", "法线加权"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::WeightedNormal,
            input: "Weighted Normal".to_string(),
            params: json!({ "selected_only": true }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["减面", "decimate"].iter().any(|key| lower.contains(key)) {
        let ratio = parse_first_number(prompt).unwrap_or(0.5).clamp(0.01, 1.0);
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::Decimate,
            input: format!("减面 {}", ratio),
            params: json!({ "ratio": ratio }),
            operation_kind: ModelPlanOperationKind::ModifierChain,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Medium,
            condition: None,
        });
    }
    if ["材质槽", "整理材质"].iter().any(|key| lower.contains(key)) {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::TidyMaterialSlots,
            input: "整理材质槽".to_string(),
            params: json!({ "selected_only": false }),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if ["贴图路径", "纹理路径", "check texture"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::CheckTexturePaths,
            input: "检查贴图路径".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    if let Some(path) = parse_path_in_prompt(prompt) {
        if is_apply_texture_intent(prompt, lower, path.as_str()) {
            steps.push(ModelSessionPlannedStep::Tool {
                action: ModelToolAction::ApplyTextureImage,
                input: format!("应用贴图 {}", path),
                params: json!({ "path": path }),
                operation_kind: ModelPlanOperationKind::BatchMaterial,
                branch: ModelPlanBranch::Primary,
                recoverable: true,
                risk: ModelPlanRiskLevel::Low,
                condition: None,
            });
        }
    }
    if ["打包贴图", "pack textures"]
        .iter()
        .any(|key| lower.contains(key))
    {
        steps.push(ModelSessionPlannedStep::Tool {
            action: ModelToolAction::PackTextures,
            input: "打包贴图".to_string(),
            params: json!({}),
            operation_kind: ModelPlanOperationKind::BatchMaterial,
            branch: ModelPlanBranch::Primary,
            recoverable: true,
            risk: ModelPlanRiskLevel::Low,
            condition: None,
        });
    }
    steps
}

/// 描述：判断用户是否要求“失败时执行回滚分支”。
fn has_rollback_branch_intent(lower: &str) -> bool {
    ["失败后回滚", "失败回滚", "自动回滚", "on failure rollback"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：解析文本中第一个数字，用于从自然语言提取参数值。
fn parse_first_number(input: &str) -> Option<f64> {
    let mut buf = String::new();
    let mut started = false;
    for ch in input.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            buf.push(ch);
            started = true;
            continue;
        }
        if started {
            break;
        }
    }
    if buf.is_empty() {
        None
    } else {
        buf.parse::<f64>().ok()
    }
}

/// 描述：从文本中提取最多三个数字，用于平移/旋转/缩放等向量参数。
fn parse_first_three_numbers(input: &str) -> Vec<f64> {
    let mut numbers: Vec<f64> = Vec::new();
    let mut buf = String::new();
    for ch in input.chars() {
        if ch.is_ascii_digit() || ch == '.' || (ch == '-' && buf.is_empty()) {
            buf.push(ch);
            continue;
        }
        if !buf.is_empty() {
            if let Ok(value) = buf.parse::<f64>() {
                numbers.push(value);
                if numbers.len() >= 3 {
                    break;
                }
            }
            buf.clear();
        }
    }
    if numbers.len() < 3 && !buf.is_empty() {
        if let Ok(value) = buf.parse::<f64>() {
            numbers.push(value);
        }
    }
    numbers
}

/// 描述：识别“平移/移动对象”意图，支持中英文关键词。
fn is_translate_intent(lower: &str) -> bool {
    ["平移", "移动", "translate", "move"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：识别“这个物体/当前物体”等单对象指代语义，默认映射到 active 对象。
fn has_active_reference_intent(lower: &str) -> bool {
    [
        "这个物体",
        "当前物体",
        "这个对象",
        "当前对象",
        "active object",
        "current object",
        "this object",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：识别“选中对象”语义，映射到 selected 作用域。
fn has_selected_reference_intent(lower: &str) -> bool {
    [
        "选中的物体",
        "选中对象",
        "当前选中对象",
        "selected object",
        "selected objects",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：识别“所有对象”语义，映射到 all 作用域。
fn has_all_objects_intent(lower: &str) -> bool {
    [
        "所有对象",
        "全部对象",
        "所有物体",
        "全部物体",
        "整个场景",
        "all objects",
        "all meshes",
        "entire scene",
    ]
    .iter()
    .any(|key| lower.contains(key))
}

/// 描述：根据自然语言意图推断选择范围，控制动作只影响期望对象集合。
fn derive_selection_scope(lower: &str) -> &'static str {
    if has_all_objects_intent(lower) {
        return "all";
    }
    if has_active_reference_intent(lower) {
        return "active";
    }
    if has_selected_reference_intent(lower) || lower.contains("选中") {
        return "selected";
    }
    "selected"
}

/// 描述：提取平移向量；若用户只提供单值则按 X 轴平移，未提供则使用默认步长。
fn parse_translate_delta(prompt: &str, lower: &str) -> (f64, f64, f64) {
    let numbers = parse_first_three_numbers(prompt);
    if numbers.len() >= 3 {
        return (numbers[0], numbers[1], numbers[2]);
    }
    if numbers.len() == 1 {
        let value = numbers[0];
        if lower.contains("y轴") || lower.contains(" y ") {
            return (0.0, value, 0.0);
        }
        if lower.contains("z轴") || lower.contains(" z ") {
            return (0.0, 0.0, value);
        }
        return (value, 0.0, 0.0);
    }
    (0.2, 0.0, 0.0)
}

/// 描述：识别旋转意图，支持中英文关键词。
fn is_rotate_intent(lower: &str) -> bool {
    ["旋转", "rotate"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：将角度输入归一为弧度；明显超过 2π 的值视为角度输入。
fn normalize_angle_to_radian(value: f64) -> f64 {
    if value.abs() > std::f64::consts::TAU {
        value.to_radians()
    } else {
        value
    }
}

/// 描述：提取旋转向量（弧度）；单值时按轴向关键词分配。
fn parse_rotate_delta(prompt: &str, lower: &str) -> (f64, f64, f64) {
    let numbers = parse_first_three_numbers(prompt);
    if numbers.len() >= 3 {
        return (
            normalize_angle_to_radian(numbers[0]),
            normalize_angle_to_radian(numbers[1]),
            normalize_angle_to_radian(numbers[2]),
        );
    }
    if numbers.len() == 1 {
        let value = normalize_angle_to_radian(numbers[0]);
        if lower.contains("y轴") || lower.contains(" y ") {
            return (0.0, value, 0.0);
        }
        if lower.contains("z轴") || lower.contains(" z ") {
            return (0.0, 0.0, value);
        }
        return (value, 0.0, 0.0);
    }
    (0.0, 0.0, 0.1745329252)
}

/// 描述：识别缩放意图，支持中英文关键词。
fn is_scale_intent(lower: &str) -> bool {
    ["缩放", "scale"]
        .iter()
        .any(|key| lower.contains(key))
}

/// 描述：提取统一缩放因子，未提供时使用默认值。
fn parse_scale_factor(prompt: &str) -> f64 {
    parse_first_number(prompt).unwrap_or(1.1).clamp(0.001, 1000.0)
}

/// 描述：从自然语言中提取路径参数，支持绝对路径和 Windows 路径。
fn parse_path_in_prompt(prompt: &str) -> Option<String> {
    let normalize_candidate = |raw: &str| -> Option<String> {
        let trimmed = raw.trim_matches(|value| {
            value == '"'
                || value == '\''
                || value == '`'
                || value == '“'
                || value == '”'
                || value == '‘'
                || value == '’'
        });
        let head = trimmed
            .split(|value: char| {
                value.is_whitespace()
                    || value == '"'
                    || value == '\''
                    || value == '`'
                    || value == '“'
                    || value == '”'
                    || value == '‘'
                    || value == '’'
                    || value == '，'
                    || value == '。'
                    || value == '；'
                    || value == '！'
                    || value == '？'
            })
            .next()
            .unwrap_or("")
            .trim_matches(|value| {
                value == '"'
                    || value == '\''
                    || value == '`'
                    || value == '“'
                    || value == '”'
                    || value == '‘'
                    || value == '’'
                    || value == '，'
                    || value == '。'
                    || value == '；'
                    || value == '！'
                    || value == '？'
                    || value == ')'
                    || value == ']'
                    || value == '}'
            });
        if head.starts_with('/') || head.contains(":\\") {
            return Some(head.to_string());
        }
        None
    };

    for token in prompt.trim().split_whitespace() {
        if let Some(candidate) = normalize_candidate(token) {
            return Some(candidate);
        }
    }
    if let Some(start) = prompt.find('/') {
        let remaining = &prompt[start..];
        if let Some(candidate) = normalize_candidate(remaining) {
            return Some(candidate);
        }
    }
    None
}

/// 描述：识别“将图片贴图应用到当前对象”的意图，避免误把普通文件路径解析为材质操作。
fn is_apply_texture_intent(prompt: &str, lower: &str, path: &str) -> bool {
    let has_texture_keyword = ["贴图", "纹理", "材质", "texture", "image", "base color"]
        .iter()
        .any(|keyword| lower.contains(keyword));
    let has_apply_verb = ["添加", "替换", "设置", "应用", "assign", "apply", "set", "use"]
        .iter()
        .any(|keyword| lower.contains(keyword));
    let lower_path = path.to_lowercase();
    let is_image_file = [".png", ".jpg", ".jpeg", ".tga", ".bmp", ".tif", ".tiff", ".exr"]
        .iter()
        .any(|suffix| lower_path.ends_with(suffix));
    let trimmed_prompt = prompt.trim_start();
    let starts_with_material_instruction =
        ["贴图", "纹理", "材质", "texture", "image", "material"]
            .iter()
            .any(|prefix| trimmed_prompt.to_lowercase().starts_with(prefix));

    (has_texture_keyword && has_apply_verb && is_image_file)
        || (starts_with_material_instruction && is_image_file)
}

/// 描述：识别“添加正方体/立方体”的显式意图，避免误判普通对话。
fn is_add_cube_intent(prompt: &str, lower: &str) -> bool {
    const CN_EXPLICIT: [&str; 12] = [
        "添加正方体",
        "添加一个正方体",
        "添加立方体",
        "添加一个立方体",
        "新建正方体",
        "新建立方体",
        "创建正方体",
        "创建立方体",
        "加个正方体",
        "加一个正方体",
        "加个立方体",
        "加一个立方体",
    ];
    if CN_EXPLICIT.iter().any(|pattern| lower.contains(pattern)) {
        return true;
    }

    const EN_EXPLICIT: [&str; 10] = [
        "add cube",
        "add a cube",
        "create cube",
        "create a cube",
        "new cube",
        "add box",
        "add a box",
        "create box",
        "create a box",
        "new box",
    ];
    if EN_EXPLICIT.iter().any(|pattern| lower.contains(pattern)) {
        return true;
    }

    let trimmed = prompt.trim_start();
    let starts_with_create_verb = ["添加", "新建", "创建", "生成", "add ", "create ", "new "]
        .iter()
        .any(|prefix| trimmed.to_lowercase().starts_with(prefix));
    let has_cube_noun = ["正方体", "立方体", "方块", "cube", "box"]
        .iter()
        .any(|keyword| lower.contains(keyword));

    starts_with_create_verb && has_cube_noun
}

/// 描述：汇总高风险原因，便于 UI 展示用户确认信息。
fn collect_risk_reasons(steps: &[ModelSessionPlannedStep]) -> Vec<String> {
    let mut reasons: Vec<String> = Vec::new();
    for step in steps {
        if step.risk_level() != ModelPlanRiskLevel::High {
            continue;
        }
        let reason = match step.operation_kind() {
            ModelPlanOperationKind::BooleanChain => "布尔链可能造成不可逆拓扑修改",
            ModelPlanOperationKind::SceneFileOps => "场景级文件操作可能覆盖当前文件",
            _ => "高风险步骤",
        };
        if !reasons.iter().any(|value| value == reason) {
            reasons.push(reason.to_string());
        }
    }
    reasons
}
