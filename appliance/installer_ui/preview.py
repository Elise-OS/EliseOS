#!/usr/bin/env python3
"""Render every installer state as plain ANSI-free text, without installer hardware."""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from . import Disk, TEXT, TextUI


STATES = ("language", "ethernet", "disk", "confirmation", "progress", "cancelled", "no-disk", "error")
SAMPLE_DISKS = [
    Disk("/dev/nvme1n1", "Example NVMe 100", 100_000_000_000, True),
    Disk("/dev/nvme0n1", "Example SSD 40", 40_000_000_000, False),
]


def render(state: str, language: str = "fr") -> str:
    output = io.BytesIO()
    ui = TextUI(output, language=language)
    if state == "language":
        ui.language_screen()
    elif state == "ethernet":
        ui.ethernet_screen(retry=True)
    elif state == "disk":
        ui.disk_screen(SAMPLE_DISKS)
    elif state == "confirmation":
        ui.confirmation_screen(SAMPLE_DISKS[0])
    elif state == "progress":
        ui.progress_screen("install", 10)
    elif state in ("cancelled", "no-disk"):
        ui.error_screen("", kind=state.replace("-", "_"))
    elif state == "error":
        ui.error_screen("Example technical detail")
    else:
        raise ValueError(f"unknown state: {state}")
    return output.getvalue().decode("utf-8").replace("\033[2J\033[H", "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", choices=STATES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--language", choices=TEXT, default="fr")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    states = STATES if args.all else (args.state or "language",)
    for state in states:
        preview = render(state, args.language)
        if args.output_dir:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            (args.output_dir / f"{state}-{args.language}.txt").write_text(preview, encoding="utf-8")
        else:
            print(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
