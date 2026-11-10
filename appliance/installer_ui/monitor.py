"""Keeps the progress screen moving while Subiquity installs Ubuntu.

select-target.py starts it in its own session just before handing over to Subiquity, then exits.
Subiquity writes every step of the installation to the journal (SUBIQUITY_CONTEXT_NAME); a few
of them mark the screen's steps. Between two marks the bar creeps on, slower and slower, so it
never stands still nor reaches the next step early. Without a journal it only creeps.
"""

from __future__ import annotations

import argparse
import math
import os
import select
import subprocess
import sys
import time
from pathlib import Path

from . import STEP_IDS

# Words of a journal line that start a step, in Subiquity's order.
MARKERS = (
    ("stage-partitioning", "disk"), ("partitioning step", "disk"),
    ("stage-extract", "copy"), ("extract step", "copy"),
    ("curthooks", "configure"),
    ("run_unattended_upgrades", "updates"), ("security updates", "updates"),
    ("subiquity/Late/run", "elise"),
    # Not the bare "subiquity/Shutdown": Subiquity logs subiquity/Shutdown/load_autoinstall_data
    # (and apply_autoinstall_config) right after reloading the configuration, before installing.
    ("subiquity/Shutdown/copy_logs_to_target", "restart"), ("subiquity/Shutdown/shutdown", "restart"),
)
# Share of the bar and typical duration (seconds) of each step.
SPANS = {
    "disk": (0, 6, 30), "copy": (6, 40, 150), "configure": (40, 62, 150),
    "updates": (62, 88, 240), "elise": (88, 96, 40), "restart": (96, 100, 10),
}
FAILED = Path(os.environ.get("ELISE_INSTALLER_STATE_DIR", "/run/elise-installer")) / "failed"


class Progress:
    def __init__(self, now: float):
        self.step = 0
        self.since = now
        self.best = 0

    def feed(self, line: str, now: float) -> None:
        for marker, step in MARKERS:
            index = STEP_IDS.index(step)
            if marker in line and index > self.step:
                self.step, self.since = index, now

    def percent(self, now: float) -> int:
        low, high, typical = SPANS[STEP_IDS[self.step]]
        reached = low + (high - low) * 0.92 * (1 - math.exp(-(now - self.since) / typical))
        self.best = max(self.best, int(reached))
        return self.best

    @property
    def key(self) -> str:
        return STEP_IDS[self.step]


def journal():
    try:
        return subprocess.Popen(
            ["journalctl", "--follow", "--lines=0", "--output=json", "--no-pager"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
    except OSError:
        return None


def run(ui, clock=time.monotonic) -> int:
    progress = Progress(clock())
    source = journal()
    shown = None
    while True:
        if FAILED.exists():
            try:
                detail = FAILED.read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                detail = ""
            ui.error_screen(detail[:160], kind="error")
            return 1
        if source and source.stdout:
            ready, _, _ = select.select([source.stdout], [], [], 1.0)
            if ready:
                # Whole chunks, not readline(): select() cannot see lines already buffered.
                chunk = os.read(source.stdout.fileno(), 65536)
                if chunk:
                    progress.feed(chunk.decode("utf-8", errors="replace"), clock())
                else:
                    source = None
        else:
            time.sleep(1.0)
        state = (progress.key, progress.percent(clock()))
        if state != shown:
            ui.progress_screen(*state)
            shown = state


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", default="fr")
    parser.add_argument("--console", default="/dev/tty9")
    args = parser.parse_args()
    from .graphics import GraphicUI

    descriptor = os.open(args.console, os.O_RDWR | os.O_NOCTTY)
    with os.fdopen(descriptor, "rb+", buffering=0) as console:
        ui = GraphicUI.open(console, language=args.language, log=lambda message: print(message, file=sys.stderr))
        return run(ui)


if __name__ == "__main__":
    raise SystemExit(main())
