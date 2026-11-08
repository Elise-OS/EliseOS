"""The family's language, known as early as the first boot of the box.

Three levels, the first that answers wins:

1. Chosen: the Élise app sends the language it shows when it follows the preparation; a
   browser opening the preparation page sends its own unless the app already did. A language
   written by hand as ELISE_LANGUAGE in elise.env counts as chosen too, after the app's.
2. Detected: guessed from what Raspberry Pi Imager wrote on the card (keyboard, time zone,
   locale), see `guess()`.
3. None: the TV takes turns in every language until one of the above answers.

The choice is kept in /var/lib/elise/language.json, not in elise.env: install-elise.sh
rewrites elise.env with `sed -i` while the preparation page runs, and a write racing it could
lose the release's image digests. The state directory survives the installation and updates;
the API, the dashboard or the resident screen can read the family's language there later.
"""
import json
import os
import re
import threading
import time
from datetime import datetime, timezone

import elise_install_state as install

# The codes of LANGUAGES in packages/i18n/src/index.ts, in the same order: the appliance
# does not ship the TypeScript sources, and test_install_screen.py keeps both lists in step.
LANGUAGES = ("fr", "en", "es", "it")
FALLBACK = "en"
CHOICE_FILE = os.environ.get("ELISE_LANGUAGE_FILE", os.path.join(install.STATE_DIR, "language.json"))
# The app is the family's deliberate choice; a browser only says what one visitor reads.
SOURCES = ("app", "browser")

# What Imager writes: cloud-init's user-data on Ubuntu (read before cloud-init applies it,
# the screen starts earlier), then the system files cloud-init or a person configured.
USER_DATA = ("boot/firmware/user-data", "var/lib/cloud/instance/user-data.txt")
LOCALE_FILE = "etc/default/locale"
KEYBOARD_FILE = "etc/default/keyboard"
TIMEZONE_FILE = "etc/timezone"
LOCALTIME = "etc/localtime"

# Keyboard layouts (XKB names) that say which language the family types. "be" is written in
# French by most of its users and Dutch is not offered; "ch" and "ca" depend on the variant.
KEYBOARDS = {"fr": "fr", "be": "fr", "es": "es", "latam": "es", "it": "it", "gb": "en", "ie": "en", "au": "en"}

# Time zones where one of the offered languages is clearly the everyday one. Zones shared by
# several languages (Brussels, Zurich, Luxembourg, Canada…) are left out: the keyboard decides.
ZONES = {
    "fr": {
        "Europe/Paris", "Europe/Monaco", "Indian/Reunion", "Indian/Mayotte", "America/Guadeloupe",
        "America/Martinique", "America/Cayenne", "America/Miquelon", "America/St_Barthelemy",
        "America/Marigot", "Pacific/Noumea", "Pacific/Tahiti", "Pacific/Marquesas", "Pacific/Gambier",
        "Pacific/Wallis",
    },
    "es": {
        "Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta", "America/Mexico_City", "America/Monterrey",
        "America/Merida", "America/Cancun", "America/Chihuahua", "America/Hermosillo", "America/Mazatlan",
        "America/Bogota", "America/Lima", "America/Santiago", "America/Caracas", "America/Montevideo",
        "America/Asuncion", "America/La_Paz", "America/Guayaquil", "America/Guatemala",
        "America/Tegucigalpa", "America/El_Salvador", "America/Managua", "America/Costa_Rica",
        "America/Panama", "America/Havana", "America/Santo_Domingo",
    },
    "it": {"Europe/Rome", "Europe/San_Marino", "Europe/Vatican"},
    "en": {
        "Europe/London", "Europe/Dublin", "Europe/Isle_of_Man", "Europe/Jersey", "Europe/Guernsey",
        "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
        "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Detroit",
        "Pacific/Auckland",
    },
}
ZONE_PREFIXES = {"America/Argentina/": "es", "Australia/": "en", "America/Indiana/": "en", "America/Kentucky/": "en"}

_lock = threading.Lock()
# cloud-init applies Imager's settings a little after the screen starts: look again now and then.
_detected = {"at": -60.0, "root": None, "value": None}


def supported(value) -> str | None:
    """The offered language of a code or a locale ("es", "it_IT.UTF-8", "fr-CA"), if any."""
    code = str(value or "").strip().strip('"').lower().replace("-", "_").split("_")[0].split(".")[0]
    return code if code in LANGUAGES else None


# Detection --------------------------------------------------------------------------------------

def zone_language(zone: str | None) -> str | None:
    zone = (zone or "").strip()
    for code, zones in ZONES.items():
        if zone in zones:
            return code
    return next((code for prefix, code in ZONE_PREFIXES.items() if zone.startswith(prefix)), None)


def keyboard_language(layout: str | None, variant: str | None = None) -> str | None:
    layout, variant = (layout or "").strip().lower(), (variant or "").strip().lower()
    if layout == "ch":
        # Swiss German by default; Swiss French is the "fr" variant.
        return "fr" if variant.startswith("fr") else None
    if layout == "ca":
        # Canadian French by default; "eng" is Canadian English.
        return "en" if variant == "eng" else "fr"
    return KEYBOARDS.get(layout)


def locale_language(locale: str | None) -> str | None:
    """A locale someone chose. cloud-init sets en_US.UTF-8 when nobody asked: it says nothing."""
    value = (locale or "").strip().strip('"')
    if not value or value.split(".")[0] in ("C", "POSIX", "en_US"):
        return None
    return supported(value)


def guess(locale=None, layout=None, variant=None, zone=None, keyboard_chosen=True) -> str | None:
    """The language most likely spoken at home, or None when nothing is reliable.

    - A locale someone set wins: it names the language.
    - Then a keyboard layout chosen in Imager: people type in their own language, wherever they
      live (a French keyboard in Madrid is French). Layouts of other languages (de, nl, pt…)
      and the ambiguous Swiss German one give None: better every language than a wrong one.
    - The US layout is the image's default and the most common layout worldwide: it only
      confirms English in an English-speaking time zone.
    - Without any keyboard choice, a time zone with one clear language decides.
    """
    spoken = locale_language(locale)
    if spoken:
        return spoken
    zone_code = zone_language(zone)
    layout = (layout or "").split(",")[0].strip().lower()
    variant = (variant or "").split(",")[0].strip().lower()
    if not layout or (layout == "us" and not keyboard_chosen):
        return zone_code
    if layout == "us":
        return "en" if zone_code == "en" else None
    return keyboard_language(layout, variant)


def _read(root: str, path: str) -> str:
    try:
        with open(os.path.join(root, path), encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return ""


def _settings(text: str) -> dict:
    values = {}
    for line in text.splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _user_data(text: str) -> dict:
    """locale, timezone and keyboard.layout/variant from cloud-config, without a YAML parser."""
    found, block = {}, None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indented = line[0] in " \t"
        key, _, value = line.strip().partition(":")
        value = value.split(" #")[0].strip().strip('"').strip("'")
        if not indented:
            block = key if key == "keyboard" and not value else None
            if key in ("locale", "timezone") and value:
                found[key] = value
            elif key == "keyboard" and value.startswith("{"):
                for name in ("layout", "variant"):
                    match = re.search(rf"\b{name}\s*:\s*['\"]?([\w-]+)", value)
                    if match:
                        found[name] = match.group(1)
        elif block == "keyboard" and key in ("layout", "variant") and value:
            found[key] = value
    return found


def hints(root: str = "/") -> dict:
    """What the card says about its family's language."""
    cloud = {}
    for path in USER_DATA:
        cloud = _user_data(_read(root, path))
        if cloud:
            break
    locale = _settings(_read(root, LOCALE_FILE))
    keyboard = _settings(_read(root, KEYBOARD_FILE))
    zone = cloud.get("timezone") or _read(root, TIMEZONE_FILE).strip()
    if not zone:
        try:
            zone = os.readlink(os.path.join(root, LOCALTIME)).split("zoneinfo/", 1)[1]
        except (OSError, IndexError):
            zone = ""
    layout = cloud.get("layout") or keyboard.get("XKBLAYOUT", "")
    return {
        "locale": cloud.get("locale") or locale.get("LANGUAGE", "").split(":")[0] or locale.get("LANG", ""),
        "layout": layout,
        "variant": cloud.get("variant", "") if cloud.get("layout") else keyboard.get("XKBVARIANT", ""),
        "zone": zone,
        # Imager's keyboard is a choice; the system file's "us" may be the untouched image.
        "keyboard_chosen": bool(cloud.get("layout")) or layout.split(",")[0] not in ("", "us"),
    }


def detect(root: str = "/") -> str | None:
    return guess(**hints(root))


# Choice -----------------------------------------------------------------------------------------

def chosen() -> dict | None:
    """The language the app, elise.env or a browser asked for, in that order."""
    try:
        with open(CHOICE_FILE, encoding="utf-8") as saved:
            choice = json.load(saved)
        if not isinstance(choice, dict) or not supported(choice.get("language")) or choice.get("source") not in SOURCES:
            choice = None
    except (OSError, ValueError):
        choice = None
    if choice and choice["source"] == "app":
        return {"language": choice["language"], "source": "app"}
    configured = supported(install.read_env("ELISE_LANGUAGE"))
    if configured:
        return {"language": configured, "source": "config"}
    return {"language": choice["language"], "source": "browser"} if choice else None


def current(root: str = "/") -> dict:
    """{"language": code or None, "source": "app" | "config" | "browser" | "detected" | None}."""
    choice = chosen()
    if choice:
        return choice
    now = time.monotonic()
    if _detected["root"] != root or now - _detected["at"] >= 15:
        _detected.update(at=now, root=root, value=detect(root))
    detected = _detected["value"]
    return {"language": detected, "source": "detected" if detected else None}


def save(language: str, source: str) -> tuple[dict, bool]:
    """Keeps a language sent by the app or a browser; returns the box's language and whether it changed.

    Sending the same language again changes nothing. A browser never replaces what the app or
    elise.env chose.
    """
    code = supported(language)
    if code is None or code != str(language).strip().lower():
        raise ValueError(f"unsupported language: {language!r}")
    if source not in SOURCES:
        raise ValueError(f"unknown source: {source!r}")
    with _lock:
        before = chosen()
        if before and (before == {"language": code, "source": source} or (source == "browser" and before["source"] != "browser")):
            return before, False
        directory = os.path.dirname(CHOICE_FILE)
        os.makedirs(directory, mode=0o755, exist_ok=True)
        temporary = f"{CHOICE_FILE}.tmp"
        with open(temporary, "w", encoding="utf-8") as output:
            json.dump({
                "language": code,
                "source": source,
                "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }, output)
            output.write("\n")
        os.chmod(temporary, 0o644)
        os.replace(temporary, CHOICE_FILE)
        after = chosen()
        return after, after != before
