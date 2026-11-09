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
        # The id /api/v1/discovery announces: the QR code opens the app on this very box.
        box=install.instance_id(),
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
          ip=None, remote=None, port=80, minutes=0, version="dev", box=None) -> dict:
    """Everything a screen shows; two equal models draw the same picture."""
    return {
        "kind": kind, "lang": lang, "step": step, "percent": max(0, min(100, int(percent))),
        "images": tuple(images) if images else None, "problem": problem, "host": host, "ip": ip,
        "remote": remote, "url": install.web_url(ip, port) if ip else None,
        # Without a language (they take turns), the link leaves it out and stays the same.
        "link": install.setup_link(box, ip, lang, port),
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
        self.typefaces: list[tuple[str, str, int]] = []  # text, typeface and pixel size
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
        self.typefaces.append((text, kind, typeface.size))
        return size

    def wrap(self, text, kind, size, width):
        lines, line = [], ""
        words = []
        for word in text.split():
            # French spaces before ; : ! ? never start a line with the sign.
            if words and word in (";", ":", "!", "?", "»"):
                words[-1] += " " + word
            elif words and words[-1] == "«":
                words[-1] += " " + word
            else:
                words.append(word)
        for word in words:
            candidate = f"{line} {word}".strip()
            if line and self.measure(candidate, kind, size) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        return lines + ([line] if line else [])

    def metrics(self, kind: str, size: float) -> tuple[float, float, float]:
        """Ascender, descender and the room above a capital, in design units."""
        typeface = self.font(kind, size)
        ascent, descent = typeface.getmetrics()
        return ascent / self.k, descent / self.k, typeface.getbbox("H")[1] / self.k

    def under(self, bottom: float, gap: float, kind: str, size: float) -> float:
        """The top to give a line so its capitals start `gap` below `bottom`."""
        return bottom + gap - self.metrics(kind, size)[2]

    def paragraph(self, x, y, text, kind, size, fill, width, leading=1.3, max_lines=3, minimum=20, dry=False):
        """Wraps from the top `y`; returns the real bottom of the block, descenders included,
        so the next block keeps the same distance whatever the language (`dry` only measures)."""
        lines = self.wrap(text, kind, size, width)
        if not lines:
            return y
        while (len(lines) > max_lines or any(self.measure(line, kind, size) > width for line in lines)) and size > minimum:
            size -= 2
            lines = self.wrap(text, kind, size, width)
        step = size * leading
        for index, line in enumerate([] if dry else lines[:max_lines]):
            if index == max_lines - 1 and len(lines) > max_lines:
                # Whole words only, without a comma or a semicolon left before the ellipsis.
                while " " in line and self.measure(line + "…", kind, size) > width:
                    line = line.rsplit(" ", 1)[0]
                line = line.rstrip(" ,;:.") + "…"
            self.text(x, y + index * step, line, kind, size, fill, width=width)
        ascent, descent, _ = self.metrics(kind, size)
        return y + (min(len(lines), max_lines) - 1) * step + ascent + descent

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

# Vertical rhythm, the same on every screen and in every language: distances run from the real
# bottom of a block (descenders included) to the capitals of the next one.
EYEBROW_TO_TITLE = 60  # from the middle of the eyebrow
TITLE_TO_LEAD = 0.34  # of the title's size, so a larger title breathes more


def catalogs(m: dict, t: dict) -> list[dict]:
    """The words a box must hold: its own, or every language's while they take turns."""
    return [TEXT[code] for code in elise_language.LANGUAGES] if m["lang"] is None else [t]


def item(values: list, index: int) -> str:
    return values[index] if index < len(values) else ""


def percent(m: dict, t: dict) -> str:
    # While languages take turns, the number keeps one shape: a thin space reads well in all.
    if m["lang"] is None:
        return f"{m['percent']} %"
    return t["percent"].format(percent=m["percent"])


def heading(paint: Painter, y, title, lead, size, width, minimum, lead_width=None, lead_lines=2, dry=False):
    """A serif title under the eyebrow centred on `y`, then its lead; returns the bottom."""
    top = paint.under(y, EYEBROW_TO_TITLE, "serif", size)
    bottom = paint.paragraph(120, top, title, "serif", size, CREAM, width, leading=1.1, max_lines=2,
                             minimum=minimum, dry=dry)
    if not lead:
        return bottom
    top = paint.under(bottom, size * TITLE_TO_LEAD, "sans", 34)
    return paint.paragraph(120, top, lead, "sans", 34, MUTED, lead_width or width, max_lines=lead_lines,
                           minimum=26, dry=dry)


def header(paint: Painter, m: dict, t: dict, elapsed: bool = True):
    paint.logo(120, 70, 84)
    paint.text(228, 112, "Élise OS", "bold", 36, CREAM, anchor="lm")
    if elapsed:
        paint.text(1800, 112, t["elapsed"].format(duration=duration(m["minutes"])), "sans", 28, MUTED, anchor="rm")


def footer(paint: Painter, m: dict, t: dict, left: str | None = None):
    paint.rounded((120, 966, 1800, 968), 1, CREAM, alpha=0.14)
    paint.text(1800, 1014, t["version"].format(version=m["version"]), "sans", 24, DIM, anchor="rm")
    if left is not None:
        paint.text(120, 1014, left, "sans", 28, MUTED, anchor="lm", width=1380)
        return

    def pieces(texts):
        remote = texts["remote_value"].format(value=m["remote"] or texts["remote_later"])
        return [m["host"], m["ip"] or texts["no_network"], remote]

    # The addresses keep their place and size while the words after them change language.
    gap, size = "   ·   ", 28
    while size > 20 and max(paint.measure(gap.join(pieces(texts)), "sans", size) for texts in catalogs(m, t)) > 1380:
        size -= 1
    x = 120
    for index, piece in enumerate(pieces(t)):
        if index:
            paint.text(x + paint.measure(gap, "sans", size) / 2, 1014, "·", "sans", size, MUTED, anchor="mm")
            x += paint.measure(gap, "sans", size)
        paint.text(x, 1014, piece, "sans", size, MUTED, anchor="lm")
        x += paint.measure(piece, "sans", size)


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


QR_CARD = (1240, 232, 1800, 912)
# The setup link (about a hundred characters) is a version 6 code at level M: 41 modules, drawn
# 10 pixels each at 1080p, 7 at 720p, with at least 4 modules of cream around them.
QR_BOX = (1300, 272, 1740, 712)


def caption(paint: Painter, text, kind, size, width, max_lines=2, minimum=22) -> tuple[list[str], float]:
    """Centred lines of similar length (never a lone word under a long line), and their size."""
    lines = paint.wrap(text, kind, size, width)
    while len(lines) > max_lines and size > minimum:
        size -= 1
        lines = paint.wrap(text, kind, size, width)
    if len(lines) == 2:
        words = " ".join(lines).split(" ")
        splits = [(" ".join(words[:i]), " ".join(words[i:])) for i in range(1, len(words))]
        fitting = [pair for pair in splits if max(paint.measure(line, kind, size) for line in pair) <= width]
        if fitting:
            lines = list(min(fitting, key=lambda pair: max(paint.measure(line, kind, size) for line in pair)))
    return lines[:max_lines], size


def centred(paint: Painter, x, top, bottom, lines, kind, size, color, width, leading=1.25):
    """`lines` centred on `x`, their capitals centred between `top` and `bottom`."""
    if not lines:
        return
    ascent, _, above = paint.metrics(kind, size)
    block = (len(lines) - 1) * size * leading + ascent - above
    y = top + (bottom - top - block) / 2 - above
    for index, line in enumerate(lines):
        paint.text(x, y + index * size * leading, line, kind, size, color, anchor="ma", width=width)


def qr_card(paint: Painter, m: dict, t: dict):
    left, top, right, bottom = QR_CARD
    paint.rounded(QR_CARD, 40, CREAM)
    center = (left + right) / 2
    address = m["url"] or m["home"]
    if paint.qr(QR_BOX[0], QR_BOX[1], QR_BOX[2] - QR_BOX[0], m["link"]):
        # For whoever cannot scan, the address to type; it keeps its place in every language.
        paint.text(center, bottom - 46, address, "bold", 30, BLUE, anchor="ms", width=480)
        ascent, _, above = paint.metrics("bold", 30)
        lines, size = caption(paint, t["scan"], "bold", 30, 470)
        centred(paint, center, QR_BOX[3], bottom - 46 - (ascent - above), lines, "bold", size, NAVY, 480)
        return
    lines, size = caption(paint, t["open_address"], "sans", 30, 460)
    centred(paint, center, top + 150, top + 270, lines, "sans", size, BLUE, 470)
    paint.text(center, top + 340, address, "bold", 52, NAVY, anchor="mm", width=460)
    if not m["ip"]:
        lines, size = caption(paint, t["no_network"], "sans", 26, 460)
        centred(paint, center, top + 390, top + 450, lines, "sans", size, DIM, 470)


def address_rows(paint: Painter, m: dict, t: dict, x, baseline, width):
    """Labels on `baseline`, the addresses one line below; words in the interface's sans serif."""
    column = width * 0.42
    values = baseline + 44
    paint.text(x, baseline, t["local"].upper(), "bold", 20, DIM, anchor="ls", tracking=2, width=column - 24)
    paint.text(x, values, m["ip"] or t["no_network"], "bold", 34, CREAM, anchor="ls", width=column - 24)
    paint.text(x + column, baseline, t["remote"].upper(), "bold", 20, DIM, anchor="ls", tracking=2, width=width - column)
    if m["remote"]:
        paint.text(x + column, values, m["remote"], "bold", 34, CREAM, anchor="ls", width=width - column)
    else:
        paint.text(x + column, values, t["remote_later"], "sans", 30, MUTED, anchor="ls", width=width - column)


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
        paint.text(left + 124, y, t["steps"].get(key, ""), kind, 31, color, anchor="lm", width=label_width)


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
    return max(paint.paragraph(x, y, texts[key], kind, size, CREAM, width, dry=True, **options) for texts in catalogs(m, t))


def draw_welcome(paint, m, t):
    # Centred above the card; while languages take turns, on the longest so nothing else moves.
    height = 12 + max(heading(paint, 0, texts["welcome_title"], texts["welcome_lead"], 80, 1040, 60,
                              lead_width=1000, dry=True) for texts in catalogs(m, t))
    y = 208 + (372 - height) / 2
    eyebrow(paint, y, t["welcome_eyebrow"], SKY, icon="dot")
    heading(paint, y, t["welcome_title"], t["welcome_lead"], 80, 1040, 60, lead_width=1000)
    top = 612
    paint.rounded((120, top, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
    paint.text(164, top + 64, t["continue"], "bold", 32, CREAM, anchor="ls", width=950)
    paint.text(164, top + 108, t["continue_body"], "sans", 28, MUTED, anchor="ls", width=950)
    paint.text(164, top + 172, m["home"], "bold", 50, SKY, anchor="ls", width=950)
    address_rows(paint, m, t, 164, top + 222, 950)
    qr_card(paint, m, t)
    where = t["step_of"].format(n=m["step"] + 1, total=len(STEP_IDS))
    footer(paint, m, t, left=f"{where}  ·  {t['steps'][STEP_IDS[m['step']]]}" if where else "")


def draw_progress(paint, m, t):
    key = STEP_IDS[m["step"]]
    eyebrow(paint, 246, t["progress_eyebrow"], SKY, icon="dot")
    heading(paint, 246, t["steps"].get(key, ""), t["leads"].get(key, ""), 76, 860, 56, lead_lines=3)
    # The number stays put while the words around it change.
    paint.text(116, 790, percent(m, t), "serif", 150, CREAM, anchor="ls")
    progress_bar(paint, 120, 820, 860, m["percent"], SKY)
    if m["images"]:
        below = t["components"].format(done=m["images"][0], total=m["images"][1])
    else:
        below = t["step_of"].format(n=m["step"] + 1, total=len(STEP_IDS))
    paint.text(120, 880, below, "bold", 28, CREAM, anchor="ls", width=860)
    paint.text(120, 924, t["reassure"], "sans", 26, MUTED, anchor="ls", width=860)
    steps_card(paint, m, t, failed=False)
    footer(paint, m, t)


def draw_action(paint, m, t):
    eyebrow(paint, 246, t["action_eyebrow"], AMBER, icon="dot")
    heading(paint, 246, t["action_title"], t["action_body"], 78, 1040, 56, lead_width=1000, lead_lines=4)
    note = tallest(paint, m, t, "action_note", 160, 0, "bold", 30, 960, max_lines=2, minimum=22)
    top = 852 - note - 56
    paint.rounded((120, top, 1160, 852), 28, AMBER, alpha=0.12)
    paint.paragraph(160, paint.under(top, 32, "bold", 30), t["action_note"], "bold", 30, CREAM, 960, max_lines=2, minimum=22)
    paint.text(120, 904, t["paused"].format(n=m["step"] + 1, total=len(STEP_IDS)), "sans", 26, DIM, anchor="ls", width=1040)
    qr_card(paint, m, t)
    footer(paint, m, t)


DETAIL_SIZE = 28  # read from three metres away


def draw_problem(paint, m, t):
    network = (m["problem"] or {}).get("category") == "network"
    eyebrow(paint, 246, t["problem_eyebrow"], CORAL, icon="dot")
    bottom = heading(paint, 246, t["problem_network"] if network else t["problem_other"], None, 72, 880, 52)
    bottom = paint.paragraph(120, paint.under(bottom, 36, "bold", 30), t["auto_title"], "bold", 30,
                             CREAM, 880, max_lines=1, minimum=24)
    bottom = paint.paragraph(120, paint.under(bottom, 10, "sans", 30), t["auto_body"], "sans", 30, MUTED, 880,
                             max_lines=2, minimum=24)
    bottom = paint.paragraph(120, paint.under(bottom, 30, "bold", 30), t["check_title"], "bold", 30, CREAM, 880,
                             max_lines=1, minimum=24)
    for index, line in enumerate(t["checks_network" if network else "checks_other"]):
        top = paint.under(bottom, 14 if index == 0 else 10, "sans", 28)
        paint.circle(130, top + paint.metrics("sans", 28)[2] + 10, 6, CORAL)
        bottom = paint.paragraph(156, top, line, "sans", 28, MUTED, 844, max_lines=2, minimum=22)
    # The installer writes in French: in another language, the app gives the details.
    message = (m["problem"] or {}).get("message") if t is TEXT["fr"] else None
    if message:
        detail = t["detail"].format(message=message)
        height = paint.paragraph(120, 0, detail, "sans", DETAIL_SIZE, MUTED, 880, max_lines=2, minimum=DETAIL_SIZE, dry=True)
        # Along the bottom of the steps, under a rule when there is room; or right after the list.
        top = 916 - height
        if top >= paint.under(bottom, 52, "sans", DETAIL_SIZE):
            paint.rounded((120, top - 20, 1000, top - 18), 1, CREAM, alpha=0.14)
        else:
            top = paint.under(bottom, 26, "sans", DETAIL_SIZE)
        if top + height <= 936:
            paint.paragraph(120, top, detail, "sans", DETAIL_SIZE, MUTED, 880, max_lines=2, minimum=DETAIL_SIZE)
    steps_card(paint, m, t, failed=True)
    footer(paint, m, t)


def draw_done(paint, m, t):
    eyebrow(paint, 246, t["done_eyebrow"], GREEN, icon="check")
    title = paint.paragraph(120, paint.under(246, EYEBROW_TO_TITLE, "serif", 104), t["done_title"], "serif", 104,
                            CREAM, 1040, max_lines=1, minimum=64)
    title = max(title, paint.under(246, EYEBROW_TO_TITLE, "serif", 104) + sum(paint.metrics("serif", 104)[:2]))
    if m["kind"] == "ready":
        top = paint.under(title, 104 * TITLE_TO_LEAD, "sans", 36)
        bottom = tallest(paint, m, t, "ready_body", 120, top, "sans", 36, 1000, max_lines=3, minimum=26)
        paint.paragraph(120, top, t["ready_body"], "sans", 36, MUTED, 1000, max_lines=3, minimum=26)
        paint.text(120, bottom + 92, m["home"], "bold", 56, GREEN, anchor="ls", width=1040)
        address_rows(paint, m, t, 120, bottom + 158, 1040)
    elif m["kind"] == "installing":
        bottom = tallest(paint, m, t, "installing_body", 164, 584, "sans", 32, 950, max_lines=4, minimum=24)
        paint.rounded((120, 470, 1160, bottom + 44), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.circle(178, 532, 12, GREEN)
        paint.mark_pulse(178, 532, 12, GREEN)
        paint.text(206, 532, t["installing_title"], "bold", 36, CREAM, anchor="lm", width=920)
        paint.paragraph(164, 584, t["installing_body"], "sans", 32, MUTED, 950, max_lines=4, minimum=24)
    else:
        paint.rounded((120, 470, 1160, 912), 32, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.10)
        paint.text(164, 530, t["pair_title"], "bold", 38, CREAM, anchor="lm", width=950)
        y = 600
        for number in (1, 2, 3):
            # The numbers stay in place whichever language is shown.
            reach = max(paint.paragraph(238, y + 4, item(texts["pair_steps"], number - 1), "sans", 32, CREAM, 880,
                                        max_lines=2, minimum=24, dry=True) for texts in catalogs(m, t))
            paint.circle(190, y + 24, 26, GREEN, alpha=0.18)
            paint.text(190, y + 24, str(number), "bold", 28, GREEN, anchor="mm")
            if number == 2:
                paint.mark_pulse(190, y + 24, 26, GREEN)
            paint.paragraph(238, y + 4, item(t["pair_steps"], number - 1), "sans", 32,
                            CREAM if number == 2 else MUTED, 880, max_lines=2, minimum=24)
            y = max(y + 100, reach + 32)
    qr_card(paint, m, t)
    footer(paint, m, t)


SCREENS = {
    "welcome": draw_welcome, "progress": draw_progress, "action": draw_action, "problem": draw_problem,
    "ready": draw_done, "pair": draw_done, "installing": draw_done,
}


def render(m: dict, size=(1920, 1080), lang: str | None = None) -> Painter:
    """Draws a screen, every word in `lang` (the model's language by default).

    `lang=""` draws only what has no words: the bare screen two languages fade through. A
    model without a language lays its boxes out for the longest language, so they stay put
    while the languages take turns: see Rotation.
    """
    lang = m["lang"] if lang is None else lang
    t = text_for(lang) if lang else BLANK
    paint = Painter(size, ACCENTS[m["kind"]])
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


# Fades ----------------------------------------------------------------------------------------

def ease(value: float) -> float:
    return (1 - math.cos(math.pi * max(0.0, min(1.0, value)))) / 2


def union(first, second):
    return (min(first[0], second[0]), min(first[1], second[1]), max(first[2], second[2]), max(first[3], second[3]))


def touching(first, second, margin=0) -> bool:
    return (first[0] <= second[2] + margin and second[0] <= first[2] + margin
            and first[1] <= second[3] + margin and second[1] <= first[3] + margin)


def changed(first: Image.Image, second: Image.Image, bare: Image.Image | None = None,
            columns: int = 16, rows: int = 18) -> list[tuple]:
    """The boxes where two pictures differ (or differ from the bare screen: a word the same in
    both languages fades too), found tile by tile. The words of a screen sit in a few columns:
    a fade that leaves the rest alone costs a fraction of the whole picture."""
    if bare is None:
        difference = ImageChops.difference(first, second)
    else:
        difference = ImageChops.lighter(ImageChops.difference(first, bare), ImageChops.difference(second, bare))
    xs = [round(first.width * i / columns) for i in range(columns + 1)]
    ys = [round(first.height * j / rows) for j in range(rows + 1)]
    boxes: list[tuple] = []
    for j in range(rows):
        run = None
        for i in range(columns):
            inside = difference.crop((xs[i], ys[j], xs[i + 1], ys[j + 1])).getbbox()
            if inside:
                tile = (xs[i] + inside[0], ys[j] + inside[1], xs[i] + inside[2], ys[j] + inside[3])
                run = tile if run is None else union(run, tile)
            elif run:
                boxes.append(run)
                run = None
        if run:
            boxes.append(run)
    merged = True
    while merged:
        merged = False
        for a in range(len(boxes)):
            for b in range(a + 1, len(boxes)):
                if touching(boxes[a], boxes[b], margin=2):
                    boxes[a] = union(boxes[a], boxes.pop(b))
                    merged = True
                    break
            if merged:
                break
    return boxes


class Fade:
    """From one picture to the next, prepared a step at a time, then only copied to the TV.

    With a `bare` picture (a new language), the old words fade out to it and the new ones fade
    in: never two languages over each other. The bare screen keeps everything without words
    (the logo, the QR code, the addresses, the percentage, the progress bar): they do not
    blink. Without one (the same language, a number moving on), the pictures dissolve.

    The steps are blended and encoded ahead of time, on the changed boxes only; showing one is
    a copy. A Raspberry Pi 4, four to six times slower than a desktop computer, needs a few
    hundredths of a second a step (see render-install-screen-previews.py --bench); a board too
    slow for the budget gets fewer steps, so a fade never takes longer nor stutters.
    """

    DURATION = 1.1
    OUT = 0.4  # share of the time spent fading out
    STEPS, MIN_STEPS = 10, 6
    BUDGET = 1.0  # processor seconds a fade may cost
    steps = STEPS

    def __init__(self, first: Image.Image, second: Image.Image, bare: Image.Image | None = None,
                 pack=None, steps: int | None = None):
        self.pack = pack or (lambda image, origin: (image, origin))
        self.count = steps or Fade.steps
        self.adaptive = steps is None
        self.parts = []
        for box in changed(first, second, bare):
            self.parts.append((box, first.crop(box), bare.crop(box) if bare else None, second.crop(box)))
        self.frames: list[list] = []
        self.cost = 0.0

    def ready(self) -> bool:
        return len(self.frames) >= self.count or not self.parts

    def picture(self, a, middle, b, progress: float) -> Image.Image:
        if middle is None:
            return Image.blend(a, b, ease(progress))
        if progress < self.OUT:
            return Image.blend(a, middle, ease(progress / self.OUT))
        return Image.blend(middle, b, ease((progress - self.OUT) / (1 - self.OUT)))

    def prepare(self) -> bool:
        """Prepares one more step; True once all are."""
        if self.ready():
            return True
        started = time.perf_counter()
        progress = (len(self.frames) + 1) / self.count
        self.frames.append([self.pack(self.picture(a, middle, b, progress), box[:2]) for box, a, middle, b in self.parts])
        self.cost += time.perf_counter() - started
        if self.ready() and self.adaptive:
            Fade.steps = max(self.MIN_STEPS, min(self.STEPS, int(self.BUDGET * self.count / max(self.cost, 1e-6))))
        return self.ready()

    def play(self, write, sleep=time.sleep):
        while not self.prepare():
            pass
        interval = self.DURATION / max(1, len(self.frames))
        for frame in self.frames:
            started = time.monotonic()
            for packed in frame:
                write(packed)
            sleep(max(0.0, interval - (time.monotonic() - started)))


class Rotation:
    """Bonjour · Hello · Hola · Ciao, while no language is known.

    The whole screen speaks one language at a time: title, steps, labels and footer change
    together, through the bare screen (see Fade). The welcome changes about every four seconds,
    the following screens, longer to read, about every six. While the progress moves on, the
    language keeps its turn and its time.
    """

    HOLD = {"welcome": 3.0}
    DEFAULT_HOLD = 5.0

    def __init__(self, m: dict, size, index: int = 0, since: float | None = None, pack=None):
        self.model, self.size, self.pack = m, size, pack
        self.order = elise_language.LANGUAGES
        self.index = index % len(self.order)
        self.base = render(m, size, lang="")
        self.frames: dict[int, Painter] = {}
        self.since = time.monotonic() if since is None else since
        self.fade = None

    @property
    def language(self) -> str:
        return self.order[self.index]

    def frame(self, index: int | None = None) -> Painter:
        index = self.index if index is None else index % len(self.order)
        if index not in self.frames:
            self.frames[index] = render(self.model, self.size, lang=self.order[index])
        return self.frames[index]

    def prepare(self) -> bool:
        """One slice of the work towards the next language, short enough to keep the live marker
        breathing; True once the fade is ready."""
        following = (self.index + 1) % len(self.order)
        if following not in self.frames:
            self.frame(following)
            return False
        if self.fade is None:
            self.fade = Fade(self.frame().image, self.frames[following].image, self.base.image, self.pack)
            return self.fade.ready()
        return self.fade.prepare()

    def due(self, now: float) -> bool:
        return now - self.since >= self.HOLD.get(self.model["kind"], self.DEFAULT_HOLD)

    def advance(self, write=None, sleep=time.sleep) -> Painter:
        """Fades to the next language through `write(packed)` and returns its picture."""
        while not self.prepare():
            pass
        if write:
            self.fade.play(write, sleep)
        self.index = (self.index + 1) % len(self.order)
        self.since = time.monotonic()
        self.fade = None
        return self.frame()



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

    def pack(self, image: Image.Image, origin=(0, 0)):
        """The framebuffer's bytes for `image` at `origin`, clipped to the screen: encoding is
        the costly part, done ahead of time for a fade."""
        x, y = origin
        width = min(image.width, self.size[0] - x)
        height = min(image.height, self.size[1] - y)
        if width <= 0 or height <= 0:
            return None
        if (width, height) != image.size:
            image = image.crop((0, 0, width, height))
        return encode(image, self.format), (x, y), width, height

    def show(self, image: Image.Image, origin=(0, 0)):
        self.write(self.pack(image, origin))

    def write(self, packed):
        if packed is None:
            return
        data, (x, y), width, height = packed
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


def screen_connected(drm_root: str = "/sys/class/drm") -> bool | None:
    """True/False from the DRM connectors, None when the kernel does not say."""
    try:
        statuses = [
            read_sysfs(os.path.join(drm_root, name, "status"))
            for name in os.listdir(drm_root)
            if os.path.exists(os.path.join(drm_root, name, "status"))
        ]
    except OSError:
        return None
    return any(status == "connected" for status in statuses) if statuses else None


def display_available(drm_root: str = "/sys/class/drm", framebuffer: str = FRAMEBUFFER) -> bool:
    """Whether starting the TV service can display anything now.

    A framebuffer remains a useful fallback on efifb/simpledrm and ARM64 systems even when a DRM
    connector reports stale information while the KMS driver is taking over.
    """
    connected = screen_connected(drm_root)
    return connected is True or os.path.exists(framebuffer)


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
    display = console = current = shown = spoken = pulse = rotation = None
    waiting_logged = False
    try:
        while not stopping["now"] and not should_leave(started_done):
            if display is None:
                try:
                    if not display_available():
                        raise OSError("aucun écran branché")
                    display = Framebuffer()
                except (OSError, ValueError) as error:
                    if not waiting_logged:
                        print(f"Écran d’installation en attente d’une TV : {error}", file=sys.stderr)
                        waiting_logged = True
                    pause(2)
                    continue
                console = console or Console()
                current = shown = spoken = rotation = None
                waiting_logged = False
                print(f"Écran d’installation affiché en {display.size[0]}×{display.size[1]} ({display.format}).")
            try:
                state = snapshot(tracker, started)
                if state != current or shown is None:
                    if state["lang"] is None:
                        # The language keeps its turn and its time while the progress moves on.
                        keep = (rotation.index, rotation.since) if rotation else ()
                        rotation = Rotation(state, display.size, *keep, pack=display.pack)
                        frame, words = rotation.frame(), rotation.language
                    else:
                        rotation = None
                        frame, words = render(state, display.size), state["lang"]
                    if shown is None:
                        display.show(frame.image)
                    elif display.size[0] * display.size[1] <= 1920 * 1080:
                        bare = None
                        if words != spoken:
                            # Another language: through the bare screen, never two at once.
                            bare = (rotation.base if rotation else render({**state, "lang": None}, display.size, lang="")).image
                        Fade(shown, frame.image, bare, display.pack, steps=None if bare else Fade.MIN_STEPS).play(display.write)
                    else:
                        display.show(frame.image)
                    shown, current, spoken, pulse = frame.image, state, words, frame.pulse
                # Seven calm frames a second for the live marker, then a fresh look at the progress;
                # in between, the next language gets ready a slice at a time.
                for _ in range(14):
                    if stopping["now"]:
                        break
                    if rotation and rotation.prepare() and rotation.due(time.monotonic()):
                        frame = rotation.advance(display.write)
                        shown, spoken, pulse = frame.image, rotation.language, frame.pulse
                    if pulse:
                        region, box = pulse_frame(shown, pulse, (time.monotonic() % 2.2) / 2.2)
                        display.show(region, box[:2])
                    time.sleep(1 / 7)
                if display.replaced() or not display_available():
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
    if "--detect-display" in sys.argv[1:]:
        sys.exit(0 if display_available() else 1)
    sys.exit(run())
