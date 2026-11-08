#!/usr/bin/env python3
"""Élise's first installation, drawn on the TV until the resident screen takes over.

The image has neither X nor a browser before scripts/install-screen.sh: Pillow draws each
screen straight into the HDMI framebuffer while the text console waits on its own terminal.
"""
import fcntl
import math
import mmap
import os
import signal
import struct
import sys
import time

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

import elise_install_state as install

try:
    import qrcode
except ImportError:  # The address stays readable in large type.
    qrcode = None

HERE = os.path.dirname(os.path.abspath(__file__))
ASSET_DIRS = (
    os.environ.get("ELISE_INSTALL_SCREEN_ASSETS", ""),
    "/usr/share/elise/runtime/appliance",
    "/opt/elise/current/appliance",
    HERE,
)
FRAMEBUFFER = os.environ.get("ELISE_INSTALL_SCREEN_FB", "/dev/fb0")
TERMINAL = int(os.environ.get("ELISE_INSTALL_SCREEN_VT", "8"))
AUTH_FILE = os.environ.get("ELISE_GITHUB_AUTH_FILE", "/etc/elise/github-auth")
LOCALE_FILE = "/etc/default/locale"
KEYBOARD_FILE = "/etc/default/keyboard"
STEP_IDS = [step[0] for step in install.STEPS]

# Élise's palette, deepened for a television seen from the sofa.
NAVY = (11, 41, 72)
NAVY_DEEP = (6, 23, 42)
CREAM = (245, 240, 232)
MUTED = (178, 190, 204)
DIM = (112, 132, 155)
BLUE = (55, 104, 132)
SKY = (140, 186, 212)
GREEN = (116, 184, 145)
AMBER = (230, 170, 98)
CORAL = (232, 142, 120)
ACCENTS = {
    "welcome": SKY, "progress": SKY, "action": AMBER, "problem": CORAL,
    "ready": GREEN, "pair": GREEN, "installing": GREEN,
}

TEXT = {
    "fr": {
        "elapsed": "Commencé il y a {duration}",
        "step_of": "Étape {n} sur {total}",
        "steps": {
            "settings": "Réglages du Raspberry Pi", "network": "Connexion à Internet", "clock": "Mise à l’heure",
            "verify": "Vérification de la version", "download": "Téléchargement des composants",
            "start": "Démarrage d’Élise",
        },
        "leads": {
            "settings": "Élise applique les réglages choisis lors de la préparation de la carte.",
            "network": "Élise vérifie sa connexion à Internet.",
            "clock": "Élise se met à l’heure pour sécuriser ses échanges.",
            "verify": "Élise vérifie que sa version est authentique.",
            "download": "Élise télécharge ses composants. C’est l’étape la plus longue.",
            "start": "Élise démarre et vérifie que tout fonctionne.",
        },
        "components": "{done} composants sur {total}",
        "percent": "{percent} %",
        "local": "Adresse locale",
        "remote": "Accès à distance",
        "remote_later": "à configurer depuis l’application",
        "remote_value": "Accès à distance : {value}",
        "follow": "Suivre sur votre téléphone",
        "no_network": "en attente du réseau",
        "version": "Version {version}",
        "scan": "Avec l’appareil photo du téléphone",
        "welcome_eyebrow": "PREMIÈRE INSTALLATION",
        "welcome_title": "Élise OS est en cours d’installation",
        "welcome_lead": "Tout se fait automatiquement. Laissez le boîtier allumé et relié à Internet.",
        "continue": "Pour continuer",
        "continue_body": "Ouvrez l’application mobile Élise, ou rendez-vous sur",
        "progress_eyebrow": "INSTALLATION EN COURS",
        "reassure": "Vous n’avez rien à faire : cet écran se met à jour tout seul.",
        "action_eyebrow": "UNE INFORMATION EST NÉCESSAIRE",
        "action_title": "Continuez sur votre téléphone ou votre ordinateur",
        "action_body": "Pour télécharger ses composants, Élise a besoin du compte bot GitHub. "
        "Indiquez-le dans l’application Élise ou sur la page de préparation.",
        "action_note": "Rien à saisir sur la télévision. L’installation reprendra toute seule.",
        "action_scan": "Scannez pour continuer",
        "paused": "Installation en pause · étape {n} sur {total}",
        "problem_eyebrow": "INSTALLATION EN PAUSE",
        "problem_network": "Élise n’arrive pas à joindre Internet",
        "problem_other": "L’installation a rencontré un problème",
        "auto_title": "Ce qu’Élise fait",
        "auto_body": "Élise réessaie toute seule, chaque minute. Inutile de débrancher le boîtier.",
        "check_title": "Ce que vous pouvez vérifier",
        "checks_network": [
            "Le câble réseau relie bien le boîtier à la box Internet.",
            "La box Internet est allumée et fonctionne.",
            "En Wi-Fi : le nom et le mot de passe saisis lors de la préparation de la carte.",
        ],
        "checks_other": [
            "Laissez le boîtier allumé et relié à Internet.",
            "Si le problème revient, ouvrez l’application Élise pour voir le détail.",
        ],
        "detail": "Détail : {message}",
        "done_eyebrow": "INSTALLATION TERMINÉE",
        "done_title": "Élise est prête",
        "ready_body": "Ouvrez l’application Élise, ou l’adresse ci-contre, pour créer le compte de la famille.",
        "pair_title": "Dernière étape : l’écran du salon",
        "pair_steps": [
            "Ouvrez l’application Élise sur votre téléphone.",
            "Touchez « Activer l’accès privé » et suivez les étapes.",
            "La télévision affichera ensuite Élise toute seule.",
        ],
        "installing_title": "L’écran du salon se prépare",
        "installing_body": "L’accès privé est actif. Élise installe l’affichage de la télévision : "
        "cela peut prendre une vingtaine de minutes. Cet écran sera remplacé automatiquement.",
        "open": "Ouvrir Élise",
    },
    "en": {
        "elapsed": "Started {duration} ago",
        "step_of": "Step {n} of {total}",
        "steps": {
            "settings": "Raspberry Pi settings", "network": "Internet connection", "clock": "Setting the clock",
            "verify": "Checking the version", "download": "Downloading components", "start": "Starting Élise",
        },
        "leads": {
            "settings": "Élise is applying the settings chosen when the card was prepared.",
            "network": "Élise is checking its Internet connection.",
            "clock": "Élise is setting its clock to keep its connections secure.",
            "verify": "Élise is checking that its version is authentic.",
            "download": "Élise is downloading its components. This is the longest step.",
            "start": "Élise is starting and checking that everything works.",
        },
        "components": "{done} of {total} components",
        "percent": "{percent}%",
        "local": "Local address",
        "remote": "Remote access",
        "remote_later": "to set up from the app",
        "remote_value": "Remote access: {value}",
        "follow": "Follow on your phone",
        "no_network": "waiting for the network",
        "version": "Version {version}",
        "scan": "With your phone’s camera",
        "welcome_eyebrow": "FIRST INSTALLATION",
        "welcome_title": "Élise OS is being installed",
        "welcome_lead": "Everything happens automatically. Keep the box switched on and connected to the Internet.",
        "continue": "To continue",
        "continue_body": "Open the Élise mobile app, or go to",
        "progress_eyebrow": "INSTALLING",
        "reassure": "Nothing to do: this screen updates by itself.",
        "action_eyebrow": "INFORMATION NEEDED",
        "action_title": "Continue on your phone or computer",
        "action_body": "To download its components, Élise needs the GitHub bot account. "
        "Enter it in the Élise app or on the preparation page.",
        "action_note": "Nothing to type on the TV. The installation will resume by itself.",
        "action_scan": "Scan to continue",
        "paused": "Installation paused · step {n} of {total}",
        "problem_eyebrow": "INSTALLATION PAUSED",
        "problem_network": "Élise cannot reach the Internet",
        "problem_other": "The installation ran into a problem",
        "auto_title": "What Élise is doing",
        "auto_body": "Élise tries again by itself every minute. No need to unplug the box.",
        "check_title": "What you can check",
        "checks_network": [
            "The network cable connects the box to your Internet router.",
            "Your Internet router is switched on and working.",
            "On Wi-Fi: the network name and password entered when preparing the card.",
        ],
        "checks_other": [
            "Keep the box switched on and connected to the Internet.",
            "If the problem comes back, open the Élise app to see the details.",
        ],
        "detail": "Details: {message}",
        "done_eyebrow": "INSTALLATION COMPLETE",
        "done_title": "Élise is ready",
        "ready_body": "Open the Élise app, or the address shown here, to create the family account.",
        "pair_title": "Last step: the living room screen",
        "pair_steps": [
            "Open the Élise app on your phone.",
            "Tap “Enable private access” and follow the steps.",
            "The TV will then show Élise by itself.",
        ],
        "installing_title": "Preparing the living room screen",
        "installing_body": "Private access is on. Élise is installing the TV display, which can take about "
        "twenty minutes. This screen will be replaced automatically.",
        "open": "Open Élise",
    },
    "es": {
        "elapsed": "Iniciada hace {duration}",
        "step_of": "Paso {n} de {total}",
        "steps": {
            "settings": "Ajustes de la Raspberry Pi", "network": "Conexión a Internet", "clock": "Puesta en hora",
            "verify": "Verificación de la versión", "download": "Descarga de componentes", "start": "Inicio de Élise",
        },
        "leads": {
            "settings": "Élise aplica los ajustes elegidos al preparar la tarjeta.",
            "network": "Élise comprueba su conexión a Internet.",
            "clock": "Élise se pone en hora para proteger sus comunicaciones.",
            "verify": "Élise comprueba que su versión es auténtica.",
            "download": "Élise descarga sus componentes. Es el paso más largo.",
            "start": "Élise se inicia y comprueba que todo funciona.",
        },
        "components": "{done} de {total} componentes",
        "percent": "{percent} %",
        "local": "Dirección local",
        "remote": "Acceso remoto",
        "remote_later": "se configura desde la aplicación",
        "remote_value": "Acceso remoto: {value}",
        "follow": "Siga en su teléfono",
        "no_network": "esperando la red",
        "version": "Versión {version}",
        "scan": "Con la cámara del teléfono",
        "welcome_eyebrow": "PRIMERA INSTALACIÓN",
        "welcome_title": "Élise OS se está instalando",
        "welcome_lead": "Todo se hace automáticamente. Deje el equipo encendido y conectado a Internet.",
        "continue": "Para continuar",
        "continue_body": "Abra la aplicación móvil Élise o vaya a",
        "progress_eyebrow": "INSTALACIÓN EN CURSO",
        "reassure": "No tiene que hacer nada: esta pantalla se actualiza sola.",
        "action_eyebrow": "SE NECESITA UN DATO",
        "action_title": "Continúe en su teléfono u ordenador",
        "action_body": "Para descargar sus componentes, Élise necesita la cuenta bot de GitHub. "
        "Indíquela en la aplicación Élise o en la página de preparación.",
        "action_note": "No hay nada que escribir en el televisor. La instalación continuará sola.",
        "action_scan": "Escanee para continuar",
        "paused": "Instalación en pausa · paso {n} de {total}",
        "problem_eyebrow": "INSTALACIÓN EN PAUSA",
        "problem_network": "Élise no consigue conectarse a Internet",
        "problem_other": "La instalación ha encontrado un problema",
        "auto_title": "Lo que hace Élise",
        "auto_body": "Élise lo vuelve a intentar sola cada minuto. No hace falta desenchufar el equipo.",
        "check_title": "Lo que puede comprobar",
        "checks_network": [
            "El cable de red conecta el equipo con el router de Internet.",
            "El router de Internet está encendido y funciona.",
            "Por Wi-Fi: el nombre y la contraseña indicados al preparar la tarjeta.",
        ],
        "checks_other": [
            "Deje el equipo encendido y conectado a Internet.",
            "Si el problema vuelve, abra la aplicación Élise para ver el detalle.",
        ],
        "detail": "Detalle: {message}",
        "done_eyebrow": "INSTALACIÓN TERMINADA",
        "done_title": "Élise está lista",
        "ready_body": "Abra la aplicación Élise, o la dirección indicada, para crear la cuenta de la familia.",
        "pair_title": "Último paso: la pantalla del salón",
        "pair_steps": [
            "Abra la aplicación Élise en su teléfono.",
            "Toque «Activar el acceso privado» y siga los pasos.",
            "El televisor mostrará Élise automáticamente.",
        ],
        "installing_title": "Preparando la pantalla del salón",
        "installing_body": "El acceso privado está activo. Élise instala la pantalla del televisor: "
        "puede tardar unos veinte minutos. Esta pantalla se sustituirá automáticamente.",
        "open": "Abrir Élise",
    },
    "it": {
        "elapsed": "Avviata {duration} fa",
        "step_of": "Passaggio {n} di {total}",
        "steps": {
            "settings": "Impostazioni del Raspberry Pi", "network": "Connessione a Internet",
            "clock": "Regolazione dell’ora", "verify": "Verifica della versione",
            "download": "Download dei componenti", "start": "Avvio di Élise",
        },
        "leads": {
            "settings": "Élise applica le impostazioni scelte durante la preparazione della scheda.",
            "network": "Élise controlla la connessione a Internet.",
            "clock": "Élise regola l’ora per proteggere le sue comunicazioni.",
            "verify": "Élise verifica che la sua versione sia autentica.",
            "download": "Élise scarica i suoi componenti. È il passaggio più lungo.",
            "start": "Élise si avvia e controlla che tutto funzioni.",
        },
        "components": "{done} componenti su {total}",
        "percent": "{percent}%",
        "local": "Indirizzo locale",
        "remote": "Accesso remoto",
        "remote_later": "da configurare dall’app",
        "remote_value": "Accesso remoto: {value}",
        "follow": "Segua dal telefono",
        "no_network": "in attesa della rete",
        "version": "Versione {version}",
        "scan": "Con la fotocamera del telefono",
        "welcome_eyebrow": "PRIMA INSTALLAZIONE",
        "welcome_title": "Élise OS è in fase di installazione",
        "welcome_lead": "Tutto avviene automaticamente. Lasci il dispositivo acceso e collegato a Internet.",
        "continue": "Per continuare",
        "continue_body": "Apra l’app Élise sul telefono oppure vada su",
        "progress_eyebrow": "INSTALLAZIONE IN CORSO",
        "reassure": "Non deve fare nulla: questa schermata si aggiorna da sola.",
        "action_eyebrow": "SERVE UN’INFORMAZIONE",
        "action_title": "Continui dal telefono o dal computer",
        "action_body": "Per scaricare i suoi componenti, Élise ha bisogno dell’account bot GitHub. "
        "Lo indichi nell’app Élise o nella pagina di preparazione.",
        "action_note": "Non c’è nulla da digitare sul televisore. L’installazione riprenderà da sola.",
        "action_scan": "Inquadri per continuare",
        "paused": "Installazione in pausa · passaggio {n} di {total}",
        "problem_eyebrow": "INSTALLAZIONE IN PAUSA",
        "problem_network": "Élise non riesce a raggiungere Internet",
        "problem_other": "L’installazione ha incontrato un problema",
        "auto_title": "Cosa fa Élise",
        "auto_body": "Élise riprova da sola ogni minuto. Non serve scollegare il dispositivo.",
        "check_title": "Cosa può controllare",
        "checks_network": [
            "Il cavo di rete collega il dispositivo al modem/router.",
            "Il modem/router è acceso e funziona.",
            "In Wi-Fi: nome e password inseriti durante la preparazione della scheda.",
        ],
        "checks_other": [
            "Lasci il dispositivo acceso e collegato a Internet.",
            "Se il problema si ripresenta, apra l’app Élise per vedere i dettagli.",
        ],
        "detail": "Dettaglio: {message}",
        "done_eyebrow": "INSTALLAZIONE COMPLETATA",
        "done_title": "Élise è pronta",
        "ready_body": "Apra l’app Élise, o l’indirizzo indicato, per creare l’account della famiglia.",
        "pair_title": "Ultimo passaggio: lo schermo del soggiorno",
        "pair_steps": [
            "Apra l’app Élise sul telefono.",
            "Tocchi «Attiva l’accesso privato» e segua i passaggi.",
            "Il televisore mostrerà poi Élise da solo.",
        ],
        "installing_title": "Lo schermo del soggiorno si sta preparando",
        "installing_body": "L’accesso privato è attivo. Élise installa la visualizzazione sul televisore: "
        "può richiedere una ventina di minuti. Questa schermata verrà sostituita automaticamente.",
        "open": "Aprire Élise",
    },
}
# Raspberry Pi Imager sets the keyboard, rarely the locale: both hint at the family's language.
# "us" is also the untouched image's layout, so it says nothing.
KEYBOARDS = {"fr": "fr", "be": "fr", "ch": "fr", "ca": "fr", "es": "es", "latam": "es", "it": "it", "gb": "en", "us": ""}


def language() -> str:
    configured = install.read_env("ELISE_LANGUAGE") or install.read_env("ELISE_LOCALE")
    hints = [configured]
    for path, keys in ((LOCALE_FILE, ("LANGUAGE", "LC_ALL", "LANG")), (KEYBOARD_FILE, ("XKBLAYOUT",))):
        try:
            with open(path, encoding="utf-8") as settings:
                values = dict(line.strip().split("=", 1) for line in settings if "=" in line and not line.startswith("#"))
        except OSError:
            continue
        for key in keys:
            value = values.get(key, "").strip().strip('"').split(",")[0].split(":")[0]
            hints.append(KEYBOARDS.get(value, value or "") if key == "XKBLAYOUT" else value)
    for hint in hints:
        code = (hint or "").lower()[:2]
        if not code or code in ("c", "c.", "po"):
            continue
        return code if code in TEXT else "en"
    return "fr"


def duration(minutes: int) -> str:
    if minutes < 60:
        return f"{max(1, minutes)} min"
    return f"{minutes // 60} h {minutes % 60:02d}"


def auth_saved() -> bool:
    try:
        with open(AUTH_FILE, encoding="utf-8") as auth:
            return any(line.startswith("token=") and len(line.strip()) > 6 for line in auth)
    except OSError:
        return False


class Tracker:
    """Steadies the screen while elise-firstboot.sh restarts from its first message after a pause."""

    def __init__(self):
        self.furthest = 0
        self.problem = None
        self.action = None

    def update(self, status: dict, firstboot_done: bool, auth: bool) -> dict:
        step = STEP_IDS.index(status["step"])
        message = status["message"]
        self.furthest = max(self.furthest, step)
        if status["needsGithubAuth"]:
            self.action = step
        elif self.action is not None and (auth or step > self.action):
            self.action = None
        if status["error"] or any(hint in message for hint in install.PAUSE_HINTS):
            category = "network" if status["step"] == "network" else "other"
            self.problem = {"step": step, "category": category, "message": message}
        elif self.problem is not None:
            # Waiting for the network is the problem itself; any other step resumed is progress.
            limit = self.problem["step"] + (1 if self.problem["category"] == "network" else 0)
            if step >= limit:
                self.problem = None
        if firstboot_done:
            return {"kind": "done", "step": len(STEP_IDS) - 1, "problem": None}
        if self.action is not None:
            return {"kind": "action", "step": max(step, self.action), "problem": None}
        if self.problem is not None:
            return {"kind": "problem", "step": max(step, self.problem["step"]), "problem": self.problem}
        return {"kind": "welcome" if self.furthest == 0 else "progress", "step": step, "problem": None}


def choose_screen(view: dict, screen_enabled: bool, tailscale_running: bool) -> str:
    if view["kind"] != "done":
        return view["kind"]
    if not screen_enabled:
        return "ready"
    return "installing" if tailscale_running else "pair"


def snapshot(tracker: Tracker, lang: str, started: float) -> dict:
    status = install.read_status()
    firstboot_done = os.path.exists(install.FIRSTBOOT_MARKER)
    view = tracker.update(status, firstboot_done, auth_saved())
    remote = install.tailscale()
    screen_enabled = install.read_env("ELISE_SCREEN_ENABLED") != "false"
    port = install.PREPARATION_PORT
    if firstboot_done:
        port = int(install.read_env("ELISE_HTTP_PORT") or 80)
    return model(
        kind=choose_screen(view, screen_enabled, remote["running"]),
        lang=lang,
        step=view["step"],
        percent=100 if firstboot_done else status["percent"],
        images=install.images_progress() if STEP_IDS[view["step"]] == "download" else None,
        problem=view["problem"],
        host=status["address"],
        ip=status["ipAddress"],
        remote=remote["ip"],
        port=port,
        minutes=int((time.monotonic() - started) // 60),
        version=status["version"],
    )


def model(kind, lang="fr", step=0, percent=0, images=None, problem=None, host="elise.local",
          ip=None, remote=None, port=80, minutes=0, version="dev") -> dict:
    """Everything a screen shows; two equal models draw the same picture."""
    return {
        "kind": kind, "lang": lang, "step": step, "percent": max(0, min(100, int(percent))),
        "images": tuple(images) if images else None, "problem": problem, "host": host, "ip": ip,
        "remote": remote, "url": install.web_url(ip, port) if ip else None,
        "home": install.web_url(host, port), "minutes": minutes, "version": version,
    }


# Drawing --------------------------------------------------------------------------------------

def asset(name: str) -> str | None:
    for directory in ASSET_DIRS:
        if directory and os.path.exists(os.path.join(directory, name)):
            return os.path.join(directory, name)
    return None


FONT_FILES = {"serif": "fonts/SourceSerif4-Regular.ttf", "sans": "fonts/Inter-Regular.ttf", "bold": "fonts/Inter-SemiBold.ttf"}
_fonts: dict = {}
_backgrounds: dict = {}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    key = (kind, size)
    if key not in _fonts:
        path = asset(FONT_FILES[kind])
        _fonts[key] = ImageFont.truetype(path, size) if path else ImageFont.load_default(size)
    return _fonts[key]


def background(size: tuple[int, int], accent: tuple[int, int, int]) -> Image.Image:
    key = (size, accent)
    if key not in _backgrounds:
        width, height = size
        column = Image.new("RGB", (1, 64))
        for y in range(64):
            t = y / 63
            column.putpixel((0, y), tuple(round(NAVY[i] * (1 - t) + NAVY_DEEP[i] * t) for i in range(3)))
        image = column.resize(size, Image.BILINEAR)
        # Soft light drawn small then blurred and enlarged: cheap on a Raspberry Pi.
        glow = Image.new("RGB", (64, 36))
        draw = ImageDraw.Draw(glow)
        draw.ellipse((-22, -26, 30, 16), fill=tuple(round(c * 0.32) for c in BLUE))
        draw.ellipse((40, 20, 84, 50), fill=tuple(round(c * 0.10) for c in accent))
        glow = glow.filter(ImageFilter.GaussianBlur(7)).resize(size, Image.BICUBIC)
        _backgrounds[key] = ImageChops.add(image, glow)
    return _backgrounds[key].copy()


def mix(color, base, alpha: float):
    return tuple(round(c * alpha + b * (1 - alpha)) for c, b in zip(color, base))


class Painter:
    """Lays out a 1920×1080 design on any screen, keeping text inside its column."""

    SUPERSAMPLE = 4

    def __init__(self, size: tuple[int, int], accent):
        self.width, self.height = size
        self.k = min(self.width / 1920, self.height / 1080)
        self.ox = (self.width - 1920 * self.k) / 2
        self.oy = (self.height - 1080 * self.k) / 2
        self.image = background(size, accent)
        self.draw = ImageDraw.Draw(self.image)
        self.boxes: list[tuple[str, tuple[int, int, int, int]]] = []
        self.pulse = None

    def x(self, value: float) -> float:
        return self.ox + value * self.k

    def y(self, value: float) -> float:
        return self.oy + value * self.k

    def box(self, box) -> tuple[int, int, int, int]:
        return (round(self.x(box[0])), round(self.y(box[1])), round(self.x(box[2])), round(self.y(box[3])))

    def font(self, kind: str, size: float):
        return font(kind, max(8, round(size * self.k)))

    def measure(self, text: str, kind: str, size: float, tracking: float = 0) -> float:
        return (self.font(kind, size).getlength(text) + tracking * self.k * max(0, len(text) - 1)) / self.k

    def text(self, x, y, text, kind, size, fill, anchor="la", tracking=0.0, width=None):
        """One line at design coordinates; shrinks to `width` rather than overflowing."""
        while width and size > 12 and self.measure(text, kind, size, tracking) > width:
            size -= 1
        typeface = self.font(kind, size)
        if anchor[0] == "r":
            x -= self.measure(text, kind, size, tracking)
        elif anchor[0] == "m":
            x -= self.measure(text, kind, size, tracking) / 2
        position = (self.x(x), self.y(y))
        vertical = "l" + anchor[1]
        if tracking:
            cursor = position[0]
            for char in text:
                self.draw.text((cursor, position[1]), char, font=typeface, fill=fill, anchor=vertical)
                cursor += typeface.getlength(char) + tracking * self.k
        else:
            self.draw.text(position, text, font=typeface, fill=fill, anchor=vertical)
        left, top, right, bottom = self.draw.textbbox(position, text, font=typeface, anchor=vertical)
        right = max(right, round(left + self.measure(text, kind, size, tracking) * self.k))
        self.boxes.append((text, (left, top, right, bottom)))
        return size

    def wrap(self, text, kind, size, width):
        lines, line = [], ""
        for word in text.split():
            candidate = f"{line} {word}".strip()
            if line and self.measure(candidate, kind, size) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        return lines + ([line] if line else [])

    def paragraph(self, x, y, text, kind, size, fill, width, leading=1.3, max_lines=3, minimum=20, dry=False):
        """Wraps from the top `y`; returns the bottom of the last line (`dry` only measures)."""
        lines = self.wrap(text, kind, size, width)
        while (len(lines) > max_lines or any(self.measure(line, kind, size) > width for line in lines)) and size > minimum:
            size -= 2
            lines = self.wrap(text, kind, size, width)
        step = size * leading
        for index, line in enumerate([] if dry else lines[:max_lines]):
            if index == max_lines - 1 and len(lines) > max_lines:
                while line and self.measure(line + "…", kind, size) > width:
                    line = line[:-1]
                line = line.rstrip() + "…"
            self.text(x, y + index * step, line, kind, size, fill, width=width)
        return y + (min(len(lines), max_lines) - 1) * step + size * 1.05

    def mask(self, box, draw_shape):
        """Anti-aliased coverage: the shape is drawn four times larger, then reduced."""
        left, top, right, bottom = (math.floor(self.x(box[0])), math.floor(self.y(box[1])),
                                    math.ceil(self.x(box[2])), math.ceil(self.y(box[3])))
        width, height = max(1, right - left), max(1, bottom - top)
        scale = self.SUPERSAMPLE
        mask = Image.new("L", (width * scale, height * scale))

        def local(value_x, value_y):
            return ((self.x(value_x) - left) * scale, (self.y(value_y) - top) * scale)

        draw_shape(ImageDraw.Draw(mask), local, self.k * scale)
        return mask.reduce(scale), (left, top)

    def shape(self, box, draw_shape, color, alpha=1.0):
        mask, origin = self.mask(box, draw_shape)
        if alpha < 1:
            mask = mask.point(lambda value: round(value * alpha))
        self.image.paste(color, (*origin, origin[0] + mask.width, origin[1] + mask.height), mask)

    def rounded(self, box, radius, color, alpha=1.0, outline=None, outline_alpha=1.0):
        def fill(draw, local, factor):
            draw.rounded_rectangle((*local(box[0], box[1]), *local(box[2], box[3])), radius * factor, fill=255)

        if outline:
            def ring(draw, local, factor):
                draw.rounded_rectangle((*local(box[0], box[1]), *local(box[2], box[3])), radius * factor,
                                       outline=255, width=max(1, round(2 * factor)))
            self.shape(box, ring, outline, outline_alpha)
        self.shape(box, fill, color, alpha)

    def circle(self, cx, cy, radius, color, alpha=1.0, width=0):
        def draw_circle(draw, local, factor):
            bounds = (*local(cx - radius, cy - radius), *local(cx + radius, cy + radius))
            if width:
                draw.ellipse(bounds, outline=255, width=max(1, round(width * factor)))
            else:
                draw.ellipse(bounds, fill=255)

        self.shape((cx - radius - 1, cy - radius - 1, cx + radius + 1, cy + radius + 1), draw_circle, color, alpha)

    def check(self, cx, cy, radius, color):
        def draw_check(draw, local, factor):
            points = [local(cx - radius * 0.42, cy + radius * 0.02), local(cx - radius * 0.1, cy + radius * 0.34),
                      local(cx + radius * 0.45, cy - radius * 0.32)]
            draw.line(points, fill=255, width=max(1, round(radius * 0.2 * factor)), joint="curve")
            for point in (points[0], points[2]):
                tip = radius * 0.1 * factor
                draw.ellipse((point[0] - tip, point[1] - tip, point[0] + tip, point[1] + tip), fill=255)

        self.shape((cx - radius, cy - radius, cx + radius, cy + radius), draw_check, color)

    def mark_pulse(self, cx, cy, radius, color):
        self.pulse = (round(self.x(cx)), round(self.y(cy)), max(2, round(radius * self.k)), color)

    def logo(self, x, y, size):
        self.rounded((x, y, x + size, y + size), size * 0.28, CREAM)
        path = asset("elise-logo.png")
        if path:
            inner = round(size * 0.8 * self.k)
            mark = Image.open(path).convert("RGBA").resize((inner, inner), Image.LANCZOS)
            offset = round(size * 0.1 * self.k)
            self.image.paste(mark, (round(self.x(x)) + offset, round(self.y(y)) + offset), mark)

    def qr(self, x, y, size, data) -> bool:
        if qrcode is None or not data:
            return False
        code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=1, border=0)
        code.add_data(data)
        code.make(fit=True)
        matrix = code.get_matrix()
        count = len(matrix)
        # Whole pixels per module keep every edge sharp for the phone's camera.
        module = max(1, int(size * self.k // count))
        span = module * count
        left = round(self.x(x + size / 2) - span / 2)
        top = round(self.y(y + size / 2) - span / 2)
        for row, cells in enumerate(matrix):
            for column, dark in enumerate(cells):
                if dark:
                    self.draw.rectangle((left + column * module, top + row * module,
                                         left + (column + 1) * module - 1, top + (row + 1) * module - 1), fill=NAVY)
        return True


def text_for(lang: str) -> dict:
    return TEXT.get(lang, TEXT["en"])


def header(paint: Painter, m: dict, t: dict, elapsed: bool = True):
    paint.logo(120, 70, 84)
    paint.text(228, 112, "Élise OS", "bold", 36, CREAM, anchor="lm")
    if elapsed:
        paint.text(1800, 112, t["elapsed"].format(duration=duration(m["minutes"])), "sans", 28, MUTED, anchor="rm")


def footer(paint: Painter, m: dict, t: dict, left: str | None = None):
    paint.rounded((120, 966, 1800, 968), 1, CREAM, alpha=0.14)
    if left is None:
        remote = t["remote_value"].format(value=m["remote"] or t["remote_later"])
        left = "   ·   ".join([m["host"], m["ip"] or t["no_network"], remote])
    paint.text(120, 1014, left, "sans", 28, MUTED, anchor="lm", width=1380)
    paint.text(1800, 1014, t["version"].format(version=m["version"]), "sans", 24, DIM, anchor="rm")


def eyebrow(paint: Painter, y, label, accent, icon=None):
    x = 120
    if icon == "check":
        paint.circle(134, y + 2, 14, accent)
        paint.check(134, y + 2, 14, NAVY_DEEP)
        x = 164
    elif icon == "dot":
        paint.circle(132, y + 2, 9, accent)
        paint.mark_pulse(132, y + 2, 9, accent)
        x = 158
    paint.text(x, y, label, "bold", 24, accent, anchor="lm", tracking=3.5, width=960)


def qr_card(paint: Painter, m: dict, t: dict, url: str | None, title: str, accent):
    left, top, right, bottom = 1240, 232, 1800, 912
    paint.rounded((left, top, right, bottom), 40, CREAM)
    center = (left + right) / 2
    if paint.qr(center - 200, top + 76, 400, url):
        caption_top = top + 530
    else:
        caption_top = top + 260
        paint.text(center, top + 180, (url or m["home"]).removeprefix("http://"), "bold", 52, NAVY, anchor="mm", width=460)
    paint.text(center, caption_top, title, "bold", 32, NAVY, anchor="ma", width=470)
    lines = paint.wrap(t["scan"], "sans", 26, 450)
    for index, line in enumerate(lines[:2]):
        paint.text(center, caption_top + 48 + index * 34, line, "sans", 26, BLUE, anchor="ma", width=470)


def address_rows(paint: Painter, m: dict, t: dict, x, y, width):
    column = width * 0.42
    paint.text(x, y, t["local"].upper(), "bold", 20, DIM, tracking=2, width=column - 24)
    paint.text(x, y + 34, m["ip"] or t["no_network"], "bold", 34, CREAM, width=column - 24)
    paint.text(x + column, y, t["remote"].upper(), "bold", 20, DIM, tracking=2, width=width - column)
    if m["remote"]:
        paint.text(x + column, y + 34, m["remote"], "bold", 34, CREAM, width=width - column)
    else:
        paint.text(x + column, y + 38, t["remote_later"], "serif", 32, MUTED, width=width - column)


def steps_card(paint: Painter, m: dict, t: dict, failed: bool):
    left, top, right = 1060, 232, 1800
    paint.rounded((left, top, right, 912), 36, CREAM, alpha=0.05, outline=CREAM, outline_alpha=0.10)
    for index, key in enumerate(STEP_IDS):
        y = top + 70 + index * 108
        state = "done" if index < m["step"] else "pending"
        if index == m["step"]:
            state = "failed" if failed else ("done" if m["kind"] in ("ready", "pair", "installing") else "current")
        if state in ("current", "failed"):
            paint.rounded((left + 22, y - 44, right - 22, y + 44), 26, CREAM, alpha=0.08)
        icon = left + 76
        if state == "done":
            paint.circle(icon, y, 22, GREEN)
            paint.check(icon, y, 22, NAVY_DEEP)
        elif state == "failed":
            paint.circle(icon, y, 22, CORAL)
            paint.text(icon, y, "!", "bold", 28, NAVY_DEEP, anchor="mm")
        elif state == "current":
            paint.circle(icon, y, 22, SKY, width=4)
            paint.circle(icon, y, 9, SKY)
            paint.mark_pulse(icon, y, 22, SKY)
        else:
            paint.circle(icon, y, 22, DIM, alpha=0.7, width=2)
        detail = None
        if key == "download" and state == "current" and m["images"]:
            detail = f"{m['images'][0]} / {m['images'][1]}"
            paint.text(right - 52, y, detail, "bold", 28, SKY, anchor="rm")
        label_width = right - 52 - (left + 124) - (110 if detail else 0)
        color = {"done": CREAM, "current": CREAM, "failed": CORAL}.get(state, DIM)
        kind = "bold" if state in ("current", "failed") else "sans"
        paint.text(left + 124, y, t["steps"][key], kind, 31, color, anchor="lm", width=label_width)


def progress_bar(paint: Painter, x, y, width, percent, accent):
    paint.rounded((x, y, x + width, y + 18), 9, CREAM, alpha=0.12)
    end = x + max(18, width * percent / 100)

    def bar(draw, local, factor):
        draw.rounded_rectangle((*local(x, y), *local(end, y + 18)), 9 * factor, fill=255)

    mask, origin = paint.mask((x, y, end, y + 18), bar)
    ramp = Image.linear_gradient("L").rotate(90).resize(mask.size)
    paint.image.paste(Image.composite(Image.new("RGB", mask.size, GREEN), Image.new("RGB", mask.size, accent), ramp), origin, mask)


def draw_welcome(paint, m, t):
    eyebrow(paint, 246, t["welcome_eyebrow"], SKY, icon="dot")
    bottom = paint.paragraph(120, 286, t["welcome_title"], "serif", 80, CREAM, 1040, leading=1.12, max_lines=2, minimum=60)
    paint.paragraph(120, bottom + 28, t["welcome_lead"], "sans", 34, MUTED, 1000, max_lines=2, minimum=26)
    paint.rounded((120, 624, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
    paint.text(164, 670, t["continue"], "bold", 32, CREAM, anchor="lm", width=950)
    paint.text(164, 716, t["continue_body"], "sans", 28, MUTED, anchor="lm", width=950)
    paint.text(164, 768, m["home"], "bold", 50, SKY, anchor="lm", width=950)
    address_rows(paint, m, t, 164, 822, 950)
    qr_card(paint, m, t, m["url"], t["follow"], SKY)
    footer(paint, m, t, left=f"{t['step_of'].format(n=m['step'] + 1, total=len(STEP_IDS))}  ·  {t['steps'][STEP_IDS[m['step']]]}")


def draw_progress(paint, m, t):
    key = STEP_IDS[m["step"]]
    eyebrow(paint, 246, t["progress_eyebrow"], SKY, icon="dot")
    bottom = paint.paragraph(120, 286, t["steps"][key], "serif", 76, CREAM, 860, leading=1.1, max_lines=2, minimum=56)
    paint.paragraph(120, bottom + 26, t["leads"][key], "sans", 34, MUTED, 860, max_lines=3, minimum=26)
    paint.text(116, 790, t["percent"].format(percent=m["percent"]), "serif", 150, CREAM, anchor="ls")
    progress_bar(paint, 120, 820, 860, m["percent"], SKY)
    if m["images"]:
        below = t["components"].format(done=m["images"][0], total=m["images"][1])
    else:
        below = t["step_of"].format(n=m["step"] + 1, total=len(STEP_IDS))
    paint.text(120, 872, below, "bold", 28, CREAM, anchor="lm", width=420)
    paint.paragraph(120, 908, t["reassure"], "sans", 26, MUTED, 860, max_lines=1, minimum=20)
    steps_card(paint, m, t, failed=False)
    footer(paint, m, t)


def draw_action(paint, m, t):
    eyebrow(paint, 246, t["action_eyebrow"], AMBER, icon="dot")
    bottom = paint.paragraph(120, 286, t["action_title"], "serif", 78, CREAM, 1040, leading=1.1, max_lines=2, minimum=56)
    bottom = paint.paragraph(120, bottom + 30, t["action_body"], "sans", 34, MUTED, 1000, max_lines=4, minimum=26)
    note = paint.paragraph(160, 0, t["action_note"], "bold", 30, CREAM, 960, max_lines=2, minimum=22, dry=True)
    top = 852 - note - 60
    paint.rounded((120, top, 1160, 852), 28, AMBER, alpha=0.12)
    paint.paragraph(160, top + 30, t["action_note"], "bold", 30, CREAM, 960, max_lines=2, minimum=22)
    paint.text(120, 896, t["paused"].format(n=m["step"] + 1, total=len(STEP_IDS)), "sans", 26, DIM, anchor="lm", width=1040)
    qr_card(paint, m, t, m["url"], t["action_scan"], AMBER)
    footer(paint, m, t)


def draw_problem(paint, m, t):
    network = (m["problem"] or {}).get("category") == "network"
    eyebrow(paint, 246, t["problem_eyebrow"], CORAL, icon="dot")
    title = t["problem_network"] if network else t["problem_other"]
    bottom = paint.paragraph(120, 286, title, "serif", 72, CREAM, 880, leading=1.1, max_lines=2, minimum=52)
    y = bottom + 40
    paint.text(120, y, t["auto_title"], "bold", 30, CREAM, width=880)
    y = paint.paragraph(120, y + 46, t["auto_body"], "sans", 30, MUTED, 880, max_lines=2, minimum=24) + 34
    paint.text(120, y, t["check_title"], "bold", 30, CREAM, width=880)
    y += 50
    for item in t["checks_network" if network else "checks_other"]:
        paint.circle(130, y + 17, 6, CORAL)
        y = paint.paragraph(156, y, item, "sans", 28, MUTED, 840, max_lines=2, minimum=22) + 14
    # The installer writes French: elsewhere the app gives the details.
    message = (m["problem"] or {}).get("message") if m["lang"] == "fr" else None
    if message and y < 900:
        paint.paragraph(120, max(y + 8, 900), t["detail"].format(message=message), "sans", 22, DIM, 880, max_lines=1, minimum=18)
    steps_card(paint, m, t, failed=True)
    footer(paint, m, t)


def draw_done(paint, m, t):
    eyebrow(paint, 246, t["done_eyebrow"], GREEN, icon="check")
    paint.paragraph(120, 286, t["done_title"], "serif", 104, CREAM, 1040, leading=1.08, max_lines=1, minimum=64)
    if m["kind"] == "ready":
        bottom = paint.paragraph(120, 450, t["ready_body"], "sans", 36, MUTED, 1000, max_lines=3, minimum=26)
        paint.text(120, bottom + 64, m["home"], "bold", 56, GREEN, anchor="lm", width=1040)
        address_rows(paint, m, t, 120, bottom + 136, 1040)
    elif m["kind"] == "installing":
        bottom = paint.paragraph(164, 584, t["installing_body"], "sans", 32, MUTED, 950, max_lines=4, minimum=24, dry=True)
        paint.rounded((120, 470, 1160, bottom + 52), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.circle(178, 532, 12, GREEN)
        paint.mark_pulse(178, 532, 12, GREEN)
        paint.text(206, 532, t["installing_title"], "bold", 36, CREAM, anchor="lm", width=920)
        paint.paragraph(164, 584, t["installing_body"], "sans", 32, MUTED, 950, max_lines=4, minimum=24)
    else:
        paint.rounded((120, 470, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.text(164, 530, t["pair_title"], "bold", 38, CREAM, anchor="lm", width=950)
        y = 600
        for number, line in enumerate(t["pair_steps"], 1):
            paint.circle(190, y + 24, 26, GREEN, alpha=0.18)
            paint.text(190, y + 24, str(number), "bold", 28, GREEN, anchor="mm")
            if number == 2:
                paint.mark_pulse(190, y + 24, 26, GREEN)
            y = max(y + 100, paint.paragraph(238, y + 4, line, "sans", 32, CREAM if number == 2 else MUTED, 880, max_lines=2, minimum=24) + 40)
    qr_card(paint, m, t, m["url"], t["open"], GREEN)
    footer(paint, m, t)


SCREENS = {
    "welcome": draw_welcome, "progress": draw_progress, "action": draw_action, "problem": draw_problem,
    "ready": draw_done, "pair": draw_done, "installing": draw_done,
}


def render(m: dict, size=(1920, 1080)) -> Painter:
    paint = Painter(size, ACCENTS[m["kind"]])
    t = text_for(m["lang"])
    header(paint, m, t, elapsed=m["kind"] not in ("ready", "pair", "installing"))
    SCREENS[m["kind"]](paint, m, t)
    return paint


def pulse_frame(base: Image.Image, pulse, phase: float):
    """A breathing halo around the live marker, redrawn in its own small square."""
    cx, cy, radius, color = pulse
    reach = radius * 3
    box = (max(0, cx - reach), max(0, cy - reach), min(base.width, cx + reach), min(base.height, cy + reach))
    region = base.crop(box)
    grow = (1 - math.cos(phase * 2 * math.pi)) / 2
    halo = radius * (1.15 + 1.6 * grow)
    scale = 4
    mask = Image.new("L", (region.width * scale, region.height * scale))
    center = ((cx - box[0]) * scale, (cy - box[1]) * scale)
    ImageDraw.Draw(mask).ellipse(
        (center[0] - halo * scale, center[1] - halo * scale, center[0] + halo * scale, center[1] + halo * scale),
        outline=255, width=max(1, round(radius * 0.18 * scale)),
    )
    mask = mask.reduce(scale).point(lambda value: round(value * 0.7 * (1 - grow)))
    region.paste(color, (0, 0, region.width, region.height), mask)
    return region, box


# Framebuffer ----------------------------------------------------------------------------------

FBIOGET_VSCREENINFO = 0x4600


def pack_rgb565(image: Image.Image, swap: bool = False) -> bytes:
    """Little-endian RGB565 with Pillow's C routines: Python loops are too slow on a Pi."""
    red, green, blue = image.convert("RGB").split()
    if swap:
        red, blue = blue, red
    high = ImageChops.add(red.point(lambda value: value & 0xF8), green.point(lambda value: value >> 5))
    low = ImageChops.add(green.point(lambda value: (value << 3) & 0xE0), blue.point(lambda value: value >> 3))
    return Image.merge("LA", (low, high)).tobytes()


def encode(image: Image.Image, pixel_format: str) -> bytes:
    if pixel_format == "RGB565":
        return pack_rgb565(image)
    if pixel_format == "BGR565":
        return pack_rgb565(image, swap=True)
    return image.convert("RGB").tobytes("raw", pixel_format)


def pixel_format(bits: int, red_offset: int | None) -> str:
    if bits == 16:
        return "BGR565" if red_offset == 0 else "RGB565"
    if bits == 24:
        return "RGB" if red_offset == 0 else "BGR"
    if bits == 32:
        return "RGBX" if red_offset == 0 else "BGRX"
    raise ValueError(f"unsupported framebuffer depth: {bits}")


def read_sysfs(path: str) -> str:
    with open(path, encoding="ascii") as handle:
        return handle.read().strip()


def identity(sysfs: str) -> tuple:
    values = []
    for name in ("name", "virtual_size", "bits_per_pixel", "stride"):
        try:
            values.append(read_sysfs(f"{sysfs}/{name}"))
        except OSError:
            values.append(None)
    return tuple(values)


class Framebuffer:
    def __init__(self, device: str = FRAMEBUFFER, sysfs: str | None = None):
        sysfs = sysfs or f"/sys/class/graphics/{os.path.basename(device)}"
        self.sysfs = sysfs
        self.identity = identity(sysfs)
        self.fd = os.open(device, os.O_RDWR)
        try:
            width, height = (int(v) for v in read_sysfs(f"{sysfs}/virtual_size").split(","))
            bits = int(read_sysfs(f"{sysfs}/bits_per_pixel"))
            self.stride = int(read_sysfs(f"{sysfs}/stride"))
            red_offset, self.yoffset = None, 0
            try:
                info = fcntl.ioctl(self.fd, FBIOGET_VSCREENINFO, bytes(160))
                xres, yres, _, _, _, self.yoffset, bits = struct.unpack_from("7I", info)
                red_offset = struct.unpack_from("I", info, 32)[0]
                # The visible mode, not the double-buffered virtual area.
                width, height = xres or width, yres or height
            except OSError:
                pass
            self.size = (width, height)
            self.format = pixel_format(bits, red_offset)
            self.bytes_per_pixel = bits // 8
            self.memory = mmap.mmap(self.fd, self.stride * (self.yoffset + height))
        except BaseException:
            os.close(self.fd)
            raise

    def show(self, image: Image.Image, origin=(0, 0)):
        x, y = origin
        width = min(image.width, self.size[0] - x)
        height = min(image.height, self.size[1] - y)
        if width <= 0 or height <= 0:
            return
        if (width, height) != image.size:
            image = image.crop((0, 0, width, height))
        data = encode(image, self.format)
        row = width * self.bytes_per_pixel
        if x == 0 and row == self.stride:
            start = (self.yoffset + y) * self.stride
            self.memory[start:start + len(data)] = data
            return
        for line in range(height):
            start = (self.yoffset + y + line) * self.stride + x * self.bytes_per_pixel
            self.memory[start:start + row] = data[line * row:(line + 1) * row]

    def replaced(self) -> bool:
        """The firmware's early framebuffer gives way to the graphics driver's a few seconds in."""
        return identity(self.sysfs) != self.identity

    def close(self):
        self.memory.close()
        os.close(self.fd)


def screen_connected() -> bool | None:
    """True/False from the DRM connectors, None when the kernel does not say."""
    try:
        statuses = [
            read_sysfs(os.path.join("/sys/class/drm", name, "status"))
            for name in os.listdir("/sys/class/drm")
            if os.path.exists(os.path.join("/sys/class/drm", name, "status"))
        ]
    except OSError:
        return None
    return any(status == "connected" for status in statuses) if statuses else None


# Console --------------------------------------------------------------------------------------

KDSETMODE, KD_TEXT, KD_GRAPHICS = 0x4B3A, 0x00, 0x01
VT_GETSTATE, VT_ACTIVATE = 0x5603, 0x5606
CURSOR_BLINK = "/sys/class/graphics/fbcon/cursor_blink"


class Console:
    """Keeps kernel messages and the login prompt off the picture, then gives the TV back."""

    def __init__(self, terminal: int = TERMINAL):
        self.fd = None
        self.previous = 1
        self.blink = None
        try:
            self.fd = os.open(f"/dev/tty{terminal}", os.O_RDWR | os.O_NOCTTY)
            state = fcntl.ioctl(self.fd, VT_GETSTATE, bytes(6))
            self.previous = struct.unpack("HHH", state)[0] or 1
            # No blanking, no power saving, no cursor: what `setterm` would send.
            os.write(self.fd, b"\033[9;0]\033[14;0]\033[?25l")
            fcntl.ioctl(self.fd, VT_ACTIVATE, terminal)
            time.sleep(0.3)
            fcntl.ioctl(self.fd, KDSETMODE, KD_GRAPHICS)
        except OSError as error:
            print(f"Console texte non isolée : {error}", file=sys.stderr)
        try:
            self.blink = read_sysfs(CURSOR_BLINK)
            with open(CURSOR_BLINK, "w", encoding="ascii") as handle:
                handle.write("0")
        except OSError:
            self.blink = None

    def restore(self):
        if self.blink is not None:
            try:
                with open(CURSOR_BLINK, "w", encoding="ascii") as handle:
                    handle.write(self.blink)
            except OSError:
                pass
        if self.fd is None:
            return
        try:
            fcntl.ioctl(self.fd, KDSETMODE, KD_TEXT)
            os.write(self.fd, b"\033[?25h")
            fcntl.ioctl(self.fd, VT_ACTIVATE, self.previous)
        except OSError:
            pass
        os.close(self.fd)
        self.fd = None


# Main loop ------------------------------------------------------------------------------------

def should_leave(started_done: bool) -> bool:
    if os.path.exists(install.SCREEN_MARKER):
        return True
    # A box without the resident screen needs this one only during its first installation.
    return started_done and install.read_env("ELISE_SCREEN_ENABLED") == "false"


def run() -> int:
    stopping = {"now": False}

    def stop(*_args):
        stopping["now"] = True

    def pause(seconds: float):
        deadline = time.monotonic() + seconds
        while not stopping["now"] and time.monotonic() < deadline:
            time.sleep(0.1)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    # time.monotonic() counts from boot: on the first boot, that is the installation time.
    started = 0.0
    started_done = os.path.exists(install.FIRSTBOOT_MARKER)
    if should_leave(started_done):
        print("Écran d’installation inutile : il laisse la place.")
        return 0
    lang = language()
    tracker = Tracker()
    display = console = current = shown = pulse = None
    waiting_logged = False
    try:
        while not stopping["now"] and not should_leave(started_done):
            if display is None:
                try:
                    if screen_connected() is False:
                        raise OSError("aucun écran branché")
                    display = Framebuffer()
                except (OSError, ValueError) as error:
                    if not waiting_logged:
                        print(f"Écran d’installation en attente d’une TV : {error}", file=sys.stderr)
                        waiting_logged = True
                    pause(2)
                    continue
                console = console or Console()
                current = shown = None
                waiting_logged = False
                print(f"Écran d’installation affiché en {display.size[0]}×{display.size[1]} ({display.format}).")
            try:
                state = snapshot(tracker, lang, started)
                if state != current or shown is None:
                    frame = render(state, display.size)
                    if shown is not None and display.size[0] * display.size[1] <= 1920 * 1080:
                        for step in range(1, 9):
                            display.show(Image.blend(shown, frame.image, step / 8))
                            time.sleep(0.04)
                    display.show(frame.image)
                    shown, current, pulse = frame.image, state, frame.pulse
                # Seven calm frames a second for the live marker, then a fresh look at the progress.
                for _ in range(14):
                    if stopping["now"]:
                        break
                    if pulse:
                        region, box = pulse_frame(shown, pulse, (time.monotonic() % 2.2) / 2.2)
                        display.show(region, box[:2])
                    time.sleep(1 / 7)
                if display.replaced() or screen_connected() is False:
                    raise OSError("écran débranché ou framebuffer remplacé")
            except (OSError, ValueError, IndexError) as error:
                print(f"Écran d’installation interrompu : {error}", file=sys.stderr)
                display.close()
                display = None
    finally:
        if console:
            console.restore()
        if display:
            display.close()
    return 0


if __name__ == "__main__":
    sys.exit(run())
