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
import elise_install_texts as texts
import elise_language

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

TEXT = texts.TEXT


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


def snapshot(tracker: Tracker, started: float) -> dict:
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
        # None while nothing tells the family's language: the screen takes turns.
        lang=elise_language.current()["language"],
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
        if not text:
            return size
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


def text_for(lang: str | None) -> dict:
    return TEXT.get(lang or elise_language.FALLBACK, TEXT[elise_language.FALLBACK])


def blank(value):
    """The catalogue's shape without its words: the screen as it looks between two languages."""
    if isinstance(value, dict):
        return {key: blank(item) for key, item in value.items()}
    return [] if isinstance(value, list) else ""


BLANK = blank(TEXT["fr"])


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


def tallest(paint, m, t, key, x, y, kind, size, width, **options) -> float:
    """Bottom of a paragraph in its longest language: a box taking turns must fit them all."""
    catalogs = [t] if m["lang"] else [TEXT[code] for code in elise_language.LANGUAGES]
    return max(paint.paragraph(x, y, texts[key], kind, size, CREAM, width, dry=True, **options) for texts in catalogs)


def welcome_height(paint, texts) -> float:
    title = paint.paragraph(120, 0, texts["welcome_title"], "serif", 80, CREAM, 1040, leading=1.12, max_lines=2, minimum=60, dry=True)
    return 52 + paint.paragraph(120, title + 28, texts["welcome_lead"], "sans", 34, MUTED, 1000, max_lines=2, minimum=26, dry=True)


def draw_welcome(paint, m, t, h):
    # Centred above the card; while languages take turns, on the longest so nothing jumps.
    catalogs = [h] if m["lang"] else [TEXT[code] for code in elise_language.LANGUAGES]
    top = 200 + (400 - max(welcome_height(paint, texts) for texts in catalogs)) / 2 + 12
    eyebrow(paint, top, h["welcome_eyebrow"], SKY, icon="dot")
    bottom = paint.paragraph(120, top + 40, h["welcome_title"], "serif", 80, CREAM, 1040, leading=1.12, max_lines=2, minimum=60)
    paint.paragraph(120, bottom + 28, h["welcome_lead"], "sans", 34, MUTED, 1000, max_lines=2, minimum=26)
    paint.rounded((120, 624, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
    paint.text(164, 670, h["continue"], "bold", 32, CREAM, anchor="lm", width=950)
    paint.text(164, 716, h["continue_body"], "sans", 28, MUTED, anchor="lm", width=950)
    paint.text(164, 768, m["home"], "bold", 50, SKY, anchor="lm", width=950)
    address_rows(paint, m, h, 164, 822, 950)
    qr_card(paint, m, t, m["url"], t["follow"], SKY)
    footer(paint, m, t, left=f"{t['step_of'].format(n=m['step'] + 1, total=len(STEP_IDS))}  ·  {t['steps'][STEP_IDS[m['step']]]}")


def draw_progress(paint, m, t, h):
    key = STEP_IDS[m["step"]]
    eyebrow(paint, 246, h["progress_eyebrow"], SKY, icon="dot")
    bottom = paint.paragraph(120, 286, h["steps"].get(key, ""), "serif", 76, CREAM, 860, leading=1.1, max_lines=2, minimum=56)
    paint.paragraph(120, bottom + 26, h["leads"].get(key, ""), "sans", 34, MUTED, 860, max_lines=3, minimum=26)
    # The number stays put while the words around it take turns.
    paint.text(116, 790, t["percent"].format(percent=m["percent"]), "serif", 150, CREAM, anchor="ls")
    progress_bar(paint, 120, 820, 860, m["percent"], SKY)
    if m["images"]:
        below = h["components"].format(done=m["images"][0], total=m["images"][1])
    else:
        below = h["step_of"].format(n=m["step"] + 1, total=len(STEP_IDS))
    paint.text(120, 872, below, "bold", 28, CREAM, anchor="lm", width=420)
    paint.paragraph(120, 908, h["reassure"], "sans", 26, MUTED, 860, max_lines=1, minimum=20)
    steps_card(paint, m, t, failed=False)
    footer(paint, m, t)


def draw_action(paint, m, t, h):
    eyebrow(paint, 246, h["action_eyebrow"], AMBER, icon="dot")
    bottom = paint.paragraph(120, 286, h["action_title"], "serif", 78, CREAM, 1040, leading=1.1, max_lines=2, minimum=56)
    bottom = paint.paragraph(120, bottom + 30, h["action_body"], "sans", 34, MUTED, 1000, max_lines=4, minimum=26)
    note = tallest(paint, m, t, "action_note", 160, 0, "bold", 30, 960, max_lines=2, minimum=22)
    top = 852 - note - 60
    paint.rounded((120, top, 1160, 852), 28, AMBER, alpha=0.12)
    paint.paragraph(160, top + 30, h["action_note"], "bold", 30, CREAM, 960, max_lines=2, minimum=22)
    paint.text(120, 896, h["paused"].format(n=m["step"] + 1, total=len(STEP_IDS)), "sans", 26, DIM, anchor="lm", width=1040)
    qr_card(paint, m, t, m["url"], t["action_scan"], AMBER)
    footer(paint, m, t)


def draw_problem(paint, m, t, h):
    network = (m["problem"] or {}).get("category") == "network"
    eyebrow(paint, 246, h["problem_eyebrow"], CORAL, icon="dot")
    title = h["problem_network"] if network else h["problem_other"]
    bottom = paint.paragraph(120, 286, title, "serif", 72, CREAM, 880, leading=1.1, max_lines=2, minimum=52)
    y = bottom + 40
    paint.text(120, y, h["auto_title"], "bold", 30, CREAM, width=880)
    y = paint.paragraph(120, y + 46, h["auto_body"], "sans", 30, MUTED, 880, max_lines=2, minimum=24) + 34
    paint.text(120, y, h["check_title"], "bold", 30, CREAM, width=880)
    y += 50
    for item in h["checks_network" if network else "checks_other"]:
        paint.circle(130, y + 17, 6, CORAL)
        y = paint.paragraph(156, y, item, "sans", 28, MUTED, 840, max_lines=2, minimum=22) + 14
    # The installer writes French: elsewhere the app gives the details.
    message = (m["problem"] or {}).get("message") if m["lang"] == "fr" else None
    if message and y < 900:
        paint.paragraph(120, max(y + 8, 900), t["detail"].format(message=message), "sans", 22, DIM, 880, max_lines=1, minimum=18)
    steps_card(paint, m, t, failed=True)
    footer(paint, m, t)


def draw_done(paint, m, t, h):
    eyebrow(paint, 246, h["done_eyebrow"], GREEN, icon="check")
    paint.paragraph(120, 286, h["done_title"], "serif", 104, CREAM, 1040, leading=1.08, max_lines=1, minimum=64)
    if m["kind"] == "ready":
        bottom = tallest(paint, m, t, "ready_body", 120, 450, "sans", 36, 1000, max_lines=3, minimum=26)
        paint.paragraph(120, 450, h["ready_body"], "sans", 36, MUTED, 1000, max_lines=3, minimum=26)
        paint.text(120, bottom + 64, m["home"], "bold", 56, GREEN, anchor="lm", width=1040)
        address_rows(paint, m, h, 120, bottom + 136, 1040)
    elif m["kind"] == "installing":
        bottom = tallest(paint, m, t, "installing_body", 164, 584, "sans", 32, 950, max_lines=4, minimum=24)
        paint.rounded((120, 470, 1160, bottom + 52), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.circle(178, 532, 12, GREEN)
        paint.mark_pulse(178, 532, 12, GREEN)
        paint.text(206, 532, h["installing_title"], "bold", 36, CREAM, anchor="lm", width=920)
        paint.paragraph(164, 584, h["installing_body"], "sans", 32, MUTED, 950, max_lines=4, minimum=24)
    else:
        paint.rounded((120, 470, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.text(164, 530, h["pair_title"], "bold", 38, CREAM, anchor="lm", width=950)
        y = 600
        for number, line in enumerate(h["pair_steps"], 1):
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


def render(m: dict, size=(1920, 1080), hero: str | None = None) -> Painter:
    """Draws a screen. Without a language (`m["lang"]` None), the message on the left is in
    `hero`, or left out when `hero` is None, and the rest is in English: see Rotation."""
    paint = Painter(size, ACCENTS[m["kind"]])
    t = text_for(m["lang"])
    h = t if m["lang"] else (text_for(hero) if hero else BLANK)
    header(paint, m, t, elapsed=m["kind"] not in ("ready", "pair", "installing"))
    SCREENS[m["kind"]](paint, m, t, h)
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


# Languages taking turns ------------------------------------------------------------------------

def ease(value: float) -> float:
    return (1 - math.cos(math.pi * max(0.0, min(1.0, value)))) / 2


class Rotation:
    """Bonjour · Hello · Hola · Ciao, while no language is known.

    The message on the left takes turns in every language; the QR code, the addresses, the
    steps, the header and the footer stay still, in English, the language most families can
    read. Between two languages the words fade out to the bare screen and the next ones fade
    in: no flash, no two languages over each other. The welcome changes every four seconds;
    the following screens hold each language longer, their message is longer to read.
    """

    HOLD = {"welcome": 3.0}
    DEFAULT_HOLD = 5.0
    FADE_OUT, FADE_IN, FPS = 0.45, 0.65, 14

    def __init__(self, m: dict, size, index: int = 0, now: float | None = None):
        self.model, self.size = m, size
        self.order = elise_language.LANGUAGES
        self.index = index % len(self.order)
        self.base = render(m, size)
        self.frames: dict[int, Painter] = {}
        self.since = time.monotonic() if now is None else now

    @property
    def language(self) -> str:
        return self.order[self.index]

    def frame(self, index: int | None = None) -> Painter:
        index = self.index if index is None else index % len(self.order)
        if index not in self.frames:
            self.frames[index] = render(self.model, self.size, hero=self.order[index])
        return self.frames[index]

    def prepared(self) -> bool:
        return (self.index + 1) % len(self.order) in self.frames

    def due(self, now: float) -> bool:
        return now - self.since >= self.HOLD.get(self.model["kind"], self.DEFAULT_HOLD)

    def region(self, first: Image.Image, second: Image.Image) -> tuple[int, int, int, int]:
        boxes = [ImageChops.difference(self.base.image, image).getbbox() for image in (first, second)]
        boxes = [box for box in boxes if box]
        if not boxes:
            return (0, 0, 0, 0)
        return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))

    @classmethod
    def between(cls, first: Image.Image, base: Image.Image, second: Image.Image, progress: float) -> Image.Image:
        """The picture `progress` (0 to 1) of the way from one language to the next."""
        split = cls.FADE_OUT / (cls.FADE_OUT + cls.FADE_IN)
        if progress < split:
            return Image.blend(first, base, ease(progress / split))
        return Image.blend(base, second, ease((progress - split) / (1 - split)))

    def advance(self, show=None, sleep=time.sleep) -> Painter:
        """Fades to the next language through `show(image, origin)` and returns its frame."""
        current, following = self.frame(), self.frame(self.index + 1)
        box = self.region(current.image, following.image)
        if show and box[2] > box[0] and box[3] > box[1]:
            first, base, second = (image.crop(box) for image in (current.image, self.base.image, following.image))
            count = round((self.FADE_OUT + self.FADE_IN) * self.FPS)
            for step in range(1, count + 1):
                show(self.between(first, base, second, step / count), box[:2])
                sleep(1 / self.FPS)
        self.index = (self.index + 1) % len(self.order)
        self.since = time.monotonic()
        return following


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
    tracker = Tracker()
    display = console = current = shown = pulse = rotation = None
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
                current = shown = rotation = None
                waiting_logged = False
                print(f"Écran d’installation affiché en {display.size[0]}×{display.size[1]} ({display.format}).")
            try:
                state = snapshot(tracker, started)
                if state != current or shown is None:
                    if state["lang"] is None:
                        # The same language keeps its turn when the progress moves on.
                        rotation = Rotation(state, display.size, rotation.index if rotation else 0)
                        frame = rotation.frame()
                    else:
                        rotation = None
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
                    if rotation and not rotation.prepared():
                        rotation.frame(rotation.index + 1)
                    elif rotation and rotation.due(time.monotonic()):
                        frame = rotation.advance(display.show)
                        shown, pulse = frame.image, frame.pulse
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
