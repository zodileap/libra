bl_info = {
    "name": "Zodileap MCP Bridge",
    "author": "libra",
    "version": (0, 2, 0),
    "blender": (3, 0, 0),
    "location": "View3D",
    "description": "Expose current Blender session for Zodileap desktop MCP calls",
    "category": "System",
}

import bpy
import bmesh
import json
import os
import queue
import socketserver
import threading
import traceback

HOST = "127.0.0.1"
PORT = 23331

_TASK_QUEUE = queue.Queue()


class BridgeError(RuntimeError):
    def __init__(self, code, message, suggestion=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.suggestion = suggestion


def _find_object(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise BridgeError(
            "object_not_found",
            f"object `{name}` not found",
            "请先在场景中确认对象名称是否正确",
        )
    return obj


def _find_collection(name):
    collection = bpy.data.collections.get(name)
    if collection is None:
        raise BridgeError(
            "collection_not_found",
            f"collection `{name}` not found",
            "请先在场景中确认集合名称是否正确",
        )
    return collection


def _iter_collection_containers():
    seen = set()
    for scene in bpy.data.scenes:
        root = getattr(scene, "collection", None)
        if root is None:
            continue
        pointer = int(root.as_pointer())
        if pointer in seen:
            continue
        seen.add(pointer)
        yield root
    for collection in bpy.data.collections:
        pointer = int(collection.as_pointer())
        if pointer in seen:
            continue
        seen.add(pointer)
        yield collection


def _find_collection_parents(collection):
    parents = []
    for container in _iter_collection_containers():
        if any(child.name == collection.name for child in container.children):
            parents.append(container)
    return parents


def _is_scene_root_collection(collection):
    return any(scene.collection.name == collection.name for scene in bpy.data.scenes)


def _collection_has_descendant(root, candidate):
    for child in root.children:
        if child.name == candidate.name:
            return True
        if _collection_has_descendant(child, candidate):
            return True
    return False


def _default_scene_root_collection():
    scene = getattr(bpy.context, "scene", None)
    if scene and getattr(scene, "collection", None):
        return scene.collection
    if bpy.data.scenes:
        return bpy.data.scenes[0].collection
    return None


def _editable_objects(selected_only=False):
    objects = bpy.context.selected_objects if selected_only else bpy.data.objects
    return [obj for obj in objects if obj.type == "MESH"]


def _parse_target_names(payload):
    if not isinstance(payload, dict):
        return []
    raw_names = payload.get("target_names")
    if raw_names is None:
        return []
    if not isinstance(raw_names, (list, tuple)):
        raise BridgeError(
            "invalid_args",
            "target_names must be a non-empty string array",
        )
    names = []
    for item in raw_names:
        name = str(item or "").strip()
        if name:
            names.append(name)
    if not names:
        raise BridgeError(
            "invalid_args",
            "target_names must be a non-empty string array",
        )
    return names


def _resolve_transform_targets(payload):
    if not isinstance(payload, dict):
        payload = {}

    if "selection_scope" in payload:
        scope = str(payload.get("selection_scope") or "selected").strip().lower()
    else:
        selected_only = bool(payload.get("selected_only", True))
        scope = "selected" if selected_only else "all"

    if scope == "active":
        active = bpy.context.view_layer.objects.active
        if active and active.type == "MESH":
            targets = [active]
        else:
            selected = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
            if selected:
                targets = [selected[0]]
            else:
                raise BridgeError(
                    "no_target_object",
                    "no active mesh object found for selection_scope=active",
                    "请先在 Blender 中激活一个可编辑对象",
                )
    elif scope == "selected":
        targets = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
        if not targets:
            raise BridgeError(
                "no_target_object",
                "no selected mesh objects found for selection_scope=selected",
                "请先在 Blender 中选中需要操作的对象",
            )
    elif scope == "all":
        targets = [obj for obj in bpy.data.objects if obj.type == "MESH"]
        if not targets:
            raise BridgeError("no_target_object", "no mesh objects found in current scene")
    else:
        raise BridgeError(
            "invalid_args",
            f"invalid selection_scope `{scope}`, expected active/selected/all",
        )

    target_names = _parse_target_names(payload)
    if not target_names:
        return targets, scope

    target_set = set(target_names)
    filtered = [obj for obj in targets if obj.name in target_set]
    if filtered:
        return filtered, scope
    raise BridgeError(
        "no_target_object",
        f"none of target_names matched under selection_scope={scope}",
        "请确认 target_names 中的对象名称，并检查选择范围是否正确",
    )


def _set_object_mode():
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode="OBJECT")


def _active_or_selected_name(payload):
    name = payload.get("object") if isinstance(payload, dict) else None
    if name:
        return name
    selected = bpy.context.selected_objects
    if selected:
        return selected[0].name
    active = bpy.context.view_layer.objects.active
    if active:
        return active.name
    raise BridgeError("no_target_object", "no active or selected object")


def _list_objects(_payload):
    active = bpy.context.view_layer.objects.active
    active_name = active.name if active else None
    data = []
    for obj in bpy.data.objects:
        data.append(
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "selected": bool(obj.select_get()),
                "active": bool(active_name and obj.name == active_name),
            }
        )
    return {
        "ok": True,
        "message": f"listed {len(data)} objects",
        "data": {"objects": data},
    }


def _get_selection_context(_payload):
    active = bpy.context.view_layer.objects.active
    active_mesh_name = active.name if active and active.type == "MESH" else None
    selected_mesh_names = [obj.name for obj in bpy.context.selected_objects if obj.type == "MESH"]
    return {
        "ok": True,
        "message": f"selection ready: active={active_mesh_name or 'none'}, selected={len(selected_mesh_names)}",
        "data": {
            "active_object": active_mesh_name,
            "selected_objects": selected_mesh_names,
            "selected_count": len(selected_mesh_names),
        },
    }


def _select_objects(payload):
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list) or len(names) == 0:
        raise BridgeError("invalid_args", "select_objects requires non-empty `names` list")

    _set_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for name in names:
        obj = _find_object(str(name))
        obj.select_set(True)
        selected.append(obj.name)

    bpy.context.view_layer.objects.active = bpy.data.objects.get(selected[0])
    return {
        "ok": True,
        "message": f"selected {len(selected)} object(s)",
        "data": {"selected": selected},
    }


def _rename_object(payload):
    old_name = str(payload.get("old_name") or "").strip()
    new_name = str(payload.get("new_name") or "").strip()
    if not old_name or not new_name:
        raise BridgeError("invalid_args", "rename_object requires old_name and new_name")
    obj = _find_object(old_name)
    obj.name = new_name
    return {
        "ok": True,
        "message": f"renamed object `{old_name}` -> `{new_name}`",
        "data": {"old_name": old_name, "new_name": obj.name},
    }


def _organize_hierarchy(payload):
    if not isinstance(payload, dict):
        payload = {}

    mode = str(payload.get("mode") or "object_parent").strip().lower()
    if mode == "object_parent":
        child_name = str(payload.get("child") or "").strip()
        parent_name = payload.get("parent")
        if not child_name:
            raise BridgeError("invalid_args", "organize_hierarchy requires `child`")

        child = _find_object(child_name)
        if parent_name is None or str(parent_name).strip() == "":
            child.parent = None
            parent_label = None
        else:
            parent = _find_object(str(parent_name))
            child.parent = parent
            parent_label = parent.name

        return {
            "ok": True,
            "message": "hierarchy updated",
            "data": {
                "mode": "object_parent",
                "child": child.name,
                "parent": parent_label,
            },
        }

    if mode == "collection_rename":
        collection_name = str(payload.get("collection") or payload.get("child") or "").strip()
        new_name = str(payload.get("new_name") or "").strip()
        if not collection_name or not new_name:
            raise BridgeError(
                "invalid_args",
                "collection_rename requires non-empty `collection` and `new_name`",
            )
        collection = _find_collection(collection_name)
        if _is_scene_root_collection(collection):
            raise BridgeError(
                "invalid_target",
                "scene root collection cannot be renamed",
            )
        old_name = collection.name
        collection.name = new_name
        return {
            "ok": True,
            "message": f"collection renamed `{old_name}` -> `{collection.name}`",
            "data": {
                "mode": "collection_rename",
                "collection": old_name,
                "new_name": collection.name,
            },
        }

    if mode == "collection_move":
        collection_name = str(payload.get("collection") or payload.get("child") or "").strip()
        parent_name = str(
            payload.get("parent_collection")
            if payload.get("parent_collection") is not None
            else payload.get("parent") or ""
        ).strip()
        if not collection_name:
            raise BridgeError(
                "invalid_args",
                "collection_move requires non-empty `collection`",
            )

        collection = _find_collection(collection_name)
        if _is_scene_root_collection(collection):
            raise BridgeError(
                "invalid_target",
                "scene root collection cannot be moved",
            )

        if parent_name:
            new_parent = _find_collection(parent_name)
            if new_parent.name == collection.name:
                raise BridgeError("invalid_args", "collection cannot be parent of itself")
            if _collection_has_descendant(collection, new_parent):
                raise BridgeError(
                    "invalid_args",
                    "collection cannot be moved under its descendant",
                )
        else:
            new_parent = _default_scene_root_collection()
            if new_parent is None:
                raise BridgeError("scene_unavailable", "no scene root collection available")

        old_parents = _find_collection_parents(collection)
        for old_parent in old_parents:
            old_parent.children.unlink(collection)
        new_parent.children.link(collection)

        return {
            "ok": True,
            "message": f"collection moved `{collection.name}` -> `{new_parent.name}`",
            "data": {
                "mode": "collection_move",
                "collection": collection.name,
                "old_parents": [parent.name for parent in old_parents],
                "new_parent": new_parent.name,
            },
        }

    if mode == "collection_reorder":
        collection_name = str(payload.get("collection") or payload.get("child") or "").strip()
        parent_name = str(payload.get("parent_collection") or "").strip()
        position = str(payload.get("position") or "last").strip().lower()
        if not collection_name:
            raise BridgeError(
                "invalid_args",
                "collection_reorder requires non-empty `collection`",
            )
        if position not in {"first", "last"}:
            raise BridgeError(
                "invalid_args",
                "collection_reorder `position` must be first/last",
            )

        collection = _find_collection(collection_name)
        if parent_name:
            parent_container = _find_collection(parent_name)
        else:
            parents = _find_collection_parents(collection)
            parent_container = parents[0] if parents else _default_scene_root_collection()
        if parent_container is None:
            raise BridgeError("scene_unavailable", "no parent collection available for reorder")

        children = list(parent_container.children)
        if not any(child.name == collection.name for child in children):
            raise BridgeError(
                "invalid_args",
                f"collection `{collection.name}` is not child of `{parent_container.name}`",
            )
        others = [child for child in children if child.name != collection.name]
        ordered = [collection] + others if position == "first" else others + [collection]
        for child in children:
            parent_container.children.unlink(child)
        for child in ordered:
            parent_container.children.link(child)

        return {
            "ok": True,
            "message": f"collection reordered `{collection.name}` to {position} in `{parent_container.name}`",
            "data": {
                "mode": "collection_reorder",
                "collection": collection.name,
                "parent_collection": parent_container.name,
                "position": position,
                "order": [child.name for child in ordered],
            },
        }

    raise BridgeError(
        "invalid_args",
        "organize_hierarchy `mode` must be object_parent/collection_move/collection_rename/collection_reorder",
    )


def _align_origin(payload):
    selected_only = bool(payload.get("selected_only", True)) if isinstance(payload, dict) else True
    objs = _editable_objects(selected_only=selected_only)
    for obj in objs:
        obj.location = (0.0, 0.0, 0.0)
    return {
        "ok": True,
        "message": f"aligned {len(objs)} object(s) to origin",
        "data": {"count": len(objs)},
    }


def _translate_objects(payload):
    raw_delta = payload.get("delta", [0.0, 0.0, 0.0]) if isinstance(payload, dict) else [0.0, 0.0, 0.0]
    if not isinstance(raw_delta, (list, tuple)) or len(raw_delta) != 3:
        raise BridgeError("invalid_args", "translate_objects requires `delta` with 3 numbers")
    dx, dy, dz = float(raw_delta[0]), float(raw_delta[1]), float(raw_delta[2])

    objs, scope = _resolve_transform_targets(payload)

    for obj in objs:
        obj.location = (
            float(obj.location.x + dx),
            float(obj.location.y + dy),
            float(obj.location.z + dz),
        )

    return {
        "ok": True,
        "message": f"translated {len(objs)} object(s)",
        "data": {
            "count": len(objs),
            "objects": [obj.name for obj in objs],
            "delta": [dx, dy, dz],
            "selection_scope": scope,
        },
    }


def _rotate_objects(payload):
    raw_delta = payload.get("delta_euler", [0.0, 0.0, 0.0]) if isinstance(payload, dict) else [0.0, 0.0, 0.0]
    if not isinstance(raw_delta, (list, tuple)) or len(raw_delta) != 3:
        raise BridgeError("invalid_args", "rotate_objects requires `delta_euler` with 3 numbers")
    dx, dy, dz = float(raw_delta[0]), float(raw_delta[1]), float(raw_delta[2])

    objs, scope = _resolve_transform_targets(payload)
    for obj in objs:
        obj.rotation_euler.x += dx
        obj.rotation_euler.y += dy
        obj.rotation_euler.z += dz

    return {
        "ok": True,
        "message": f"rotated {len(objs)} object(s)",
        "data": {
            "count": len(objs),
            "objects": [obj.name for obj in objs],
            "delta_euler": [dx, dy, dz],
            "selection_scope": scope,
        },
    }


def _scale_objects(payload):
    if not isinstance(payload, dict):
        payload = {}
    factor = payload.get("factor", 1.0)
    if isinstance(factor, (int, float)):
        sx = sy = sz = float(factor)
    elif isinstance(factor, (list, tuple)) and len(factor) == 3:
        sx, sy, sz = float(factor[0]), float(factor[1]), float(factor[2])
    else:
        raise BridgeError("invalid_args", "scale_objects requires numeric `factor` or [x,y,z]")

    objs, scope = _resolve_transform_targets(payload)
    for obj in objs:
        obj.scale = (
            float(obj.scale.x * sx),
            float(obj.scale.y * sy),
            float(obj.scale.z * sz),
        )

    return {
        "ok": True,
        "message": f"scaled {len(objs)} object(s)",
        "data": {
            "count": len(objs),
            "objects": [obj.name for obj in objs],
            "factor": [sx, sy, sz],
            "selection_scope": scope,
        },
    }


def _normalize_scale(payload):
    selected_only = bool(payload.get("selected_only", True)) if isinstance(payload, dict) else True
    apply_scale = bool(payload.get("apply", True)) if isinstance(payload, dict) else True
    _set_object_mode()
    objs = _editable_objects(selected_only=selected_only)

    if apply_scale:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        if objs:
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    return {
        "ok": True,
        "message": f"normalized scale for {len(objs)} object(s)",
        "data": {"count": len(objs), "applied": apply_scale},
    }


def _normalize_axis(payload):
    selected_only = bool(payload.get("selected_only", True)) if isinstance(payload, dict) else True
    _set_object_mode()
    objs = _editable_objects(selected_only=selected_only)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    return {
        "ok": True,
        "message": f"normalized axis for {len(objs)} object(s)",
        "data": {"count": len(objs)},
    }


def _solidify(payload):
    thickness = float(payload.get("thickness", 0.02))
    obj = _find_object(_active_or_selected_name(payload))
    mod = obj.modifiers.new(name="ZL_Solidify", type="SOLIDIFY")
    mod.thickness = thickness
    return {
        "ok": True,
        "message": f"solidify applied to `{obj.name}`",
        "data": {"object": obj.name, "thickness": thickness},
    }


def _add_cube(payload):
    size = float(payload.get("size", 2.0))
    location = payload.get("location", [0.0, 0.0, 0.0])
    if not isinstance(location, (list, tuple)) or len(location) != 3:
        location = [0.0, 0.0, 0.0]
    x, y, z = float(location[0]), float(location[1]), float(location[2])
    name = str(payload.get("name") or "").strip()

    _set_object_mode()
    bpy.ops.mesh.primitive_cube_add(size=size, location=(x, y, z))
    obj = bpy.context.active_object
    if obj and name:
        obj.name = name

    return {
        "ok": True,
        "message": f"cube created `{obj.name if obj else 'Cube'}`",
        "data": {
            "name": obj.name if obj else "Cube",
            "size": size,
            "location": [x, y, z],
        },
    }


def _bevel(payload):
    width = float(payload.get("width", 0.02))
    segments = int(payload.get("segments", 2))
    obj = _find_object(_active_or_selected_name(payload))
    mod = obj.modifiers.new(name="ZL_Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    return {
        "ok": True,
        "message": f"bevel applied to `{obj.name}`",
        "data": {"object": obj.name, "width": width, "segments": segments},
    }


def _mirror(payload):
    axis = str(payload.get("axis", "X")).upper()
    if axis not in {"X", "Y", "Z"}:
        raise BridgeError("invalid_args", "mirror axis must be X/Y/Z")

    obj = _find_object(_active_or_selected_name(payload))
    mod = obj.modifiers.new(name="ZL_Mirror", type="MIRROR")
    mod.use_axis[0] = axis == "X"
    mod.use_axis[1] = axis == "Y"
    mod.use_axis[2] = axis == "Z"
    return {
        "ok": True,
        "message": f"mirror applied to `{obj.name}`",
        "data": {"object": obj.name, "axis": axis},
    }


def _array(payload):
    count = int(payload.get("count", 2))
    offset = float(payload.get("offset", 1.0))
    obj = _find_object(_active_or_selected_name(payload))
    mod = obj.modifiers.new(name="ZL_Array", type="ARRAY")
    mod.count = count
    mod.relative_offset_displace = (offset, 0.0, 0.0)
    return {
        "ok": True,
        "message": f"array applied to `{obj.name}`",
        "data": {"object": obj.name, "count": count, "offset": offset},
    }


def _boolean(payload):
    if not isinstance(payload, dict):
        payload = {}

    obj_name = _active_or_selected_name(payload)
    target_name = str(payload.get("target") or "").strip()
    raw_targets = payload.get("targets")
    operation = str(payload.get("operation") or "DIFFERENCE").upper()
    order = str(payload.get("order") or "as_provided").strip().lower()
    rollback_on_error = bool(payload.get("rollback_on_error", True))

    if operation not in {"UNION", "DIFFERENCE", "INTERSECT"}:
        raise BridgeError("invalid_args", "boolean operation must be UNION/DIFFERENCE/INTERSECT")
    if order not in {"as_provided", "reverse"}:
        raise BridgeError("invalid_args", "boolean `order` must be as_provided/reverse")

    target_names = []
    if raw_targets is not None:
        if not isinstance(raw_targets, (list, tuple)):
            raise BridgeError("invalid_args", "boolean `targets` must be a non-empty string array")
        for item in raw_targets:
            name = str(item or "").strip()
            if not name:
                raise BridgeError("invalid_args", "boolean `targets` must be a non-empty string array")
            target_names.append(name)
    elif target_name:
        target_names.append(target_name)
    else:
        raise BridgeError("invalid_args", "boolean requires `target` or non-empty `targets`")

    deduped_targets = []
    seen_targets = set()
    for name in target_names:
        if name in seen_targets:
            continue
        seen_targets.add(name)
        deduped_targets.append(name)

    if order == "reverse":
        deduped_targets.reverse()

    obj = _find_object(obj_name)
    created_modifiers = []
    applied_targets = []

    try:
        for index, current_target_name in enumerate(deduped_targets):
            target = _find_object(current_target_name)
            mod = obj.modifiers.new(name=f"ZL_Boolean_{index + 1}", type="BOOLEAN")
            mod.operation = operation
            mod.object = target
            created_modifiers.append(mod.name)
            applied_targets.append(target.name)
    except BridgeError:
        if rollback_on_error:
            for modifier_name in reversed(created_modifiers):
                modifier = obj.modifiers.get(modifier_name)
                if modifier is not None:
                    obj.modifiers.remove(modifier)
        raise

    return {
        "ok": True,
        "message": f"boolean `{operation}` applied: {obj.name} <- {len(applied_targets)} target(s)",
        "data": {
            "object": obj.name,
            "target": applied_targets[0] if len(applied_targets) == 1 else None,
            "targets": applied_targets,
            "count": len(applied_targets),
            "operation": operation,
            "order": order,
            "rollback_on_error": rollback_on_error,
        },
    }


def _auto_smooth(payload):
    angle = float(payload.get("angle", 0.5235987756))
    selected_only = bool(payload.get("selected_only", True))
    objs = _editable_objects(selected_only=selected_only)
    for obj in objs:
        if obj.data and hasattr(obj.data, "use_auto_smooth"):
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = angle
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return {
        "ok": True,
        "message": f"auto smooth applied to {len(objs)} object(s)",
        "data": {"count": len(objs), "angle": angle},
    }


def _weighted_normal(payload):
    selected_only = bool(payload.get("selected_only", True))
    objs = _editable_objects(selected_only=selected_only)
    for obj in objs:
        exists = next((m for m in obj.modifiers if m.type == "WEIGHTED_NORMAL"), None)
        if exists is None:
            obj.modifiers.new(name="ZL_WeightedNormal", type="WEIGHTED_NORMAL")
    return {
        "ok": True,
        "message": f"weighted normal ensured for {len(objs)} object(s)",
        "data": {"count": len(objs)},
    }


def _decimate(payload):
    ratio = float(payload.get("ratio", 0.5))
    obj = _find_object(_active_or_selected_name(payload))
    mod = obj.modifiers.new(name="ZL_Decimate", type="DECIMATE")
    mod.ratio = ratio
    return {
        "ok": True,
        "message": f"decimate applied to `{obj.name}`",
        "data": {"object": obj.name, "ratio": ratio},
    }


def _tidy_material_slots(payload):
    selected_only = bool(payload.get("selected_only", False))
    objs = _editable_objects(selected_only=selected_only)
    removed = 0
    for obj in objs:
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        for idx in reversed(range(len(obj.material_slots))):
            if obj.material_slots[idx].material is None:
                obj.active_material_index = idx
                bpy.ops.object.material_slot_remove()
                removed += 1
    return {
        "ok": True,
        "message": f"tidied material slots, removed {removed}",
        "data": {"removed": removed, "objects": len(objs)},
    }


def _parse_baseline_face_counts(payload):
    if not isinstance(payload, dict):
        return {}
    raw = payload.get("baseline_face_counts")
    if not isinstance(raw, dict):
        return {}
    baseline = {}
    for name, count in raw.items():
        key = str(name or "").strip()
        if not key:
            continue
        try:
            baseline[key] = int(count)
        except (TypeError, ValueError):
            continue
    return baseline


def _inspect_mesh_topology(payload):
    if not isinstance(payload, dict):
        payload = {}
    selected_only = bool(payload.get("selected_only", True))
    strict = bool(payload.get("strict", False))
    scope = "selected" if selected_only else "all"

    objs = _editable_objects(selected_only=selected_only)
    if not objs:
        if strict:
            raise BridgeError(
                "no_target_object",
                f"no mesh objects found for selection_scope={scope}",
                "请先在 Blender 中选中待检查对象，或关闭 strict 模式",
            )
        objs = _editable_objects(selected_only=False)
        scope = "all_fallback"

    baseline = _parse_baseline_face_counts(payload)
    details = []
    face_counts = {}
    issue_count = 0
    total_non_manifold_edges = 0
    total_zero_normal_faces = 0

    for obj in objs:
        mesh = obj.data
        face_count = int(len(mesh.polygons))
        edge_count = int(len(mesh.edges))
        vertex_count = int(len(mesh.vertices))
        zero_normal_faces = sum(
            1 for poly in mesh.polygons if float(getattr(poly.normal, "length", 1.0)) < 1e-8
        )

        bm = bmesh.new()
        bm.from_mesh(mesh)
        non_manifold_edges = sum(1 for edge in bm.edges if not edge.is_manifold)
        bm.free()

        baseline_face_count = baseline.get(obj.name)
        face_count_delta = (
            int(face_count - baseline_face_count)
            if baseline_face_count is not None
            else 0
        )
        has_issue = non_manifold_edges > 0 or zero_normal_faces > 0
        if has_issue:
            issue_count += 1
        total_non_manifold_edges += int(non_manifold_edges)
        total_zero_normal_faces += int(zero_normal_faces)

        details.append(
            {
                "object": obj.name,
                "face_count": face_count,
                "edge_count": edge_count,
                "vertex_count": vertex_count,
                "non_manifold_edges": int(non_manifold_edges),
                "zero_normal_faces": int(zero_normal_faces),
                "face_count_delta": face_count_delta,
                "has_issue": has_issue,
            }
        )
        face_counts[obj.name] = face_count

    return {
        "ok": True,
        "message": f"topology check finished: checked {len(details)}, issues {issue_count}",
        "data": {
            "selection_scope": scope,
            "checked_count": len(details),
            "issue_count": issue_count,
            "total_non_manifold_edges": total_non_manifold_edges,
            "total_zero_normal_faces": total_zero_normal_faces,
            "details": details,
            "face_counts": face_counts,
        },
    }


def _check_texture_paths(payload):
    if not isinstance(payload, dict):
        payload = {}
    repair_relative = bool(payload.get("repair_relative", False))
    requested_base_dir = str(payload.get("base_dir") or "").strip()
    search_dirs = []
    if requested_base_dir:
        search_dirs.append(os.path.abspath(requested_base_dir))
    if bpy.data.filepath:
        search_dirs.append(os.path.dirname(os.path.abspath(bpy.data.filepath)))
    if os.getcwd() not in search_dirs:
        search_dirs.append(os.getcwd())

    missing = []
    fixed = []
    for image in bpy.data.images:
        if not image.filepath:
            continue
        path = bpy.path.abspath(image.filepath)
        if os.path.exists(path):
            continue

        repaired = False
        repaired_path = None
        if repair_relative:
            basename = os.path.basename(path)
            for base_dir in search_dirs:
                candidate = os.path.join(base_dir, basename)
                if os.path.exists(candidate):
                    image.filepath = bpy.path.relpath(candidate) if bpy.data.filepath else candidate
                    repaired = True
                    repaired_path = candidate
                    fixed.append(
                        {
                            "image": image.name,
                            "from_path": path,
                            "to_path": repaired_path,
                        }
                    )
                    break
        if not repaired:
            missing.append({"image": image.name, "path": path})
    return {
        "ok": True,
        "message": f"texture check finished, missing {len(missing)}, fixed {len(fixed)}",
        "data": {
            "missing": missing,
            "missing_count": len(missing),
            "fixed": fixed,
            "fixed_count": len(fixed),
            "repair_relative": repair_relative,
            "search_dirs": search_dirs,
        },
    }


def _resolve_texture_channel_paths(payload):
    channel_keys = {
        "base_color": "base_color_path",
        "normal": "normal_path",
        "roughness": "roughness_path",
        "metallic": "metallic_path",
    }
    resolved = {}

    base_color_path = str(payload.get("base_color_path") or payload.get("path") or "").strip()
    if base_color_path:
        abs_path = os.path.abspath(base_color_path)
        if not os.path.exists(abs_path):
            raise BridgeError("file_not_found", f"file not found: {abs_path}")
        resolved["base_color"] = abs_path

    for channel, key in channel_keys.items():
        if channel == "base_color":
            continue
        raw_path = str(payload.get(key) or "").strip()
        if not raw_path:
            continue
        abs_path = os.path.abspath(raw_path)
        if not os.path.exists(abs_path):
            raise BridgeError("file_not_found", f"file not found: {abs_path}")
        resolved[channel] = abs_path

    if not resolved:
        raise BridgeError(
            "invalid_args",
            "apply_texture_image requires at least one of path/base_color_path/normal_path/roughness_path/metallic_path",
        )
    return resolved


def _ensure_image_texture_node(nodes, label, location):
    matched = [node for node in nodes if node.type == "TEX_IMAGE" and node.label == label]
    if matched:
        keep = matched[0]
        keep.location = location
        for extra in matched[1:]:
            nodes.remove(extra)
        return keep
    node = nodes.new(type="ShaderNodeTexImage")
    node.label = label
    node.name = label
    node.location = location
    return node


def _ensure_normal_map_node(nodes, label, location):
    matched = [
        node
        for node in nodes
        if node.type == "NORMAL_MAP" and (node.label == label or node.name == label)
    ]
    if matched:
        keep = matched[0]
        keep.label = label
        keep.name = label
        keep.location = location
        for extra in matched[1:]:
            nodes.remove(extra)
        return keep
    node = nodes.new(type="ShaderNodeNormalMap")
    node.label = label
    node.name = label
    node.location = location
    return node


def _replace_input_link(links, from_socket, to_socket):
    if from_socket is None or to_socket is None:
        return
    for link in list(to_socket.links):
        links.remove(link)
    links.new(from_socket, to_socket)


def _resolve_apply_texture_target_names(payload):
    raw_objects = payload.get("objects")
    if raw_objects is None:
        single = str(payload.get("object") or "").strip()
        if single:
            return [single]
        targets, _scope = _resolve_transform_targets(payload)
        return [obj.name for obj in targets]
    if not isinstance(raw_objects, (list, tuple)):
        raise BridgeError(
            "invalid_args",
            "apply_texture_image `objects` must be a non-empty string array",
        )
    names = []
    for item in raw_objects:
        name = str(item or "").strip()
        if name:
            names.append(name)
    if not names:
        raise BridgeError(
            "invalid_args",
            "apply_texture_image `objects` must be a non-empty string array",
        )
    deduped = []
    seen = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    return deduped


def _apply_texture_channels_to_object(obj, channel_paths):
    if obj.type != "MESH":
        raise BridgeError("invalid_target", f"object `{obj.name}` is not mesh")

    material = obj.active_material
    if material is None:
        material = bpy.data.materials.new(name=f"ZL_Auto_{obj.name}")
        if obj.data.materials:
            obj.data.materials[0] = material
        else:
            obj.data.materials.append(material)

    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links

    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        for node in nodes:
            if node.type == "BSDF_PRINCIPLED":
                bsdf = node
                break
    if bsdf is None:
        bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
        bsdf.location = (0, 0)

    output = nodes.get("Material Output")
    if output is None:
        for node in nodes:
            if node.type == "OUTPUT_MATERIAL":
                output = node
                break
    if output is None:
        output = nodes.new(type="ShaderNodeOutputMaterial")
        output.location = (300, 0)

    if bsdf.outputs.get("BSDF") and output.inputs.get("Surface"):
        _replace_input_link(links, bsdf.outputs.get("BSDF"), output.inputs.get("Surface"))

    applied_channels = []
    warnings = []

    def _collect_texture_warnings(channel, image, expected_colorspace):
        width = int(image.size[0]) if image.size else 0
        height = int(image.size[1]) if image.size else 0
        if width <= 0 or height <= 0:
            warnings.append(
                {
                    "object": obj.name,
                    "channel": channel,
                    "kind": "invalid_size",
                    "message": f"{channel} 贴图尺寸无效（{width}x{height}）",
                    "suggestion": "请检查源贴图是否损坏，或重新导出有效纹理。",
                }
            )
            return
        if width < 128 or height < 128:
            warnings.append(
                {
                    "object": obj.name,
                    "channel": channel,
                    "kind": "low_resolution",
                    "message": f"{channel} 贴图分辨率较低（{width}x{height}）",
                    "suggestion": "建议使用至少 512x512 的贴图，以避免近景模糊。",
                }
            )
        if width > 8192 or height > 8192:
            warnings.append(
                {
                    "object": obj.name,
                    "channel": channel,
                    "kind": "high_resolution",
                    "message": f"{channel} 贴图分辨率较高（{width}x{height}）",
                    "suggestion": "如性能受限，建议降采样到 2K 或 4K。",
                }
            )
        if expected_colorspace and image.colorspace_settings.name != expected_colorspace:
            warnings.append(
                {
                    "object": obj.name,
                    "channel": channel,
                    "kind": "colorspace_mismatch",
                    "message": f"{channel} 色彩空间为 {image.colorspace_settings.name}，预期 {expected_colorspace}",
                    "suggestion": "建议在贴图设置中修正为预期色彩空间。",
                }
            )

    if "base_color" in channel_paths:
        image = bpy.data.images.load(channel_paths["base_color"], check_existing=True)
        original_colorspace = image.colorspace_settings.name
        image.colorspace_settings.name = "sRGB"
        if original_colorspace != "sRGB":
            warnings.append(
                {
                    "object": obj.name,
                    "channel": "base_color",
                    "kind": "colorspace_adjusted",
                    "message": f"base_color 色彩空间已从 {original_colorspace} 自动调整为 sRGB",
                    "suggestion": "如需线性色彩流程，可手动确认贴图导入设置。",
                }
            )
        base_color_node = _ensure_image_texture_node(
            nodes, "ZL_BaseColorTexture", (-520, 180)
        )
        base_color_node.image = image
        _collect_texture_warnings("base_color", image, "sRGB")
        _replace_input_link(
            links,
            base_color_node.outputs.get("Color"),
            bsdf.inputs.get("Base Color"),
        )
        applied_channels.append("base_color")

    if "normal" in channel_paths:
        image = bpy.data.images.load(channel_paths["normal"], check_existing=True)
        original_colorspace = image.colorspace_settings.name
        image.colorspace_settings.name = "Non-Color"
        if original_colorspace != "Non-Color":
            warnings.append(
                {
                    "object": obj.name,
                    "channel": "normal",
                    "kind": "colorspace_adjusted",
                    "message": f"normal 色彩空间已从 {original_colorspace} 自动调整为 Non-Color",
                    "suggestion": "法线贴图建议始终使用 Non-Color。",
                }
            )
        normal_tex_node = _ensure_image_texture_node(
            nodes, "ZL_NormalTexture", (-520, -40)
        )
        normal_tex_node.image = image
        _collect_texture_warnings("normal", image, "Non-Color")
        normal_map_node = _ensure_normal_map_node(nodes, "ZL_NormalMap", (-240, -40))
        _replace_input_link(
            links,
            normal_tex_node.outputs.get("Color"),
            normal_map_node.inputs.get("Color"),
        )
        _replace_input_link(
            links,
            normal_map_node.outputs.get("Normal"),
            bsdf.inputs.get("Normal"),
        )
        applied_channels.append("normal")

    if "roughness" in channel_paths:
        image = bpy.data.images.load(channel_paths["roughness"], check_existing=True)
        original_colorspace = image.colorspace_settings.name
        image.colorspace_settings.name = "Non-Color"
        if original_colorspace != "Non-Color":
            warnings.append(
                {
                    "object": obj.name,
                    "channel": "roughness",
                    "kind": "colorspace_adjusted",
                    "message": f"roughness 色彩空间已从 {original_colorspace} 自动调整为 Non-Color",
                    "suggestion": "粗糙度贴图建议使用 Non-Color。",
                }
            )
        roughness_node = _ensure_image_texture_node(
            nodes, "ZL_RoughnessTexture", (-520, -260)
        )
        roughness_node.image = image
        _collect_texture_warnings("roughness", image, "Non-Color")
        _replace_input_link(
            links,
            roughness_node.outputs.get("Color"),
            bsdf.inputs.get("Roughness"),
        )
        applied_channels.append("roughness")

    if "metallic" in channel_paths:
        image = bpy.data.images.load(channel_paths["metallic"], check_existing=True)
        original_colorspace = image.colorspace_settings.name
        image.colorspace_settings.name = "Non-Color"
        if original_colorspace != "Non-Color":
            warnings.append(
                {
                    "object": obj.name,
                    "channel": "metallic",
                    "kind": "colorspace_adjusted",
                    "message": f"metallic 色彩空间已从 {original_colorspace} 自动调整为 Non-Color",
                    "suggestion": "金属度贴图建议使用 Non-Color。",
                }
            )
        metallic_node = _ensure_image_texture_node(
            nodes, "ZL_MetallicTexture", (-520, -460)
        )
        metallic_node.image = image
        _collect_texture_warnings("metallic", image, "Non-Color")
        _replace_input_link(
            links,
            metallic_node.outputs.get("Color"),
            bsdf.inputs.get("Metallic"),
        )
        applied_channels.append("metallic")

    return material.name, applied_channels, warnings


def _apply_texture_image(payload):
    if not isinstance(payload, dict):
        payload = {}
    channel_paths = _resolve_texture_channel_paths(payload)
    target_names = _resolve_apply_texture_target_names(payload)
    success = []
    failed = []
    last_applied_channels = []
    warnings = []

    for name in target_names:
        try:
            obj = _find_object(name)
            material_name, applied_channels, object_warnings = _apply_texture_channels_to_object(
                obj, channel_paths
            )
            success.append({"object": obj.name, "material": material_name})
            last_applied_channels = applied_channels
            warnings.extend(object_warnings)
        except BridgeError as err:
            failed.append(
                {
                    "object": name,
                    "code": err.code,
                    "message": err.message,
                }
            )

    if not success:
        first = failed[0] if failed else {"code": "invalid_target", "message": "no mesh object available"}
        raise BridgeError(first["code"], first["message"])

    return {
        "ok": True,
        "message": f"applied texture channels {','.join(last_applied_channels)} to {len(success)} object(s), failed {len(failed)}",
        "data": {
            "object": success[0]["object"] if len(success) == 1 else None,
            "material": success[0]["material"] if len(success) == 1 else None,
            "objects": [item["object"] for item in success],
            "results": success,
            "failed": failed,
            "success_count": len(success),
            "failed_count": len(failed),
            "channels": last_applied_channels,
            "paths": channel_paths,
            "path": channel_paths.get("base_color"),
            "warnings": warnings,
            "warning_count": len(warnings),
        },
    }


def _pack_textures(_payload):
    bpy.ops.file.pack_all()
    return {"ok": True, "message": "packed all textures", "data": {}}


def _new_file(payload):
    use_empty = bool(payload.get("use_empty", True)) if isinstance(payload, dict) else True
    bpy.ops.wm.read_homefile(use_empty=use_empty)
    return {"ok": True, "message": "new blender file created", "data": {"use_empty": use_empty}}


def _open_file(payload):
    path = str(payload.get("path") or "").strip()
    if not path:
        raise BridgeError("invalid_args", "open_file requires `path`")
    abs_path = os.path.abspath(path)
    if not os.path.exists(abs_path):
        raise BridgeError("file_not_found", f"file not found: {abs_path}")
    bpy.ops.wm.open_mainfile(filepath=abs_path)
    return {"ok": True, "message": f"opened file `{abs_path}`", "data": {"path": abs_path}}


def _save_file(payload):
    path = str(payload.get("path") or "").strip()
    if path:
        abs_path = os.path.abspath(path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=abs_path)
        return {"ok": True, "message": f"saved file `{abs_path}`", "data": {"path": abs_path}}

    if not bpy.data.filepath:
        raise BridgeError(
            "missing_path",
            "current blender file has no path, please provide `path`",
            "先执行一次另存为，或在请求中传入 path",
        )

    bpy.ops.wm.save_mainfile()
    return {"ok": True, "message": f"saved file `{bpy.data.filepath}`", "data": {"path": bpy.data.filepath}}


def _undo(_payload):
    if not bpy.ops.ed.undo.poll():
        raise BridgeError("undo_unavailable", "undo is not available now")
    bpy.ops.ed.undo()
    return {"ok": True, "message": "undo success", "data": {}}


def _redo(_payload):
    if not bpy.ops.ed.redo.poll():
        raise BridgeError("redo_unavailable", "redo is not available now")
    bpy.ops.ed.redo()
    return {"ok": True, "message": "redo success", "data": {}}


def _read_bool_arg(payload, key, default):
    value = payload.get(key, default)
    if isinstance(value, bool):
        return value
    raise BridgeError("invalid_args", f"`{key}` must be boolean")


def _resolve_export_output_path(payload):
    output_path = payload.get("output_path") if isinstance(payload, dict) else None
    if not output_path:
        raise BridgeError("invalid_args", "missing `output_path`")

    output_path = os.path.abspath(str(output_path))
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    return output_path


def _validate_export_output_file(output_path, format_name):
    if not os.path.exists(output_path):
        raise BridgeError("export_file_missing", f"{format_name} export file not found: {output_path}")
    size = os.path.getsize(output_path)
    if size <= 0:
        raise BridgeError("export_file_empty", f"{format_name} export file is empty: {output_path}")
    return size


def _export_glb(payload):
    output_path = _resolve_export_output_path(payload)
    use_selection = _read_bool_arg(payload, "use_selection", False)
    export_apply = _read_bool_arg(payload, "export_apply", True)
    _set_object_mode()
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=use_selection,
        export_apply=export_apply,
    )
    file_size = _validate_export_output_file(output_path, "GLB")

    return {
        "ok": True,
        "message": "exported",
        "output_path": output_path,
        "data": {
            "path": output_path,
            "format": "glb",
            "use_selection": use_selection,
            "file_size_bytes": file_size,
        },
    }


def _export_fbx(payload):
    output_path = _resolve_export_output_path(payload)
    use_selection = _read_bool_arg(payload, "use_selection", False)
    apply_modifiers = _read_bool_arg(payload, "apply_modifiers", True)
    add_leaf_bones = _read_bool_arg(payload, "add_leaf_bones", False)

    _set_object_mode()
    bpy.ops.export_scene.fbx(
        filepath=output_path,
        use_selection=use_selection,
        use_mesh_modifiers=apply_modifiers,
        add_leaf_bones=add_leaf_bones,
        path_mode="AUTO",
    )
    file_size = _validate_export_output_file(output_path, "FBX")

    return {
        "ok": True,
        "message": "exported",
        "output_path": output_path,
        "data": {
            "path": output_path,
            "format": "fbx",
            "use_selection": use_selection,
            "file_size_bytes": file_size,
        },
    }


def _export_obj(payload):
    output_path = _resolve_export_output_path(payload)
    use_selection = _read_bool_arg(payload, "use_selection", False)
    apply_modifiers = _read_bool_arg(payload, "apply_modifiers", True)
    export_materials = _read_bool_arg(payload, "export_materials", True)

    _set_object_mode()
    obj_export_result = False
    if hasattr(bpy.ops, "wm") and hasattr(bpy.ops.wm, "obj_export"):
        try:
            obj_export_result = bpy.ops.wm.obj_export(
                filepath=output_path,
                export_selected_objects=use_selection,
                apply_modifiers=apply_modifiers,
                export_materials=export_materials,
            )
        except TypeError:
            obj_export_result = bpy.ops.wm.obj_export(filepath=output_path)
    elif hasattr(bpy.ops, "export_scene") and hasattr(bpy.ops.export_scene, "obj"):
        obj_export_result = bpy.ops.export_scene.obj(
            filepath=output_path,
            use_selection=use_selection,
            use_mesh_modifiers=apply_modifiers,
            use_materials=export_materials,
        )
    else:
        raise BridgeError("unsupported_action", "obj export operator is unavailable")

    if not obj_export_result:
        raise BridgeError("export_failed", f"obj export failed: {output_path}")
    file_size = _validate_export_output_file(output_path, "OBJ")

    return {
        "ok": True,
        "message": "exported",
        "output_path": output_path,
        "data": {
            "path": output_path,
            "format": "obj",
            "use_selection": use_selection,
            "file_size_bytes": file_size,
        },
    }


ACTION_HANDLERS = {
    "ping": lambda _payload: {"ok": True, "message": "bridge is reachable", "data": {}},
    "list_objects": _list_objects,
    "get_selection_context": _get_selection_context,
    "select_objects": _select_objects,
    "rename_object": _rename_object,
    "organize_hierarchy": _organize_hierarchy,
    "translate_objects": _translate_objects,
    "rotate_objects": _rotate_objects,
    "scale_objects": _scale_objects,
    "align_origin": _align_origin,
    "normalize_scale": _normalize_scale,
    "normalize_axis": _normalize_axis,
    "add_cube": _add_cube,
    "solidify": _solidify,
    "bevel": _bevel,
    "mirror": _mirror,
    "array": _array,
    "boolean": _boolean,
    "auto_smooth": _auto_smooth,
    "weighted_normal": _weighted_normal,
    "decimate": _decimate,
    "inspect_mesh_topology": _inspect_mesh_topology,
    "tidy_material_slots": _tidy_material_slots,
    "check_texture_paths": _check_texture_paths,
    "apply_texture_image": _apply_texture_image,
    "pack_textures": _pack_textures,
    "new_file": _new_file,
    "open_file": _open_file,
    "save_file": _save_file,
    "undo": _undo,
    "redo": _redo,
    "export_glb": _export_glb,
    "export_fbx": _export_fbx,
    "export_obj": _export_obj,
}


def _handle_request(request):
    action = request.get("action")
    if not action:
        raise BridgeError("invalid_action", "missing action")

    payload = request.get("payload")
    if payload is None:
        payload = {}

    handler = ACTION_HANDLERS.get(action)
    if handler is None:
        raise BridgeError(
            "unsupported_action",
            f"unsupported action: {action}",
            "请在模型设置中确认该能力已启用，并检查动作名是否正确",
        )

    return handler(payload)


def _pump_tasks():
    while True:
        try:
            task = _TASK_QUEUE.get_nowait()
        except queue.Empty:
            break

        try:
            task["response"] = _handle_request(task["request"])
        except BridgeError as err:
            task["response"] = {
                "ok": False,
                "code": err.code,
                "message": err.message,
                "suggestion": err.suggestion,
            }
        except Exception as err:
            traceback.print_exc()
            task["response"] = {
                "ok": False,
                "code": "unknown_error",
                "message": str(err),
                "suggestion": "请检查 Blender 控制台输出获取详细堆栈",
            }

        task["event"].set()

    return 0.05


class _BridgeHandler(socketserver.StreamRequestHandler):
    def handle(self):
        raw_line = self.rfile.readline().decode("utf-8").strip()
        if not raw_line:
            return

        try:
            request = json.loads(raw_line)
        except Exception as err:
            response = {
                "ok": False,
                "code": "invalid_json",
                "message": f"invalid json: {err}",
                "suggestion": "请确认请求是 JSON 行文本",
            }
            self.wfile.write((json.dumps(response) + "\n").encode("utf-8"))
            return

        task = {
            "request": request,
            "response": None,
            "event": threading.Event(),
        }
        _TASK_QUEUE.put(task)

        done = task["event"].wait(timeout=240)
        if not done:
            response = {
                "ok": False,
                "code": "main_thread_timeout",
                "message": "timeout waiting blender main thread",
                "suggestion": "请减少单次操作复杂度或重试",
            }
        else:
            response = task["response"] or {
                "ok": False,
                "code": "empty_task_response",
                "message": "empty task response",
            }

        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))


class _BridgeServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def _server_key():
    return "_libra_bridge_server"


def start_bridge(host=HOST, port=PORT):
    ns = bpy.app.driver_namespace
    if ns.get(_server_key()):
        return

    server = _BridgeServer((host, port), _BridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    ns[_server_key()] = server

    if not bpy.app.timers.is_registered(_pump_tasks):
        bpy.app.timers.register(_pump_tasks, persistent=True)

    print(f"[libra] blender bridge running at {host}:{port}")


def stop_bridge():
    ns = bpy.app.driver_namespace
    server = ns.get(_server_key())
    if not server:
        return

    server.shutdown()
    server.server_close()
    ns[_server_key()] = None
    print("[libra] blender bridge stopped")


def _persist_user_preferences():
    context = getattr(bpy, "context", None)
    if context is None:
        return
    # 描述：Blender Extension 安装流程可能运行在受限上下文（_RestrictContext），
    # 此时强行保存用户偏好会抛错并导致误导日志；这里直接跳过。
    if getattr(context, "view_layer", None) is None:
        return
    try:
        if hasattr(bpy.ops.wm, "save_userpref"):
            bpy.ops.wm.save_userpref()
    except Exception as err:
        if "_RestrictContext" in str(err) and "view_layer" in str(err):
            return
        print(f"[libra] save user preferences failed: {err}")


def register():
    start_bridge()
    _persist_user_preferences()


def unregister():
    stop_bridge()


if __name__ == "__main__":
    register()
