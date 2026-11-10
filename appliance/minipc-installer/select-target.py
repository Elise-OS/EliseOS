#!/usr/bin/env python3
"""Run the safe, interactive pre-install checks for the Élise OS installer."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from installer_ui import (
    LANGUAGES,
    Disk,
    choose_disk,
    choose_language,
    confirm_erase,
    follow_installation,
    open_ui,
    show_error,
    show_progress,
    wait_for_ethernet,
)

MINIMUM_BYTES = 32_000_000_000
TARGET_TOKEN = "__ELISE_TARGET_DISK__"
LOCALE_TOKEN = "__ELISE_LOCALE__"
KEYBOARD_TOKEN = "__ELISE_KEYBOARD__"
TIMEZONE_TOKEN = "__ELISE_TIMEZONE__"
SERIAL_MARKER = "ELISE_INSTALLER"
STATE_DIR = Path(os.environ.get("ELISE_INSTALLER_STATE_DIR", "/run/elise-installer"))


def flatten(devices: list[dict]) -> list[dict]:
    result: list[dict] = []
    for device in devices:
        result.append(device)
        result.extend(flatten(device.get("children") or []))
    return result


def installation_device(devices: list[dict], source: str) -> str | None:
    """Return the top-level block device which contains the installation medium."""
    source = source.split("[", 1)[0]
    all_devices = flatten(devices)
    parents = {str(device.get("name")): str(device.get("pkname") or "") for device in all_devices}
    current = source
    seen: set[str] = set()
    while current and current not in seen:
        seen.add(current)
        parent = parents.get(current, "")
        if not parent:
            return current
        current = parent if parent.startswith("/dev/") else f"/dev/{parent}"
    return source or None


def contains_data(device: dict) -> bool:
    """Best-effort indication that a disk already has partitions, a filesystem or a label."""
    for item in flatten([device]):
        if item is not device and item.get("type") in ("part", "crypt", "lvm"):
            return True
        if any(item.get(field) for field in ("fstype", "label", "pttype", "parttype")):
            return True
        if any(item.get("mountpoints") or []):
            return True
    return False


def eligible_disks(devices: list[dict], source: str) -> tuple[list[Disk], list[tuple[dict, str]]]:
    """Return safe internal targets, largest first, and every rejected disk with its reason."""
    install_device = installation_device(devices, source)
    rejected: list[tuple[dict, str]] = []
    candidates: list[Disk] = []
    for device in devices:
        path = str(device.get("path") or device.get("name") or "")
        size = int(device.get("size") or 0)
        if device.get("type") != "disk":
            continue
        if path == install_device:
            rejected.append((device, "installation-media"))
        elif bool(device.get("rm")):
            rejected.append((device, "removable"))
        elif str(device.get("tran") or "").lower() == "usb":
            rejected.append((device, "usb"))
        elif size < MINIMUM_BYTES:
            rejected.append((device, "too-small"))
        elif not path.startswith("/dev/"):
            rejected.append((device, "invalid-path"))
        else:
            candidates.append(
                Disk(
                    path=path,
                    model=str(device.get("model") or "").strip(),
                    size=size,
                    has_data=contains_data(device),
                )
            )
    candidates.sort(key=lambda item: (item.size, item.path), reverse=True)
    return candidates, rejected


def serial(message: str) -> None:
    line = f"{SERIAL_MARKER}: {message}\n"
    sys.stderr.write(line)
    sys.stderr.flush()
    for path in ("/dev/ttyS0", "/dev/hvc0"):
        try:
            with open(path, "w", encoding="utf-8") as output:
                output.write(line)
        except OSError:
            pass


def console_path() -> str:
    override = os.environ.get("ELISE_INSTALLER_CONSOLE")
    if override:
        return override
    if os.path.exists("/dev/tty9"):
        subprocess.run(["chvt", "9"], check=False)
        return "/dev/tty9"
    return "/dev/console"


def load_devices() -> list[dict]:
    fixture = os.environ.get("ELISE_INSTALLER_LSBLK_JSON")
    if fixture:
        data = json.loads(Path(fixture).read_text(encoding="utf-8"))
    else:
        subprocess.run(["udevadm", "settle"], check=False)
        output = subprocess.check_output(
            [
                "lsblk", "--json", "--bytes", "--paths",
                "--output", "NAME,KNAME,PKNAME,PATH,SIZE,MODEL,TYPE,RM,TRAN,MOUNTPOINTS,FSTYPE,LABEL,PTTYPE,PARTTYPE",
            ],
            text=True,
        )
        data = json.loads(output)
    return data.get("blockdevices") or []


def find_install_source() -> str:
    override = os.environ.get("ELISE_INSTALLER_SOURCE")
    if override is not None:
        return override
    result = subprocess.run(
        ["findmnt", "-n", "-o", "SOURCE", "--target", "/cdrom"],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout.strip()


def network_state(sys_class_net: Path = Path("/sys/class/net")) -> str:
    """"online" with a cabled Ethernet carrier and working Internet (never Wi-Fi), else what is
    missing: "no-cable" or "no-internet", so the screen can say which."""
    try:
        ethernet = [path for path in sys_class_net.iterdir() if path.name.startswith(("en", "eth"))]
    except OSError:
        return "no-cable"
    def has_carrier(interface: Path) -> bool:
        try:
            return (interface / "carrier").read_text(encoding="ascii").strip() == "1"
        except OSError:
            return False

    if not any(has_carrier(path) for path in ethernet):
        return "no-cable"
    try:
        route = subprocess.run(
            ["ip", "-4", "route", "show", "default"],
            check=False,
            stdout=subprocess.PIPE,
            text=True,
            timeout=3,
        )
        if not route.stdout.strip():
            return "no-internet"
        with socket.create_connection(("github.com", 443), timeout=4):
            return "online"
    except (OSError, subprocess.SubprocessError):
        return "no-internet"


def ethernet_ready(sys_class_net: Path = Path("/sys/class/net")) -> bool:
    return network_state(sys_class_net) == "online"


def configure_autoinstall(path: str, language: str) -> None:
    config = LANGUAGES[language]
    autoinstall = Path(os.environ.get("ELISE_AUTOINSTALL_PATH", "/autoinstall.yaml"))
    content = autoinstall.read_text(encoding="utf-8")
    replacements = {
        TARGET_TOKEN: path,
        LOCALE_TOKEN: config["locale"],
        KEYBOARD_TOKEN: config["keyboard"],
        TIMEZONE_TOKEN: config["timezone"],
    }
    for token, value in replacements.items():
        if content.count(token) != 1:
            raise RuntimeError(f"token {token} absent or duplicated in {autoinstall}")
        content = content.replace(token, value)
    temporary = autoinstall.with_suffix(".elise.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(autoinstall)


def save_language(language: str) -> Path:
    STATE_DIR.mkdir(mode=0o755, parents=True, exist_ok=True)
    output = STATE_DIR / "language.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            {
                "language": language,
                "source": "installer",
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            },
            ensure_ascii=False,
        ) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o644)
    temporary.replace(output)
    return output


def scripted_key_reader() -> Callable[[], str] | None:
    """Optional deterministic input for unit/preview harnesses; production reads the TTY."""
    value = os.environ.get("ELISE_INSTALLER_KEYS")
    if value is None:
        return None
    keys = iter(item.strip() for item in value.split(",") if item.strip())
    return lambda: next(keys)


def main() -> int:
    path = console_path()
    flags = os.O_RDWR | os.O_NOCTTY if not os.path.isfile(path) else os.O_RDWR | os.O_CREAT | os.O_APPEND
    with os.fdopen(os.open(path, flags, 0o600), "rb+", buffering=0) as console:
        ui = open_ui(
            console,
            key_reader=scripted_key_reader(),
            state_logger=lambda state: serial(f"SCREEN {state}"),
            log=serial,
        )
        language = choose_language(ui)
        save_language(language)
        serial(f"LANGUAGE selected={language}")

        wait_for_ethernet(ui, network_state)
        serial("ETHERNET online")

        candidates, rejected = eligible_disks(load_devices(), find_install_source())
        if not candidates:
            show_error(ui, "", kind="no_disk")
            serial(f"REFUSED no eligible internal disk >= 32 GB rejected={len(rejected)}")
            return 1

        chosen = choose_disk(ui, candidates)
        serial(
            f"DISK selected={chosen.path} model={chosen.name('en')} size={chosen.size} "
            f"has_data={str(chosen.has_data).lower()} candidates={len(candidates)} rejected={len(rejected)}"
        )
        if not confirm_erase(ui, chosen):
            show_error(ui, "", kind="cancelled")
            serial("CANCELLED at explicit erase confirmation")
            return 130

        configure_autoinstall(chosen.path, language)
        show_progress(ui, "subiquity", 0)
        serial(f"ACCEPTED target={chosen.path} language={language}; Installation d'Élise OS")
        if follow_installation(ui, STATE_DIR):
            serial("PROGRESS screen follows Subiquity")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
