# ModelToolAction 能力边界与参数契约

## 1. 目的

- 本文用于统一 `ModelToolAction` 的能力边界、输入契约、默认值、错误码与风险等级。
- 代码单一来源位于 `crates/core/mcp/model/src/action_contract.rs`。
- 规划层能力开关校验（`check_capability_for_session_step`）直接复用该契约映射。

## 2. 能力边界

- `scene`：`list_objects`、`get_selection_context`、`select_objects`、`rename_object`、`organize_hierarchy`
- `transform`：`translate_objects`、`rotate_objects`、`scale_objects`、`align_origin`、`normalize_scale`、`normalize_axis`
- `geometry`：`add_cube`、`solidify`、`bevel`、`mirror`、`array`、`boolean`
- `mesh_opt`：`auto_smooth`、`weighted_normal`、`decimate`、`inspect_mesh_topology`
- `material`：`tidy_material_slots`、`check_texture_paths`、`apply_texture_image`、`pack_textures`
- `file`：`new_file`、`open_file`、`save_file`、`undo`、`redo`

## 3. 契约总览

| action | capability | 风险等级 | 输入与默认值（摘要） | 主要错误码 |
| --- | --- | --- | --- | --- |
| `list_objects` | `scene` | `low` | 无 | `mcp.model.bridge.action_failed` |
| `get_selection_context` | `scene` | `low` | 无 | `mcp.model.bridge.action_failed` |
| `select_objects` | `scene` | `low` | `names`(必填, string[]) | `mcp.model.bridge.action_failed` |
| `rename_object` | `scene` | `low` | `old_name`(必填), `new_name`(必填) | `mcp.model.bridge.action_failed` |
| `organize_hierarchy` | `scene` | `low` | `mode`(默认 `object_parent`)；`object_parent` 需 `child`；`collection_move` 需 `collection` 并可选 `parent_collection`；`collection_rename` 需 `collection`+`new_name`；`collection_reorder` 需 `collection` 并可选 `position=first/last` | `mcp.model.tool.organize_hierarchy_invalid_mode`<br/>`mcp.model.tool.organize_hierarchy_missing_child`<br/>`mcp.model.tool.organize_hierarchy_missing_collection`<br/>`mcp.model.tool.organize_hierarchy_missing_new_name`<br/>`mcp.model.tool.organize_hierarchy_invalid_position`<br/>`mcp.model.tool.organize_hierarchy_invalid_parent`<br/>`mcp.model.bridge.action_failed` |
| `translate_objects` | `transform` | `low` | `delta`(必填, number[3])；`selection_scope`(默认 `selected`)；`target_names`(可选) | `mcp.model.tool.translate_delta.missing`<br/>`mcp.model.tool.translate_delta.invalid`<br/>`mcp.model.tool.translate_delta.out_of_range`<br/>`mcp.model.tool.invalid_selection_scope`<br/>`mcp.model.tool.target_names_invalid`<br/>`mcp.model.tool.target_names_empty` |
| `rotate_objects` | `transform` | `low` | `delta_euler`(必填, number[3])；`selection_scope`(默认 `selected`)；`target_names`(可选) | `mcp.model.tool.rotate_delta_euler.missing`<br/>`mcp.model.tool.rotate_delta_euler.invalid`<br/>`mcp.model.tool.rotate_delta_euler.out_of_range`<br/>`mcp.model.tool.invalid_selection_scope`<br/>`mcp.model.tool.target_names_invalid`<br/>`mcp.model.tool.target_names_empty` |
| `scale_objects` | `transform` | `low` | `factor`(必填, number 或 number[3])；`selection_scope`(默认 `selected`)；`target_names`(可选) | `mcp.model.tool.scale_factor_missing`<br/>`mcp.model.tool.scale_factor_invalid`<br/>`mcp.model.tool.scale_factor_out_of_range`<br/>`mcp.model.tool.invalid_selection_scope`<br/>`mcp.model.tool.target_names_invalid`<br/>`mcp.model.tool.target_names_empty` |
| `align_origin` | `transform` | `medium` | `selected_only`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `normalize_scale` | `transform` | `medium` | `selected_only`(默认 `true`)；`apply`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `normalize_axis` | `transform` | `medium` | `selected_only`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `add_cube` | `geometry` | `low` | `size`(默认 `2.0`)；`location`(默认 `[0,0,0]`)；`name`(可选) | `mcp.model.tool.add_cube_size_out_of_range`<br/>`mcp.model.bridge.action_failed` |
| `solidify` | `geometry` | `medium` | `thickness`(默认 `0.02`)；`object`(可选，默认 active/selected) | `mcp.model.tool.solidify_thickness_out_of_range`<br/>`mcp.model.bridge.action_failed` |
| `bevel` | `geometry` | `medium` | `width`(默认 `0.02`)；`segments`(默认 `2`)；`object`(可选) | `mcp.model.tool.bevel_width_out_of_range`<br/>`mcp.model.tool.bevel_segments_out_of_range`<br/>`mcp.model.bridge.action_failed` |
| `mirror` | `geometry` | `medium` | `axis`(默认 `X`)；`object`(可选) | `mcp.model.tool.mirror_axis_invalid`<br/>`mcp.model.bridge.action_failed` |
| `array` | `geometry` | `medium` | `count`(默认 `2`)；`offset`(默认 `1.0`)；`object`(可选) | `mcp.model.tool.array_count_out_of_range`<br/>`mcp.model.tool.array_offset_out_of_range`<br/>`mcp.model.bridge.action_failed` |
| `boolean` | `geometry` | `high` | `target` 或 `targets`(至少其一)；`operation`(默认 `DIFFERENCE`)；`times`(默认 `1`)；`order`(默认 `as_provided`)；`rollback_on_error`(默认 `true`)；`object`(可选) | `mcp.model.tool.boolean_times_out_of_range`<br/>`mcp.model.tool.boolean_missing_target`<br/>`mcp.model.tool.boolean_invalid_target`<br/>`mcp.model.tool.boolean_invalid_targets`<br/>`mcp.model.tool.boolean_invalid_order`<br/>`mcp.model.tool.boolean_invalid_rollback`<br/>`mcp.model.bridge.action_failed` |
| `auto_smooth` | `mesh_opt` | `low` | `angle`(默认 `0.5235987756`)；`selected_only`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `weighted_normal` | `mesh_opt` | `low` | `selected_only`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `decimate` | `mesh_opt` | `medium` | `ratio`(默认 `0.5`)；`object`(可选) | `mcp.model.tool.decimate_ratio_out_of_range`<br/>`mcp.model.bridge.action_failed` |
| `inspect_mesh_topology` | `mesh_opt` | `low` | `selected_only`(默认 `true`)；`strict`(默认 `false`)；`baseline_face_counts`(默认 `{}`) | `mcp.model.tool.inspect_topology_invalid_selected_only`<br/>`mcp.model.tool.inspect_topology_invalid_strict`<br/>`mcp.model.tool.inspect_topology_invalid_baseline`<br/>`mcp.model.bridge.action_failed` |
| `tidy_material_slots` | `material` | `low` | `selected_only`(默认 `false`) | `mcp.model.bridge.action_failed` |
| `check_texture_paths` | `material` | `low` | `repair_relative`(默认 `false`)；`base_dir`(可选) | `mcp.model.bridge.action_failed` |
| `apply_texture_image` | `material` | `low` | `path/base_color_path/normal_path/roughness_path/metallic_path` 至少其一；`object`(可选)；`objects`(可选) | `mcp.model.tool.apply_texture_missing_path`<br/>`mcp.model.tool.apply_texture_invalid_path`<br/>`mcp.model.tool.apply_texture_invalid_object`<br/>`mcp.model.tool.apply_texture_invalid_objects`<br/>`mcp.model.bridge.action_failed` |
| `pack_textures` | `material` | `low` | 无 | `mcp.model.bridge.action_failed` |
| `new_file` | `file` | `high` | `use_empty`(默认 `true`) | `mcp.model.bridge.action_failed` |
| `open_file` | `file` | `high` | `path`(必填) | `mcp.model.tool.open_file_missing_path`<br/>`mcp.model.bridge.action_failed` |
| `save_file` | `file` | `medium` | `path`(可选，默认当前文件路径) | `mcp.model.tool.save_file_invalid_path`<br/>`mcp.model.bridge.action_failed` |
| `undo` | `file` | `low` | 无 | `mcp.model.bridge.action_failed` |
| `redo` | `file` | `low` | 无 | `mcp.model.bridge.action_failed` |

## 4. 说明

- 风险等级用于规划层默认风险判断，不等同于最终执行风险；最终风险仍由具体步骤上下文决定。
- 错误码分为两层：本地参数校验错误（`mcp.model.tool.*`）和桥接执行错误（统一为 `mcp.model.bridge.action_failed`，其 message 中包含桥接侧细分 code）。
