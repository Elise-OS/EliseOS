#!/usr/bin/env python3
"""Privileged Zigbee coordinator agent for the Élise box.

The web API talks to this process over a root-owned Unix socket.  It is the only
component that touches the hardware: it lists the Zigbee keys plugged on the box
(USB, GPIO or network), recognises the model from a data file, can probe an
ambiguous key read-only, and installs it into Zigbee2MQTT with a backup and an
automatic rollback.  It never runs a command received from the API: requests
carry a port, a technology, a speed and a flag, all validated here.

`elise-zigbee-agent.py auto` is called by `elise-zigbee-setup` (boot and udev):
it installs a key on its own only when the answer is certain.
"""

from __future__ import annotations

import fcntl
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import termios
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import UnixStreamServer
from typing import Any, Callable

SOCKET_PATH = os.environ.get("ELISE_ZIGBEE_AGENT_SOCKET", "/run/elise-zigbee/agent.sock")
STATE_DIR = Path(os.environ.get("ELISE_ZIGBEE_STATE_DIR", "/var/lib/elise/zigbee"))
ENV_FILE = Path(os.environ.get("ELISE_CONFIG_FILE", "/etc/elise/elise.env"))
ROOT_DIR = Path(os.environ.get("ELISE_ROOT_DIR", "/opt/elise"))
DEV_ROOT = Path(os.environ.get("ELISE_DEV_ROOT", "/dev"))
SYS_ROOT = Path(os.environ.get("ELISE_SYS_ROOT", "/sys"))
PROC_ROOT = Path(os.environ.get("ELISE_PROC_ROOT", "/proc"))
MODELS_FILE = Path(
    os.environ.get(
        "ELISE_ZIGBEE_MODELS_FILE", str(Path(__file__).resolve().with_name("elise-zigbee-adapters.json"))
    )
)
Z2M_DATA_DIR_OVERRIDE = os.environ.get("ELISE_ZIGBEE_DATA_DIR")
COMPOSE_PROJECT = "elise-os"
VERIFY_SECONDS = int(os.environ.get("ELISE_ZIGBEE_VERIFY_SECONDS", "120"))
POLL_SECONDS = float(os.environ.get("ELISE_ZIGBEE_POLL_SECONDS", "3"))
BRIDGE_CACHE_SECONDS = 10
BACKUPS_KEPT = 5
Z2M_DATA_FILES = ("configuration.yaml", "coordinator_backup.json", "database.db", "state.json")

ADAPTERS = ("zstack", "ember", "deconz", "zigate", "zboss")
BAUDRATES = (38400, 57600, 115200, 230400, 460800, 921600)
ENV_KEYS = (
    "ZIGBEE_ADAPTER_MODE",
    "ZIGBEE_ADAPTER",
    "ZIGBEE_ADAPTER_TYPE",
    "ZIGBEE_SERIAL_PORT",
    "ZIGBEE_BAUDRATE",
    "ZIGBEE_RTSCTS",
)
ENV_VALUE = re.compile(r"^[A-Za-z0-9_./:@+=,\[\]-]*$")
TTY_NAME = re.compile(r"^tty(USB|ACM|AMA|S|XRUSB)\d+$")
HOST_NAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
INSTALL_STEPS = ("check", "backup", "configure", "restart", "verify")
STEP_PROGRESS = {"check": 8, "backup": 22, "configure": 38, "restart": 62, "verify": 96}
MDNS_SERVICES = ("_slzb-06._tcp", "_zigstar_gw._tcp", "_tubeszb._tcp")

INSTALL_LOCK = threading.Lock()
STATE_LOCK = threading.RLock()
CANCEL = threading.Event()
PROBE_CACHE: dict[str, dict[str, Any]] = {}
# One mDNS browse may last this long; the whole network search stays below the API timeout.
NETWORK_SEARCH_SECONDS = 8
# Network keys found by the last search stay in the plain status for a while: the screens poll it
# every few seconds and only search the network every half minute.
NETWORK_MEMORY_SECONDS = 90
NETWORK_MEMORY: dict[str, Any] = {"at": 0.0, "items": []}
BRIDGE_CACHE: dict[str, Any] = {"at": 0.0, "value": None}


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------- data


def load_models() -> dict[str, Any]:
    with MODELS_FILE.open(encoding="utf-8") as handle:
        return json.load(handle)


def model_by_id(models: dict[str, Any], model_id: str | None) -> dict[str, Any] | None:
    return next((item for item in models["models"] if item["id"] == model_id), None)


# ------------------------------------------------------------------- environment


def read_env(path: Path | None = None) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for line in (path or ENV_FILE).read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except OSError:
        pass
    return values


def write_env(updates: dict[str, str | None], path: Path | None = None) -> None:
    """Atomically sets (or removes, with None) keys of the env file, keeping everything else."""
    target = path or ENV_FILE
    for key, value in updates.items():
        if key not in ENV_KEYS:
            raise ValueError(f"Clé de configuration non autorisée : {key}")
        if value is not None and not ENV_VALUE.fullmatch(value):
            raise ValueError(f"Valeur de configuration invalide pour {key}.")
    try:
        lines = target.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        lines = []
    pending = dict(updates)
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else None
        if key in pending:
            value = pending.pop(key)
            if value is not None:
                output.append(f"{key}={value}")
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in pending.items() if value is not None)
    temporary = target.with_name(target.name + ".zigbee.tmp")
    temporary.write_text("\n".join(output) + "\n", encoding="utf-8")
    try:
        os.chmod(temporary, os.stat(target).st_mode & 0o777)
    except OSError:
        os.chmod(temporary, 0o640)
    os.replace(temporary, target)


def current_config() -> dict[str, Any]:
    env = read_env()
    adapter = env.get("ZIGBEE_ADAPTER", "")
    serial_port = env.get("ZIGBEE_SERIAL_PORT", "")
    if serial_port.startswith("tcp://"):
        port: str | None = serial_port
    elif adapter and adapter != "/dev/null":
        port = adapter
    else:
        port = None
    technology = env.get("ZIGBEE_ADAPTER_TYPE", "auto") or "auto"
    baudrate = env.get("ZIGBEE_BAUDRATE", "")
    rtscts = env.get("ZIGBEE_RTSCTS", "")
    return {
        "port": port,
        "adapter": technology,
        "baudrate": int(baudrate) if baudrate.isdigit() else None,
        "rtscts": {"true": True, "false": False}.get(rtscts.lower()) if rtscts else None,
        "mode": "manual" if env.get("ZIGBEE_ADAPTER_MODE") == "manual" else "auto",
    }


# ------------------------------------------------------------------ USB scanning


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None


def usb_info(tty_name: str) -> tuple[dict[str, str | None] | None, str | None]:
    """USB descriptor and kernel driver of a tty, read from sysfs."""
    device = SYS_ROOT / "class" / "tty" / tty_name / "device"
    try:
        current = Path(os.path.realpath(device))
    except OSError:
        return None, None
    driver = None
    try:
        driver = os.path.basename(os.path.realpath(device / "driver"))
    except OSError:
        pass
    for _ in range(6):
        vendor = _read_text(current / "idVendor")
        if vendor:
            return (
                {
                    "vid": vendor.lower(),
                    "pid": (_read_text(current / "idProduct") or "").lower(),
                    "manufacturer": _read_text(current / "manufacturer"),
                    "product": _read_text(current / "product"),
                    "serial": _read_text(current / "serial"),
                },
                driver,
            )
        if current.parent == current:
            break
        current = current.parent
    return None, driver


def port_holders(device: str) -> list[str]:
    """Names of the other processes holding a device open."""
    holders: set[str] = set()
    try:
        entries = list(PROC_ROOT.iterdir())
    except OSError:
        return []
    for entry in entries:
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            for descriptor in (entry / "fd").iterdir():
                try:
                    if os.readlink(descriptor) == device:
                        holders.add(_read_text(entry / "comm") or entry.name)
                except OSError:
                    continue
        except OSError:
            continue
    return sorted(holders)


def candidate_id(port: str) -> str:
    return hashlib.sha1(port.encode("utf-8")).hexdigest()[:12]


def scan_usb() -> list[dict[str, Any]]:
    """Every serial port that can be a USB (or GPIO) Zigbee key, with a stable path."""
    serial = DEV_ROOT / "serial"
    found: dict[str, dict[str, Any]] = {}

    def add(link: Path, stability: str) -> None:
        try:
            real = Path(os.path.realpath(link))
        except OSError:
            return
        if not TTY_NAME.fullmatch(real.name) or not real.exists():
            return
        # by-id links are listed first and carry the product name: later aliases are ignored.
        if real.name in found:
            return
        usb, driver = usb_info(real.name)
        port = str(link)
        found[real.name] = {
            "id": candidate_id(port),
            "kind": "usb" if usb else "gpio",
            "port": port,
            "portStability": stability,
            "device": str(real),
            "byIdName": link.name if stability == "by-id" else None,
            "usb": usb,
            "driver": driver,
            "network": None,
        }

    for folder, stability in (("by-id", "by-id"), ("by-path", "by-path")):
        try:
            for link in sorted((serial / folder).iterdir()):
                add(link, stability)
        except OSError:
            continue
    try:
        for entry in sorted(DEV_ROOT.iterdir()):
            if re.fullmatch(r"tty(USB|ACM)\d+", entry.name) and entry.name not in found:
                add(entry, "raw")
    except OSError:
        pass
    for candidate in found.values():
        holders = port_holders(candidate["device"])
        candidate["busyBy"] = holders[0] if holders else None
    return list(found.values())


# ----------------------------------------------------------------- identification


def _option(models: dict[str, Any], technology: str, baudrate: int, rtscts: bool, model_id: str | None):
    model = model_by_id(models, model_id)
    return {
        "technology": technology,
        "baudrate": baudrate,
        "rtscts": rtscts,
        "modelId": model_id,
        "modelName": model["name"] if model else None,
    }


def _model_option(models: dict[str, Any], model: dict[str, Any]) -> dict[str, Any]:
    return _option(models, model["technology"], model["baudrate"], model["rtscts"], model["id"])


def identify(
    models: dict[str, Any],
    usb: dict[str, str | None] | None,
    by_id_name: str | None,
    hostname: str | None = None,
    driver: str | None = None,
) -> dict[str, Any]:
    """Recognises a key from its USB descriptor, its by-id name or its network name."""
    hits: list[tuple[int, dict[str, Any], list[str], str]] = []
    for model in models["models"]:
        rules = model.get("match", {})
        best: tuple[int, list[str], str] | None = None
        for rule in rules.get("usb", []):
            if not usb or usb["vid"] != rule["vid"] or usb["pid"] != rule["pid"]:
                continue
            if "product" in rule:
                if not re.search(rule["product"], usb.get("product") or "", re.I):
                    continue
                score = 100
            else:
                score = 70
            if best is None or score > best[0]:
                best = (score, rule.get("ambiguousWith", []), "usb-id")
        for pattern in rules.get("byId", []):
            if by_id_name and re.search(pattern, by_id_name, re.I) and (best is None or best[0] < 90):
                best = (90, best[1] if best else [], "by-id")
        for pattern in rules.get("hostname", []):
            if hostname and re.search(pattern, hostname, re.I) and (best is None or best[0] < 85):
                best = (85, [], "hostname")
        if best:
            hits.append((best[0], model, best[1], best[2]))

    if hits:
        hits.sort(key=lambda item: -item[0])
        score, model, ambiguous_with, source = hits[0]
        options = [_model_option(models, model)]
        for other_id in ambiguous_with:
            other = model_by_id(models, other_id)
            if other:
                options.append(_model_option(models, other))
        # A second model with another technology at the same score also needs a decision.
        for other_score, other, _, _ in hits[1:]:
            if other_score == score and other["technology"] != model["technology"]:
                options.append(_model_option(models, other))
        technologies = {option["technology"] for option in options}
        confidence = "high" if score >= 90 else "medium"
        if len(technologies) > 1:
            confidence = "ambiguous"
        return {
            "modelId": model["id"] if confidence != "ambiguous" else None,
            "name": model["name"] if confidence != "ambiguous" else None,
            "vendor": model["vendor"],
            "chip": model["chip"] if confidence != "ambiguous" else None,
            "status": model["status"],
            "confidence": confidence,
            "source": source,
            "notes": list(model.get("notes", [])),
            "options": options,
        }

    chip = None
    if usb:
        chip = next(
            (
                item
                for item in models["genericChips"]
                if any(rule["vid"] == usb["vid"] and rule["pid"] == usb["pid"] for rule in item["usb"])
            ),
            None,
        )
    if chip is None and driver == "cdc_acm":
        chip = next(item for item in models["genericChips"] if item["id"] == "generic-cdc-acm")
    if chip:
        return {
            "modelId": None,
            "name": None,
            "vendor": (usb or {}).get("manufacturer"),
            "chip": chip["name"],
            "status": None,
            "confidence": "ambiguous",
            "source": "generic",
            "notes": [],
            "options": [
                _option(models, item["technology"], item["baudrate"], item["rtscts"], None)
                for item in chip["candidates"]
            ],
        }
    return {
        "modelId": None,
        "name": None,
        "vendor": (usb or {}).get("manufacturer"),
        "chip": None,
        "status": None,
        "confidence": "unknown",
        "source": "unknown",
        "notes": [],
        "options": [],
    }


def apply_probe(models: dict[str, Any], identity: dict[str, Any], probe: dict[str, Any]) -> dict[str, Any]:
    """A positive probe settles the technology; the model name is kept when it agrees."""
    technology, baudrate = probe["technology"], probe["baudrate"]
    match = next((o for o in identity["options"] if o["technology"] == technology), None)
    rtscts = match["rtscts"] if match else models["technologies"][technology]["rtscts"]
    option = _option(models, technology, baudrate, rtscts, match["modelId"] if match else None)
    named = option["modelId"] is not None
    model = model_by_id(models, option["modelId"])
    return {
        **identity,
        "modelId": option["modelId"],
        "name": option["modelName"],
        "chip": model["chip"] if model else identity["chip"],
        "status": model["status"] if model else identity["status"],
        "notes": list(model.get("notes", [])) if model else identity["notes"],
        "confidence": "high",
        "source": "probe" if not named or identity["confidence"] == "ambiguous" else identity["source"],
        "options": [option],
    }


def describe(models: dict[str, Any], raw: dict[str, Any], current_port: str | None) -> dict[str, Any]:
    """Raw scan entry → candidate as exposed by the API."""
    identity = identify(
        models,
        raw["usb"],
        raw.get("byIdName"),
        (raw.get("network") or {}).get("name"),
        raw.get("driver"),
    )
    cached = PROBE_CACHE.get(raw["id"])
    if cached and cached.get("serial") == (raw["usb"] or {}).get("serial"):
        identity = apply_probe(models, identity, cached)
    result = {key: value for key, value in raw.items() if key != "byIdName"}
    result["busy"] = {"by": raw["busyBy"]} if raw.get("busyBy") else None
    result.pop("busyBy", None)
    result["isCurrent"] = current_port is not None and raw["port"] == current_port
    result["identity"] = identity
    return result


# ------------------------------------------------------------------ network keys


def parse_avahi(output: str) -> list[dict[str, Any]]:
    """`avahi-browse -rpt` output → network coordinators (resolved lines start with '=')."""
    found: dict[str, dict[str, Any]] = {}
    for line in output.splitlines():
        fields = line.split(";")
        if len(fields) < 9 or fields[0] != "=" or fields[2] != "IPv4":
            continue
        name, service, host, address, port = fields[3], fields[4], fields[6], fields[7], fields[8]
        if not port.isdigit():
            continue
        hostname = host[:-6] if host.endswith(".local") else host
        found[address] = {
            "host": address,
            "port": 6638,
            "name": hostname or name,
            "service": service.strip(".").split(".")[0].replace("\\", ""),
        }
    return list(found.values())


def network_candidate(host: str, port: int, name: str | None, service: str | None) -> dict[str, Any]:
    url = f"tcp://{host}:{port}"
    return {
        "id": candidate_id(url),
        "kind": "network",
        "port": url,
        "portStability": "network",
        "device": None,
        "byIdName": None,
        "usb": None,
        "driver": None,
        "network": {"host": host, "port": port, "name": name, "service": service},
        "busyBy": None,
    }


def browse_service(avahi: str, service: str) -> list[dict[str, Any]]:
    """One mDNS service type; raises when avahi cannot run or runs out of time."""
    output = subprocess.run(
        [avahi, "-rpt", service], capture_output=True, text=True, timeout=NETWORK_SEARCH_SECONDS, check=False
    ).stdout
    return parse_avahi(output)


def scan_network() -> tuple[list[dict[str, Any]], str]:
    """Network keys announced on the home network, and how the search went.

    The services are browsed side by side so that a slow one does not delay the others. The state is
    `ok` (at least one service answered), `unavailable` (no avahi on this box) or `failed`.
    """
    avahi = shutil.which("avahi-browse")
    if not avahi:
        return [], "unavailable"
    outcomes: dict[str, list[dict[str, Any]] | None] = {}

    def browse(service: str) -> None:
        try:
            outcomes[service] = browse_service(avahi, service)
        except (OSError, subprocess.SubprocessError):
            outcomes[service] = None

    threads = [threading.Thread(target=browse, args=(service,), daemon=True) for service in MDNS_SERVICES]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(NETWORK_SEARCH_SECONDS + 2)
    results: list[dict[str, Any]] = []
    answered = False
    for service in MDNS_SERVICES:
        items = outcomes.get(service)
        if items is None:
            continue
        answered = True
        results += [network_candidate(i["host"], i["port"], i["name"], i["service"]) for i in items]
    return results, "ok" if answered else "failed"


def remembered_network(include_expired: bool = False) -> list[dict[str, Any]]:
    """Network keys of the last successful search, kept briefly so that the cheap status shows them."""
    if not NETWORK_MEMORY["at"]:
        return []
    if not include_expired and time.monotonic() - NETWORK_MEMORY["at"] > NETWORK_MEMORY_SECONDS:
        return []
    return list(NETWORK_MEMORY["items"])


# ------------------------------------------------------------------------ probes

MT_PING = bytes([0xFE, 0x00, 0x21, 0x01, 0x20])
ASH_RESET = bytes([0x1A, 0xC0, 0x38, 0xBC, 0x7E])
ZIGATE_VERSION = bytes([0x01, 0x02, 0x10, 0x10, 0x02, 0x10, 0x02, 0x10, 0x10, 0x03])


def deconz_version_frame(sequence: int = 1) -> bytes:
    """SLIP frame of the deCONZ "read firmware version" command."""
    data = bytes([0x0D, sequence, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00])
    crc = (~sum(data) + 1) & 0xFFFF
    body = data + crc.to_bytes(2, "little")
    escaped = body.replace(b"\xdb", b"\xdb\xdd").replace(b"\xc0", b"\xdb\xdc")
    return b"\xc0" + escaped + b"\xc0"


def answers_mt(reply: bytes) -> bool:
    return b"\xfe" in reply and re.search(rb"\xfe.\x61\x01", reply, re.S) is not None


def answers_ash(reply: bytes) -> bool:
    # RSTACK: control byte 0xC1 then ASH version 2.
    return b"\xc1\x02" in reply


def answers_deconz(reply: bytes) -> bool:
    return len(reply) >= 4 and reply[0] == 0xC0 and reply[1] == 0x0D and reply[3] == 0x00


def answers_zigate(reply: bytes) -> bool:
    return b"\x01\x80" in reply


PROBES: dict[str, tuple[bytes | Callable[[], bytes], Callable[[bytes], bool]]] = {
    "zstack": (MT_PING, answers_mt),
    "ember": (ASH_RESET, answers_ash),
    "deconz": (deconz_version_frame, answers_deconz),
    "zigate": (ZIGATE_VERSION, answers_zigate),
}


class SerialTransport:
    """Raw 8N1 serial port with no flow control, opened without controlling terminal."""

    def __init__(self, port: str, baudrate: int) -> None:
        speed = getattr(termios, f"B{baudrate}", None)
        if speed is None:
            raise OSError(f"Débit non pris en charge : {baudrate}")
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            attrs = termios.tcgetattr(self.fd)
            attrs[0] = 0
            attrs[1] = 0
            attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
            attrs[3] = 0
            attrs[4] = speed
            attrs[5] = speed
            attrs[6][termios.VMIN] = 0
            attrs[6][termios.VTIME] = 0
            termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
            termios.tcflush(self.fd, termios.TCIOFLUSH)
        except Exception:
            os.close(self.fd)
            raise

    def write(self, data: bytes) -> None:
        os.write(self.fd, data)

    def read(self, timeout: float) -> bytes:
        import select

        deadline = time.monotonic() + timeout
        chunks = b""
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(self.fd, 256)
                except BlockingIOError:
                    continue
                if chunk:
                    chunks += chunk
                    deadline = max(deadline, time.monotonic() + 0.15) if len(chunks) < 4 else deadline
        return chunks

    def close(self) -> None:
        try:
            os.close(self.fd)
        except OSError:
            pass


class TcpTransport:
    def __init__(self, host: str, port: int) -> None:
        self.sock = socket.create_connection((host, port), timeout=4)
        self.sock.settimeout(0.1)

    def write(self, data: bytes) -> None:
        self.sock.sendall(data)

    def read(self, timeout: float) -> bytes:
        deadline = time.monotonic() + timeout
        chunks = b""
        while time.monotonic() < deadline:
            try:
                chunk = self.sock.recv(256)
            except (socket.timeout, BlockingIOError):
                continue
            except OSError:
                break
            if not chunk:
                break
            chunks += chunk
        return chunks

    def close(self) -> None:
        self.sock.close()


def open_transport(port: str, baudrate: int):
    if port.startswith("tcp://"):
        host, _, number = port[6:].rpartition(":")
        return TcpTransport(host.strip("[]"), int(number))
    return SerialTransport(port, baudrate)


def probe_technology(
    models: dict[str, Any],
    port: str,
    technologies: list[str],
    opener: Callable[[str, int], Any] = open_transport,
) -> dict[str, Any] | None:
    """Asks the key, read-only, which firmware family answers; None when nothing answers."""
    for technology in technologies:
        if technology not in PROBES:
            continue
        frame, answers = PROBES[technology]
        for baudrate in models["technologies"][technology]["baudrates"]:
            try:
                transport = opener(port, baudrate)
            except (OSError, ValueError):
                return None
            try:
                transport.write(frame() if callable(frame) else frame)
                reply = transport.read(1.5)
            except OSError:
                reply = b""
            finally:
                transport.close()
            if reply and answers(reply):
                return {"technology": technology, "baudrate": baudrate}
    return None


# -------------------------------------------------------------- Docker / Zigbee2MQTT


def run(
    command: list[str], timeout: int = 60, check: bool = False
) -> subprocess.CompletedProcess[str]:
    """The only place a subprocess is started; every command is a fixed argument list."""
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=check)


def compose_base() -> list[str] | None:
    try:
        release = Path(os.path.realpath(ROOT_DIR / "current"))
    except OSError:
        return None
    if not release.is_dir():
        return None
    env = read_env()
    base = ["docker", "compose", "--project-name", COMPOSE_PROJECT, "--env-file", str(ENV_FILE)]
    if env.get("ELISE_VERSION") == "dev":
        return [*base, "-f", str(release / "compose.yaml")]
    base += ["-f", str(release / "compose.yaml"), "-f", str(release / "compose.release.yaml")]
    if os.uname().machine == "aarch64":
        base += [
            "-f",
            str(release / "compose.raspberry.yaml"),
            "-f",
            str(release / "compose.raspberry.release.yaml"),
        ]
    return base


def compose(*args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    base = compose_base()
    if base is None:
        raise RuntimeError("Installation Élise introuvable.")
    return run([*base, *args], timeout=timeout)


def container_id(service: str) -> str | None:
    try:
        output = compose("ps", "-a", "-q", service, timeout=30).stdout.strip()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return None
    return output.splitlines()[0] if output else None


def container_state(cid: str | None) -> str:
    """running | restarting | stopped | missing"""
    if not cid:
        return "missing"
    try:
        result = run(["docker", "inspect", "-f", "{{.State.Status}}", cid], timeout=15)
    except (OSError, subprocess.SubprocessError):
        return "missing"
    status = result.stdout.strip()
    if result.returncode != 0 or not status:
        return "missing"
    return {"running": "running", "restarting": "restarting"}.get(status, "stopped")


def container_logs(cid: str | None, tail: int = 300) -> str:
    if not cid:
        return ""
    try:
        result = run(["docker", "logs", "--tail", str(tail), cid], timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ""
    return (result.stdout or "") + (result.stderr or "")


def z2m_data_dir() -> Path | None:
    if Z2M_DATA_DIR_OVERRIDE:
        return Path(Z2M_DATA_DIR_OVERRIDE)
    try:
        result = run(
            ["docker", "volume", "inspect", "-f", "{{.Mountpoint}}", f"{COMPOSE_PROJECT}_zigbee2mqtt_data"],
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    mount = result.stdout.strip()
    return Path(mount) if result.returncode == 0 and mount else None


def _hex(value: Any) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return f"0x{value:04x}"
    if isinstance(value, list) and all(isinstance(item, int) for item in value):
        return "0x" + "".join(f"{item:02x}" for item in value)
    return str(value)


def parse_bridge(output: str) -> dict[str, Any]:
    """`mosquitto_sub -v` lines of the three bridge topics → state, coordinator, network, devices."""
    result: dict[str, Any] = {"state": "unknown", "coordinator": None, "deviceCount": None}
    for line in output.splitlines():
        topic, _, payload = line.partition(" ")
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if topic.endswith("/bridge/state") and isinstance(value, dict):
            result["state"] = "online" if value.get("state") == "online" else "offline"
        elif topic.endswith("/bridge/info") and isinstance(value, dict):
            coordinator = value.get("coordinator") or {}
            network = value.get("network") or {}
            meta = coordinator.get("meta") or {}
            revision = meta.get("revision")
            result["coordinator"] = {
                "type": str(coordinator["type"]) if coordinator.get("type") else None,
                "firmware": str(revision) if revision is not None else None,
                "meta": meta,
                "ieee": coordinator.get("ieee_address"),
                "channel": network.get("channel") if isinstance(network.get("channel"), int) else None,
                "panId": _hex(network.get("pan_id")),
                "extendedPanId": _hex(network.get("extended_pan_id")),
            }
        elif topic.endswith("/bridge/devices") and isinstance(value, list):
            result["deviceCount"] = sum(
                1 for item in value if isinstance(item, dict) and item.get("type") != "Coordinator"
            )
    return result


def read_bridge(force: bool = False) -> dict[str, Any]:
    """Reads Zigbee2MQTT's retained bridge topics through the broker container (cached)."""
    cached = BRIDGE_CACHE["value"]
    if cached is not None and not force and time.monotonic() - BRIDGE_CACHE["at"] < BRIDGE_CACHE_SECONDS:
        return cached
    value: dict[str, Any] = {"state": "unknown", "coordinator": None, "deviceCount": None}
    broker = container_id("mosquitto")
    if broker and container_state(broker) == "running":
        try:
            result = run(
                [
                    "docker",
                    "exec",
                    broker,
                    "sh",
                    "-c",
                    'mosquitto_sub -h 127.0.0.1 -u zigbee2mqtt -P "$(cat /run/elise-secrets/mqtt_password)" '
                    "-v -C 3 -W 4 -t zigbee2mqtt/bridge/state -t zigbee2mqtt/bridge/info "
                    "-t zigbee2mqtt/bridge/devices",
                ],
                timeout=15,
            )
            value = parse_bridge(result.stdout)
        except (OSError, subprocess.SubprocessError):
            pass
    BRIDGE_CACHE.update({"at": time.monotonic(), "value": value})
    return value


FIRMWARE_FLOORS = {"zstack": 20210708, "deconz": 0x26780700}


def firmware_status(technology: str | None, coordinator: dict[str, Any] | None) -> str:
    """ok | old | unknown — a hint only, it never blocks anything."""
    if not coordinator or not coordinator.get("firmware"):
        return "unknown"
    meta = coordinator.get("meta") or {}
    revision = str(coordinator["firmware"])
    if technology == "zstack":
        digits = re.search(r"\d{8}", revision)
        return "unknown" if not digits else "ok" if int(digits.group()) >= FIRMWARE_FLOORS["zstack"] else "old"
    if technology == "ember":
        version = re.match(r"(\d+)\.(\d+)", revision)
        if not version and isinstance(meta.get("major"), int):
            version = None
            major, minor = meta["major"], meta.get("minor", 0)
        elif version:
            major, minor = int(version.group(1)), int(version.group(2))
        else:
            return "unknown"
        return "ok" if (major, minor) >= (7, 4) else "old"
    if technology == "deconz":
        digits = re.fullmatch(r"(?:0x)?([0-9a-fA-F]{8})", revision)
        if not digits:
            return "unknown"
        return "ok" if int(digits.group(1), 16) >= FIRMWARE_FLOORS["deconz"] else "old"
    return "unknown"


FAILURE_PATTERNS = (
    ("NETWORK_MISMATCH", r"not consistent|inconsistent|network (key|settings).*(differ|mismatch)|adapter backup"),
    ("PORT_UNAVAILABLE", r"ENOENT|No such file|Permission denied|EACCES|EBUSY|resource busy|Error while opening serialport"),
    (
        "FIRMWARE_OLD",
        r"(?:adapter\s+)?EZSP protocol version.*(?:not supported|unsupported|too old)|"
        r"(?:Ember|EZSP).*(?:firmware|protocol).*(?:minimum|required|too old|unsupported)",
    ),
    ("WRONG_ADAPTER", r"unknown adapter|Adapter .* not supported|Failed to determine adapter"),
    ("NO_ANSWER", r"Failed to start zigbee-herdsman|Failure to connect|not responding|ASH_ERROR|Exiting\.\.\."),
)


def classify_failure(logs: str) -> str | None:
    for code, pattern in FAILURE_PATTERNS:
        if re.search(pattern, logs, re.I):
            return code
    return None


def last_error_line(logs: str) -> str | None:
    lines = [line.strip() for line in logs.splitlines() if re.search(r"error|fail|exit", line, re.I)]
    return lines[-1][-300:] if lines else None


# ------------------------------------------------------------------------- status


def status_file(name: str) -> Path:
    return STATE_DIR / name


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.chmod(temporary, 0o640)
    os.replace(temporary, path)


def idle_install() -> dict[str, Any]:
    return {
        "state": "IDLE",
        "step": None,
        "steps": [{"id": step, "state": "pending"} for step in INSTALL_STEPS],
        "progress": None,
        "startedAt": None,
        "finishedAt": None,
        "target": None,
        "networkMode": "keep",
        "errorCode": None,
        "detail": None,
        "rolledBack": False,
        "backupId": None,
        "coordinator": None,
    }


def load_install() -> dict[str, Any]:
    stored = read_json(status_file("install.json"))
    if not isinstance(stored, dict):
        return idle_install()
    merged = idle_install()
    merged.update({key: stored[key] for key in merged if key in stored})
    return merged


def save_install(install: dict[str, Any]) -> dict[str, Any]:
    with STATE_LOCK:
        write_json(status_file("install.json"), install)
    return install


def build_current(models: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    config = current_config()
    port = config["port"]
    if port is None:
        return None
    match = next((item for item in candidates if item["port"] == port), None)
    pinned = read_json(status_file("current.json")) or {}
    model = model_by_id(models, pinned.get("modelId")) if pinned.get("port") == port else None
    if model is None and match is not None:
        model = model_by_id(models, match["identity"]["modelId"])
    if port.startswith("tcp://"):
        present = True
    else:
        present = match is not None or Path(os.path.realpath(port)).exists()
    cid = container_id("zigbee2mqtt")
    container = container_state(cid)
    bridge = read_bridge() if container == "running" else {"state": "offline", "coordinator": None, "deviceCount": None}
    coordinator = bridge["coordinator"]
    technology = config["adapter"] if config["adapter"] in ADAPTERS else None
    if technology is None and match is not None and len(match["identity"]["options"]) == 1:
        technology = match["identity"]["options"][0]["technology"]
    return {
        **config,
        "present": present,
        "candidateId": match["id"] if match else candidate_id(port),
        "model": {
            "id": model["id"],
            "name": model["name"],
            "vendor": model["vendor"],
            "chip": model["chip"],
            "status": model["status"],
            "notes": list(model.get("notes", [])),
        }
        if model
        else None,
        "usb": match["usb"] if match else None,
        "z2m": {"container": container, "bridge": bridge["state"]},
        "coordinator": {key: value for key, value in coordinator.items() if key != "meta"}
        if coordinator
        else None,
        "deviceCount": bridge["deviceCount"],
        "firmware": firmware_status(technology, coordinator),
    }


def build_status(include_network: bool = False) -> dict[str, Any]:
    models = load_models()
    config = current_config()
    outcome = {"usb": "ok", "network": "skipped"}
    network_found: list[dict[str, Any]] = []
    network_done = threading.Event()

    def search_network() -> None:
        nonlocal network_found
        try:
            network_found, outcome["network"] = scan_network()
        except Exception:  # a network problem must never hide the keys plugged on the box
            outcome["network"] = "failed"
        finally:
            network_done.set()

    if include_network:
        threading.Thread(target=search_network, daemon=True).start()
    try:
        raw = scan_usb()
    except Exception:  # and the other way round
        raw = []
        outcome["usb"] = "failed"
    if include_network:
        network_done.wait(NETWORK_SEARCH_SECONDS + 4)
        if not network_done.is_set():
            outcome["network"] = "failed"
        elif outcome["network"] == "ok":
            NETWORK_MEMORY.update(at=time.monotonic(), items=network_found)
        network_items = network_found if outcome["network"] == "ok" else remembered_network()
    else:
        network_items = remembered_network()
    known = {item["port"] for item in raw}
    raw += [item for item in network_items if item["port"] not in known]
    saved = read_json(status_file("network-keys.json")) or []
    if isinstance(saved, list):
        for item in saved:
            url = f"tcp://{item.get('host')}:{item.get('port')}"
            if all(entry["port"] != url for entry in raw) and item.get("host") and item.get("port"):
                raw.append(network_candidate(item["host"], item["port"], item.get("name"), None))
    ids = {item["id"] for item in raw}
    for stale in [key for key in PROBE_CACHE if key not in ids]:
        del PROBE_CACHE[stale]
    candidates = [describe(models, item, config["port"]) for item in raw]
    if config["port"] and config["port"].startswith("tcp://") and all(c["port"] != config["port"] for c in candidates):
        host, _, number = config["port"][6:].rpartition(":")
        if number.isdigit():
            candidates.append(
                describe(models, network_candidate(host.strip("[]"), int(number), host, None), config["port"])
            )
    current = build_current(models, candidates)
    install = load_install()
    others = [item for item in candidates if not item["isCurrent"]]
    issues: list[str] = []
    if len([c for c in candidates if c["kind"] == "usb"]) > 1:
        issues.append("multiple-keys")
    if current:
        if current["z2m"]["container"] != "running":
            issues.append("z2m-stopped")
        elif current["z2m"]["bridge"] == "offline":
            issues.append("z2m-offline")
        if current["firmware"] == "old":
            issues.append("firmware-old")
        if current["model"] and current["model"]["status"] in ("discouraged", "experimental"):
            issues.append("model-" + current["model"]["status"])
        match = next((c for c in candidates if c["isCurrent"]), None)
        if match and match["busy"] and match["busy"]["by"] not in ("node", "zigbee2mqtt", "docker-proxy"):
            issues.append("port-busy")
    if others and current and current["present"]:
        issues.append("other-key-plugged")
    if install["state"] == "RUNNING":
        state = "INSTALLING"
    elif others and (current is None or not current["present"]):
        state = "NEW_KEY"
    elif current is None:
        state = "NO_KEY"
    elif not current["present"]:
        state = "KEY_MISSING"
    elif any(issue in issues for issue in ("z2m-stopped", "z2m-offline", "port-busy")):
        state = "ATTENTION"
    else:
        state = "READY"
    return {
        "state": state,
        "current": current,
        "candidates": candidates,
        "install": install,
        "issues": issues,
        "checkedAt": now(),
        "scan": outcome,
    }


# ------------------------------------------------------------------ request checks


class RequestError(ValueError):
    pass


def validate_port(port: str) -> tuple[str, str]:
    """Returns (port, kind). Only serial devices of the box or tcp:// addresses are accepted."""
    if port.startswith("tcp://"):
        host, _, number = port[6:].rpartition(":")
        host = host.strip("[]")
        if not number.isdigit() or not 1 <= int(number) <= 65535 or not host:
            raise RequestError("Adresse réseau invalide (exemple : tcp://192.168.1.50:6638).")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if not HOST_NAME.fullmatch(host):
                raise RequestError("Adresse réseau invalide (exemple : tcp://192.168.1.50:6638).") from None
        return port, "network"
    path = Path(port)
    inside_serial = any(
        path.parent == DEV_ROOT / "serial" / folder for folder in ("by-id", "by-path")
    )
    if not (inside_serial or path.parent == DEV_ROOT):
        raise RequestError("Ce port n’est pas un port série de la box.")
    if not re.fullmatch(r"[A-Za-z0-9._:+@=-]+", path.name):
        raise RequestError("Nom de port invalide.")
    real = Path(os.path.realpath(path))
    if not path.exists() or not TTY_NAME.fullmatch(real.name):
        raise RequestError("Ce port série n’existe pas ou n’est pas branché.")
    return port, "usb"


def validate_install(payload: dict[str, Any], models: dict[str, Any]) -> dict[str, Any]:
    adapter = payload.get("adapter")
    baudrate = payload.get("baudrate")
    rtscts = payload.get("rtscts")
    network_mode = payload.get("networkMode", "keep")
    if adapter == "ezsp":
        raise RequestError("Le pilote « ezsp » est obsolète : choisissez « ember ».")
    if adapter not in ADAPTERS:
        raise RequestError("Technologie Zigbee inconnue.")
    if not isinstance(baudrate, int) or isinstance(baudrate, bool) or baudrate not in BAUDRATES:
        raise RequestError("Débit non pris en charge.")
    if not isinstance(rtscts, bool):
        raise RequestError("Contrôle de flux invalide.")
    if network_mode not in ("keep", "new"):
        raise RequestError("Mode réseau invalide.")
    if network_mode == "new" and payload.get("confirmNewNetwork") is not True:
        raise RequestError("Un nouveau réseau Zigbee exige une confirmation explicite.")
    port = payload.get("port")
    wanted = payload.get("candidateId")
    if wanted:
        candidates = scan_usb()
        raw = next((item for item in candidates if item["id"] == wanted), None)
        if raw is None:
            saved = read_json(status_file("network-keys.json")) or []
            for item in saved if isinstance(saved, list) else []:
                url = f"tcp://{item.get('host')}:{item.get('port')}"
                if candidate_id(url) == wanted:
                    port = url
        else:
            port = raw["port"]
        if port is None:
            raise RequestError("Cette clé n’est plus branchée.")
    if not isinstance(port, str):
        raise RequestError("Port manquant.")
    port, kind = validate_port(port)
    model = model_by_id(models, payload.get("modelId") if isinstance(payload.get("modelId"), str) else None)
    return {
        "port": port,
        "kind": kind,
        "adapter": adapter,
        "baudrate": baudrate,
        "rtscts": rtscts,
        "networkMode": network_mode,
        "modelId": model["id"] if model else None,
        "modelName": model["name"] if model else None,
    }


# ---------------------------------------------------------------------- install


def strip_network_keys(text: str) -> str:
    """Sets the three network identifiers of configuration.yaml to GENERATE (new network)."""
    wanted = {"network_key": False, "pan_id": False, "ext_pan_id": False}
    output: list[str] = []
    lines = text.splitlines()
    index = 0
    advanced_indent: str | None = None
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(\s*)(network_key|pan_id|ext_pan_id)\s*:", line)
        if match:
            indent = len(match.group(1))
            output.append(f"{match.group(1)}{match.group(2)}: GENERATE")
            wanted[match.group(2)] = True
            index += 1
            while index < len(lines):
                follow = lines[index]
                stripped = follow.lstrip()
                follow_indent = len(follow) - len(stripped)
                if stripped.startswith("#") or not stripped:
                    break
                if follow_indent > indent or (stripped.startswith("-") and follow_indent >= indent):
                    index += 1
                    continue
                break
            continue
        if re.match(r"^advanced\s*:\s*$", line):
            advanced_indent = "  "
        output.append(line)
        index += 1
    missing = [key for key, done in wanted.items() if not done]
    if missing:
        block = [f"  {key}: GENERATE" for key in missing]
        if advanced_indent is not None:
            position = next(i for i, line in enumerate(output) if re.match(r"^advanced\s*:\s*$", line)) + 1
            output[position:position] = block
        else:
            output += ["advanced:", *block]
    return "\n".join(output) + "\n"


def backup_dir(backup_id: str) -> Path:
    return STATE_DIR / "backups" / backup_id


def make_backup(backup_id: str) -> dict[str, Any]:
    """Copies the Zigbee settings of elise.env and the Zigbee2MQTT data files."""
    folder = backup_dir(backup_id)
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    env = read_env()
    write_json(folder / "env.json", {key: env.get(key) for key in ENV_KEYS})
    data = z2m_data_dir()
    saved: list[str] = []
    if data and data.is_dir():
        for name in Z2M_DATA_FILES:
            source = data / name
            if source.is_file():
                shutil.copy2(source, folder / name)
                saved.append(name)
    write_json(folder / "manifest.json", {"createdAt": now(), "dataFiles": saved})
    return {"dataFiles": saved}


def prune_backups() -> None:
    root = STATE_DIR / "backups"
    try:
        folders = sorted(item for item in root.iterdir() if item.is_dir())
    except OSError:
        return
    for stale in folders[:-BACKUPS_KEPT]:
        shutil.rmtree(stale, ignore_errors=True)


def restore_backup(backup_id: str) -> None:
    folder = backup_dir(backup_id)
    stored = read_json(folder / "env.json") or {}
    write_env({key: stored.get(key) for key in ENV_KEYS})
    manifest = read_json(folder / "manifest.json") or {}
    data = z2m_data_dir()
    if data and data.is_dir():
        for name in Z2M_DATA_FILES:
            target = data / name
            if name in manifest.get("dataFiles", []):
                shutil.copy2(folder / name, target)
            elif name in ("coordinator_backup.json", "database.db", "state.json") and target.exists():
                # Created by the failed attempt: it must not survive the rollback.
                target.unlink()


def apply_target(target: dict[str, Any]) -> None:
    network = target["kind"] == "network"
    write_env(
        {
            "ZIGBEE_ADAPTER_MODE": "manual",
            "ZIGBEE_ADAPTER": "/dev/null" if network else target["port"],
            "ZIGBEE_ADAPTER_TYPE": target["adapter"],
            "ZIGBEE_SERIAL_PORT": target["port"] if network else None,
            "ZIGBEE_BAUDRATE": str(target["baudrate"]),
            "ZIGBEE_RTSCTS": "true" if target["rtscts"] else "false",
        }
    )


def start_z2m() -> None:
    result = compose("up", "-d", "--no-deps", "--force-recreate", "zigbee2mqtt", timeout=180)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "docker compose a échoué")[-300:])


def stop_z2m() -> None:
    compose("stop", "zigbee2mqtt", timeout=90)


def wait_for_z2m(deadline_seconds: float) -> tuple[bool, str | None, str | None, dict[str, Any] | None]:
    """(healthy, errorCode, detail, bridge) — healthy needs the log line AND the online bridge."""
    deadline = time.monotonic() + deadline_seconds
    logs = ""
    while time.monotonic() < deadline:
        if CANCEL.is_set():
            return False, "CANCELLED", None, None
        time.sleep(POLL_SECONDS)
        cid = container_id("zigbee2mqtt")
        state = container_state(cid)
        logs = container_logs(cid)
        if "Zigbee2MQTT started" in logs and state == "running":
            bridge = read_bridge(force=True)
            if bridge["state"] == "online" and bridge["coordinator"]:
                return True, None, None, bridge
            continue
        failure = classify_failure(logs)
        if state in ("stopped", "missing") or (state == "restarting" and failure):
            return False, failure or "NO_ANSWER", last_error_line(logs), None
        if failure == "NETWORK_MISMATCH":
            return False, failure, last_error_line(logs), None
    failure = classify_failure(logs)
    return False, failure or "TIMEOUT", last_error_line(logs), None


def set_step(install: dict[str, Any], step: str, state: str) -> None:
    for item in install["steps"]:
        if item["id"] == step:
            item["state"] = state
    install["step"] = step
    if state in ("running", "done"):
        install["progress"] = STEP_PROGRESS[step] if state == "done" else max(install["progress"] or 0, STEP_PROGRESS[step] - 12)
    save_install(install)


def finish(install: dict[str, Any], state: str, **fields: Any) -> dict[str, Any]:
    install.update({"state": state, "finishedAt": now(), **fields})
    if state == "SUCCEEDED":
        install["progress"] = 100
    else:
        install["progress"] = None
    return save_install(install)


def rollback(install: dict[str, Any], backup_id: str | None, had_key: bool) -> bool:
    """Puts the previous settings back and restarts what ran before; True when it is running again."""
    set_step(install, install["step"] or "restart", "failed")
    install["step"] = "rollback"
    save_install(install)
    try:
        try:
            stop_z2m()
        except (OSError, subprocess.SubprocessError, RuntimeError):
            pass
        if backup_id:
            restore_backup(backup_id)
        install["rolledBack"] = True
        save_install(install)
        if not had_key:
            return True
        start_z2m()
        healthy, _, _, _ = wait_for_z2m(float(VERIFY_SECONDS))
        return healthy
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError):
        return False


def run_install(target: dict[str, Any]) -> None:
    """Executed in a thread; every exit leaves a final state in install.json."""
    models = load_models()
    install = idle_install()
    install.update(
        {
            "state": "RUNNING",
            "startedAt": now(),
            "networkMode": target["networkMode"],
            "target": {
                "port": target["port"],
                "adapter": target["adapter"],
                "baudrate": target["baudrate"],
                "rtscts": target["rtscts"],
                "modelName": target.get("modelName"),
            },
            "progress": 2,
        }
    )
    save_install(install)
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    previous = current_config()
    had_key = previous["port"] is not None
    install["backupId"] = backup_id
    modified = False
    try:
        set_step(install, "check", "running")
        if target["kind"] == "network":
            try:
                host, _, number = target["port"][6:].rpartition(":")
                socket.create_connection((host.strip("[]"), int(number)), timeout=5).close()
            except OSError:
                finish(install, "FAILED", errorCode="KEY_UNREACHABLE", rolledBack=False)
                return
        else:
            holders = [name for name in port_holders(os.path.realpath(target["port"])) if name not in ("node",)]
            if holders and target["port"] != previous["port"]:
                finish(install, "FAILED", errorCode="PORT_BUSY", detail=holders[0], rolledBack=False)
                return
        if shutil.which("docker") is None or compose_base() is None:
            finish(install, "FAILED", errorCode="NO_Z2M", rolledBack=False)
            return
        set_step(install, "check", "done")
        if CANCEL.is_set():
            finish(install, "CANCELLED", errorCode="CANCELLED", rolledBack=False)
            return

        set_step(install, "backup", "running")
        make_backup(backup_id)
        prune_backups()
        set_step(install, "backup", "done")

        set_step(install, "configure", "running")
        if had_key:
            stop_z2m()
        modified = True
        apply_target(target)
        data = z2m_data_dir()
        if target["networkMode"] == "new" and data and data.is_dir():
            configuration = data / "configuration.yaml"
            if configuration.is_file():
                configuration.write_text(
                    strip_network_keys(configuration.read_text(encoding="utf-8")), encoding="utf-8"
                )
            for name in ("coordinator_backup.json", "database.db", "state.json"):
                (data / name).unlink(missing_ok=True)
        set_step(install, "configure", "done")

        set_step(install, "restart", "running")
        start_z2m()
        set_step(install, "restart", "done")

        set_step(install, "verify", "running")
        healthy, code, detail, bridge = wait_for_z2m(float(VERIFY_SECONDS))
        if not healthy:
            raise InstallFailure(code or "TIMEOUT", detail)
        set_step(install, "verify", "done")
        coordinator = {k: v for k, v in (bridge or {}).get("coordinator", {}).items() if k != "meta"}
        write_json(
            status_file("current.json"),
            {"port": target["port"], "modelId": target.get("modelId"), "installedAt": now()},
        )
        BRIDGE_CACHE["value"] = None
        PROBE_CACHE.pop(candidate_id(target["port"]), None)
        finish(install, "SUCCEEDED", coordinator=coordinator or None, errorCode=None, detail=None)
    except InstallFailure as failure:
        restored = rollback(install, backup_id, had_key) if modified else True
        state = "CANCELLED" if failure.code == "CANCELLED" else ("ROLLED_BACK" if restored else "FAILED")
        finish(
            install,
            state,
            errorCode=failure.code if restored or state == "CANCELLED" else "ROLLBACK_FAILED",
            detail=failure.detail,
        )
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as error:
        restored = rollback(install, backup_id, had_key) if modified else True
        finish(
            install,
            "ROLLED_BACK" if restored and modified else "FAILED",
            errorCode="INTERNAL" if restored else "ROLLBACK_FAILED",
            detail=str(error)[-300:],
        )
    finally:
        CANCEL.clear()
        BRIDGE_CACHE["value"] = None


class InstallFailure(Exception):
    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


def with_state_lock(work: Callable[[], None]) -> Callable[[], None]:
    """Serialises installs with the boot-time detection through the shared lock file."""

    def locked() -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        with (STATE_DIR / ".lock").open("a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                work()
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                INSTALL_LOCK.release()

    return locked


def start_install(payload: dict[str, Any]) -> dict[str, Any]:
    models = load_models()
    target = validate_install(payload, models)
    if not INSTALL_LOCK.acquire(blocking=False):
        raise RuntimeError("Une installation est déjà en cours.")
    CANCEL.clear()
    initial = idle_install()
    initial.update({"state": "RUNNING", "startedAt": now(), "progress": 2, "networkMode": target["networkMode"]})
    save_install(initial)
    threading.Thread(target=with_state_lock(lambda: run_install(target)), daemon=True).start()
    return initial


def cancel_install() -> dict[str, Any]:
    if INSTALL_LOCK.locked():
        CANCEL.set()
    return load_install()


def recover_interrupted() -> None:
    """After a crash or a reboot in the middle of an install, the old settings come back."""
    install = load_install()
    if install["state"] != "RUNNING" or INSTALL_LOCK.locked():
        return
    backup_id = install.get("backupId")
    restored = False
    if backup_id and backup_dir(backup_id).is_dir():
        try:
            restore_backup(backup_id)
            restored = True
            if current_config()["port"]:
                start_z2m()
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError):
            restored = False
    finish(
        install,
        "ROLLED_BACK" if restored else "FAILED",
        errorCode="INTERRUPTED",
        rolledBack=restored,
        detail=None,
    )


# ------------------------------------------------------------------------- probe


def probe_candidate(payload: dict[str, Any]) -> dict[str, Any]:
    """Read-only probe of a key. Zigbee2MQTT is stopped first when the key is the one in use."""
    models = load_models()
    config = current_config()
    wanted = payload.get("candidateId")
    candidates = scan_usb()
    raw = next((item for item in candidates if item["id"] == wanted), None)
    if raw is None:
        for item in read_json(status_file("network-keys.json")) or []:
            url = f"tcp://{item.get('host')}:{item.get('port')}"
            if candidate_id(url) == wanted:
                raw = network_candidate(item["host"], item["port"], item.get("name"), None)
    if raw is None and isinstance(payload.get("port"), str) and payload["port"].startswith("tcp://"):
        port, _ = validate_port(payload["port"])
        host, _, number = port[6:].rpartition(":")
        raw = network_candidate(host.strip("[]"), int(number), host, None)
    if raw is None:
        raise RequestError("Cette clé n’est plus branchée.")
    identity = identify(
        models, raw["usb"], raw.get("byIdName"), (raw.get("network") or {}).get("name"), raw.get("driver")
    )
    technologies = [option["technology"] for option in identity["options"]] or [
        name for name in PROBES
    ]
    for name in PROBES:
        if name not in technologies:
            technologies.append(name)
    if not INSTALL_LOCK.acquire(blocking=False):
        raise RuntimeError("Une installation est en cours : réessayez dans un instant.")
    stopped = False
    try:
        if raw["port"] == config["port"] and compose_base() is not None:
            stop_z2m()
            stopped = True
        elif raw["kind"] != "network" and port_holders(os.path.realpath(raw["port"])):
            raise RequestError("PORT_BUSY")
        probe = probe_technology(models, raw["port"], technologies)
    finally:
        if stopped:
            try:
                start_z2m()
            except (OSError, subprocess.SubprocessError, RuntimeError):
                pass
        INSTALL_LOCK.release()
    if probe:
        PROBE_CACHE[raw["id"]] = {**probe, "serial": (raw["usb"] or {}).get("serial")}
    return {"candidate": describe(models, raw, config["port"]), "answered": probe is not None}


def test_network(payload: dict[str, Any]) -> dict[str, Any]:
    host, number = payload.get("host"), payload.get("port", 6638)
    if not isinstance(host, str) or not isinstance(number, int) or isinstance(number, bool):
        raise RequestError("Adresse réseau invalide.")
    port, _ = validate_port(f"tcp://{host}:{number}")
    try:
        socket.create_connection((host, number), timeout=5).close()
    except OSError:
        raise RequestError("KEY_UNREACHABLE") from None
    saved = read_json(status_file("network-keys.json"))
    saved = saved if isinstance(saved, list) else []
    if all(item.get("host") != host or item.get("port") != number for item in saved):
        saved.append({"host": host, "port": number, "name": host})
        write_json(status_file("network-keys.json"), saved[-8:])
    models = load_models()
    raw = network_candidate(host, number, host, None)
    return {"candidate": describe(models, raw, current_config()["port"]), "answered": True}


def forget_network(payload: dict[str, Any]) -> dict[str, Any]:
    wanted = payload.get("candidateId")
    saved = read_json(status_file("network-keys.json"))
    saved = saved if isinstance(saved, list) else []
    kept = [item for item in saved if candidate_id(f"tcp://{item.get('host')}:{item.get('port')}") != wanted]
    write_json(status_file("network-keys.json"), kept)
    return build_status()


# -------------------------------------------------------------------------- auto


def auto() -> int:
    """Boot / udev entry point: install a key only when no key is configured or the old one is gone."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    handle = (STATE_DIR / ".lock").open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return 0
    try:
        if not ROOT_DIR.joinpath("current").exists() or not ENV_FILE.exists():
            return 0
        try:
            subprocess.run(["udevadm", "settle", "--timeout=10"], check=False, timeout=15)
        except (OSError, subprocess.SubprocessError):
            pass
        config = current_config()
        # The family chose this key: a new one is proposed in the app, never installed behind their
        # back. The chosen key itself must still bring Zigbee2MQTT back when it is plugged in again.
        chosen = config["mode"] == "manual" and bool(config["port"])
        if not chosen:
            recover_interrupted()
        status = build_status()
        candidates = [c for c in status["candidates"] if c["kind"] == "usb" and not c["isCurrent"]]
        current = status["current"]
        if current and current["present"]:
            # Docker cannot restart a container whose key was unplugged: it is created again.
            if current["z2m"]["container"] != "running":
                start_z2m()
            return 0
        if current and current["z2m"]["container"] in ("running", "restarting"):
            # The configured key is unplugged: no restart loop until it comes back.
            try:
                stop_z2m()
            except (OSError, subprocess.SubprocessError, RuntimeError):
                pass
        if chosen:
            return 0
        if len(candidates) != 1:
            if not candidates and not current:
                try:
                    stop_z2m()
                except (OSError, subprocess.SubprocessError, RuntimeError):
                    pass
            return 0
        candidate = candidates[0]
        identity = candidate["identity"]
        if identity["confidence"] != "high" or not identity["options"] or candidate["busy"]:
            return 0
        option = identity["options"][0]
        if not INSTALL_LOCK.acquire(blocking=False):
            return 0
        try:
            run_install(
                {
                    "port": candidate["port"],
                    "kind": "usb",
                    "adapter": option["technology"],
                    "baudrate": option["baudrate"],
                    "rtscts": option["rtscts"],
                    "networkMode": "keep",
                    "modelId": option["modelId"],
                    "modelName": option["modelName"],
                }
            )
            # An automatic install stays automatic: a later swap of the key is handled the same way.
            if load_install()["state"] == "SUCCEEDED":
                write_env({"ZIGBEE_ADAPTER_MODE": "auto"})
        finally:
            INSTALL_LOCK.release()
        return 0
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


# ------------------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        try:
            if self.path == "/status":
                self.respond(200, build_status())
            elif self.path == "/install":
                self.respond(200, load_install())
            else:
                self.respond(404, {"error": "Not found"})
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
            self.respond(503, {"error": str(error)[-300:]})

    def do_POST(self) -> None:
        try:
            length = min(int(self.headers.get("content-length", "0")), 8192)
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(payload, dict):
                raise RequestError("Requête invalide.")
            routes: dict[str, Callable[[], dict[str, Any]]] = {
                "/scan": lambda: build_status(include_network=payload.get("network") is True),
                "/probe": lambda: probe_candidate(payload),
                "/network/test": lambda: test_network(payload),
                "/network/forget": lambda: forget_network(payload),
                "/install": lambda: start_install(payload),
                "/install/cancel": cancel_install,
            }
            handler = routes.get(self.path)
            if handler is None:
                self.respond(404, {"error": "Not found"})
                return
            self.respond(200, handler())
        except RequestError as error:
            self.respond(400, {"error": str(error)})
        except (RuntimeError, OSError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            self.respond(503, {"error": str(error)[-300:]})

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


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "auto":
        raise SystemExit(auto())
    Path(SOCKET_PATH).parent.mkdir(parents=True, exist_ok=True)
    if os.path.exists(SOCKET_PATH):
        os.unlink(SOCKET_PATH)
    server = Server(SOCKET_PATH, Handler)
    os.chmod(SOCKET_PATH, 0o660)
    agent_gid = os.environ.get("ELISE_AGENT_GID")
    if agent_gid:
        os.chown(SOCKET_PATH, 0, int(agent_gid))
    try:
        recover_interrupted()
    except Exception:  # noqa: BLE001 - recovery must never prevent the agent from answering
        pass
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)


if __name__ == "__main__":
    main()
