use crate::ModelToolAction;

/// 描述：模型工具动作所属能力域，作为能力开关与边界控制的统一来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelToolCapabilityDomain {
    Scene,
    Transform,
    Geometry,
    MeshOpt,
    Material,
    File,
}

impl ModelToolCapabilityDomain {
    /// 描述：将能力域枚举转换为稳定字符串，便于写入文档与 trace。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Scene => "scene",
            Self::Transform => "transform",
            Self::Geometry => "geometry",
            Self::MeshOpt => "mesh_opt",
            Self::Material => "material",
            Self::File => "file",
        }
    }
}

/// 描述：模型工具动作参数契约，统一描述字段类型、是否必填、默认值与约束。
#[derive(Debug, Clone, Copy)]
pub struct ModelToolParamContract {
    pub name: &'static str,
    pub value_type: &'static str,
    pub required: bool,
    pub default_value: &'static str,
    pub constraint: &'static str,
}

/// 描述：单个模型工具动作契约，聚合能力边界、风险等级、参数与错误码。
#[derive(Debug, Clone, Copy)]
pub struct ModelToolActionContract {
    pub action: ModelToolAction,
    pub capability: ModelToolCapabilityDomain,
    pub risk_level: &'static str,
    pub summary: &'static str,
    pub params: &'static [ModelToolParamContract],
    pub error_codes: &'static [&'static str],
}

/// 描述：维护动作全集，确保能力边界与文档生成都覆盖全部动作。
const ALL_MODEL_TOOL_ACTIONS: [ModelToolAction; 30] = [
    ModelToolAction::ListObjects,
    ModelToolAction::GetSelectionContext,
    ModelToolAction::SelectObjects,
    ModelToolAction::RenameObject,
    ModelToolAction::OrganizeHierarchy,
    ModelToolAction::TranslateObjects,
    ModelToolAction::RotateObjects,
    ModelToolAction::ScaleObjects,
    ModelToolAction::AlignOrigin,
    ModelToolAction::NormalizeScale,
    ModelToolAction::NormalizeAxis,
    ModelToolAction::AddCube,
    ModelToolAction::Solidify,
    ModelToolAction::Bevel,
    ModelToolAction::Mirror,
    ModelToolAction::Array,
    ModelToolAction::Boolean,
    ModelToolAction::AutoSmooth,
    ModelToolAction::WeightedNormal,
    ModelToolAction::Decimate,
    ModelToolAction::InspectMeshTopology,
    ModelToolAction::TidyMaterialSlots,
    ModelToolAction::CheckTexturePaths,
    ModelToolAction::ApplyTextureImage,
    ModelToolAction::PackTextures,
    ModelToolAction::NewFile,
    ModelToolAction::OpenFile,
    ModelToolAction::SaveFile,
    ModelToolAction::Undo,
    ModelToolAction::Redo,
];

/// 描述：返回模型工具动作全集，供契约遍历、文档渲染和测试复用。
pub fn all_model_tool_actions() -> &'static [ModelToolAction] {
    &ALL_MODEL_TOOL_ACTIONS
}

const EMPTY_PARAMS: &[ModelToolParamContract] = &[];

const PARAM_NAMES: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "names",
    value_type: "string[]",
    required: true,
    default_value: "无",
    constraint: "至少一个非空对象名",
}];

const PARAM_RENAME: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "old_name",
        value_type: "string",
        required: true,
        default_value: "无",
        constraint: "非空",
    },
    ModelToolParamContract {
        name: "new_name",
        value_type: "string",
        required: true,
        default_value: "无",
        constraint: "非空",
    },
];

const PARAM_ORGANIZE_HIERARCHY: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "mode",
        value_type: "string",
        required: false,
        default_value: "object_parent",
        constraint: "object_parent/collection_move/collection_rename/collection_reorder",
    },
    ModelToolParamContract {
        name: "child|collection",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "object_parent 需 child；collection_* 需 collection（兼容 child）",
    },
    ModelToolParamContract {
        name: "parent|parent_collection",
        value_type: "string|null",
        required: false,
        default_value: "null",
        constraint: "object_parent/collection_move 可选父级；空值表示根级",
    },
    ModelToolParamContract {
        name: "new_name",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "collection_rename 时必填",
    },
    ModelToolParamContract {
        name: "position",
        value_type: "string",
        required: false,
        default_value: "last",
        constraint: "collection_reorder 时可选：first/last",
    },
];

const PARAM_TRANSLATE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "delta",
        value_type: "number[3]",
        required: true,
        default_value: "无",
        constraint: "每项范围 [-10000, 10000]",
    },
    ModelToolParamContract {
        name: "selection_scope",
        value_type: "string",
        required: false,
        default_value: "selected",
        constraint: "active/selected/all",
    },
    ModelToolParamContract {
        name: "target_names",
        value_type: "string[]",
        required: false,
        default_value: "[]",
        constraint: "提供时必须为非空字符串数组",
    },
];

const PARAM_ROTATE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "delta_euler",
        value_type: "number[3]",
        required: true,
        default_value: "无",
        constraint: "每项范围 [-3600, 3600]，单位弧度",
    },
    ModelToolParamContract {
        name: "selection_scope",
        value_type: "string",
        required: false,
        default_value: "selected",
        constraint: "active/selected/all",
    },
    ModelToolParamContract {
        name: "target_names",
        value_type: "string[]",
        required: false,
        default_value: "[]",
        constraint: "提供时必须为非空字符串数组",
    },
];

const PARAM_SCALE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "factor",
        value_type: "number|number[3]",
        required: true,
        default_value: "无",
        constraint: "范围 [0.001, 1000]",
    },
    ModelToolParamContract {
        name: "selection_scope",
        value_type: "string",
        required: false,
        default_value: "selected",
        constraint: "active/selected/all",
    },
    ModelToolParamContract {
        name: "target_names",
        value_type: "string[]",
        required: false,
        default_value: "[]",
        constraint: "提供时必须为非空字符串数组",
    },
];

const PARAM_SELECTED_ONLY_TRUE: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "selected_only",
    value_type: "bool",
    required: false,
    default_value: "true",
    constraint: "true 时只处理当前选中对象",
}];

const PARAM_NORMALIZE_SCALE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "selected_only",
        value_type: "bool",
        required: false,
        default_value: "true",
        constraint: "true 时只处理当前选中对象",
    },
    ModelToolParamContract {
        name: "apply",
        value_type: "bool",
        required: false,
        default_value: "true",
        constraint: "true 时执行 transform_apply",
    },
];

const PARAM_ADD_CUBE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "size",
        value_type: "number",
        required: false,
        default_value: "2.0",
        constraint: "范围 [0.001, 1000]",
    },
    ModelToolParamContract {
        name: "location",
        value_type: "number[3]",
        required: false,
        default_value: "[0,0,0]",
        constraint: "长度为 3 的数值向量",
    },
    ModelToolParamContract {
        name: "name",
        value_type: "string",
        required: false,
        default_value: "Cube",
        constraint: "可选自定义对象名",
    },
];

const PARAM_SOLIDIFY: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "thickness",
        value_type: "number",
        required: false,
        default_value: "0.02",
        constraint: "范围 [0.0001, 10]",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_BEVEL: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "width",
        value_type: "number",
        required: false,
        default_value: "0.02",
        constraint: "范围 [0.0001, 10]",
    },
    ModelToolParamContract {
        name: "segments",
        value_type: "integer",
        required: false,
        default_value: "2",
        constraint: "范围 [1, 32]",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_MIRROR: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "axis",
        value_type: "string",
        required: false,
        default_value: "X",
        constraint: "X/Y/Z",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_ARRAY: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "count",
        value_type: "integer",
        required: false,
        default_value: "2",
        constraint: "范围 [1, 128]",
    },
    ModelToolParamContract {
        name: "offset",
        value_type: "number",
        required: false,
        default_value: "1.0",
        constraint: "沿 X 轴相对偏移",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_BOOLEAN: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "target|targets",
        value_type: "string|string[]",
        required: false,
        default_value: "无",
        constraint: "至少提供 target 或非空 targets 数组",
    },
    ModelToolParamContract {
        name: "operation",
        value_type: "string",
        required: false,
        default_value: "DIFFERENCE",
        constraint: "UNION/DIFFERENCE/INTERSECT",
    },
    ModelToolParamContract {
        name: "times",
        value_type: "integer",
        required: false,
        default_value: "1",
        constraint: "范围 [1, 8]（规划层约束）",
    },
    ModelToolParamContract {
        name: "order",
        value_type: "string",
        required: false,
        default_value: "as_provided",
        constraint: "as_provided/reverse",
    },
    ModelToolParamContract {
        name: "rollback_on_error",
        value_type: "bool",
        required: false,
        default_value: "true",
        constraint: "失败时回滚本次新增布尔修改器",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_AUTO_SMOOTH: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "angle",
        value_type: "number",
        required: false,
        default_value: "0.5235987756",
        constraint: "弧度，默认约 30°",
    },
    ModelToolParamContract {
        name: "selected_only",
        value_type: "bool",
        required: false,
        default_value: "true",
        constraint: "true 时只处理选中对象",
    },
];

const PARAM_DECIMATE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "ratio",
        value_type: "number",
        required: false,
        default_value: "0.5",
        constraint: "范围 [0.01, 1]",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "不传则回退到 active 或首个 selected",
    },
];

const PARAM_INSPECT_TOPOLOGY: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "selected_only",
        value_type: "bool",
        required: false,
        default_value: "true",
        constraint: "true 时仅检查选中 mesh",
    },
    ModelToolParamContract {
        name: "strict",
        value_type: "bool",
        required: false,
        default_value: "false",
        constraint: "true 时空集合直接报错",
    },
    ModelToolParamContract {
        name: "baseline_face_counts",
        value_type: "map<string, uint>",
        required: false,
        default_value: "{}",
        constraint: "对象名 -> 面数基线",
    },
];

const PARAM_TIDY_MATERIAL_SLOTS: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "selected_only",
    value_type: "bool",
    required: false,
    default_value: "false",
    constraint: "true 时仅处理选中对象",
}];

const PARAM_CHECK_TEXTURE_PATHS: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "repair_relative",
        value_type: "bool",
        required: false,
        default_value: "false",
        constraint: "true 时尝试按目录修复缺失贴图",
    },
    ModelToolParamContract {
        name: "base_dir",
        value_type: "string",
        required: false,
        default_value: "当前 blend 文件目录/工作目录",
        constraint: "用于修复相对路径的优先搜索目录",
    },
];

const PARAM_APPLY_TEXTURE: &[ModelToolParamContract] = &[
    ModelToolParamContract {
        name: "path|base_color_path",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "与其他通道至少提供一个，且路径必须存在",
    },
    ModelToolParamContract {
        name: "normal_path",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "可选法线贴图",
    },
    ModelToolParamContract {
        name: "roughness_path",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "可选粗糙度贴图",
    },
    ModelToolParamContract {
        name: "metallic_path",
        value_type: "string",
        required: false,
        default_value: "无",
        constraint: "可选金属度贴图",
    },
    ModelToolParamContract {
        name: "object",
        value_type: "string",
        required: false,
        default_value: "active/selected",
        constraint: "单对象模式",
    },
    ModelToolParamContract {
        name: "objects",
        value_type: "string[]",
        required: false,
        default_value: "[]",
        constraint: "多对象模式，提供时必须为非空字符串数组",
    },
];

const PARAM_NEW_FILE: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "use_empty",
    value_type: "bool",
    required: false,
    default_value: "true",
    constraint: "true 时使用空场景模板",
}];

const PARAM_OPEN_FILE: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "path",
    value_type: "string",
    required: true,
    default_value: "无",
    constraint: "非空且文件必须存在",
}];

const PARAM_SAVE_FILE: &[ModelToolParamContract] = &[ModelToolParamContract {
    name: "path",
    value_type: "string",
    required: false,
    default_value: "当前文件路径",
    constraint: "提供时必须非空；为空时要求当前文件已保存",
}];

const ERR_ACTION_FAILED: &[&str] = &["mcp.model.bridge.action_failed"];
const ERR_ORGANIZE_HIERARCHY: &[&str] = &[
    "mcp.model.tool.organize_hierarchy_invalid_mode",
    "mcp.model.tool.organize_hierarchy_missing_child",
    "mcp.model.tool.organize_hierarchy_missing_collection",
    "mcp.model.tool.organize_hierarchy_missing_new_name",
    "mcp.model.tool.organize_hierarchy_invalid_position",
    "mcp.model.tool.organize_hierarchy_invalid_parent",
    "mcp.model.bridge.action_failed",
];
const ERR_TRANSLATE: &[&str] = &[
    "mcp.model.tool.translate_delta.missing",
    "mcp.model.tool.translate_delta.invalid",
    "mcp.model.tool.translate_delta.out_of_range",
    "mcp.model.tool.invalid_selection_scope",
    "mcp.model.tool.target_names_invalid",
    "mcp.model.tool.target_names_empty",
    "mcp.model.bridge.action_failed",
];
const ERR_ROTATE: &[&str] = &[
    "mcp.model.tool.rotate_delta_euler.missing",
    "mcp.model.tool.rotate_delta_euler.invalid",
    "mcp.model.tool.rotate_delta_euler.out_of_range",
    "mcp.model.tool.invalid_selection_scope",
    "mcp.model.tool.target_names_invalid",
    "mcp.model.tool.target_names_empty",
    "mcp.model.bridge.action_failed",
];
const ERR_SCALE: &[&str] = &[
    "mcp.model.tool.scale_factor_missing",
    "mcp.model.tool.scale_factor_invalid",
    "mcp.model.tool.scale_factor_out_of_range",
    "mcp.model.tool.invalid_selection_scope",
    "mcp.model.tool.target_names_invalid",
    "mcp.model.tool.target_names_empty",
    "mcp.model.bridge.action_failed",
];
const ERR_ADD_CUBE: &[&str] = &[
    "mcp.model.tool.add_cube_size_out_of_range",
    "mcp.model.bridge.action_failed",
];
const ERR_SOLIDIFY: &[&str] = &[
    "mcp.model.tool.solidify_thickness_out_of_range",
    "mcp.model.bridge.action_failed",
];
const ERR_BEVEL: &[&str] = &[
    "mcp.model.tool.bevel_width_out_of_range",
    "mcp.model.tool.bevel_segments_out_of_range",
    "mcp.model.bridge.action_failed",
];
const ERR_MIRROR: &[&str] = &[
    "mcp.model.tool.mirror_axis_invalid",
    "mcp.model.bridge.action_failed",
];
const ERR_ARRAY: &[&str] = &[
    "mcp.model.tool.array_count_out_of_range",
    "mcp.model.tool.array_offset_out_of_range",
    "mcp.model.bridge.action_failed",
];
const ERR_BOOLEAN: &[&str] = &[
    "mcp.model.tool.boolean_times_out_of_range",
    "mcp.model.tool.boolean_missing_target",
    "mcp.model.tool.boolean_invalid_target",
    "mcp.model.tool.boolean_invalid_targets",
    "mcp.model.tool.boolean_invalid_order",
    "mcp.model.tool.boolean_invalid_rollback",
    "mcp.model.bridge.action_failed",
];
const ERR_DECIMATE: &[&str] = &[
    "mcp.model.tool.decimate_ratio_out_of_range",
    "mcp.model.bridge.action_failed",
];
const ERR_INSPECT: &[&str] = &[
    "mcp.model.tool.inspect_topology_invalid_selected_only",
    "mcp.model.tool.inspect_topology_invalid_strict",
    "mcp.model.tool.inspect_topology_invalid_baseline",
    "mcp.model.bridge.action_failed",
];
const ERR_OPEN_FILE: &[&str] = &[
    "mcp.model.tool.open_file_missing_path",
    "mcp.model.bridge.action_failed",
];
const ERR_APPLY_TEXTURE: &[&str] = &[
    "mcp.model.tool.apply_texture_missing_path",
    "mcp.model.tool.apply_texture_invalid_path",
    "mcp.model.tool.apply_texture_invalid_object",
    "mcp.model.tool.apply_texture_invalid_objects",
    "mcp.model.bridge.action_failed",
];
const ERR_SAVE_FILE: &[&str] = &[
    "mcp.model.tool.save_file_invalid_path",
    "mcp.model.bridge.action_failed",
];

/// 描述：返回单个动作所属能力域，作为能力开关判断的统一入口。
pub fn model_tool_action_capability(action: ModelToolAction) -> ModelToolCapabilityDomain {
    match action {
        ModelToolAction::ListObjects
        | ModelToolAction::GetSelectionContext
        | ModelToolAction::SelectObjects
        | ModelToolAction::RenameObject
        | ModelToolAction::OrganizeHierarchy => ModelToolCapabilityDomain::Scene,
        ModelToolAction::TranslateObjects
        | ModelToolAction::RotateObjects
        | ModelToolAction::ScaleObjects
        | ModelToolAction::AlignOrigin
        | ModelToolAction::NormalizeScale
        | ModelToolAction::NormalizeAxis => ModelToolCapabilityDomain::Transform,
        ModelToolAction::Solidify
        | ModelToolAction::AddCube
        | ModelToolAction::Bevel
        | ModelToolAction::Mirror
        | ModelToolAction::Array
        | ModelToolAction::Boolean => ModelToolCapabilityDomain::Geometry,
        ModelToolAction::AutoSmooth
        | ModelToolAction::WeightedNormal
        | ModelToolAction::Decimate
        | ModelToolAction::InspectMeshTopology => ModelToolCapabilityDomain::MeshOpt,
        ModelToolAction::TidyMaterialSlots
        | ModelToolAction::CheckTexturePaths
        | ModelToolAction::ApplyTextureImage
        | ModelToolAction::PackTextures => ModelToolCapabilityDomain::Material,
        ModelToolAction::NewFile
        | ModelToolAction::OpenFile
        | ModelToolAction::SaveFile
        | ModelToolAction::Undo
        | ModelToolAction::Redo => ModelToolCapabilityDomain::File,
    }
}

/// 描述：返回动作默认风险等级，供文档与安全评审参考。
pub fn model_tool_action_default_risk(action: ModelToolAction) -> &'static str {
    match action {
        ModelToolAction::Boolean | ModelToolAction::NewFile | ModelToolAction::OpenFile => "high",
        ModelToolAction::AlignOrigin
        | ModelToolAction::NormalizeScale
        | ModelToolAction::NormalizeAxis
        | ModelToolAction::Solidify
        | ModelToolAction::Bevel
        | ModelToolAction::Mirror
        | ModelToolAction::Array
        | ModelToolAction::Decimate
        | ModelToolAction::SaveFile => "medium",
        _ => "low",
    }
}

/// 描述：返回动作用途摘要，便于在文档与 UI 中快速理解动作语义。
pub fn model_tool_action_summary(action: ModelToolAction) -> &'static str {
    match action {
        ModelToolAction::ListObjects => "读取当前场景对象列表与选中状态",
        ModelToolAction::GetSelectionContext => "读取当前选择集和 active 对象",
        ModelToolAction::SelectObjects => "按名称选中对象并激活首个对象",
        ModelToolAction::RenameObject => "重命名对象",
        ModelToolAction::OrganizeHierarchy => "组织对象或集合层级（父级、移动、重命名、重排）",
        ModelToolAction::TranslateObjects => "按选择范围批量平移对象",
        ModelToolAction::RotateObjects => "按选择范围批量旋转对象",
        ModelToolAction::ScaleObjects => "按选择范围批量缩放对象",
        ModelToolAction::AlignOrigin => "将对象位置对齐到世界原点",
        ModelToolAction::NormalizeScale => "统一对象缩放并可应用缩放变换",
        ModelToolAction::NormalizeAxis => "统一对象旋转轴向（应用旋转）",
        ModelToolAction::AddCube => "创建立方体对象",
        ModelToolAction::Solidify => "为对象添加加厚修改器",
        ModelToolAction::Bevel => "为对象添加倒角修改器",
        ModelToolAction::Mirror => "为对象添加镜像修改器",
        ModelToolAction::Array => "为对象添加阵列修改器",
        ModelToolAction::Boolean => "执行布尔修改器操作",
        ModelToolAction::AutoSmooth => "设置自动平滑并标记面平滑",
        ModelToolAction::WeightedNormal => "添加加权法线修改器",
        ModelToolAction::Decimate => "添加减面修改器",
        ModelToolAction::InspectMeshTopology => "检查非流形、法线异常和面数变化",
        ModelToolAction::TidyMaterialSlots => "清理空材质槽",
        ModelToolAction::CheckTexturePaths => "检查并可修复缺失贴图路径",
        ModelToolAction::ApplyTextureImage => "按通道给对象应用贴图并自动建材质节点",
        ModelToolAction::PackTextures => "将外部贴图打包进 blend 文件",
        ModelToolAction::NewFile => "新建 Blender 文件",
        ModelToolAction::OpenFile => "打开指定 Blender 文件",
        ModelToolAction::SaveFile => "保存当前文件或另存为",
        ModelToolAction::Undo => "撤销一步",
        ModelToolAction::Redo => "重做一步",
    }
}

/// 描述：返回动作参数契约，作为输入校验与文档展示的统一来源。
pub fn model_tool_action_params(action: ModelToolAction) -> &'static [ModelToolParamContract] {
    match action {
        ModelToolAction::ListObjects
        | ModelToolAction::GetSelectionContext
        | ModelToolAction::PackTextures
        | ModelToolAction::Undo
        | ModelToolAction::Redo => EMPTY_PARAMS,
        ModelToolAction::SelectObjects => PARAM_NAMES,
        ModelToolAction::RenameObject => PARAM_RENAME,
        ModelToolAction::OrganizeHierarchy => PARAM_ORGANIZE_HIERARCHY,
        ModelToolAction::TranslateObjects => PARAM_TRANSLATE,
        ModelToolAction::RotateObjects => PARAM_ROTATE,
        ModelToolAction::ScaleObjects => PARAM_SCALE,
        ModelToolAction::AlignOrigin => PARAM_SELECTED_ONLY_TRUE,
        ModelToolAction::NormalizeScale => PARAM_NORMALIZE_SCALE,
        ModelToolAction::NormalizeAxis => PARAM_SELECTED_ONLY_TRUE,
        ModelToolAction::AddCube => PARAM_ADD_CUBE,
        ModelToolAction::Solidify => PARAM_SOLIDIFY,
        ModelToolAction::Bevel => PARAM_BEVEL,
        ModelToolAction::Mirror => PARAM_MIRROR,
        ModelToolAction::Array => PARAM_ARRAY,
        ModelToolAction::Boolean => PARAM_BOOLEAN,
        ModelToolAction::AutoSmooth => PARAM_AUTO_SMOOTH,
        ModelToolAction::WeightedNormal => PARAM_SELECTED_ONLY_TRUE,
        ModelToolAction::Decimate => PARAM_DECIMATE,
        ModelToolAction::InspectMeshTopology => PARAM_INSPECT_TOPOLOGY,
        ModelToolAction::TidyMaterialSlots => PARAM_TIDY_MATERIAL_SLOTS,
        ModelToolAction::CheckTexturePaths => PARAM_CHECK_TEXTURE_PATHS,
        ModelToolAction::ApplyTextureImage => PARAM_APPLY_TEXTURE,
        ModelToolAction::NewFile => PARAM_NEW_FILE,
        ModelToolAction::OpenFile => PARAM_OPEN_FILE,
        ModelToolAction::SaveFile => PARAM_SAVE_FILE,
    }
}

/// 描述：返回动作错误码契约，覆盖参数校验错误与桥接层动作失败错误。
pub fn model_tool_action_error_codes(action: ModelToolAction) -> &'static [&'static str] {
    match action {
        ModelToolAction::TranslateObjects => ERR_TRANSLATE,
        ModelToolAction::RotateObjects => ERR_ROTATE,
        ModelToolAction::ScaleObjects => ERR_SCALE,
        ModelToolAction::OrganizeHierarchy => ERR_ORGANIZE_HIERARCHY,
        ModelToolAction::AddCube => ERR_ADD_CUBE,
        ModelToolAction::Solidify => ERR_SOLIDIFY,
        ModelToolAction::Bevel => ERR_BEVEL,
        ModelToolAction::Mirror => ERR_MIRROR,
        ModelToolAction::Array => ERR_ARRAY,
        ModelToolAction::Boolean => ERR_BOOLEAN,
        ModelToolAction::Decimate => ERR_DECIMATE,
        ModelToolAction::InspectMeshTopology => ERR_INSPECT,
        ModelToolAction::OpenFile => ERR_OPEN_FILE,
        ModelToolAction::ApplyTextureImage => ERR_APPLY_TEXTURE,
        ModelToolAction::SaveFile => ERR_SAVE_FILE,
        ModelToolAction::GetSelectionContext
        | ModelToolAction::ListObjects
        | ModelToolAction::SelectObjects
        | ModelToolAction::RenameObject
        | ModelToolAction::AlignOrigin
        | ModelToolAction::NormalizeScale
        | ModelToolAction::NormalizeAxis
        | ModelToolAction::AutoSmooth
        | ModelToolAction::WeightedNormal
        | ModelToolAction::TidyMaterialSlots
        | ModelToolAction::CheckTexturePaths
        | ModelToolAction::PackTextures
        | ModelToolAction::NewFile
        | ModelToolAction::Undo
        | ModelToolAction::Redo => ERR_ACTION_FAILED,
    }
}

/// 描述：返回单个动作的完整契约，用于统一边界判断与文档输出。
pub fn model_tool_action_contract(action: ModelToolAction) -> ModelToolActionContract {
    ModelToolActionContract {
        action,
        capability: model_tool_action_capability(action),
        risk_level: model_tool_action_default_risk(action),
        summary: model_tool_action_summary(action),
        params: model_tool_action_params(action),
        error_codes: model_tool_action_error_codes(action),
    }
}

/// 描述：返回动作契约列表，供文档渲染与测试断言使用。
pub fn model_tool_action_contracts() -> Vec<ModelToolActionContract> {
    all_model_tool_actions()
        .iter()
        .copied()
        .map(model_tool_action_contract)
        .collect()
}
