"""Reads the arrows and Enter straight from the keyboards (evdev), whatever the active console.

The screens are drawn on the framebuffer, which every virtual terminal shares, but a terminal only
receives the keys while it is the active one. On an HP G4 Mini the picture stayed while the keys
went to another console (Subiquity's), so nothing moved. /dev/input/event* sees every keyboard,
including one plugged in later; the keyboards are grabbed while a choice is made, so the keys
never also reach that other console, and released as soon as it is made.
"""

from __future__ import annotations

import fcntl
import os
import select
import struct
from pathlib import Path

EVENT = struct.Struct("llHHi")  # struct input_event on 64-bit Linux
EV_KEY = 0x01
EVIOCGRAB = 0x40044590
KEYS = {28: "enter", 96: "enter", 103: "up", 108: "down", 105: "left", 106: "right", 15: "down", 1: "escape"}
KEY_ENTER, KEY_UP = 28, 103
RESCAN_SECONDS = 1.0


def is_keyboard(capabilities: str) -> bool:
    """`capabilities/key` is a hex bitmap, most significant word first: needs Enter and Up."""
    words = capabilities.split()
    bits = 0
    for word in words:
        bits = (bits << 64) | int(word, 16)
    return bool(bits >> KEY_ENTER & 1 and bits >> KEY_UP & 1)


class Keyboards:
    def __init__(self, root: Path = Path("/sys/class/input"), devices: Path = Path("/dev/input")):
        self.root, self.devices = root, devices
        self.open: dict[str, int] = {}
        self.pending: list[str] = []

    def scan(self) -> None:
        try:
            names = [path.name for path in self.root.glob("event*")]
        except OSError:
            names = []
        for name in names:
            if name in self.open:
                continue
            try:
                capabilities = (self.root / name / "device" / "capabilities" / "key").read_text(encoding="ascii")
                if not is_keyboard(capabilities):
                    continue
                descriptor = os.open(self.devices / name, os.O_RDONLY | os.O_NONBLOCK)
            except (OSError, ValueError):
                continue
            try:
                fcntl.ioctl(descriptor, EVIOCGRAB, 1)
            except OSError:
                pass  # still readable; the key may then also reach the active console
            self.open[name] = descriptor

    def close(self) -> None:
        for descriptor in self.open.values():
            try:
                os.close(descriptor)  # also releases the grab
            except OSError:
                pass
        self.open.clear()

    def __enter__(self):
        self.scan()
        return self

    def __exit__(self, *_):
        self.close()

    def _read(self, name: str) -> str | None:
        descriptor = self.open[name]
        try:
            data = os.read(descriptor, EVENT.size * 64)
        except BlockingIOError:
            return None
        except OSError:  # unplugged
            os.close(descriptor)
            del self.open[name]
            return None
        for offset in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _sec, _usec, kind, code, value = EVENT.unpack_from(data, offset)
            if kind == EV_KEY and value in (1, 2) and code in KEYS:  # press or auto-repeat
                self.pending.append(KEYS[code])
        return self.pending.pop(0) if self.pending else None

    def read(self, tty: int | None, tty_key) -> str:
        """The next key: from a keyboard when there is one, else from the terminal (`tty_key`)."""
        while True:
            if self.pending:
                return self.pending.pop(0)
            watched = list(self.open.values()) + ([tty] if tty is not None else [])
            ready, _, _ = select.select(watched, [], [], RESCAN_SECONDS)
            if not ready:
                self.scan()
                continue
            for name, descriptor in list(self.open.items()):
                if descriptor in ready:
                    key = self._read(name)
                    if key:
                        return key
            if tty is not None and tty in ready:
                if self.open:
                    try:
                        os.read(tty, 64)  # the same keys, already read from the keyboard
                    except OSError:
                        pass
                else:
                    return tty_key()
