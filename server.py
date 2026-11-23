#!/usr/bin/env python3
"""FabGUI - web-based GUI wrapper around FabCLI."""

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

APP_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = APP_DIR / "settings.json"
STATIC_DIR = APP_DIR / "static"
DEFAULT_DOWNLOAD_DIR = str(Path.home() / "Downloads")
DEFAULT_FABCLI = os.environ.get("FABGUI_FABCLI", "fabcli")
DEFAULTS = {"fabcli_path": DEFAULT_FABCLI, "download_dir": DEFAULT_DOWNLOAD_DIR}
SETTINGS = dict(DEFAULTS)

JOBS = {}
JOBS_LOCK = threading.Lock()
DOWNLOAD_HISTORY = []
HISTORY_LOCK = threading.Lock()


def resolve_download_dir(value=None):
    text = str(value or SETTINGS.get("download_dir") or DEFAULT_DOWNLOAD_DIR).strip()
    if text == "~":
        text = str(Path.home())
    elif text.startswith("~/"):
        text = str(Path.home()) + text[1:]
    elif text.startswith("$HOME"):
        text = str(Path.home()) + text[5:]
    elif text.startswith("${HOME}"):
        text = str(Path.home()) + text[7:]
    return str(Path(text).expanduser().resolve())


def load_settings():
    global SETTINGS
    SETTINGS = dict(DEFAULTS)
    try:
        saved = json.loads(SETTINGS_PATH.read_text())
        if isinstance(saved, dict):
            if saved.get("fabcli_path"):
                SETTINGS["fabcli_path"] = str(saved["fabcli_path"])
            if saved.get("download_dir"):
                SETTINGS["download_dir"] = resolve_download_dir(saved["download_dir"])
    except Exception:
        pass


def save_settings():
    try:
        SETTINGS_PATH.write_text(json.dumps(SETTINGS, indent=2) + "\n")
        return True
    except Exception:
        return False


def fabcli_env():
    env = dict(os.environ)
    env["FABCLI_LIBRARY_CACHE"] = "1"
    env["FABCLI_NO_TIPS"] = "1"
    env["FABCLI_NO_UPDATE_CHECK"] = "1"
    local_lib_dir = str(Path.home() / ".local" / "lib")
    existing_ld = env.get("LD_LIBRARY_PATH", "")
    env["LD_LIBRARY_PATH"] = local_lib_dir + (":" + existing_ld if existing_ld else "")
    return env


def fabcli_bin():
    return shutil.which(SETTINGS["fabcli_path"]) or SETTINGS["fabcli_path"]


def fabcli_proc(args):
    return subprocess.Popen([fabcli_bin()] + args, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=fabcli_env())


def collect_proc(proc, timeout=None):
    out = err = ""
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            proc.kill()
        except Exception:
            pass
        try:
            out, err = proc.communicate(timeout=10)
        except Exception:
            out, err = "", ""
    return {"ok": bool(proc.returncode == 0 and not timed_out), "code": proc.returncode,
            "timed_out": timed_out, "stdout": out or "", "stderr": err or ""}


def run_fab(args):
    try:
        return collect_proc(fabcli_proc(args))
    except Exception as exc:
        return {"ok": False, "code": -1, "timed_out": False, "stdout": "",
                "stderr": f"failed to run fabcli: {exc}"}


def parse_fab_result(res):
    data = None
    try:
        data = json.loads((res.get("stdout") or "").strip())
    except Exception:
        data = None
    error = None
    if not res.get("ok"):
        raw_err = (res.get("stderr") or "").strip()
        err_obj = None
        if raw_err:
            try:
                err_obj = json.loads(raw_err).get("error")
            except Exception:
                err_obj = None
        error = err_obj or {"kind": "generic", "message": raw_err or f"fabcli exited with code {res.get('code')}"}
    return {"ok": bool(res.get("ok") and error is None), "code": res.get("code"),
            "kind": (error or {}).get("kind"), "message": (error or {}).get("message"),
            "data": data if error is None else None, "timed_out": bool(res.get("timed_out"))}


def flatten_download(output_dir):
    if not output_dir:
        return
    content_dir = os.path.join(output_dir, "content")
    if not os.path.isdir(content_dir):
        return
    for entry in os.listdir(content_dir):
        src = os.path.join(content_dir, entry)
        dst = os.path.join(output_dir, entry)
        if os.path.exists(dst):
            shutil.rmtree(dst) if os.path.isdir(dst) else os.remove(dst)
        shutil.move(src, dst)
    try:
        os.rmdir(content_dir)
    except OSError:
        pass


def cleanup_cache(output_dir):
    if not output_dir:
        return
    cache_file = os.path.join(output_dir, ".fabcli-asset.json")
    try:
        if os.path.isfile(cache_file):
            os.remove(cache_file)
    except OSError:
        pass


def start_job(name, args_fn, meta=None):
    jid = uuid.uuid4().hex[:12]
    job = {"id": jid, "name": name, "state": "running", "created_at": time.time(),
            "updated_at": time.time(), "started_at": time.time(), "result": None,
            "error": None, "proc": None, "meta": meta or {}}
    with JOBS_LOCK:
        JOBS[jid] = job

    def runner():
        output_dir = job["meta"].get("output_dir")
        try:
            proc = job["proc"] = fabcli_proc(args_fn())
            res = collect_proc(proc)
        except Exception as exc:
            res = {"ok": False, "code": -1, "timed_out": False, "stdout": "",
                   "stderr": f"failed to run fabcli: {exc}"}
        parsed = parse_fab_result(res)

        if not parsed["ok"] and parsed.get("kind") == "output_collision" and job["name"] == "download":
            cleanup_cache(output_dir)
            try:
                proc = job["proc"] = fabcli_proc(args_fn())
                res = collect_proc(proc)
            except Exception as exc:
                res = {"ok": False, "code": -1, "timed_out": False, "stdout": "",
                       "stderr": f"failed to run fabcli: {exc}"}
            parsed = parse_fab_result(res)

        with JOBS_LOCK:
            job["state"] = "error" if not parsed["ok"] else "success"
            job["result"] = parsed
            job["error"] = parsed if not parsed["ok"] else None
            job["updated_at"] = time.time()
            job["proc"] = None
            if job["name"] == "download":
                with HISTORY_LOCK:
                    DOWNLOAD_HISTORY.insert(0, {"id": jid, "uid": job["meta"].get("uid"),
                                                "output_dir": output_dir,
                                                "started_at": job["started_at"],
                                                "finished_at": job["updated_at"],
                                                "ok": parsed["ok"], "result": parsed})
                    del DOWNLOAD_HISTORY[50:]

        if parsed["ok"] and output_dir:
            flatten_download(output_dir)
            cleanup_cache(output_dir)

    threading.Thread(target=runner, daemon=True, name=f"fabgui-job-{jid}").start()
    return jid


def cmd_library(params):
    args = ["library"]
    if str(params.get("clear") or "").lower() in ("1", "true", "yes", "on"):
        args.append("--clear")
    elif str(params.get("refresh") or "").lower() in ("1", "true", "yes", "on"):
        args.append("--refresh")
    res = parse_fab_result(run_fab(args))
    return {"ok": res["ok"], "kind": res.get("kind"), "message": res.get("message"),
            "data": res.get("data"), "code": res.get("code")}


def cmd_download(body):
    uid = str(body.get("uid") or "").strip()
    if not uid:
        return {"ok": False, "kind": "invalid_args", "message": "download requires a Fab listing UID",
                "data": None, "code": 6}

    output_dir = resolve_download_dir(body.get("output_dir"))
    try:
        os.makedirs(output_dir, exist_ok=True)
    except OSError as exc:
        return {"ok": False, "kind": "permission_denied",
                "message": f"cannot create download directory {output_dir}: {exc}",
                "data": None, "code": 13}

    # FabCLI accepts UID as a positional argument or --uid.  Use --uid only here
    # to make the request unambiguous and keep it consistent with the API/UI.
    args = ["download", "--uid", uid, "--output", output_dir]
    engine = str(body.get("engine") or "").strip()
    platform = str(body.get("platform") or "").strip()
    if engine:
        args += ["--engine", engine]
    if platform:
        args += ["--platform", platform]
    args += ["--jobs", str(int(body.get("jobs") or 8))]
    if body.get("force"):
        args.append("--force")
    if body.get("into_empty"):
        args.append("--into-empty")

    jid = start_job("download", lambda: list(args), {"uid": uid, "output_dir": output_dir})
    return {"ok": True, "job_id": jid}


MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff",
        ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8",
        ".map": "application/json"}


class FabGuiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[fabgui] {self.address_string()} - {fmt % args}", flush=True)

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, code, path):
        data = path.read_bytes()
        ct = MIME.get(path.suffix.lower(), "application/octet-stream")
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except Exception:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}

        if path == "/api/health":
            return self._send_json(200, {"ok": True, "fabcli": SETTINGS["fabcli_path"],
                                        "download_dir": resolve_download_dir(), "time": time.time()})
        if path == "/api/settings":
            return self._send_json(200, dict(SETTINGS))
        if path == "/api/auth/status":
            res = parse_fab_result(run_fab(["auth", "status"]))
            data = res.get("data") or {}
            return self._send_json(200, {"ok": res["ok"], "authenticated": bool(data.get("authenticated")),
                                        "expires_at": data.get("expires_at"), "fab": data.get("fab")})
        if path == "/api/library":
            return self._send_json(200, cmd_library(query))
        if path == "/api/listing":
            res = parse_fab_result(run_fab(["listing", query.get("uid") or ""]))
            return self._send_json(200, {"ok": res["ok"], "kind": res.get("kind"),
                                        "message": res.get("message"), "data": res.get("data")})
        if path == "/api/jobs":
            with JOBS_LOCK:
                jobs = sorted(JOBS.values(), key=lambda item: item["created_at"], reverse=True)
            return self._send_json(200, {"jobs": jobs[:30]})
        if path.startswith("/api/jobs/"):
            jid = path[len("/api/jobs/"):].strip("/")
            with JOBS_LOCK:
                job = JOBS.get(jid)
            if job is None:
                return self._send_json(404, {"ok": False, "message": "job not found"})
            return self._send_json(200, job)
        if path == "/api/downloads":
            with HISTORY_LOCK:
                history = list(DOWNLOAD_HISTORY)
            return self._send_json(200, {"history": history})
        if path in ("/", "/index.html"):
            return self._send_bytes(200, STATIC_DIR / "index.html")
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            file_path = (STATIC_DIR / rel).resolve()
            try:
                file_path.relative_to(STATIC_DIR.resolve())
            except Exception:
                return self._send_json(404, {"ok": False, "message": "not found"})
            if not file_path.is_file():
                return self._send_json(404, {"ok": False, "message": "not found"})
            return self._send_bytes(200, file_path)
        return self._send_json(404, {"ok": False, "message": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        body = self._read_body()
        if path == "/api/auth/login":
            manual = bool(body.get("manual"))
            jid = start_job("auth", lambda: ["auth", "login"] + (["--manual"] if manual else []), {})
            return self._send_json(200, {"ok": True, "job_id": jid})
        if path == "/api/auth/logout":
            res = parse_fab_result(run_fab(["auth", "logout"]))
            return self._send_json(200, {"ok": res["ok"], "kind": res.get("kind"),
                                        "message": res.get("message")})
        if path == "/api/download":
            return self._send_json(200, cmd_download(body))
        if path == "/api/settings":
            if body.get("fabcli_path"):
                SETTINGS["fabcli_path"] = str(body.get("fabcli_path"))
            if body.get("download_dir"):
                SETTINGS["download_dir"] = resolve_download_dir(body.get("download_dir"))
            if not save_settings():
                return self._send_json(500, {"ok": False, "message": "failed to write settings.json"})
            return self._send_json(200, {"ok": True, **SETTINGS})
        return self._send_json(404, {"ok": False, "message": "not found"})


def main():
    load_settings()
    port = int(os.environ.get("FABGUI_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), FabGuiHandler)
    server.daemon_threads = True
    print(f"FabGUI server starting at http://127.0.0.1:{port}", flush=True)
    print(f"FabCLI binary: {SETTINGS['fabcli_path']}", flush=True)
    print(f"Download directory: {resolve_download_dir()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
