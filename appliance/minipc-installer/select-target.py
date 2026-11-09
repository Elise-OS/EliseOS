#!/usr/bin/env python3
"""Select and confirm the internal disk used by the Élise OS installer."""

from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import termios
import time
from pathlib import Path

MINIMUM_BYTES = 32_000_000_000
TARGET_TOKEN = "__ELISE_TARGET_DISK__"
SERIAL_MARKER = "ELISE_INSTALLER"


def flatten(devices: list[dict]) -> list[dict]:
    result: list[dict] = []
    for device in devices:
        result.append(device)
        result.extend(flatten(device.get("children") or []))
    return result


def installation_device(devices: list[dict], source: str) -> str | None:
    """Return the top-level device which contains the installation medium."""
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


def select_target(devices: list[dict], source: str) -> tuple[dict | None, list[tuple[dict, str]]]:
    install_device = installation_device(devices, source)
    rejected: list[tuple[dict, str]] = []
    candidates: list[dict] = []
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
        else:
            candidates.append(device)
    candidates.sort(key=lambda item: (int(item.get("size") or 0), str(item.get("path") or "")), reverse=True)
    return (candidates[0] if candidates else None), rejected


def size_text(size: int) -> str:
    return f"{size / 1_000_000_000:.1f} Go / GB"


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


def write_screen(console, lines: list[str]) -> None:
    content = "\033[2J\033[H\n\n"
    for line in lines:
        content += f"  {line}\n"
    console.write(content.encode("utf-8"))
    console.flush()


def wait_for_key(console, seconds: int, target: dict) -> bool:
    model = str(target.get("model") or "Disque interne / Internal disk").strip()
    size = size_text(int(target.get("size") or 0))
    path = str(target.get("path") or target.get("name"))
    old_settings = None
    try:
        old_settings = termios.tcgetattr(console.fileno())
        settings = termios.tcgetattr(console.fileno())
        settings[3] &= ~(termios.ICANON | termios.ECHO)
        settings[6][termios.VMIN] = 0
        settings[6][termios.VTIME] = 0
        termios.tcsetattr(console.fileno(), termios.TCSANOW, settings)
    except (termios.error, OSError):
        pass
    try:
        deadline = time.monotonic() + seconds
        while True:
            remaining = max(0, int(deadline - time.monotonic() + 0.999))
            write_screen(
                console,
                [
                    "ÉLISE OS — ATTENTION : EFFACEMENT DU DISQUE",
                    "ÉLISE OS — WARNING: DISK WILL BE ERASED",
                    "",
                    f"Élise OS va effacer le disque : {model}",
                    f"Élise OS will erase this disk: {model}",
                    f"{path} — {size}",
                    "",
                    f"Installation dans {remaining} s. Retirez la clé USB ou appuyez sur une touche pour annuler.",
                    f"Installation starts in {remaining} s. Remove the USB drive or press any key to cancel.",
                ],
            )
            if remaining <= 0:
                return False
            readable, _, _ = select.select([console], [], [], min(1.0, deadline - time.monotonic()))
            if readable and console.read(1):
                return True
    finally:
        if old_settings is not None:
            try:
                termios.tcsetattr(console.fileno(), termios.TCSANOW, old_settings)
            except (termios.error, OSError):
                pass


def load_devices() -> list[dict]:
    fixture = os.environ.get("ELISE_INSTALLER_LSBLK_JSON")
    if fixture:
        data = json.loads(Path(fixture).read_text(encoding="utf-8"))
    else:
        subprocess.run(["udevadm", "settle"], check=False)
        output = subprocess.check_output(
            [
                "lsblk", "--json", "--bytes", "--paths",
                "--output", "NAME,KNAME,PKNAME,PATH,SIZE,MODEL,TYPE,RM,TRAN,MOUNTPOINTS",
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


def set_target(path: str) -> None:
    autoinstall = Path(os.environ.get("ELISE_AUTOINSTALL_PATH", "/autoinstall.yaml"))
    content = autoinstall.read_text(encoding="utf-8")
    if content.count(TARGET_TOKEN) != 1:
        raise RuntimeError(f"target token absent or duplicated in {autoinstall}")
    temporary = autoinstall.with_suffix(".elise.tmp")
    temporary.write_text(content.replace(TARGET_TOKEN, path), encoding="utf-8")
    temporary.replace(autoinstall)


def main() -> int:
    devices = load_devices()
    source = find_install_source()
    target, rejected = select_target(devices, source)
    path = console_path()
    flags = os.O_RDWR | os.O_NOCTTY if not os.path.isfile(path) else os.O_RDWR | os.O_CREAT | os.O_APPEND
    with os.fdopen(os.open(path, flags, 0o600), "rb+", buffering=0) as console:
        if target is None:
            write_screen(
                console,
                [
                    "ÉLISE OS — INSTALLATION REFUSÉE",
                    "ÉLISE OS — INSTALLATION REFUSED",
                    "",
                    "Aucun disque interne d’au moins 32 Go n’a été trouvé.",
                    "No internal disk of at least 32 GB was found.",
                    "",
                    "La clé USB d’installation ne sera jamais effacée.",
                    "The installation USB drive will never be erased.",
                ],
            )
            serial("REFUSED no eligible internal disk >= 32 GB")
            return 1
        target_path = str(target.get("path") or target.get("name"))
        serial(
            f"CONFIRM target={target_path} model={str(target.get('model') or '').strip()} "
            f"size={int(target.get('size') or 0)} rejected={len(rejected)}"
        )
        seconds = int(os.environ.get("ELISE_CONFIRM_SECONDS", "30"))
        if wait_for_key(console, seconds, target):
            write_screen(
                console,
                [
                    "Installation annulée. Aucun disque n’a été modifié.",
                    "Installation cancelled. No disk was modified.",
                ],
            )
            serial("CANCELLED by key press")
            return 130
        set_target(target_path)
        write_screen(
            console,
            [
                "Installation d’Élise OS…",
                "Installing Élise OS…",
                "",
                "Le mini PC redémarrera automatiquement.",
                "The mini PC will restart automatically.",
            ],
        )
        serial(f"ACCEPTED target={target_path}; Installation d'Élise OS")
        time.sleep(2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
