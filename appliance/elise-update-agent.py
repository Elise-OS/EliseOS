#!/usr/bin/env python3
"""Privileged update agent for the private Élise OS distribution.

The web API talks to this process over a root-owned Unix socket.  GitHub
credentials and the actual installer never cross into the application
container; only redacted status is returned.

An installation runs as `elise-update-agent.py apply <version>` in its own
transient systemd unit: it outlives restarts of this agent and of the
containers, and is not bound by this service's sandbox.
"""

from __future__ import annotations

import fcntl
import json
import os
import random
import re
import subprocess
import sys
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
RUNNER_UNIT = os.environ.get("ELISE_UPDATE_RUNNER_UNIT", "elise-update-install")
AGENT_SERVICE = "elise-update-agent.service"
AGENT_PATH = os.path.abspath(__file__)
# GitHub allows 60 anonymous API calls an hour: every dashboard load must not spend one.
CHECK_MIN_INTERVAL = 60
INSTALL_LOCK = threading.Lock()
RUNNING_STATES = {"DOWNLOADING", "INSTALLING", "VERIFYING", "RESTARTING"}
# The installer announces each step with "→ "; the step gives the state shown to the family.
INSTALL_STEPS = (
    ("Installation de l’outil de vérification", "DOWNLOADING", 8),
    ("Téléchargement d’Élise OS", "DOWNLOADING", 12),
    ("Sauvegarde de sécurité", "INSTALLING", 25),
    ("Détection des équipements", "INSTALLING", 35),
    ("Téléchargement des composants", "DOWNLOADING", 45),
    ("Démarrage et vérification", "VERIFYING", 80),
    ("Planification de l’écran", "RESTARTING", 92),
    ("Élise est prête", "RESTARTING", 96),
)

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
            if merged["state"] in RUNNING_STATES and not install_running():
                merged.update(
                    {
                        "state": "FAILED",
                        "progress": None,
                        "message": f"La mise à jour a été interrompue ; Élise OS {merged['currentVersion']} reste installée.",
                        "error": merged.get("error") or "Installation interrompue.",
                    }
                )
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


def checked_recently(status: dict[str, Any]) -> bool:
    if status.get("state") not in ("UP_TO_DATE", "AVAILABLE") or not status.get("checkedAt"):
        return False
    try:
        checked = datetime.fromisoformat(str(status["checkedAt"]).replace("Z", "+00:00"))
    except ValueError:
        return False
    return (datetime.now(timezone.utc) - checked).total_seconds() < CHECK_MIN_INTERVAL


def check_release(force: bool = False) -> dict[str, Any]:
    if install_running():
        # The installer owns the status file until it finishes.
        return load_status()
    current_status = load_status()
    if not force and checked_recently(current_status):
        return current_status
    auth = read_auth()
    current = current_version()
    status = {**current_status, "state": "CHECKING", "error": None, "message": None}
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
    checked = check_release(force=True)
    checked["message"] = "Compte bot GitHub enregistré."
    return save_status(checked)


def delete_auth() -> dict[str, Any]:
    try:
        AUTH_FILE.unlink()
    except FileNotFoundError:
        pass
    return save_status({**base_status(), "message": "Compte bot supprimé."})


def lock_held() -> bool:
    try:
        handle = LOCK_FILE.open("a+")
    except OSError:
        return False
    with handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return False


def runner_active() -> bool:
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "--quiet", f"{RUNNER_UNIT}.service"],
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def install_running() -> bool:
    # `elise update` run by hand holds the lock; the runner unit covers the start-up gap.
    return lock_held() or runner_active()


def launch_runner(version: str) -> None:
    settings = {
        "ELISE_UPDATE_STATUS_FILE": STATUS_FILE,
        "ELISE_UPDATE_LOCK_FILE": LOCK_FILE,
        "ELISE_UPDATE_AUTH_FILE": AUTH_FILE,
        "ELISE_CONFIG_FILE": ENV_FILE,
        "ELISE_VERSION_FILE": VERSION_FILE,
        "ELISE_INSTALLER": INSTALLER,
        "ELISE_REPOSITORY": REPOSITORY,
        "ELISE_GITHUB_API": GITHUB_API,
        "HOME": "/root",
    }
    try:
        subprocess.run(
            [
                "systemd-run",
                f"--unit={RUNNER_UNIT}",
                "--description=Élise OS update",
                "--collect",
                "--quiet",
                *[f"--setenv={name}={value}" for name, value in settings.items()],
                "--",
                AGENT_PATH,
                "apply",
                version,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("La mise à jour n’a pas pu démarrer.") from error


def install(version: str | None = None) -> dict[str, Any]:
    current = load_status()
    target = version or current.get("latestVersion")
    if not isinstance(target, str) or not VALID_VERSION.fullmatch(target):
        raise ValueError("Version de mise à jour invalide.")
    with INSTALL_LOCK:
        if install_running():
            raise RuntimeError("Une mise à jour est déjà en cours.")
        # Ask GitHub again: only the newest stable release may be installed, never an older one.
        latest = str(latest_release()["tag_name"])
        if target != latest:
            raise ValueError(f"Seule la dernière version publiée ({latest}) peut être installée.")
        if version_key(target) <= version_key(current_version()):
            raise ValueError("Cette version n’est pas plus récente que la version installée.")
        status = save_status(
            {
                **current,
                "state": "DOWNLOADING",
                "latestVersion": target,
                "updateAvailable": True,
                "progress": 2,
                "message": "Préparation de la mise à jour…",
                "error": None,
            }
        )
        try:
            launch_runner(target)
        except RuntimeError as error:
            save_status({**status, "state": "FAILED", "progress": None, "message": str(error), "error": None})
            raise
        return status


def install_step(line: str) -> tuple[str, int, str] | None:
    if not line.startswith("→ "):
        return None
    text = line[2:].strip()
    for prefix, state, progress in INSTALL_STEPS:
        if text.startswith(prefix):
            return state, progress, f"{text}…"
    return None


def apply(version: str) -> int:
    """Runs the installer and records its outcome; executed inside the runner unit."""
    if not VALID_VERSION.fullmatch(version):
        print("Version invalide.", file=sys.stderr)
        return 2
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_FILE.open("a+")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_handle.close()
        print("Une mise à jour est déjà en cours.", file=sys.stderr)
        return 1
    status = save_status(
        {
            **load_status(),
            "state": "DOWNLOADING",
            "latestVersion": version,
            "updateAvailable": True,
            "progress": 5,
            "message": "Téléchargement de la mise à jour…",
            "error": None,
        }
    )
    log_path = STATUS_FILE.with_name("install.log")
    last_error: str | None = None
    return_code = 1
    try:
        with log_path.open("a", encoding="utf-8") as log:
            os.chmod(log_path, 0o600)
            log.write(f"=== {now()} mise à jour vers {version}\n")
            with subprocess.Popen(
                [INSTALLER, "update", "--version", version],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                env={
                    **os.environ,
                    "ELISE_SKIP_SYSTEM_PACKAGES": "true",
                    "ELISE_UPDATE_LOCK_HELD": "true",
                },
                pass_fds=(lock_handle.fileno(),),
            ) as process:
                assert process.stdout is not None
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    text = line.strip()
                    if text.startswith("Erreur : "):
                        last_error = redact_error(text.removeprefix("Erreur : "))
                    step = install_step(text)
                    if step:
                        state, progress, message = step
                        status = save_status({**status, "state": state, "progress": progress, "message": message})
                return_code = process.wait()
    except OSError:
        last_error = "L’installateur est indisponible."
    installed = current_version()
    if return_code == 0 and installed == version:
        save_status(
            {
                **status,
                "state": "SUCCEEDED",
                "currentVersion": installed,
                "latestVersion": version,
                "updateAvailable": False,
                "checkedAt": now(),
                "progress": 100,
                "message": f"Élise OS {version} est installée.",
                "error": None,
            }
        )
    else:
        save_status(
            {
                **status,
                "state": "ROLLED_BACK" if installed != version else "FAILED",
                "currentVersion": installed,
                "updateAvailable": True,
                "progress": None,
                "message": f"Élise OS {installed} a été conservée."
                if installed != version
                else "La mise à jour s’est arrêtée avant la fin.",
                "error": last_error or "L’installation a échoué.",
            }
        )
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
    lock_handle.close()
    # Load the agent shipped with whichever release is now installed.
    subprocess.run(["systemctl", "try-restart", "--no-block", AGENT_SERVICE], check=False)
    return 0 if return_code == 0 else 1


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
    if len(sys.argv) == 3 and sys.argv[1] == "apply":
        raise SystemExit(apply(sys.argv[2]))
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
