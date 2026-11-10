"""Hardware-independent states for the Élise OS mini-PC installer.

Two faces share the same keyboard and the same choices: GraphicUI (installer_ui.graphics) draws
on the framebuffer like the TV installation screen, TextUI writes plain text on the console.
open_ui() picks the first and falls back to the second whenever Pillow or a screen is missing.
"""

from __future__ import annotations

import io
import os
import select
import subprocess
import sys
import termios
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from .texts import STEP_IDS, TEXT


LANGUAGES = {
    "fr": {"name": "Français", "locale": "fr_FR.UTF-8", "keyboard": "fr", "timezone": "Europe/Paris"},
    "en": {"name": "English", "locale": "en_GB.UTF-8", "keyboard": "gb", "timezone": "Europe/London"},
    "es": {"name": "Español", "locale": "es_ES.UTF-8", "keyboard": "es", "timezone": "Europe/Madrid"},
    "it": {"name": "Italiano", "locale": "it_IT.UTF-8", "keyboard": "it", "timezone": "Europe/Rome"},
}


@dataclass(frozen=True)
class Disk:
    path: str
    model: str
    size: int
    has_data: bool = False

    def name(self, language: str = "fr") -> str:
        """The model lsblk reports, or a translated description when the disk gives none."""
        return self.model.strip() or TEXT[language]["internal_disk"]

    def size_text(self, language: str = "fr") -> str:
        """Decimal units, as printed on the box: "107 Go", "42,9 GB", "1.0 TB"."""
        text = TEXT[language]
        gigabytes = self.size / 1_000_000_000
        value, unit = (gigabytes / 1000, text["size_units"][1]) if gigabytes >= 1000 else (gigabytes, text["size_units"][0])
        number = f"{value:.0f}" if unit == text["size_units"][0] and value >= 100 else f"{value:.1f}"
        return f"{number.replace('.', text['decimal'])} {unit}"

    def label(self, language: str = "fr") -> str:
        return f"{self.name(language)} ({self.path}, {self.size_text(language)})"


def ui_language(language: str) -> str:
    return language if language in LANGUAGES else "fr"


class TextUI:
    """Minimal ANSI console UI with an injectable key source for tests and previews."""

    def __init__(
        self,
        console,
        *,
        language: str = "fr",
        key_reader: Callable[[], str] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        state_logger: Callable[[str], None] | None = None,
    ) -> None:
        self.console = console
        self.language = ui_language(language)
        self.key_reader = key_reader
        self.sleeper = sleeper
        self.state_logger = state_logger or (lambda _state: None)

    @property
    def text(self) -> dict:
        return TEXT[self.language]

    def _write(self, value: str) -> None:
        encoded = value.encode("utf-8")
        try:
            self.console.write(encoded)
        except TypeError:
            self.console.write(value)
        self.console.flush()

    def render(self, state: str, title: str, lines: Iterable[str] = (), options=(), selected=0) -> None:
        self.state_logger(state)
        content = ["\033[2J\033[H", "", "  ÉLISE OS", "", f"  {title}", "  " + "═" * 64, ""]
        content.extend(f"  {line}" for line in lines)
        if options:
            content.append("")
            for index, option in enumerate(options):
                marker = "▶" if index == selected else " "
                content.append(f"  {marker}  {option}")
        content.extend(["", ""])
        self._write("\n".join(content))

    def _terminal_key(self) -> str:
        fd = self.console.fileno()
        first = os.read(fd, 1)
        if first in (b"\r", b"\n"):
            return "enter"
        if first == b"\t":
            return "down"
        if first == b"\x1b":
            sequence = b""
            for _ in range(2):
                ready, _, _ = select.select([fd], [], [], 0.15)
                if ready:
                    sequence += os.read(fd, 1)
            for suffix, key in ((b"A", "up"), (b"B", "down"), (b"C", "right"), (b"D", "left")):
                if sequence.endswith(suffix):
                    return key
            return "escape"
        return first.decode("utf-8", errors="ignore").lower()

    def read_key(self) -> str:
        return self.key_reader() if self.key_reader else self._terminal_key()

    def choose(self, count: int, default: int, show: Callable[[int], None]) -> int:
        """Moves the selection with the arrows (all four: a list or a row of buttons) until Enter."""
        selected = default
        old_settings = None
        try:
            try:
                old_settings = termios.tcgetattr(self.console.fileno())
                settings = termios.tcgetattr(self.console.fileno())
                settings[3] &= ~(termios.ICANON | termios.ECHO)
                settings[6][termios.VMIN] = 1
                settings[6][termios.VTIME] = 0
                termios.tcsetattr(self.console.fileno(), termios.TCSANOW, settings)
            except (AttributeError, OSError, termios.error, io.UnsupportedOperation):
                pass
            while True:
                show(selected)
                key = self.read_key()
                if key in ("up", "left"):
                    selected = (selected - 1) % count
                elif key in ("down", "right"):
                    selected = (selected + 1) % count
                elif key == "enter":
                    return selected
        finally:
            if old_settings is not None:
                try:
                    termios.tcsetattr(self.console.fileno(), termios.TCSANOW, old_settings)
                except (OSError, termios.error):
                    pass

    def language_screen(self, selected: int = 0) -> None:
        # Nobody has chosen yet: the words follow the highlighted language.
        text = TEXT[list(LANGUAGES)[selected]]
        self.render("language", text["language_title"], [text["language_help"]], [item["name"] for item in LANGUAGES.values()], selected)

    def disk_screen(self, disks: list[Disk], selected: int = 0) -> None:
        text = self.text
        options = [f"{disk.label(self.language)} — {text['data'] if disk.has_data else text['empty']}" for disk in disks]
        self.render("disk", text["disk_title"], [text["disk_help"]], options, selected)

    def confirmation_screen(self, disk: Disk, selected: int = 0) -> None:
        text = self.text
        self.render(
            "confirmation",
            text["confirm_title"],
            [disk.label(self.language), text["confirm_body"], text["confirm_safe"]],
            [text["cancel"], text["erase"]],
            selected,
        )

    def ethernet_screen(self, retry: bool = False, state: str = "no-cable") -> None:
        text = self.text
        lines = [text["ethernet_body"], text["ethernet_no_internet" if state == "no-internet" else "ethernet_waiting"]]
        if retry:
            lines.append(text["ethernet_hint_internet" if state == "no-internet" else "ethernet_hint_cable"])
        self.render("ethernet", text["ethernet_title"], lines)

    def progress_screen(self, step: str = "disk", percent: int | None = None) -> None:
        text = self.text
        key = step if step in STEP_IDS else STEP_IDS[0]
        lines = [text["steps"][key], text["reassure"], text["keep_usb"]]
        if percent is not None:
            lines.append(text["percent"].format(percent=max(0, min(100, percent))))
        self.render(f"progress:{step}", text["progress_eyebrow"].capitalize(), lines)

    def error_screen(self, message: str, *, kind: str = "error") -> None:
        text = self.text
        kind = kind if kind in ("cancelled", "no_disk") else "error"
        lines = [text[f"{kind}_body"], *text[f"{kind}_steps"]]
        if kind == "error" and message:
            lines.append(text["detail"].format(message=message))
        self.render(kind, text[f"{kind}_title"], lines)


def open_ui(console, *, log: Callable[[str], None] = lambda _message: None, **options) -> TextUI:
    """The framebuffer face when it can draw, else the text console: both read the same keys."""
    if os.environ.get("ELISE_INSTALLER_UI", "").lower() != "text":
        try:
            from .graphics import GraphicUI

            return GraphicUI.open(console, log=log, **options)
        except Exception as error:  # Pillow, fonts or framebuffer missing: never block the install.
            log(f"UI text fallback: {type(error).__name__}: {error}")
    return TextUI(console, **options)


def choose_language(ui: TextUI) -> str:
    codes = list(LANGUAGES)
    selected = ui.choose(len(codes), 0, ui.language_screen)
    ui.language = codes[selected]
    return ui.language


def choose_disk(ui: TextUI, disks: list[Disk]) -> Disk:
    if len(disks) == 1:
        return disks[0]
    return disks[ui.choose(len(disks), 0, lambda selected: ui.disk_screen(disks, selected))]


def confirm_erase(ui: TextUI, disk: Disk) -> bool:
    """« Annuler » comes first and is selected: only an explicit move then Enter erases."""
    return ui.choose(2, 0, lambda selected: ui.confirmation_screen(disk, selected)) == 1


def wait_for_ethernet(ui: TextUI, probe: Callable[[], bool | str], interval: float = 2.0) -> None:
    """`probe` answers True/"online" when ready, else False/"no-cable" or "no-internet"."""
    attempt = 0
    while True:
        state = probe()
        if state is True or state == "online":
            return
        ui.ethernet_screen(retry=attempt > 0, state="no-internet" if state == "no-internet" else "no-cable")
        ui.sleeper(interval)
        attempt += 1


def show_progress(ui: TextUI, step: str, percent: int | None = None) -> None:
    ui.progress_screen(step, percent)


def show_error(ui: TextUI, message: str, *, kind: str = "error") -> None:
    ui.error_screen(message, kind=kind)


def follow_installation(ui: TextUI, log_dir: Path) -> bool:
    """Hands the progress screen to installer_ui.monitor, which outlives the early command.

    It runs in its own session with no inherited pipe, so Subiquity never waits for it.
    """
    if not getattr(ui, "graphical", False) or getattr(ui, "failed", False):
        return False
    try:
        log_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
        log = open(log_dir / "progress-screen.log", "ab")
    except OSError:
        log = subprocess.DEVNULL
    try:
        subprocess.Popen(
            [sys.executable, "-m", "installer_ui.monitor", "--language", ui.language],
            cwd=Path(__file__).resolve().parent.parent,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, start_new_session=True,
        )
        return True
    except OSError:
        return False
    finally:
        if log is not subprocess.DEVNULL:
            log.close()
