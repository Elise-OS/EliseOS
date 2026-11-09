"""First boot progress shared by the preparation page and the TV installation screen."""
import ipaddress
import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.parse
import uuid

STATUS = os.environ.get("ELISE_PREPARATION_STATUS", "/run/elise-preparation/status.json")
CONFIG_FILE = os.environ.get("ELISE_CONFIG_FILE", "/etc/elise/elise.env")
VERSION_FILE = os.environ.get("ELISE_VERSION_FILE", "/usr/share/elise/version")
STATE_DIR = os.environ.get("ELISE_STATE_DIR", "/var/lib/elise")
FIRSTBOOT_MARKER = os.path.join(STATE_DIR, ".firstboot-complete")
SCREEN_MARKER = os.path.join(STATE_DIR, ".screen-setup-complete")
PREPARATION_PORT = int(os.environ.get("ELISE_PREPARATION_PORT", "80"))
MACHINE_ID = os.environ.get("ELISE_MACHINE_ID_FILE", "/etc/machine-id")
# Opens the Élise app on this box's preparation (universal link / app link); without the app,
# the page offers the stores or to continue on http://<ip>. The app and the site read box, ip, lang.
SETUP_LINK = "https://eliseos.paulbreton.dev/setup/"
HOME_NETWORKS = tuple(ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))

# Each step is recognised from the messages written by elise-firstboot.sh and install-elise.sh.
STEPS = [
    ("settings", "Réglages du Raspberry Pi", 5, ("Application des réglages",)),
    ("network", "Connexion à Internet", 5, ("Connexion au réseau", "Internet est indisponible")),
    ("clock", "Mise à l’heure", 5, ("Synchronisation de l’horloge",)),
    (
        "verify",
        "Vérification de la version",
        10,
        ("Indiquez le compte bot", "Installation de", "Téléchargement d’Élise OS", "Sauvegarde", "Détection des"),
    ),
    ("download", "Téléchargement des composants", 65, ("Téléchargement des composants", "Construction des")),
    ("start", "Démarrage d’Élise", 10, ("Démarrage et vérification", "Planification", "Élise est prête")),
]
# Installer errors name what failed; they place the red step even after a service restart.
ERROR_HINTS = [
    ("network", ("Internet",)),
    ("verify", ("manifeste", "signature", "release", "cosign", "compte bot", "dépôt", "archive", "sauvegarder", "base de la version")),
    ("download", ("téléchargement a été interrompu", "GHCR")),
    ("start", ("démarrage a échoué", "contrôles de santé")),
]
# elise-firstboot.sh reports these pauses without the error flag; it retries on its own.
PAUSE_HINTS = ("Internet est indisponible", "a rencontré un problème")
_state = {"step": 0, "seen": False}
_images = {"at": 0.0, "value": None}
_tailscale = {"at": -60.0, "value": {"running": False, "ip": None, "name": None}}
_lock = threading.Lock()


def read_env(key: str) -> str:
    value = ""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as config:
            for line in config:
                if line.startswith(f"{key}="):
                    value = line.split("=", 1)[1].strip()
    except OSError:
        pass
    return value


def version() -> str:
    try:
        with open(VERSION_FILE, encoding="utf-8") as installed:
            return installed.read().strip()
    except OSError:
        return "dev"


def hostname() -> str:
    return socket.gethostname().split(".")[0]


def local_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            return probe.getsockname()[0]
    except OSError:
        return ""


def web_url(host: str, port: int) -> str:
    return f"http://{host}" if port == 80 else f"http://{host}:{port}"


def instance_id() -> str:
    """The identity /api/v1/discovery announces, and the TV's QR code with it.

    elise-firstboot.sh pins the same value in elise.env before anything else, so the final API
    keeps the identity the app saw during the preparation."""
    configured = read_env("ELISE_INSTANCE_ID")
    if configured:
        return configured
    try:
        with open(MACHINE_ID, encoding="utf-8") as machine_id:
            machine = machine_id.read().strip()
    except OSError:
        machine = socket.gethostname()
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"elise-os:{machine}"))


def home_network(address: str | None) -> bool:
    """An RFC 1918 IPv4 address: the only kind worth handing to a phone on the same Wi-Fi."""
    try:
        ip = ipaddress.ip_address(address or "")
    except ValueError:
        return False
    return ip.version == 4 and any(ip in network for network in HOME_NETWORKS)


def setup_link(box: str | None, ip: str | None, lang: str | None = None, port: int = 80) -> str | None:
    """What the TV's QR code opens: the Élise app on this box (`lang` the TV's language, left
    out while languages take turns), else the box's own page when nothing says which box or where.
    The instance id is public already (discovery answers it on the home network): no secret here."""
    if not ip:
        return None
    if box and len(box) <= 64 and port == 80 and home_network(ip):
        query = {"box": box, "ip": ip, **({"lang": lang} if lang else {})}
        return f"{SETUP_LINK}?{urllib.parse.urlencode(query)}"
    return web_url(ip, port)


def tailscale() -> dict:
    """The private access address once Tailscale is connected; never fails without it."""
    now = time.monotonic()
    with _lock:
        if now - _tailscale["at"] < 10:
            return _tailscale["value"]
        _tailscale["at"] = now
    try:
        # Exits non-zero while logged out but still describes the backend state.
        output = subprocess.run(
            ["tailscale", "status", "--json"], capture_output=True, text=True, timeout=3, check=False,
        ).stdout
        data = json.loads(output or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        data = {}
    me = data.get("Self") if isinstance(data, dict) else None
    me = me if isinstance(me, dict) else {}
    running = isinstance(data, dict) and data.get("BackendState") == "Running"
    addresses = [ip for ip in me.get("TailscaleIPs") or [] if isinstance(ip, str) and "." in ip]
    value = {
        "running": running,
        "ip": addresses[0] if running and addresses else None,
        "name": (str(me.get("DNSName") or "").rstrip(".") or None) if running else None,
    }
    with _lock:
        _tailscale["value"] = value
    return value


def images_progress() -> tuple[int, int] | None:
    """Count release images already pulled, from the digests pinned in elise.env."""
    now = time.monotonic()
    with _lock:
        if now - _images["at"] < 3:
            return _images["value"]
        _images["at"] = now
    expected = set()
    try:
        with open(CONFIG_FILE, encoding="utf-8") as config:
            for line in config:
                match = re.match(r"ELISE_[A-Z0-9]+_IMAGE=(\S+@sha256:[a-f0-9]{64})", line)
                if match:
                    expected.add(match.group(1))
    except OSError:
        pass
    value = None
    if expected:
        try:
            listed = subprocess.run(
                ["docker", "image", "ls", "--digests", "--format", "{{.Repository}}@{{.Digest}}"],
                capture_output=True, text=True, timeout=3, check=False,
            ).stdout.split()
            value = (len(expected & set(listed)), len(expected))
        except (OSError, subprocess.SubprocessError):
            value = None
    with _lock:
        _images["value"] = value
    return value


def read_raw() -> dict | None:
    try:
        with open(STATUS, encoding="utf-8") as status:
            raw = json.load(status)
        return raw if isinstance(raw, dict) else None
    except (OSError, ValueError):
        return None


def build_status(raw: dict | None, memory: dict | None = None) -> dict:
    """The preparation progress; `memory` keeps the current step between two messages."""
    memory = _state if memory is None else memory
    if raw is None:
        raw = {"message": "Démarrage de la préparation…"}
    else:
        memory["seen"] = True
    message = str(raw.get("message") or "")
    error = bool(raw.get("error"))
    for index, (_, _, _, prefixes) in enumerate(STEPS):
        if any(prefix in message for prefix in prefixes):
            memory["step"] = index
    if error:
        for key, hints in ERROR_HINTS:
            if any(hint in message for hint in hints):
                memory["step"] = next(i for i, step in enumerate(STEPS) if step[0] == key)
                break
    current = memory["step"]
    steps, percent = [], 0.0
    for index, (key, label, weight, _) in enumerate(STEPS):
        detail = None
        if index < current:
            state, done = "done", 1.0
        elif index == current:
            state, done = ("failed" if error else "current"), 0.3
            if key == "download":
                pulled = images_progress()
                if pulled:
                    detail = f"{pulled[0]} / {pulled[1]}"
                    done = pulled[0] / pulled[1]
            if "Élise est prête" in message:
                state, done = "done", 1.0
        else:
            state, done = "pending", 0.0
        percent += weight * done
        steps.append({"id": key, "label": label, "state": state, "detail": detail})
    host = hostname()
    return {
        "message": message,
        "error": error,
        "needsGithubAuth": bool(raw.get("needsGithubAuth")),
        "step": STEPS[current][0],
        "steps": steps,
        "percent": round(percent),
        "address": f"{host}.local",
        "ipAddress": local_address() or None,
        "tailscaleAddress": tailscale()["ip"],
        "version": version(),
        "updatedAt": raw.get("updatedAt"),
    }


def read_status() -> dict:
    return build_status(read_raw())
