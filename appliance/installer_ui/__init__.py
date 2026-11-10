"""Hardware-independent states for the Élise OS mini-PC installer.

The first implementation deliberately uses a plain Linux console.  A future framebuffer
renderer can implement the same public functions without changing disk or install logic.
"""

from __future__ import annotations

import os
import select
import termios
import time
from dataclasses import dataclass
from typing import Callable, Iterable


LANGUAGES = {
    "fr": {"name": "Français", "locale": "fr_FR.UTF-8", "keyboard": "fr", "timezone": "Europe/Paris"},
    "en": {"name": "English", "locale": "en_GB.UTF-8", "keyboard": "gb", "timezone": "Europe/London"},
    "es": {"name": "Español", "locale": "es_ES.UTF-8", "keyboard": "es", "timezone": "Europe/Madrid"},
    "it": {"name": "Italiano", "locale": "it_IT.UTF-8", "keyboard": "it", "timezone": "Europe/Rome"},
}

TEXT = {
    "fr": {
        "language_title": "Choisissez votre langue",
        "language_help": "Utilisez les flèches, puis appuyez sur Entrée.",
        "disk_title": "Où installer Élise OS ?",
        "disk_help": "Choisissez un disque interne. La clé USB est toujours exclue.",
        "data": "contient déjà un système ou des données",
        "empty": "aucun contenu détecté",
        "confirm_title": "Effacement du disque",
        "confirm": "Tout le contenu de {disk} sera effacé.",
        "irreversible": "Cette action est définitive.",
        "erase": "Effacer et installer",
        "cancel": "Annuler sans rien modifier",
        "ethernet_title": "Branchez un câble réseau Ethernet",
        "ethernet_body": "Élise a besoin d’Internet. La connexion sera détectée automatiquement.",
        "ethernet_retry": "Nouvel essai en cours…",
        "install_title": "Installation d’Élise OS…",
        "install_body": "Le mini PC redémarrera automatiquement. Laissez la clé branchée jusque-là.",
        "cancelled_title": "Installation annulée",
        "cancelled_body": "Aucun disque n’a été modifié. Vous pouvez éteindre le mini PC.",
        "no_disk_title": "Aucun disque compatible",
        "no_disk_body": "Il faut un disque interne d’au moins 32 Go. Les disques USB sont exclus.",
        "error_title": "L’installation ne peut pas continuer",
    },
    "en": {
        "language_title": "Choose your language",
        "language_help": "Use the arrow keys, then press Enter.",
        "disk_title": "Where should Élise OS be installed?",
        "disk_help": "Choose an internal disk. The USB installer is always excluded.",
        "data": "already contains a system or data",
        "empty": "no existing content detected",
        "confirm_title": "Erase disk",
        "confirm": "All content on {disk} will be erased.",
        "irreversible": "This cannot be undone.",
        "erase": "Erase and install",
        "cancel": "Cancel without changing anything",
        "ethernet_title": "Connect an Ethernet network cable",
        "ethernet_body": "Élise needs Internet. The connection will be detected automatically.",
        "ethernet_retry": "Trying again…",
        "install_title": "Installing Élise OS…",
        "install_body": "The mini PC will restart automatically. Leave the USB drive connected until then.",
        "cancelled_title": "Installation cancelled",
        "cancelled_body": "No disk was changed. You can switch off the mini PC.",
        "no_disk_title": "No compatible disk",
        "no_disk_body": "An internal disk of at least 32 GB is required. USB disks are excluded.",
        "error_title": "Installation cannot continue",
    },
    "es": {
        "language_title": "Elija su idioma",
        "language_help": "Use las flechas y pulse Intro.",
        "disk_title": "¿Dónde quiere instalar Élise OS?",
        "disk_help": "Elija un disco interno. La memoria USB de instalación siempre queda excluida.",
        "data": "ya contiene un sistema o datos",
        "empty": "no se ha detectado contenido",
        "confirm_title": "Borrar el disco",
        "confirm": "Se borrará todo el contenido de {disk}.",
        "irreversible": "Esta acción no se puede deshacer.",
        "erase": "Borrar e instalar",
        "cancel": "Cancelar sin modificar nada",
        "ethernet_title": "Conecte un cable de red Ethernet",
        "ethernet_body": "Élise necesita Internet. La conexión se detectará automáticamente.",
        "ethernet_retry": "Intentándolo de nuevo…",
        "install_title": "Instalando Élise OS…",
        "install_body": "El mini PC se reiniciará automáticamente. Deje la memoria USB conectada hasta entonces.",
        "cancelled_title": "Instalación cancelada",
        "cancelled_body": "No se ha modificado ningún disco. Puede apagar el mini PC.",
        "no_disk_title": "No hay ningún disco compatible",
        "no_disk_body": "Se necesita un disco interno de al menos 32 GB. Los discos USB quedan excluidos.",
        "error_title": "La instalación no puede continuar",
    },
    "it": {
        "language_title": "Scelga la lingua",
        "language_help": "Usi le frecce, poi prema Invio.",
        "disk_title": "Dove installare Élise OS?",
        "disk_help": "Scelga un disco interno. La chiavetta di installazione è sempre esclusa.",
        "data": "contiene già un sistema o dei dati",
        "empty": "nessun contenuto rilevato",
        "confirm_title": "Cancellazione del disco",
        "confirm": "Tutto il contenuto di {disk} verrà cancellato.",
        "irreversible": "Questa operazione non può essere annullata.",
        "erase": "Cancella e installa",
        "cancel": "Annulla senza modificare nulla",
        "ethernet_title": "Colleghi un cavo di rete Ethernet",
        "ethernet_body": "Élise ha bisogno di Internet. La connessione verrà rilevata automaticamente.",
        "ethernet_retry": "Nuovo tentativo…",
        "install_title": "Installazione di Élise OS…",
        "install_body": "Il mini PC si riavvierà automaticamente. Lasci la chiavetta collegata fino ad allora.",
        "cancelled_title": "Installazione annullata",
        "cancelled_body": "Nessun disco è stato modificato. Può spegnere il mini PC.",
        "no_disk_title": "Nessun disco compatibile",
        "no_disk_body": "Serve un disco interno di almeno 32 GB. I dischi USB sono esclusi.",
        "error_title": "L’installazione non può continuare",
    },
}


@dataclass(frozen=True)
class Disk:
    path: str
    model: str
    size: int
    has_data: bool = False

    @property
    def size_text(self) -> str:
        return f"{self.size / 1_000_000_000:.1f} GB"

    @property
    def label(self) -> str:
        return f"{self.model or 'Internal disk'} ({self.path}, {self.size_text})"


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
        self.language = language if language in LANGUAGES else "fr"
        self.key_reader = key_reader
        self.sleeper = sleeper
        self.state_logger = state_logger or (lambda _state: None)

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
        if first == b"\x1b":
            sequence = b""
            for _ in range(2):
                ready, _, _ = select.select([fd], [], [], 0.15)
                if ready:
                    sequence += os.read(fd, 1)
            if sequence.endswith(b"A"):
                return "up"
            if sequence.endswith(b"B"):
                return "down"
            return "escape"
        return first.decode("utf-8", errors="ignore").lower()

    def read_key(self) -> str:
        return self.key_reader() if self.key_reader else self._terminal_key()

    def choose(self, state: str, title: str, lines: list[str], options: list[str], default: int) -> int:
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
            except (AttributeError, OSError, termios.error):
                pass
            while True:
                self.render(state, title, lines, options, selected)
                key = self.read_key()
                if key == "up":
                    selected = (selected - 1) % len(options)
                elif key == "down":
                    selected = (selected + 1) % len(options)
                elif key == "enter":
                    return selected
        finally:
            if old_settings is not None:
                try:
                    termios.tcsetattr(self.console.fileno(), termios.TCSANOW, old_settings)
                except (OSError, termios.error):
                    pass

    def language_screen(self, selected: int = 0) -> None:
        text = TEXT["fr"]
        self.render("language", text["language_title"], [text["language_help"]], [item["name"] for item in LANGUAGES.values()], selected)

    def disk_screen(self, disks: list[Disk], selected: int = 0) -> None:
        text = TEXT[self.language]
        options = [f"{disk.label} — {text['data'] if disk.has_data else text['empty']}" for disk in disks]
        self.render("disk", text["disk_title"], [text["disk_help"]], options, selected)

    def confirmation_screen(self, disk: Disk, selected: int = 0) -> None:
        text = TEXT[self.language]
        self.render(
            "confirmation",
            text["confirm_title"],
            [text["confirm"].format(disk=disk.label), text["irreversible"]],
            [text["cancel"], text["erase"]],
            selected,
        )

    def ethernet_screen(self, retry: bool = False) -> None:
        text = TEXT[self.language]
        lines = [text["ethernet_body"]]
        if retry:
            lines.append(text["ethernet_retry"])
        self.render("ethernet", text["ethernet_title"], lines)

    def progress_screen(self, step: str = "install", percent: int | None = None) -> None:
        text = TEXT[self.language]
        lines = [text["install_body"]]
        if percent is not None:
            lines.append(f"{max(0, min(100, percent))} %")
        self.render(f"progress:{step}", text["install_title"], lines)

    def error_screen(self, message: str, *, kind: str = "error") -> None:
        text = TEXT[self.language]
        title = text.get(f"{kind}_title", text["error_title"])
        body = text.get(f"{kind}_body", message)
        self.render(kind, title, [body] if body else [message])


def choose_language(ui: TextUI) -> str:
    codes = list(LANGUAGES)
    selected = ui.choose(
        "language",
        TEXT["fr"]["language_title"],
        [TEXT["fr"]["language_help"]],
        [LANGUAGES[code]["name"] for code in codes],
        0,
    )
    ui.language = codes[selected]
    return ui.language


def choose_disk(ui: TextUI, disks: list[Disk]) -> Disk:
    if len(disks) == 1:
        return disks[0]
    text = TEXT[ui.language]
    options = [f"{disk.label} — {text['data'] if disk.has_data else text['empty']}" for disk in disks]
    return disks[ui.choose("disk", text["disk_title"], [text["disk_help"]], options, 0)]


def confirm_erase(ui: TextUI, disk: Disk) -> bool:
    text = TEXT[ui.language]
    selected = ui.choose(
        "confirmation",
        text["confirm_title"],
        [text["confirm"].format(disk=disk.label), text["irreversible"]],
        [text["cancel"], text["erase"]],
        0,
    )
    return selected == 1


def wait_for_ethernet(ui: TextUI, probe: Callable[[], bool], interval: float = 2.0) -> None:
    attempt = 0
    while not probe():
        ui.ethernet_screen(retry=attempt > 0)
        ui.sleeper(interval)
        attempt += 1


def show_progress(ui: TextUI, step: str, percent: int | None = None) -> None:
    ui.progress_screen(step, percent)


def show_error(ui: TextUI, message: str, *, kind: str = "error") -> None:
    ui.error_screen(message, kind=kind)
