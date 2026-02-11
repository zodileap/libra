bl_info = {
    "name": "Zodileap MCP Bridge",
    "author": "zodileap",
    "version": (0, 1, 0),
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


def _handle_request(request):
    action = request.get("action")

    if action == "ping":
        return {"ok": True, "message": "pong"}

    if action == "export_glb":
        output_path = request.get("output_path")
        if not output_path:
            raise RuntimeError("missing `output_path`")

        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        if bpy.ops.object.mode_set.poll():
            bpy.ops.object.mode_set(mode="OBJECT")

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
        }

    raise RuntimeError(f"unsupported action: {action}")


def _pump_tasks():
    while True:
        try:
            task = _TASK_QUEUE.get_nowait()
        except queue.Empty:
            break

        try:
            task["response"] = _handle_request(task["request"])
        except Exception as err:
            traceback.print_exc()
            task["response"] = {
                "ok": False,
                "message": str(err),
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
            response = {"ok": False, "message": f"invalid json: {err}"}
            self.wfile.write((json.dumps(response) + "\n").encode("utf-8"))
            return

        task = {
            "request": request,
            "response": None,
            "event": threading.Event(),
        }
        _TASK_QUEUE.put(task)

        done = task["event"].wait(timeout=120)
        if not done:
            response = {
                "ok": False,
                "message": "timeout waiting blender main thread",
            }
        else:
            response = task["response"] or {"ok": False, "message": "empty task response"}

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


def register():
    start_bridge()


def unregister():
    stop_bridge()


if __name__ == "__main__":
    register()
