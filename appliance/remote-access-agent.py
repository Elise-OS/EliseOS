#!/usr/bin/env python3
"""Small root agent exposing only Élise's supported Tailscale operations."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler
from socketserver import UnixStreamServer
from typing import Any

SOCKET_PATH = os.environ.get("ELISE_REMOTE_AGENT_SOCKET", "/run/elise-remote-access/agent.sock")
TARGET_PORT = int(os.environ.get("ELISE_REMOTE_TARGET_PORT", "18080"))
CONFIG_DIR = os.environ.get("ELISE_CONFIG_DIR", "/etc/elise")
COMPOSE_DIR = os.environ.get("ELISE_COMPOSE_DIR", "/opt/elise/current")
SERVE_PORT = 8443
AUTH_URL: str | None = None
AUTH_PROCESS: subprocess.Popen[str] | None = None
LOCK = threading.Lock()


def run(*args: str, timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, "LC_ALL": "C"},
    )


def command_json(*args: str) -> dict[str, Any]:
    result = run(*args)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "command failed").strip())
    value = json.loads(result.stdout)
    return value if isinstance(value, dict) else {}


def serve_is_enabled(value: Any) -> bool:
    if isinstance(value, str):
        return ":8443" in value
    if isinstance(value, dict):
        return any(serve_is_enabled(key) or serve_is_enabled(item) for key, item in value.items())
    if isinstance(value, list):
        return any(serve_is_enabled(item) for item in value)
    return False


def webrtc_available() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 8555), timeout=0.5):
            return True
    except OSError:
        return False


def status() -> dict[str, Any]:
    global AUTH_URL, AUTH_PROCESS
    base: dict[str, Any] = {
        "state": "UNAVAILABLE",
        "installed": False,
        "remoteUrl": None,
        "hostname": None,
        "servePort": SERVE_PORT,
        "keyExpiresAt": None,
        "httpsAvailable": False,
        "webrtcAvailable": webrtc_available(),
        "authUrl": AUTH_URL,
        "actionRequired": "RETRY",
    }
    try:
        tailscale = command_json("tailscale", "status", "--json")
    except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return base

    base["installed"] = True
    backend_state = str(tailscale.get("BackendState", ""))
    self_node = tailscale.get("Self") if isinstance(tailscale.get("Self"), dict) else {}
    dns_name = str(self_node.get("DNSName") or "").rstrip(".")
    hostname = dns_name.split(".", 1)[0] if dns_name else str(self_node.get("HostName") or "")
    base["hostname"] = hostname or None
    key_expiry = self_node.get("KeyExpiry")
    base["keyExpiresAt"] = key_expiry if isinstance(key_expiry, str) and key_expiry else None

    with LOCK:
        authorizing = AUTH_PROCESS is not None and AUTH_PROCESS.poll() is None
        if AUTH_PROCESS is not None and AUTH_PROCESS.poll() is not None:
            AUTH_PROCESS = None

    if backend_state != "Running":
        base["state"] = "AUTHORIZING" if authorizing else "SIGNED_OUT"
        base["actionRequired"] = "NONE" if authorizing else "AUTHENTICATE"
        return base

    try:
        serve_config = command_json("tailscale", "serve", "status", "--json")
        enabled = serve_is_enabled(serve_config)
    except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError):
        enabled = False
    base["httpsAvailable"] = enabled
    base["remoteUrl"] = f"https://{dns_name}:{SERVE_PORT}" if dns_name and enabled else None
    base["state"] = "READY" if enabled and base["webrtcAvailable"] else (
        "DEGRADED" if enabled else "CONFIGURING"
    )
    base["actionRequired"] = "NONE" if enabled else "ENABLE_HTTPS"
    base["authUrl"] = None
    return base


def capture_auth_url(process: subprocess.Popen[str]) -> None:
    global AUTH_URL
    if process.stdout is None:
        return
    for line in process.stdout:
        match = re.search(r"https://login\.tailscale\.com/\S+", line)
        if match:
            with LOCK:
                AUTH_URL = match.group(0).rstrip(".,")


def connect(hostname: str | None) -> dict[str, Any]:
    global AUTH_PROCESS, AUTH_URL
    if hostname and not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", hostname):
        raise ValueError("Nom de machine invalide")
    current = status()
    if current["state"] in {"READY", "CONFIGURING", "DEGRADED"}:
        return current
    with LOCK:
        if AUTH_PROCESS is None or AUTH_PROCESS.poll() is not None:
            AUTH_URL = None
            args = ["tailscale", "up", "--accept-dns=true"]
            if hostname:
                args.append(f"--hostname={hostname}")
            AUTH_PROCESS = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env={**os.environ, "LC_ALL": "C"},
            )
            threading.Thread(target=capture_auth_url, args=(AUTH_PROCESS,), daemon=True).start()
    return status()


def enable() -> dict[str, Any]:
    current = status()
    if current["state"] in {"SIGNED_OUT", "AUTHORIZING", "UNAVAILABLE"}:
        raise RuntimeError("Tailscale doit d’abord être rattaché au compte de la famille")
    result = run(
        "tailscale",
        "serve",
        "--bg",
        "--yes",
        f"--https={SERVE_PORT}",
        f"http://127.0.0.1:{TARGET_PORT}",
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())
    tailscale = command_json("tailscale", "status", "--json")
    self_node = tailscale.get("Self") if isinstance(tailscale.get("Self"), dict) else {}
    full_dns_name = str(self_node.get("DNSName") or "").rstrip(".")
    if full_dns_name:
        configure_webrtc(full_dns_name)
    return status()


def configure_webrtc(candidate: str) -> None:
    env_file = os.path.join(CONFIG_DIR, "elise.env")
    if not os.path.isfile(env_file) or not os.path.isfile(os.path.join(COMPOSE_DIR, "compose.yaml")):
        return
    with open(env_file, encoding="utf-8") as source:
        lines = source.read().splitlines()
    lines = [line for line in lines if not line.startswith("MICHEL_WEBRTC_CANDIDATE=")]
    lines.append(f"MICHEL_WEBRTC_CANDIDATE={candidate}")
    temporary = f"{env_file}.tmp"
    with open(temporary, "w", encoding="utf-8") as output:
        output.write("\n".join(lines) + "\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, env_file)
    compose = [
        "docker", "compose", "--project-name", "michel-os", "--env-file", env_file,
        "-f", os.path.join(COMPOSE_DIR, "compose.yaml"),
        "-f", os.path.join(COMPOSE_DIR, "compose.release.yaml"),
    ]
    raspberry = os.path.join(COMPOSE_DIR, "compose.raspberry.yaml")
    if os.uname().machine == "aarch64" and os.path.isfile(raspberry):
        compose.extend(["-f", raspberry, "-f", os.path.join(COMPOSE_DIR, "compose.raspberry.release.yaml")])
    result = run(*compose, "up", "-d", "--force-recreate", "bootstrap", "go2rtc", timeout=120)
    if result.returncode != 0:
        raise RuntimeError("L’accès web est actif, mais la caméra distante doit être vérifiée")


def disable() -> dict[str, Any]:
    result = run("tailscale", "serve", f"--https={SERVE_PORT}", "off")
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return status()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/status":
            self.respond(404, {"error": "Not found"})
            return
        self.respond(200, status())

    def do_POST(self) -> None:
        try:
            length = min(int(self.headers.get("content-length", "0")), 4096)
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/connect":
                result = connect(payload.get("hostname"))
            elif self.path == "/enable":
                result = enable()
            elif self.path == "/disable":
                result = disable()
            else:
                self.respond(404, {"error": "Not found"})
                return
            self.respond(200, result)
        except (ValueError, RuntimeError, FileNotFoundError, subprocess.TimeoutExpired) as error:
            self.respond(503, {"error": str(error)})

    def respond(self, code: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class Server(UnixStreamServer):
    allow_reuse_address = True


def main() -> None:
    os.makedirs(os.path.dirname(SOCKET_PATH), mode=0o750, exist_ok=True)
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    server = Server(SOCKET_PATH, Handler)
    os.chmod(SOCKET_PATH, 0o660)
    agent_gid = os.environ.get("ELISE_AGENT_GID")
    if agent_gid:
        os.chown(SOCKET_PATH, 0, int(agent_gid))
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)


if __name__ == "__main__":
    main()
