#!/usr/bin/env python3
"""Privileged update agent for the private Élise OS distribution.

The web API talks to this process over a root-owned Unix socket.  GitHub
credentials and the actual installer never cross into the application
container; only redacted status is returned.
"""

from __future__ import annotations

import fcntl
import json
import os
import random
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer
from typing import Any

SOCKET_PATH = os.environ.get("ELISE_UPDATE_AGENT_SOCKET", "/run/elise-update/agent.sock")
AUTH_FILE = Path(os.environ.get("ELISE_UPDATE_AUTH_FILE", "/etc/elise/github-auth"))
STATUS_FILE = Path(os.environ.get("ELISE_UPDATE_STATUS_FILE", "/var/lib/elise/update/status.json"))
LOCK_FILE = Path(os.environ.get("ELISE_UPDATE_LOCK_FILE", "/run/elise-update/update.lock"))
REPOSITORY = os.environ.get("ELISE_REPOSITORY", "Elise-OS/EliseOS")
GITHUB_API = os.environ.get("ELISE_GITHUB_API", "https://api.github.com").rstrip("/")
INSTALLER = os.environ.get("ELISE_INSTALLER", "/usr/local/bin/elise")
VERSION_FILE = Path(os.environ.get("ELISE_VERSION_FILE", "/usr/share/elise/version"))
ENV_FILE = Path(os.environ.get("ELISE_CONFIG_FILE", "/etc/elise/elise.env"))
INSTALL_PROCESS: subprocess.Popen[str] | None = None
INSTALL_LOCK = threading.Lock()

VALID_VERSION = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_auth() -> tuple[str, str] | None:
    try:
        values: dict[str, str] = {}
        for line in AUTH_FILE.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
        username, token = values.get("username", "").strip(), values.get("token", "").strip()
        if username and token:
            return username, token
    except OSError:
        pass
    return None


def current_version() -> str:
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("MICHEL_VERSION="):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    except OSError:
        pass
    try:
        value = VERSION_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    except OSError:
        pass
    return "dev"


def version_key(value: str) -> tuple[int, int, int, str]:
    match = re.match(r"^v(\d+)\.(\d+)\.(\d+)(?:-(.*))?$", value)
    if not match:
        return (-1, -1, -1, value)
    # Stable versions sort after their prerelease siblings.
    suffix = match.group(4) or "~stable"
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)), suffix)


def redact_error(error: str) -> str:
    auth = read_auth()
    if auth:
        error = error.replace(auth[1], "[secret]")
    return error[-500:]


def base_status() -> dict[str, Any]:
    auth = read_auth()
    return {
        "state": "UP_TO_DATE",
        "currentVersion": current_version(),
        "latestVersion": None,
        "updateAvailable": False,
        "authConfigured": auth is not None,
        "authUsername": auth[0] if auth else None,
        "checkedAt": None,
        "releaseNotes": None,
        "progress": None,
        "message": None,
        "error": None,
    }


def load_status() -> dict[str, Any]:
    try:
        value = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        if isinstance(value, dict):
            merged = base_status()
            merged.update({key: value[key] for key in merged if key in value})
            merged["currentVersion"] = current_version()
            merged["authConfigured"] = read_auth() is not None
            merged["authUsername"] = read_auth()[0] if read_auth() else None
            return merged
    except (OSError, json.JSONDecodeError):
        pass
    return base_status()


def save_status(status: dict[str, Any]) -> dict[str, Any]:
    status = {key: status.get(key) for key in base_status()}
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
    os.chmod(temporary, 0o640)
    os.replace(temporary, STATUS_FILE)
    return status


class AuthRequired(RuntimeError):
    pass


def github_request(path: str) -> Any:
    auth = read_auth()
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "elise-os-update-agent",
    }
    # A public repository needs no account; the bot only unlocks a private one.
    if auth:
        headers["Authorization"] = f"Bearer {auth[1]}"
    request = urllib.request.Request(f"{GITHUB_API}{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if not auth and error.code in (401, 403, 404):
            raise AuthRequired("Dépôt privé : configurez le compte bot GitHub.") from error
        raise RuntimeError(f"Impossible de vérifier GitHub : {error.reason}") from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        reason = getattr(error, "reason", str(error))
        raise RuntimeError(f"Impossible de vérifier GitHub : {reason}") from error


def latest_release() -> dict[str, Any]:
    value = github_request(f"/repos/{REPOSITORY}/releases/latest")
    if not isinstance(value, dict):
        raise RuntimeError("Réponse GitHub invalide.")
    tag = str(value.get("tag_name", ""))
    if not VALID_VERSION.fullmatch(tag) or value.get("draft") or value.get("prerelease"):
        raise RuntimeError("La dernière release Élise est invalide ou non stable.")
    return value


def check_release() -> dict[str, Any]:
    auth = read_auth()
    current = current_version()
    status = {**load_status(), "state": "CHECKING", "error": None, "message": None}
    save_status(status)
    try:
        release = latest_release()
        latest = str(release["tag_name"])
        available = version_key(latest) > version_key(current)
        return save_status(
            {
                **status,
                "state": "AVAILABLE" if available else "UP_TO_DATE",
                "latestVersion": latest,
                "updateAvailable": available,
                "authConfigured": auth is not None,
                "authUsername": auth[0] if auth else None,
                "checkedAt": now(),
                "releaseNotes": str(release.get("body") or "")[:12000],
                "progress": None,
            }
        )
    except AuthRequired as error:
        return save_status({**base_status(), "state": "UNCONFIGURED", "checkedAt": now(), "message": str(error)})
    except RuntimeError as error:
        return save_status(
            {
                **status,
                "state": "FAILED",
                "checkedAt": now(),
                "error": redact_error(str(error)),
                "message": "La vérification a échoué.",
            }
        )


def write_auth(username: str, token: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9-]{1,100}", username) or "\n" in token or "\r" in token:
        raise ValueError("Identifiants GitHub invalides.")
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = AUTH_FILE.with_suffix(".tmp")
    temporary.write_text(f"username={username}\ntoken={token}\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, AUTH_FILE)
    checked = check_release()
    checked["message"] = "Compte bot GitHub enregistré."
    return save_status(checked)


def delete_auth() -> dict[str, Any]:
    try:
        AUTH_FILE.unlink()
    except FileNotFoundError:
        pass
    return save_status({**base_status(), "message": "Compte bot supprimé."})


def finish_install(process: subprocess.Popen[str], version: str) -> None:
    global INSTALL_PROCESS
    return_code = process.wait()
    with INSTALL_LOCK:
        INSTALL_PROCESS = None
    if return_code == 0:
        save_status(
            {
                **load_status(),
                "state": "RESTARTING",
                "progress": 95,
                "message": "Les services redémarrent…",
                "error": None,
            }
        )
        save_status(
            {
                **load_status(),
                "state": "SUCCEEDED",
                "currentVersion": current_version(),
                "latestVersion": version,
                "updateAvailable": False,
                "checkedAt": now(),
                "progress": 100,
                "message": "Mise à jour installée.",
                "error": None,
            }
        )
    else:
        save_status(
            {
                **load_status(),
                "state": "ROLLED_BACK" if current_version() != version else "FAILED",
                "updateAvailable": True,
                "progress": None,
                "message": "La version précédente a été conservée.",
                "error": "L’installation a échoué.",
            }
        )


def install(version: str | None = None) -> dict[str, Any]:
    global INSTALL_PROCESS
    current = load_status()
    target = version or current.get("latestVersion")
    if not isinstance(target, str) or not VALID_VERSION.fullmatch(target):
        raise ValueError("Version de mise à jour invalide.")
    if version_key(target) <= version_key(current_version()) and target != current.get("latestVersion"):
        raise ValueError("Cette version n’est pas plus récente.")
    with INSTALL_LOCK:
        if INSTALL_PROCESS is not None and INSTALL_PROCESS.poll() is None:
            raise RuntimeError("Une mise à jour est déjà en cours.")
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        lock_handle = LOCK_FILE.open("a+")
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_NB)
        except BlockingIOError as error:
            lock_handle.close()
            raise RuntimeError("Une mise à jour est déjà en cours.") from error
        # Keep the descriptor open in the child thread's closure until install ends.
        status = save_status(
            {
                **current,
                "state": "DOWNLOADING",
                "latestVersion": target,
                "updateAvailable": True,
                "progress": 5,
                "message": "Téléchargement de la mise à jour…",
                "error": None,
            }
        )
        log_path = STATUS_FILE.with_name("install.log")
        log = log_path.open("a", encoding="utf-8")
        os.chmod(log_path, 0o600)
        try:
            process = subprocess.Popen(
                [INSTALLER, "update", "--version", target],
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                env={
                    **os.environ,
                    "ELISE_SKIP_SYSTEM_PACKAGES": "true",
                    "ELISE_UPDATE_LOCK_HELD": "true",
                    "ELISE_UPDATE_STATUS_FILE": str(STATUS_FILE),
                },
                pass_fds=(lock_handle.fileno(),),
            )
        except OSError:
            log.close()
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
            lock_handle.close()
            save_status(
                {
                    **status,
                    "state": "FAILED",
                    "progress": None,
                    "message": "La mise à jour n’a pas pu démarrer.",
                    "error": "L’installateur est indisponible.",
                }
            )
            raise
        INSTALL_PROCESS = process
        save_status(
            {
                **status,
                "state": "INSTALLING",
                "progress": 20,
                "message": "Installation et vérification de la mise à jour…",
            }
        )

        def wait_and_release() -> None:
            try:
                finish_install(process, target)
            finally:
                log.close()
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
                lock_handle.close()

        threading.Thread(target=wait_and_release, daemon=True).start()
        return status


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/status":
            self.respond(200, load_status())
            return
        if self.path == "/check":
            self.respond(200, check_release())
            return
        self.respond(404, {"error": "Not found"})

    def do_POST(self) -> None:
        try:
            length = min(int(self.headers.get("content-length", "0")), 8192)
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/credentials":
                result = write_auth(str(payload.get("username", "")), str(payload.get("token", "")))
            elif self.path == "/credentials/delete":
                result = delete_auth()
            elif self.path == "/install":
                version = payload.get("version")
                result = install(str(version) if version is not None else None)
            else:
                self.respond(404, {"error": "Not found"})
                return
            self.respond(200, result)
        except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
            self.respond(400 if isinstance(error, ValueError) else 503, {"error": redact_error(str(error))})

    def respond(self, code: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class Server(UnixStreamServer):
    allow_reuse_address = True


def periodic_check() -> None:
    # Keep the first boot quiet while Docker and the dashboard settle.
    time.sleep(120 + random.randint(0, 300))
    while True:
        try:
            check_release()
        except Exception:  # noqa: BLE001 - a failed check must not kill the agent
            pass
        time.sleep(6 * 60 * 60 + random.randint(0, 900))


def main() -> None:
    Path(SOCKET_PATH).parent.mkdir(parents=True, exist_ok=True)
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    server = Server(SOCKET_PATH, Handler)
    os.chmod(SOCKET_PATH, 0o660)
    agent_gid = os.environ.get("ELISE_AGENT_GID")
    if agent_gid:
        os.chown(SOCKET_PATH, 0, int(agent_gid))
    threading.Thread(target=periodic_check, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)


if __name__ == "__main__":
    main()
