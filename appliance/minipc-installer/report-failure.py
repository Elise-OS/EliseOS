#!/usr/bin/env python3
"""Run by Subiquity's error-commands: say why the install stopped, on screen and on the USB stick.

The first failed step of curtin's log and its error become the detail of the error screen
(installer_ui.monitor reads /run/elise-installer/failed). A short report is also written to the
stick's "writable" partition, next to the install-logs-* folder Subiquity saves there, so a
failure on a mini PC can be read later on any Linux machine. It never raises: a report that
cannot be written must not hide the error screen.
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(os.environ.get("ELISE_INSTALLER_STATE_DIR", "/run/elise-installer"))
CURTIN_LOG = Path(os.environ.get("ELISE_CURTIN_LOG", "/var/log/installer/curtin-install.log"))


def failure_detail(log: str) -> str:
    """'install-grub: installing grub to target devices — EFI variables are not supported…'."""
    step = reason = ""
    for line in log.splitlines():
        text = line.strip()
        if not step and ": FAIL: " in text:
            name, _, words = text.partition(": FAIL: ")
            step = f"{name.rsplit('/', 1)[-1]}: {words}".strip(": ")
        elif step and not reason and text.startswith("Stderr:") and text[7:].strip():
            reason = text[7:].strip()
        if step and reason:
            break
    return " — ".join(part for part in (step, reason) if part)


def write_report(detail: str, log: str) -> Path | None:
    device = subprocess.run(["blkid", "-L", "writable"], text=True, capture_output=True, check=False).stdout.strip()
    if not device:
        return None
    mountpoint = STATE_DIR / "usb"
    mountpoint.mkdir(parents=True, exist_ok=True)
    if subprocess.run(["mount", device, str(mountpoint)], check=False).returncode != 0:
        return None
    try:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
        report = mountpoint / f"elise-install-error-{stamp}.txt"
        journal = subprocess.run(["journalctl", "-b", "--no-pager", "-o", "short-iso", "-n", "400"],
                                 text=True, capture_output=True, check=False).stdout
        tail = "\n".join(log.splitlines()[-200:])
        report.write_text(
            f"Élise OS mini PC installer — installation stopped\n{stamp}\n\n{detail or 'no curtin failure found'}\n\n"
            f"--- curtin-install.log (end) ---\n{tail}\n\n--- journal (end) ---\n{journal}\n",
            encoding="utf-8",
        )
        os.sync()
        return report
    finally:
        subprocess.run(["umount", str(mountpoint)], check=False)


def main() -> int:
    try:
        log = CURTIN_LOG.read_text(encoding="utf-8", errors="replace")
    except OSError:
        log = ""
    detail = failure_detail(log)
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        # Atomically: the progress screen turns into the error screen as soon as the file exists.
        temporary = STATE_DIR / "failed.tmp"
        temporary.write_text(detail + "\n", encoding="utf-8")
        temporary.replace(STATE_DIR / "failed")
    except OSError as error:
        print(f"ELISE_INSTALLER: cannot mark the failure: {error}", file=sys.stderr)
    try:
        report = write_report(detail, log)
    except Exception as error:  # noqa: BLE001 — never let the report hide the error screen
        report = None
        print(f"ELISE_INSTALLER: no report on the USB stick: {error}", file=sys.stderr)
    print(f"ELISE_INSTALLER: ERROR {detail or 'installation stopped'}; report={report or 'none'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
