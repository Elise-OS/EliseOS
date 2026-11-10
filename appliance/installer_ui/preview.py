#!/usr/bin/env python3
"""Render every installer state without installer hardware: text by default, PNG with --png."""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from . import LANGUAGES, Disk, TEXT, TextUI


STATES = ("language", "ethernet", "disk", "confirmation", "progress", "cancelled", "no-disk", "error")
SAMPLE_DISKS = [
    Disk("/dev/nvme0n1", "Samsung SSD 980 PRO 1TB", 1_000_204_886_016, True),
    Disk("/dev/sda", "", 128_035_676_160, False),
]
SAMPLE_ERROR = "curtin install failed: unable to reach archive.ubuntu.com"


def render(state: str, language: str = "fr") -> str:
    output = io.BytesIO()
    ui = TextUI(output, language=language)
    if state == "language":
        ui.language_screen(list(LANGUAGES).index(language))
    elif state == "ethernet":
        ui.ethernet_screen(retry=True)
    elif state == "disk":
        ui.disk_screen(SAMPLE_DISKS)
    elif state == "confirmation":
        ui.confirmation_screen(SAMPLE_DISKS[0])
    elif state == "progress":
        ui.progress_screen("copy", 27)
    elif state in ("cancelled", "no-disk"):
        ui.error_screen("", kind=state.replace("-", "_"))
    elif state == "error":
        ui.error_screen(SAMPLE_ERROR)
    else:
        raise ValueError(f"unknown state: {state}")
    return output.getvalue().decode("utf-8").replace("\033[2J\033[H", "")


def sample(state: str, language: str = "fr") -> dict:
    """What each state shows in the PNG previews and the rendering tests."""
    return {
        "language": {"selected": list(LANGUAGES).index(language)},
        "ethernet": {"retry": True, "network": "no-cable"},
        "disk": {"disks": tuple(SAMPLE_DISKS), "selected": 0},
        "confirmation": {"disk": SAMPLE_DISKS[0], "selected": 0},
        "progress": {"step": "copy", "percent": 27},
        "error": {"message": SAMPLE_ERROR},
    }.get(state, {})


def picture(state: str, language: str = "fr", size=(1920, 1080), **overrides):
    from .graphics import render as draw

    return draw(state, language, size, version="v0.1.28", **{**sample(state, language), **overrides})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", choices=STATES)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--language", choices=TEXT, default="fr")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--png", action="store_true", help="draw the framebuffer screens (needs Pillow)")
    parser.add_argument("--size", default="1920x1080", help="screen size for --png, e.g. 1366x768")
    args = parser.parse_args()
    states = STATES if args.all else (args.state or "language",)
    size = tuple(int(value) for value in args.size.lower().split("x"))
    for state in states:
        if args.png:
            output = args.output_dir or Path(".")
            output.mkdir(parents=True, exist_ok=True)
            path = output / f"{state}-{args.language}-{size[0]}x{size[1]}.png"
            picture(state, args.language, size).image.save(path)
            print(path)
            continue
        preview = render(state, args.language)
        if args.output_dir:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            (args.output_dir / f"{state}-{args.language}.txt").write_text(preview, encoding="utf-8")
        else:
            print(preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
