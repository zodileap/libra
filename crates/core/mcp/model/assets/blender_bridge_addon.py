bl_info = {
    "name": "Zodileap MCP Bridge",
    "author": "zodileap",
    "version": (0, 2, 0),
    "blender": (3, 0, 0),
    "location": "View3D",
    "description": "Expose current Blender session for Zodileap desktop MCP calls",
    "category": "System",
}

import bpy
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


def _editable_objects(selected_only=False):
    objects = bpy.context.selected_objects if selected_only else bpy.data.objects
    return [obj for obj in objects if obj.type == "MESH"]


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
            return [active], scope
        selected = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
        if selected:
            return [selected[0]], scope
        raise BridgeError(
            "no_target_object",
            "no active mesh object found for selection_scope=active",
            "请先在 Blender 中激活一个可编辑对象",
        )
    if scope == "selected":
        targets = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
        if targets:
            return targets, scope
        raise BridgeError(
            "no_target_object",
            "no selected mesh objects found for selection_scope=selected",
            "请先在 Blender 中选中需要操作的对象",
        )
    if scope == "all":
        targets = [obj for obj in bpy.data.objects if obj.type == "MESH"]
        if targets:
            return targets, scope
        raise BridgeError("no_target_object", "no mesh objects found in current scene")
    raise BridgeError(
        "invalid_args",
        f"invalid selection_scope `{scope}`, expected active/selected/all",
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
    data = []
    for obj in bpy.data.objects:
        data.append(
            {
                "name": obj.name,
                "type": obj.type,
                "parent": obj.parent.name if obj.parent else None,
                "selected": bool(obj.select_get()),
            }
        )
    return {
        "ok": True,
        "message": f"listed {len(data)} objects",
        "data": {"objects": data},
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
        "data": {"child": child.name, "parent": parent_label},
    }


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
    obj_name = _active_or_selected_name(payload)
    target_name = str(payload.get("target") or "").strip()
    operation = str(payload.get("operation") or "DIFFERENCE").upper()
    if operation not in {"UNION", "DIFFERENCE", "INTERSECT"}:
        raise BridgeError("invalid_args", "boolean operation must be UNION/DIFFERENCE/INTERSECT")
    if not target_name:
        raise BridgeError("invalid_args", "boolean requires `target`")

    obj = _find_object(obj_name)
    target = _find_object(target_name)
    mod = obj.modifiers.new(name="ZL_Boolean", type="BOOLEAN")
    mod.operation = operation
    mod.object = target

    return {
        "ok": True,
        "message": f"boolean `{operation}` applied: {obj.name} <- {target.name}",
        "data": {"object": obj.name, "target": target.name, "operation": operation},
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


def _check_texture_paths(payload):
    missing = []
    for image in bpy.data.images:
        if not image.filepath:
            continue
        path = bpy.path.abspath(image.filepath)
        if not os.path.exists(path):
            missing.append({"image": image.name, "path": path})
    return {
        "ok": True,
        "message": f"texture check finished, missing {len(missing)}",
        "data": {"missing": missing, "missing_count": len(missing)},
    }


def _apply_texture_image(payload):
    path = str(payload.get("path") or "").strip()
    if not path:
        raise BridgeError("invalid_args", "apply_texture_image requires `path`")
    abs_path = os.path.abspath(path)
    if not os.path.exists(abs_path):
        raise BridgeError("file_not_found", f"file not found: {abs_path}")

    object_name = str(payload.get("object") or "").strip()
    if object_name:
        obj = _find_object(object_name)
    else:
        obj = _find_object(_active_or_selected_name(payload))
    if obj.type != "MESH":
        raise BridgeError("invalid_target", f"object `{obj.name}` is not mesh")

    image = bpy.data.images.load(abs_path, check_existing=True)

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
        has_surface_link = False
        for link in links:
            if (
                link.from_node == bsdf
                and link.to_node == output
                and link.to_socket == output.inputs.get("Surface")
            ):
                has_surface_link = True
                break
        if not has_surface_link:
            links.new(bsdf.outputs.get("BSDF"), output.inputs.get("Surface"))

    texture_node = None
    for node in nodes:
        if node.type == "TEX_IMAGE" and node.label == "ZL_BaseColorTexture":
            texture_node = node
            break
    if texture_node is None:
        texture_node = nodes.new(type="ShaderNodeTexImage")
        texture_node.label = "ZL_BaseColorTexture"
        texture_node.name = "ZL_BaseColorTexture"
        texture_node.location = (-360, 0)
    texture_node.image = image

    base_color = bsdf.inputs.get("Base Color")
    color_output = texture_node.outputs.get("Color")
    if base_color and color_output:
        for link in list(base_color.links):
            links.remove(link)
        links.new(color_output, base_color)

    return {
        "ok": True,
        "message": f"applied texture `{abs_path}` to `{obj.name}`",
        "data": {"object": obj.name, "material": material.name, "path": abs_path},
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


def _export_glb(payload):
    output_path = payload.get("output_path") if isinstance(payload, dict) else None
    if not output_path:
        raise BridgeError("invalid_args", "missing `output_path`")

    output_path = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    _set_object_mode()
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
    )

    return {
        "ok": True,
        "message": "exported",
        "output_path": output_path,
        "data": {"path": output_path},
    }


ACTION_HANDLERS = {
    "ping": lambda _payload: {"ok": True, "message": "bridge is reachable", "data": {}},
    "list_objects": _list_objects,
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
    return "_zodileap_bridge_server"


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

    print(f"[zodileap] blender bridge running at {host}:{port}")


def stop_bridge():
    ns = bpy.app.driver_namespace
    server = ns.get(_server_key())
    if not server:
        return

    server.shutdown()
    server.server_close()
    ns[_server_key()] = None
    print("[zodileap] blender bridge stopped")


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
        print(f"[zodileap] save user preferences failed: {err}")


def register():
    start_bridge()
    _persist_user_preferences()


def unregister():
    stop_bridge()


if __name__ == "__main__":
    register()
