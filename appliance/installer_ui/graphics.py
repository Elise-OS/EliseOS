"""The installer drawn like the TV installation screen: the same engine, palette and type.

elise-install-screen.py lays out a 1920×1080 design on any screen with Pillow and writes it to
the framebuffer; this module only adds the installer's screens. The keyboard stays TextUI's.
On the USB stick, build-minipc-installer.sh copies that engine next to this file (engine/) and
unpacks a pinned Pillow wheel into vendor/, because Ubuntu's live system has no python3-pil.
"""

from __future__ import annotations

import fcntl
import importlib.util
import math
import os
import sys
from pathlib import Path

from . import LANGUAGES, STEP_IDS, TEXT, Disk, TextUI, ui_language

HERE = Path(__file__).resolve().parent
VENDOR = HERE.parent / "vendor"
ENGINE_DIRS = (HERE / "engine", HERE.parent)  # on the USB stick, then in the repository
VERSION_FILE = HERE / "VERSION"


def load_engine():
    if VENDOR.is_dir() and str(VENDOR) not in sys.path:
        sys.path.append(str(VENDOR))  # after the system's own Pillow, when there is one
    for directory in ENGINE_DIRS:
        path = directory / "elise-install-screen.py"
        if path.is_file():
            break
    else:
        raise ImportError("elise-install-screen.py not found")
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))  # its elise_install_* modules sit beside it
    spec = importlib.util.spec_from_file_location("elise_install_screen_engine", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


E = load_engine()
NAVY, NAVY_DEEP, CREAM, MUTED, DIM = E.NAVY, E.NAVY_DEEP, E.CREAM, E.MUTED, E.DIM
BLUE, SKY, GREEN, AMBER, CORAL = E.BLUE, E.SKY, E.GREEN, E.AMBER, E.CORAL
SOFT = E.mix(MUTED, DIM, 0.5)  # pending steps: quieter than MUTED, still AA on the navy
AMBER_INK = (128, 78, 16)  # amber words on a cream card, AA
CORAL_INK = (150, 58, 40)

LEFT, RIGHT = 120, 1800
COLUMN = 880  # the left column, from LEFT
CARD_LEFT = 1060  # the right column, to RIGHT
TOP, BOTTOM = 232, 912  # between the header and the footer rule
MIDDLE = 560
STAGE = {"language": 0, "ethernet": 1, "disk": 2, "confirmation": 2, "progress": 3}
KIND = {"no_disk": "no-disk", "no-disk": "no-disk", "cancelled": "cancelled"}


def read_version() -> str | None:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


# Shapes ---------------------------------------------------------------------------------------

def outline(paint, box, radius, color, width=3.0, alpha=1.0):
    def ring(draw, local, factor):
        draw.rounded_rectangle((*local(box[0], box[1]), *local(box[2], box[3])), radius * factor,
                               outline=255, width=max(1, round(width * factor)))

    paint.shape((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1), ring, color, alpha)


def polygon(paint, points, color, alpha=1.0):
    xs, ys = [p[0] for p in points], [p[1] for p in points]

    def fill(draw, local, factor):
        draw.polygon([local(x, y) for x, y in points], fill=255)

    paint.shape((min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1), fill, color, alpha)


def line(paint, points, color, width, alpha=1.0, dash=None):
    """A thick polyline with round joints; `dash` = (on, off) lengths along the path."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    pad = width

    def stroke(draw, local, factor):
        thickness = max(1, round(width * factor))
        segments = [points]
        if dash:
            segments, current, travelled, on = [], [points[0]], 0.0, True
            for (x0, y0), (x1, y1) in zip(points, points[1:]):
                length = math.hypot(x1 - x0, y1 - y0)
                start = 0.0
                while length - start > 1e-6:
                    left = (dash[0] if on else dash[1]) - travelled
                    step = min(left, length - start)
                    start += step
                    point = (x0 + (x1 - x0) * start / length, y0 + (y1 - y0) * start / length)
                    travelled += step
                    if on:
                        current.append(point)
                    if travelled >= (dash[0] if on else dash[1]) - 1e-6:
                        if on:
                            segments.append(current)
                        on, travelled, current = not on, 0.0, [point]
            if on and len(current) > 1:
                segments.append(current)
        for segment in segments:
            local_points = [local(x, y) for x, y in segment]
            draw.line(local_points, fill=255, width=thickness, joint="curve")
            for end in (local_points[0], local_points[-1]):
                r = thickness / 2
                draw.ellipse((end[0] - r, end[1] - r, end[0] + r, end[1] + r), fill=255)

    paint.shape((min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad), stroke, color, alpha)


def bezier(p0, p1, p2, p3, count=40):
    points = []
    for i in range(count + 1):
        t = i / count
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        points.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return points


def arrow(paint, cx, cy, direction, size, color):
    s = size
    shapes = {
        "up": [(cx, cy - s * 0.55), (cx + s * 0.62, cy + s * 0.4), (cx - s * 0.62, cy + s * 0.4)],
        "down": [(cx, cy + s * 0.55), (cx + s * 0.62, cy - s * 0.4), (cx - s * 0.62, cy - s * 0.4)],
        "left": [(cx - s * 0.55, cy), (cx + s * 0.4, cy - s * 0.62), (cx + s * 0.4, cy + s * 0.62)],
        "right": [(cx + s * 0.55, cy), (cx - s * 0.4, cy - s * 0.62), (cx - s * 0.4, cy + s * 0.62)],
    }
    polygon(paint, shapes[direction], color)


def focus(paint, box, radius, accent):
    """The keyboard focus: a bright ring standing a little off the chosen card or button."""
    outline(paint, (box[0] - 9, box[1] - 9, box[2] + 9, box[3] + 9), radius + 9, accent, width=4)


# Frame: header, stages and footer -------------------------------------------------------------

def stages(paint, t, current):
    """Language · Network · Disk · Installation, right-aligned in the header."""
    size, dot, gap, link = 24, 8, 12, 34
    labels = t["stages"]
    widths = [paint.measure(label, "bold" if i == current else "sans", size) for i, label in enumerate(labels)]
    total = sum(widths) + len(labels) * (dot * 2 + gap) + (len(labels) - 1) * (link + 2 * 14)
    x = RIGHT - total
    y = 112
    for index, label in enumerate(labels):
        if index:
            paint.rounded((x + 14, y - 1, x + 14 + link, y + 1), 1, CREAM, alpha=0.22)
            x += link + 28
        if index < current:
            paint.circle(x + dot, y, dot, GREEN)
        elif index == current:
            paint.circle(x + dot, y, dot + 5, SKY, alpha=0.28)
            paint.circle(x + dot, y, dot, SKY)
        else:
            paint.circle(x + dot, y, dot - 1, SOFT, width=2)
        x += dot * 2 + gap
        paint.text(x, y, label, "bold" if index == current else "sans", size,
                   CREAM if index == current else (MUTED if index < current else SOFT), anchor="lm")
        x += widths[index]


def header(paint, t, state):
    paint.logo(LEFT, 70, 84)
    paint.text(228, 112, "Élise OS", "bold", 36, CREAM, anchor="lm")
    if state in STAGE:
        stages(paint, t, STAGE[state])
    else:
        paint.text(RIGHT, 112, t["header"], "sans", 28, MUTED, anchor="rm", width=900)


def keycap(paint, x, y, label=None, direction=None) -> float:
    """A keyboard key drawn at `x`, centred on `y`; returns its width."""
    height = 48
    width = height if direction else max(height, paint.measure(label, "bold", 22) + 34)
    paint.rounded((x, y - height / 2, x + width, y + height / 2), 11, CREAM, alpha=0.10,
                  outline=CREAM, outline_alpha=0.34)
    if direction:
        arrow(paint, x + width / 2, y, direction, 15, CREAM)
    else:
        paint.text(x + width / 2, y, label, "bold", 22, CREAM, anchor="mm")
    return width


def footer(paint, t, version, left=None, keys=None):
    paint.rounded((LEFT, 966, RIGHT, 968), 1, CREAM, alpha=0.14)
    if version:
        paint.text(RIGHT, 1014, t["version"].format(version=version), "sans", 24, DIM, anchor="rm")
    y = 1014
    if keys:
        x = LEFT
        for arrows in (keys, None):
            if arrows:
                for direction in arrows:
                    x += keycap(paint, x, y, direction=direction) + 10
                label = t["key_choose"]
            else:
                x += 38
                x += keycap(paint, x, y, label=t["key_enter"]) + 10
                label = t["key_confirm"]
            paint.text(x + 6, y, label, "sans", 26, MUTED, anchor="lm")
            x += 6 + paint.measure(label, "sans", 26)
    elif left:
        paint.text(LEFT, y, left, "sans", 28, MUTED, anchor="lm", width=1300)


def eyebrow(paint, y, label, accent, icon=None):
    if icon != "alert":
        E.eyebrow(paint, y, label, accent, icon=icon)
        return
    paint.circle(134, y + 2, 14, accent)
    paint.rounded((132, y - 6, 136, y + 4), 2, NAVY_DEEP)
    paint.circle(134, y + 8, 2.4, NAVY_DEEP)
    paint.text(164, y, label, "bold", 24, accent, anchor="lm", tracking=3.5, width=COLUMN - 44)


def fit(paint, text, kind, size, width, minimum):
    """One line within `width`: a little smaller, then cut with an ellipsis rather than tiny."""
    while size > minimum and paint.measure(text, kind, size) > width:
        size -= 1
    if paint.measure(text, kind, size) > width:
        while len(text) > 1 and paint.measure(text.rstrip() + "…", kind, size) > width:
            text = text[:-1]
        text = text.rstrip() + "…"
    return text, size


def shorten(message: str, limit: int = 180) -> str:
    """A technical detail kept to two calm lines: no endless word, no endless sentence."""
    words = [word if len(word) <= 48 else word[:47] + "…" for word in message.split()]
    text = " ".join(words)
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def balance(paint, lines, kind, size, width):
    """Two lines of similar length rather than a lone word under a long line."""
    if len(lines) != 2:
        return lines
    words = " ".join(lines).split()
    splits = [(" ".join(words[:i]), " ".join(words[i:])) for i in range(1, len(words))]
    fitting = [pair for pair in splits if max(paint.measure(line, kind, size) for line in pair) <= width]
    if not fitting:
        return lines
    return list(min(fitting, key=lambda pair: abs(paint.measure(pair[0], kind, size) - paint.measure(pair[1], kind, size))))


def heading(paint, y, title, lead, size, width, minimum, lead_width=None, lead_lines=2, dry=False):
    """The engine's heading (serif title under the eyebrow centred on `y`, then its lead), with a
    title on two lines of similar length: never a lone word under a long line."""
    top = paint.under(y, E.EYEBROW_TO_TITLE, "serif", size)
    lines = paint.wrap(title, "serif", size, width)
    while (len(lines) > 2 or any(paint.measure(line, "serif", size) > width for line in lines)) and size > minimum:
        size -= 2
        lines = paint.wrap(title, "serif", size, width)
    lines = balance(paint, lines, "serif", size, width)
    step = size * 1.1
    for index, line in enumerate([] if dry else lines[:2]):
        paint.text(LEFT, top + index * step, line, "serif", size, CREAM, width=width)
    ascent, descent, _ = paint.metrics("serif", size)
    bottom = top + (min(len(lines), 2) - 1) * step + ascent + descent
    if not lead:
        return bottom
    top = paint.under(bottom, size * E.TITLE_TO_LEAD, "sans", 34)
    return paint.paragraph(LEFT, top, lead, "sans", 34, MUTED, lead_width or width, max_lines=lead_lines,
                           minimum=26, dry=dry)


def left_block_height(paint, catalogs, title_key, lead_key, size, minimum, lead_lines, title_width=COLUMN - 40):
    """Eyebrow, title and lead, in their longest language: the column then never jumps."""
    return 12 + max(heading(paint, 0, t[title_key], t[lead_key], size, title_width, minimum,
                              lead_width=COLUMN - 40, lead_lines=lead_lines, dry=True) for t in catalogs)


# Screens --------------------------------------------------------------------------------------

FLAG_W, FLAG_H = 72, 48


def flag_image(code: str, width: int, height: int):
    """The four flags as plain shapes (no bitmap asset), drawn 4× larger then reduced."""
    from PIL import Image, ImageDraw

    s = 4
    w, h = width * s, height * s
    image = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    if code in ("fr", "it"):
        left, right = ((0, 85, 164), (239, 65, 53)) if code == "fr" else ((0, 146, 70), (206, 43, 55))
        draw.rectangle((0, 0, w / 3, h), fill=left)
        draw.rectangle((w * 2 / 3, 0, w, h), fill=right)
    elif code == "es":
        draw.rectangle((0, 0, w, h), fill=(170, 21, 27))
        draw.rectangle((0, h / 4, w, h * 3 / 4), fill=(241, 191, 0))
    elif code == "en":
        blue, red, white = (1, 33, 105), (200, 16, 46), (255, 255, 255)
        draw.rectangle((0, 0, w, h), fill=blue)
        draw.line((0, 0, w, h), fill=white, width=round(h * 0.2))
        draw.line((0, h, w, 0), fill=white, width=round(h * 0.2))
        draw.line((0, 0, w, h), fill=red, width=round(h * 0.07))
        draw.line((0, h, w, 0), fill=red, width=round(h * 0.07))
        draw.rectangle((w / 2 - h * 0.17, 0, w / 2 + h * 0.17, h), fill=white)
        draw.rectangle((0, h / 2 - h * 0.17, w, h / 2 + h * 0.17), fill=white)
        draw.rectangle((w / 2 - h * 0.1, 0, w / 2 + h * 0.1, h), fill=red)
        draw.rectangle((0, h / 2 - h * 0.1, w, h / 2 + h * 0.1), fill=red)
    mask = Image.new("L", (w, h))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), round(h * 0.16), fill=255)
    return image.reduce(s), mask.reduce(s)


def flag(paint, x, y, code):
    width, height = max(1, round(FLAG_W * paint.k)), max(1, round(FLAG_H * paint.k))
    image, mask = flag_image(code, width, height)
    paint.image.paste(image, (round(paint.x(x)), round(paint.y(y))), mask)
    outline(paint, (x, y, x + FLAG_W, y + FLAG_H), FLAG_H * 0.16, NAVY, width=1.5, alpha=0.18)


def draw_language(paint, t, data):
    selected = data.get("selected", 0)
    catalogs = list(TEXT.values())
    height = left_block_height(paint, catalogs, "language_title", "language_lead", 80, 60, 3, title_width=COLUMN)
    y = MIDDLE - height / 2 + 12
    eyebrow(paint, y, t["language_eyebrow"], SKY)
    heading(paint, y, t["language_title"], t["language_lead"], 80, COLUMN, 60,
              lead_width=COLUMN - 40, lead_lines=3)
    card, gap = 124, 22
    top = MIDDLE - (len(LANGUAGES) * card + (len(LANGUAGES) - 1) * gap) / 2
    for index, (code, info) in enumerate(LANGUAGES.items()):
        box = (CARD_LEFT, top, RIGHT, top + card)
        chosen = index == selected
        if chosen:
            focus(paint, box, 30, SKY)
            paint.rounded(box, 30, CREAM)
        else:
            paint.rounded(box, 30, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.14)
        middle = top + card / 2
        flag(paint, CARD_LEFT + 52, middle - FLAG_H / 2, code)
        paint.text(CARD_LEFT + 52 + FLAG_W + 30, middle, info["name"], "bold", 44, NAVY if chosen else CREAM,
                   anchor="lm", width=440)
        mark = RIGHT - 70
        if chosen:
            paint.circle(mark, middle, 22, NAVY)
            paint.check(mark, middle, 22, CREAM)
        else:
            paint.circle(mark, middle, 21, CREAM, alpha=0.35, width=2)
        top += card + gap
    return {"keys": ("up", "down")}


def device(paint, box, radius, label):
    paint.rounded(box, radius, CREAM, alpha=0.09)
    outline(paint, box, radius, CREAM, width=3, alpha=0.6)
    paint.text((box[0] + box[2]) / 2, 572, label, "sans", 28, MUTED, anchor="ms", width=280)


def info_icon(paint, x, y, color):
    paint.circle(x, y, 14, color, width=2.2)
    paint.circle(x, y - 6, 2.2, color)
    paint.rounded((x - 1.6, y - 1.5, x + 1.6, y + 8), 1.6, color)


def draw_ethernet(paint, t, data):
    internet = data.get("network") == "no-internet"
    eyebrow(paint, 246, t["ethernet_eyebrow"], AMBER, icon="dot")
    bottom = heading(paint, 246, t["ethernet_title"], t["ethernet_body"], 80, COLUMN - 20, 56,
                       lead_width=COLUMN - 40, lead_lines=4)
    top = paint.under(bottom, 44, "sans", 28)
    info_icon(paint, LEFT + 14, top + paint.metrics("sans", 28)[2] + 10, MUTED)
    paint.paragraph(LEFT + 46, top, t["ethernet_wifi"], "sans", 28, MUTED, COLUMN - 46, max_lines=2, minimum=22)

    paint.rounded((CARD_LEFT, TOP, RIGHT, BOTTOM), 36, CREAM, alpha=0.05, outline=CREAM, outline_alpha=0.10)
    # The mini PC on the left, the router on the right, the cable hanging between them.
    pc, router = (1112, 318, 1316, 506), (1562, 372, 1752, 470)
    device(paint, pc, 34, t["device_minipc"])
    device(paint, router, 24, t["device_router"])
    paint.circle(pc[0] + 40, pc[1] + 40, 11, CREAM, alpha=0.6, width=2.5)
    paint.circle(pc[0] + 40, pc[3] - 38, 6, GREEN)
    paint.rounded((pc[0] + 66, pc[3] - 41, pc[0] + 140, pc[3] - 35), 3, CREAM, alpha=0.32)
    for index, color in enumerate((GREEN, AMBER if internet else GREEN, SOFT)):
        paint.circle(router[0] + 40 + index * 30, router[3] - 30, 6, color)
    pc_port, router_port = (pc[2] + 16, 430), (router[0] - 16, 421)
    paint.rounded((pc[2] - 2, 416, pc[2] + 16, 444), 5, CREAM, alpha=0.7)
    paint.rounded((router[0] - 16, 407, router[0] + 2, 435), 5, CREAM, alpha=0.7)
    if internet:
        line(paint, bezier(pc_port, (1390, 580), (1490, 580), router_port), SKY, 9)
        paint.circle(router[2] - 8, router[1] - 6, 21, AMBER)
        paint.text(router[2] - 8, router[1] - 6, "?", "bold", 26, NAVY_DEEP, anchor="mm")
    else:
        # The plug rests below the mini PC's port, waiting to be pushed in.
        plug = (1394, 548)
        line(paint, bezier(router_port, (1500, 640), (1394, 680), (plug[0], plug[1] + 20)), AMBER, 9)
        paint.rounded((plug[0] - 15, plug[1] - 22, plug[0] + 15, plug[1] + 20), 6, AMBER)
        paint.rounded((plug[0] - 8, plug[1] - 34, plug[0] + 8, plug[1] - 22), 3, AMBER)
        line(paint, bezier((plug[0] - 2, plug[1] - 52), (plug[0] - 6, 470), (1362, 440), (pc_port[0] + 30, 434)),
             AMBER, 3.5, alpha=0.9, dash=(10, 9))
        polygon(paint, [(pc_port[0] + 18, 433), (pc_port[0] + 36, 422), (pc_port[0] + 36, 445)], AMBER)

    panel = (CARD_LEFT + 32, 708, RIGHT - 32, BOTTOM - 32)
    paint.rounded(panel, 26, CREAM, alpha=0.06)
    status = t["ethernet_no_internet" if internet else "ethernet_waiting"]
    hint = t["ethernet_hint_internet" if internet else "ethernet_hint_cable"] if data.get("retry") else None
    x = panel[0] + 82
    if hint:
        status_y, hint_top = panel[1] + 52, panel[1] + 84
    else:
        status_y, hint_top = (panel[1] + panel[3]) / 2, None
    paint.circle(panel[0] + 46, status_y, 11, AMBER)
    paint.mark_pulse(panel[0] + 46, status_y, 11, AMBER)
    paint.text(x, status_y, status, "bold", 31, CREAM, anchor="lm", width=panel[2] - x - 30)
    if hint:
        paint.paragraph(x, hint_top, hint, "sans", 26, MUTED, panel[2] - x - 30, max_lines=2, minimum=20)
    return {"left": t["auto_update"]}


def disk_icon(paint, cx, cy, color, alpha=1.0):
    box = (cx - 34, cy - 24, cx + 34, cy + 24)
    outline(paint, box, 9, color, width=3.5, alpha=alpha)
    paint.rounded((cx - 20, cy + 6, cx + 6, cy + 10), 2, color, alpha=alpha)
    paint.circle(cx + 19, cy + 8, 3.5, color, alpha=alpha)


def badge(paint, x_right, y, label, on_cream, data):
    width = paint.measure(label, "bold", 22) + 58
    box = (x_right - width, y - 21, x_right, y + 21)
    if data:
        paint.rounded(box, 21, AMBER, alpha=0.26 if on_cream else 0.16)
        ink = AMBER_INK if on_cream else AMBER
    else:
        paint.rounded(box, 21, NAVY if on_cream else CREAM, alpha=0.08)
        ink = BLUE if on_cream else MUTED
    paint.circle(box[0] + 22, y, 5, ink)
    paint.text(box[0] + 38, y, label, "bold", 22, ink, anchor="lm")
    return width


def draw_disk(paint, t, data):
    disks: list[Disk] = data["disks"]
    language = data["language"]
    selected = data.get("selected", 0)
    height = left_block_height(paint, [t], "disk_title", "disk_help", 80, 56, 3)
    y = MIDDLE - height / 2 + 12
    eyebrow(paint, y, t["disk_eyebrow"], SKY)
    heading(paint, y, t["disk_title"], t["disk_help"], 80, COLUMN - 40, 56, lead_width=COLUMN - 40, lead_lines=3)

    visible = min(len(disks), 4)
    first = min(max(0, selected - visible + 1), len(disks) - visible)
    more = len(disks) - visible
    gap = 22
    card = min(156, (BOTTOM - TOP - (60 if more else 0) - (visible - 1) * gap) / visible)
    top = MIDDLE - (visible * card + (visible - 1) * gap + (60 if more else 0)) / 2
    for index in range(first, first + visible):
        disk = disks[index]
        chosen = index == selected
        box = (CARD_LEFT, top, RIGHT, top + card)
        if chosen:
            focus(paint, box, 28, SKY)
            paint.rounded(box, 28, CREAM)
        else:
            paint.rounded(box, 28, CREAM, alpha=0.06, outline=CREAM, outline_alpha=0.14)
        ink, quiet, number = (NAVY, BLUE, BLUE) if chosen else (CREAM, MUTED, SKY)
        disk_icon(paint, CARD_LEFT + 76, top + card / 2, ink, alpha=1.0 if chosen else 0.8)
        x, end = CARD_LEFT + 148, RIGHT - 40
        first_line, second_line = top + card * 0.36, top + card * 0.69
        size_text = disk.size_text(language)
        size_width = paint.measure(size_text, "bold", 36)
        paint.text(end, first_line, size_text, "bold", 36, number, anchor="rm")
        name, size = fit(paint, disk.name(language), "bold", 36, end - x - size_width - 28, 28)
        paint.text(x, first_line, name, "bold", size, ink, anchor="lm")
        label = t["data"] if disk.has_data else t["empty"]
        used = badge(paint, end, second_line, label, chosen, disk.has_data)
        path, size = fit(paint, disk.path, "sans", 26, end - x - used - 24, 22)
        paint.text(x, second_line, path, "sans", size, quiet, anchor="lm")
        top += card + gap
    if more:
        paint.text((CARD_LEFT + RIGHT) / 2, top + 22, t["more_disks"].format(count=more), "sans", 26, MUTED, anchor="mm")
    return {"keys": ("up", "down")}


def button(paint, box, label, chosen, danger):
    accent = CORAL if danger else SKY
    if chosen:
        focus(paint, box, 30, accent)
        paint.rounded(box, 30, CORAL if danger else CREAM)
        ink = NAVY_DEEP if danger else NAVY
    elif danger:
        outline(paint, box, 30, CORAL, width=3, alpha=0.85)
        ink = CORAL
    else:
        paint.rounded(box, 30, CREAM, alpha=0.08, outline=CREAM, outline_alpha=0.28)
        ink = CREAM
    paint.text((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, label, "bold", 34, ink, anchor="mm",
               width=box[2] - box[0] - 48)


def draw_confirmation(paint, t, data):
    disk: Disk = data["disk"]
    language = data["language"]
    selected = data.get("selected", 0)
    eyebrow(paint, 246, t["confirm_eyebrow"], CORAL, icon="alert")
    bottom = heading(paint, 246, t["confirm_title"], t["confirm_body"], 76, COLUMN - 20, 56,
                       lead_width=COLUMN - 40, lead_lines=4)
    # Reassurance last on the left, level with the buttons.
    safe_top = 892 - paint.paragraph(LEFT + 48, 0, t["confirm_safe"], "bold", 28, CREAM, COLUMN - 88,
                                     max_lines=2, minimum=22, dry=True)
    safe_top = max(safe_top, paint.under(bottom, 44, "bold", 28))
    cap = paint.metrics("bold", 28)[2]
    paint.circle(LEFT + 16, safe_top + cap + 11, 16, GREEN)
    paint.check(LEFT + 16, safe_top + cap + 11, 16, NAVY_DEEP)
    paint.paragraph(LEFT + 48, safe_top, t["confirm_safe"], "bold", 28, CREAM, COLUMN - 88, max_lines=2, minimum=22)

    card = (CARD_LEFT, TOP, RIGHT, 676)
    paint.rounded(card, 36, CORAL, alpha=0.10)
    outline(paint, card, 36, CORAL, width=2.5, alpha=0.55)
    x, width = CARD_LEFT + 56, RIGHT - CARD_LEFT - 112
    paint.text(x, TOP + 66, t["confirm_disk"], "bold", 22, CORAL, anchor="lm", tracking=3, width=width)
    name, size = disk.name(language), 48
    lines = paint.wrap(name, "bold", size, width)
    while len(lines) > 2 and size > 34:
        size -= 2
        lines = paint.wrap(name, "bold", size, width)
    if len(lines) > 2:
        lines = [lines[0], fit(paint, " ".join(lines[1:]), "bold", size, width, size)[0]]
    top = paint.under(TOP + 66, 44, "bold", size)
    for index, words in enumerate(balance(paint, lines, "bold", size, width)):
        paint.text(x, top + index * size * 1.1, words, "bold", size, CREAM, width=width)
    paint.text(x - 4, 562, disk.size_text(language), "serif", 92, CREAM, anchor="ls", width=width)
    row = 622
    used = badge(paint, RIGHT - 56, row, t["data"] if disk.has_data else t["empty"], False, disk.has_data)
    paint.text(x, row, disk.path, "sans", 28, MUTED, anchor="lm", width=width - used - 24)

    half = (RIGHT - CARD_LEFT - 28) / 2
    button(paint, (CARD_LEFT, 748, CARD_LEFT + half, 860), t["cancel"], selected == 0, danger=False)
    button(paint, (RIGHT - half, 748, RIGHT, 860), t["erase"], selected == 1, danger=True)
    return {"keys": ("left", "right")}


def steps_card(paint, t, current):
    left, top, right = CARD_LEFT, TOP, RIGHT
    paint.rounded((left, top, right, BOTTOM), 36, CREAM, alpha=0.05, outline=CREAM, outline_alpha=0.10)
    for index, key in enumerate(STEP_IDS):
        y = top + 70 + index * 108
        state = "done" if index < current else ("current" if index == current else "pending")
        icon = left + 76
        if state == "current":
            paint.rounded((left + 22, y - 44, right - 22, y + 44), 26, CREAM, alpha=0.08)
            paint.circle(icon, y, 22, SKY, width=4)
            paint.circle(icon, y, 9, SKY)
            paint.mark_pulse(icon, y, 22, SKY)
        elif state == "done":
            paint.circle(icon, y, 22, GREEN)
            paint.check(icon, y, 22, NAVY_DEEP)
        else:
            paint.circle(icon, y, 22, SOFT, alpha=0.8, width=2)
        color = {"done": CREAM, "current": CREAM}.get(state, SOFT)
        paint.text(left + 124, y, t["steps"][key], "bold" if state == "current" else "sans", 31, color,
                   anchor="lm", width=right - 52 - (left + 124))


def draw_progress(paint, t, data):
    step = data.get("step")
    current = STEP_IDS.index(step) if step in STEP_IDS else 0
    key = STEP_IDS[current]
    percent = max(0, min(100, int(data.get("percent") or 0)))
    eyebrow(paint, 246, t["progress_eyebrow"], SKY, icon="dot")
    heading(paint, 246, t["steps"][key], t["leads"][key], 76, 860, 56, lead_lines=3)
    paint.text(116, 790, t["percent"].format(percent=percent), "serif", 150, CREAM, anchor="ls")
    E.progress_bar(paint, LEFT, 820, 860, percent, SKY)
    paint.text(LEFT, 880, t["step_of"].format(n=current + 1, total=len(STEP_IDS)), "bold", 28, CREAM, anchor="ls", width=860)
    paint.text(LEFT, 924, t["reassure"], "sans", 26, MUTED, anchor="ls", width=860)
    steps_card(paint, t, current)
    return {"left": t["keep_usb"]}


OUTCOMES = {
    "cancelled": ("cancelled", GREEN, "check", "power_off"),
    "no-disk": ("no_disk", AMBER, "alert", "nothing_changed"),
    "error": ("error", CORAL, "alert", "power_off"),
}


def draw_outcome(paint, t, data):
    prefix, accent, icon, foot = OUTCOMES[data["kind"]]
    eyebrow(paint, 246, t[f"{prefix}_eyebrow"], accent, icon=icon)
    bottom = heading(paint, 246, t[f"{prefix}_title"], t[f"{prefix}_body"], 80, COLUMN - 20, 56,
                       lead_width=COLUMN - 40, lead_lines=4)
    message = data.get("message")
    if prefix == "error" and message:
        detail = t["detail"].format(message=shorten(message))
        height = paint.paragraph(LEFT, 0, detail, "sans", 26, MUTED, COLUMN - 40, max_lines=2, minimum=22, dry=True)
        top = max(BOTTOM - height, paint.under(bottom, 48, "sans", 26))
        paint.rounded((LEFT, top - 30, LEFT + COLUMN - 40, top - 28), 1, CREAM, alpha=0.14)
        paint.paragraph(LEFT, top, detail, "sans", 26, MUTED, COLUMN - 40, max_lines=2, minimum=22)

    width = RIGHT - CARD_LEFT - 132 - 52
    rows, y = [], TOP + 160
    for words in t[f"{prefix}_steps"]:
        reach = paint.paragraph(CARD_LEFT + 132, y + 2, words, "sans", 32, CREAM, width, max_lines=3, minimum=24, dry=True)
        rows.append(y)
        y = max(y + 112, reach + 44)
    paint.rounded((CARD_LEFT, TOP, RIGHT, min(BOTTOM, y + 20)), 36, CREAM, alpha=0.05, outline=CREAM, outline_alpha=0.10)
    paint.text(CARD_LEFT + 56, TOP + 78, t[f"{prefix}_next"], "bold", 36, CREAM, anchor="lm", width=620)
    for number, (words, top) in enumerate(zip(t[f"{prefix}_steps"], rows), start=1):
        paint.circle(CARD_LEFT + 82, top + 22, 26, accent, alpha=0.18)
        paint.text(CARD_LEFT + 82, top + 22, str(number), "bold", 28, accent, anchor="mm")
        paint.paragraph(CARD_LEFT + 132, top + 2, words, "sans", 32, CREAM, width, max_lines=3, minimum=24)
    return {"left": t[foot]}


SCREENS = {
    "language": draw_language, "ethernet": draw_ethernet, "disk": draw_disk, "confirmation": draw_confirmation,
    "progress": draw_progress, "cancelled": draw_outcome, "no-disk": draw_outcome, "error": draw_outcome,
}
ACCENTS = {"ethernet": AMBER, "confirmation": CORAL, "cancelled": GREEN, "no-disk": AMBER, "error": CORAL}


def render(state: str, language: str = "fr", size=(1920, 1080), *, version: str | None = None, **data):
    """One installer screen as an engine Painter (its .image, .boxes, .typefaces)."""
    state = KIND.get(state, state)
    if state == "language":
        language = list(LANGUAGES)[data.get("selected", 0)]
    language = ui_language(language)
    t = TEXT[language]
    paint = E.Painter(size, ACCENTS.get(state, SKY))
    header(paint, t, state)
    frame = SCREENS[state](paint, t, {**data, "kind": state, "language": language})
    footer(paint, t, version, left=frame.get("left"), keys=frame.get("keys"))
    return paint


# Console and framebuffer ----------------------------------------------------------------------

KDSETMODE, KD_TEXT, KD_GRAPHICS = 0x4B3A, 0x00, 0x01


def console_mode(console, mode: int) -> bool:
    """KD_GRAPHICS keeps the kernel's text console (cursor, messages) off the picture."""
    try:
        if mode == KD_GRAPHICS:
            os.write(console.fileno(), b"\033[9;0]\033[14;0]\033[?25l")
        fcntl.ioctl(console.fileno(), KDSETMODE, mode)
        if mode == KD_TEXT:
            os.write(console.fileno(), b"\033[?25h")
        return True
    except (AttributeError, OSError, ValueError):
        return False


class GraphicUI(TextUI):
    """TextUI's keyboard and choices, drawn on the framebuffer; falls back to text on any fault."""

    graphical = True

    def __init__(self, console, *, display, version=None, log=lambda _message: None, **options):
        super().__init__(console, **options)
        self.display = display
        self.version = version
        self.log = log
        self.failed = False
        self.shown = None
        self.frames: dict = {}

    @classmethod
    def open(cls, console, *, log=lambda _message: None, **options):
        for name in E.FONT_FILES.values():
            if not E.asset(name):
                raise FileNotFoundError(name)
        display = E.Framebuffer()
        if not console_mode(console, KD_GRAPHICS):
            log("UI console stays in text mode")
        log(f"UI graphic {display.size[0]}x{display.size[1]} {display.format}")
        return cls(console, display=display, version=read_version(), log=log, **options)

    def draw(self, state: str, logged: str | None = None, **data) -> bool:
        if self.failed:
            return False
        key = (state, self.language, repr(sorted(data.items(), key=lambda item: item[0])))
        try:
            image = self.frames.get(key)
            if image is None:
                image = render(state, self.language, self.display.size, version=self.version, **data).image
                if len(self.frames) > 24:
                    self.frames.clear()
                self.frames[key] = image
            if key != self.shown:
                self.display.show(image)
                self.shown = key
        except Exception as error:  # A screen that cannot be drawn must not stop the installation.
            self.failed = True
            self.log(f"UI text fallback: {type(error).__name__}: {error}")
            console_mode(self.console, KD_TEXT)
            return False
        self.state_logger(logged or state)
        return True

    def language_screen(self, selected: int = 0) -> None:
        if not self.draw("language", selected=selected):
            super().language_screen(selected)

    def disk_screen(self, disks: list[Disk], selected: int = 0) -> None:
        if not self.draw("disk", disks=tuple(disks), selected=selected):
            super().disk_screen(disks, selected)

    def confirmation_screen(self, disk: Disk, selected: int = 0) -> None:
        if not self.draw("confirmation", disk=disk, selected=selected):
            super().confirmation_screen(disk, selected)

    def ethernet_screen(self, retry: bool = False, state: str = "no-cable") -> None:
        if not self.draw("ethernet", retry=retry, network=state):
            super().ethernet_screen(retry, state)

    def progress_screen(self, step: str = "disk", percent: int | None = None) -> None:
        shown = step if step in STEP_IDS else STEP_IDS[0]
        if not self.draw("progress", logged=f"progress:{step}", step=shown, percent=percent or 0):
            super().progress_screen(step, percent)

    def error_screen(self, message: str, *, kind: str = "error") -> None:
        state = KIND.get(kind, "error")
        if not self.draw(state, logged=kind, message=message if state == "error" else ""):
            super().error_screen(message, kind=kind)
