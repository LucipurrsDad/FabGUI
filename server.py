#!/usr/bin/env python3
"""FabGUI - web-based GUI wrapper around the FabCLI Epic Games / Fab downloader.

Serves a single-page web UI that drives the `fabcli` binary:

    fabcli search ...  ->  POST /api/search
    fabcli library     ->  GET  /api/library
    fabcli claim ...   ->  POST /api/claim
    fabcli claim ...   ->  POST /api/claim-batch
    fabcli download    ->  POST /api/download   (runs as a background job)

All downloads are written under the user-configured download directory
(default: /home/deck/Projects).
"""

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

APP_DIR = Path(__file__).resolve().parent
SETTINGS_PATH = APP_DIR / "settings.json"
STATIC_DIR = APP_DIR / "static"
DEFAULT_DOWNLOAD_DIR = "/home/deck/Projects"
DEFAULT_FABCLI = os.environ.get("FABGUI_FABCLI", "fabcli")

DEFAULTS = {"fabcli_path": DEFAULT_FABCLI}
SETTINGS = dict(DEFAULTS)

JOBS = {}
JOBS_LOCK = threading.Lock()
DOWNLOAD_HISTORY = []
HISTORY_LOCK = threading.Lock()


# --------------------------------------------------------------------------
# settings
# --------------------------------------------------------------------------

def load_settings():
    global SETTINGS
    SETTINGS = dict(DEFAULTS)
    try:
        saved = json.loads(SETTINGS_PATH.read_text())
        if isinstance(saved, dict):
            for k, v in DEFAULTS.items():
                if saved.get(k):
                    SETTINGS[k] = saved[k]
    except Exception:
        pass


def save_settings():
    try:
        SETTINGS_PATH.write_text(json.dumps(SETTINGS, indent=2) + "\n")
        return True
    except Exception as e:
        print(f"[fabgui] failed to save settings: {e}", flush=True)
        return False


# --------------------------------------------------------------------------
# fabcli execution helpers
# --------------------------------------------------------------------------

def fabcli_env():
    env = dict(os.environ)
    env["FABCLI_LIBRARY_CACHE"] = "1"
    env["FABCLI_NO_TIPS"] = "1"
    env["FABCLI_NO_UPDATE_CHECK"] = "1"
    # Keep fabcli running across SteamOS atomic updates: /home persists,
    # so point the loader at user-installed shared libraries there.
    local_lib_dir = "/home/deck/.local/lib"
    existing_ld = env.get("LD_LIBRARY_PATH", "")
    env["LD_LIBRARY_PATH"] = local_lib_dir + (":" + existing_ld if existing_ld else "")
    return env


def fabcli_bin():
    return shutil.which(SETTINGS["fabcli_path"]) or SETTINGS["fabcli_path"]


def fabcli_proc(args):
    return subprocess.Popen(
        [fabcli_bin()] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=fabcli_env(),
    )


def run_fab(args):
    """Run fabcli and return a normalized result dict (never raises)."""
    try:
        proc = fabcli_proc(args)
        return collect_proc(proc)
    except Exception as e:
        return {"ok": False, "code": -1, "timed_out": False, "stdout": "", "stderr": f"failed to run fabcli: {e}"}


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
    return {
        "ok": bool(proc.returncode == 0 and not timed_out),
        "code": proc.returncode,
        "timed_out": timed_out,
        "stdout": out or "",
        "stderr": err or "",
    }


def parse_fab_result(res):
    """Turn a fabcli subprocess result into {ok, code, kind, message, data, timed_out}."""
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

    return {
        "ok": bool(res.get("ok") and error is None),
        "code": res.get("code"),
        "kind": (error or {}).get("kind"),
        "message": (error or {}).get("message"),
        "data": data if error is None else None,
        "timed_out": bool(res.get("timed_out")),
    }


def flatten_download(output_dir):
    """Move files out of content/ subfolder and remove the empty content tree.

    FabCLI nests downloads under content/<asset>/. Flatten so files land
    directly in output_dir and remove the now-empty content directory.
    """
    if not output_dir:
        return
    content_dir = os.path.join(output_dir, "content")
    if not os.path.isdir(content_dir):
        return
    for entry in os.listdir(content_dir):
        src = os.path.join(content_dir, entry)
        dst = os.path.join(output_dir, entry)
        if os.path.exists(dst):
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            else:
                os.remove(dst)
        shutil.move(src, dst)
    try:
        os.rmdir(content_dir)
    except OSError:
        pass


def cleanup_cache(output_dir):
    """Remove FabCLI's .fabcli-asset.json cache marker so re-downloads don't collide.

    FabCLI refuses to re-download an asset when this file already exists in
    --output (output_collision / file_exists). Deleting it lets the user
    re-download even after they've removed the asset files themselves.
    """
    if not output_dir:
        return
    cache_file = os.path.join(output_dir, ".fabcli-asset.json")
    try:
        if os.path.isfile(cache_file):
            os.remove(cache_file)
    except OSError:
        pass


# --------------------------------------------------------------------------
# background jobs (auth login, downloads)
# --------------------------------------------------------------------------

def start_job(name, args_fn, meta=None):
    jid = uuid.uuid4().hex[:12]
    job = {
        "id": jid,
        "name": name,
        "state": "running",
        "created_at": time.time(),
        "updated_at": time.time(),
        "started_at": time.time(),
        "result": None,
        "error": None,
        "proc": None,
        "meta": meta or {},
    }
    with JOBS_LOCK:
        JOBS[jid] = job

    def runner():
        output_dir = None
        try:
            proc = job["proc"] = fabcli_proc(args_fn())
            res = collect_proc(proc)
        except Exception as e:
            res = {"ok": False, "code": -1, "timed_out": False, "stdout": "", "stderr": f"failed to run fabcli: {e}"}
        parsed = parse_fab_result(res)

        # Handle output_collision: FabCLI refuses to re-download when
        # .fabcli-asset.json already exists in --output. Remove it and retry once.
        if (not parsed["ok"] and parsed.get("kind") == "output_collision"
                and job["name"] == "download"):
            output_dir = job["meta"].get("output_dir")
            cleanup_cache(output_dir)
            try:
                proc = job["proc"] = fabcli_proc(args_fn())
                res = collect_proc(proc)
            except Exception as e:
                res = {"ok": False, "code": -1, "timed_out": False, "stdout": "", "stderr": f"failed to run fabcli: {e}"}
            parsed = parse_fab_result(res)

        if job["name"] == "download":
            output_dir = output_dir or job["meta"].get("output_dir")

        with JOBS_LOCK:
            job["state"] = "error" if not parsed["ok"] else "success"
            job["result"] = parsed
            job["error"] = parsed if not parsed["ok"] else None
            job["updated_at"] = time.time()
            job["proc"] = None
            if job["name"] == "download":
                with HISTORY_LOCK:
                    DOWNLOAD_HISTORY.insert(0, {
                        "id": jid,
                        "uid": job["meta"].get("uid"),
                        "output_dir": output_dir,
                        "started_at": job["started_at"],
                        "finished_at": job["updated_at"],
                        "ok": parsed["ok"],
                        "result": parsed,
                    })
                    del DOWNLOAD_HISTORY[50:]

        if parsed["ok"] and output_dir:
            flatten_download(output_dir)
            cleanup_cache(output_dir)

    t = threading.Thread(target=runner, daemon=True, name=f"fabgui-job-{jid}")
    t.start()
    return jid


def cancel_job(jid):
    with JOBS_LOCK:
        job = JOBS.get(jid)
    if job and job.get("proc"):
        try:
            job["proc"].terminate()
        except Exception:
            pass
    return True


def get_job(jid):
    with JOBS_LOCK:
        return JOBS.get(jid)


def list_jobs():
    with JOBS_LOCK:
        jobs = sorted(JOBS.values(), key=lambda j: j["created_at"], reverse=True)
    return jobs[:30]


# --------------------------------------------------------------------------
# fabcli command wrappers
# --------------------------------------------------------------------------

def cmd_auth_status():
    res = run_fab(["auth", "status"])
    parsed = parse_fab_result(res)
    data = parsed.get("data") or {}
    return {
        "ok": parsed["ok"],
        "kind": parsed.get("kind"),
        "message": parsed.get("message"),
        "authenticated": bool(data.get("authenticated")),
        "expires_at": data.get("expires_at"),
        "refreshed": data.get("refreshed"),
        "fab": data.get("fab"),
        "code": parsed.get("code"),
        "data": parsed.get("data"),
    }


def cmd_auth_whoami():
    res = run_fab(["auth", "whoami"])
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_auth_logout():
    res = run_fab(["auth", "logout"])
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_search(body):
    args = ["search"]
    query = (body.get("query") or "").strip()
    if query:
        args += ["--query", query]
    filters = body.get("filters") or []
    if not isinstance(filters, list):
        filters = []
    for f in filters:
        if isinstance(f, str):
            if "=" in f:
                k, v = f.split("=", 1)
                f = {"key": k.strip(), "value": v.strip()}
        k = str(f.get("key") or f.get("k") or "").strip()
        v = str(f.get("value") or f.get("v") or "").strip()
        if k and v:
            args += ["--filter", f"{k}={v}"]
    sort = body.get("sort")
    if sort:
        args += ["--sort", str(sort)]
    count = body.get("count")
    if count is not None and str(count).strip() != "":
        args += ["--count", str(int(count))]
    if body.get("with_ownership"):
        args += ["--with-ownership"]
    res = run_fab(args)
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_library(params):
    args = ["library"]
    refresh = str(params.get("refresh") or "").lower() in ("1", "true", "yes", "on")
    clear = str(params.get("clear") or "").lower() in ("1", "true", "yes", "on")
    if clear:
        args.append("--clear")
    elif refresh:
        args.append("--refresh")
    res = run_fab(args)
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_claim(uid):
    res = run_fab(["claim", str(uid)])
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_claim_batch(uids):
    csv = ",".join(str(u) for u in uids if str(u).strip())
    res = run_fab(["claim-batch", "--uids", csv])
    parsed = parse_fab_result(res)
    return {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")}


def cmd_download(body):
    print("DEBUG cmd_download: body =", body)
    print("DEBUG uid from body:", body.get("uid"))
    uid = str(body.get("uid") or "").strip()
    print("DEBUG uid after strip:", repr(uid))
    if not uid:
        return {"ok": False, "kind": "invalid_args", "message": "download requires a listing uid", "data": None, "code": 6}
    output_dir = str(body.get("output_dir") or "")
    if not output_dir:
        output_dir = None
    args = ["download", uid]
    if output_dir:
        args += ["--output", output_dir]
    engine = body.get("engine")
    if engine:
        args += ["--engine", str(engine)]
    platform = body.get("platform")
    if platform:
        args += ["--platform", str(platform)]
    args += ["--jobs", str(int(body.get("jobs") or 8))]
    if body.get("force"):
        args += ["--force"]
    if body.get("into_empty"):
        args += ["--into-empty"]
    jid = start_job("download", lambda: list(args), {"uid": uid, "output_dir": output_dir})
    return {"ok": True, "job_id": jid}


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json",
}


class FabGuiHandler(BaseHTTPRequestHandler):
    server_version = "FabGUI/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[fabgui] {self.address_string()} - {fmt % args}", flush=True)

    # ---------------- plumbing ----------------

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_raw(self, code, content_type, data):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
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

    def _params(self):
        parsed = urlparse(self.path)
        return {k: v[-1] for k, v in parse_qs(parsed.query).items()}

    # ---------------- GET ----------------

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path or "/"
            query = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
            if path == "/api/health":
                return self._send_json(200, {"ok": True, "fabcli": SETTINGS["fabcli_path"], "time": time.time()})
            if path == "/api/settings":
                return self._send_json(200, dict(SETTINGS))
            if path == "/api/auth/status":
                return self._send_json(200, cmd_auth_status())
            if path == "/api/auth/whoami":
                return self._send_json(200, cmd_auth_whoami())
            if path == "/api/library":
                return self._send_json(200, cmd_library(query))
            if path == "/api/listing":
                uid = query.get("uid") or ""
                res = run_fab(["listing", uid])
                parsed = parse_fab_result(res)
                return self._send_json(200, {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")})
            if path == "/api/formats":
                uid = query.get("uid") or ""
                res = run_fab(["formats", uid])
                parsed = parse_fab_result(res)
                return self._send_json(200, {"ok": parsed["ok"], "kind": parsed.get("kind"), "message": parsed.get("message"), "data": parsed.get("data"), "code": parsed.get("code")})
            if path == "/api/jobs":
                return self._send_json(200, {"jobs": list_jobs()})
            if path.startswith("/api/jobs/"):
                jid = path[len("/api/jobs/"):].strip("/")
                job = get_job(jid)
                if job is None:
                    return self._send_json(404, {"ok": False, "message": "job not found"})
                return self._send_json(200, job)
            if path == "/api/downloads":
                with HISTORY_LOCK:
                    history = list(DOWNLOAD_HISTORY)
                return self._send_json(200, {"history": history})
            if path in ("/", "/index.html"):
                return self._serve_static("index.html")
            if path.startswith("/static/"):
                rel = path[len("/static/"):].split("?")[0]
                f = (STATIC_DIR / rel).resolve()
                try:
                    f.relative_to(STATIC_DIR.resolve())
                except Exception:
                    return self._send_json(404, {"ok": False, "message": "not found"})
                if not f.is_file():
                    return self._send_json(404, {"ok": False, "message": "not found"})
                return self._send_bytes(200, f)
            return self._send_json(404, {"ok": False, "message": "not found"})
        except Exception as e:
            try:
                self._send_json(500, {"ok": False, "message": f"internal error: {e}"})
            except Exception:
                pass

    def _send_bytes(self, code, f):
        data = f.read_bytes()
        ct = MIME.get(f.suffix.lower(), "application/octet-stream")
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _serve_static(self, rel):
        f = (STATIC_DIR / rel).resolve()
        try:
            f.relative_to(STATIC_DIR.resolve())
        except Exception:
            return self._send_json(404, {"ok": False, "message": "not found"})
        if not f.is_file():
            return self._send_json(404, {"ok": False, "message": "not found"})
        return self._send_bytes(200, f)

    # ---------------- POST ----------------

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path or "/"
            body = self._read_body()
            if path == "/api/auth/login":
                manual = bool(body.get("manual"))
                jid = start_job("auth", lambda: (["auth", "login"] + (["--manual"] if manual else [])), {})
                return self._send_json(200, {"ok": True, "job_id": jid})
            if path == "/api/auth/logout":
                return self._send_json(200, cmd_auth_logout())
            if path == "/api/search":
                return self._send_json(200, cmd_search(body))
            if path == "/api/claim":
                return self._send_json(200, cmd_claim(body.get("uid")))
            if path == "/api/claim-batch":
                uids = body.get("uids") or []
                if not isinstance(uids, list):
                    uids = [u for u in str(uids).split(",") if u.strip()]
                return self._send_json(200, cmd_claim_batch(uids))
            if path == "/api/download":
                return self._send_json(200, cmd_download(body))
            if path == "/api/settings":
                if body.get("fabcli_path"):
                    SETTINGS["fabcli_path"] = str(body.get("fabcli_path"))
                if not save_settings():
                    return self._send_json(500, {"ok": False, "message": "failed to write settings.json"})
                return self._send_json(200, {"ok": True, **SETTINGS})
            return self._send_json(404, {"ok": False, "message": "not found"})
        except Exception as e:
            try:
                self._send_json(500, {"ok": False, "message": f"internal error: {e}"})
            except Exception:
                pass


def main():
    load_settings()
    port = int(os.environ.get("FABGUI_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), FabGuiHandler)
    server.daemon_threads = True
    print(f"FabGUI server starting on http://127.0.0.1:{port}", flush=True)
    print(f"FabCLI binary: {SETTINGS['fabcli_path']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
