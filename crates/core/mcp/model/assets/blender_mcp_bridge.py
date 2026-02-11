"""
Zodileap Blender MCP Bridge

How to use in Blender current session:
1) Open Blender Text Editor.
2) Open this file and click Run Script.
3) Keep Blender session running.

The bridge listens on 127.0.0.1:23331 and accepts JSON line requests:
{"action":"export_glb","output_path":"/abs/path/file.glb"}
"""

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


def start_bridge(host=HOST, port=PORT):
    ns = bpy.app.driver_namespace
    if ns.get("_zodileap_bridge_server"):
        print("[zodileap] bridge already running")
        return

    server = _BridgeServer((host, port), _BridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    ns["_zodileap_bridge_server"] = server

    if not bpy.app.timers.is_registered(_pump_tasks):
        bpy.app.timers.register(_pump_tasks, persistent=True)

    print(f"[zodileap] blender bridge running at {host}:{port}")


def stop_bridge():
    ns = bpy.app.driver_namespace
    server = ns.get("_zodileap_bridge_server")
    if not server:
        print("[zodileap] bridge not running")
        return

    server.shutdown()
    server.server_close()
    ns["_zodileap_bridge_server"] = None
    print("[zodileap] blender bridge stopped")


start_bridge()
