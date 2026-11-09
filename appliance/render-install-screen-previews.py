#!/usr/bin/env python3
"""Draw every TV installation screen into PNG files, without a framebuffer.

Usage: render-install-screen-previews.py OUTPUT_DIR [--lang fr|rotation] [--size 1920x1080]
       render-install-screen-previews.py --bench [--size 1920x1080]

With --lang rotation: the welcome and the download in each language, pictures from the middle
of their fades, then the following screens in one language each. --bench measures what the
fades cost on this computer.
"""
import argparse
import importlib.util
import os
import pathlib
import statistics
import time

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("install_screen", here / "elise-install-screen.py")
screen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)

COMMON = {"host": "elise.local", "ip": "192.168.1.42", "version": "v0.1.22"}
PREVIEWS = {
    "1-accueil": dict(kind="welcome", step=0, percent=2, minutes=1),
    "2-accueil-tailscale": dict(kind="welcome", step=0, percent=2, minutes=1, remote="100.101.42.7"),
    "3-suivi-telechargement": dict(kind="progress", step=4, percent=41, images=(3, 12), minutes=14),
    "4-action-github": dict(kind="action", step=3, percent=25, minutes=6),
    "5-probleme-internet": dict(
        kind="problem", step=1, percent=5, minutes=7,
        problem={"step": 1, "category": "network", "message": "Internet est indisponible. Élise réessaiera automatiquement ; vérifiez le câble ou le Wi-Fi."},
    ),
    "6-probleme-installation": dict(
        kind="problem", step=4, percent=48, minutes=22,
        problem={"step": 4, "category": "other", "message": "Erreur : le téléchargement a été interrompu ; relancez la même commande. Élise réessaiera automatiquement dans une minute."},
    ),
    "7-termine-associer-ecran": dict(kind="pair", step=5, percent=100, minutes=31),
    "8-termine-ecran-en-installation": dict(kind="installing", step=5, percent=100, minutes=34, remote="100.101.42.7"),
    "9-termine-sans-ecran-resident": dict(kind="ready", step=5, percent=100, minutes=31),
}


def faded(first, fade, progress):
    """The whole picture `progress` (0 to 1) of the way through a fade."""
    picture = first.copy()
    for box, a, middle, b in fade.parts:
        picture.paste(fade.picture(a, middle, b, progress), box[:2])
    return picture


def rotation(output, size):
    images = {}
    for name in ("1-accueil", "3-suivi-telechargement"):
        turns = screen.Rotation(screen.model(lang=None, **{**COMMON, **PREVIEWS[name]}), size)
        for index, code in enumerate(turns.order):
            images[f"rotation-{name}-{index + 1}-{code}"] = turns.frame(index).image
        fade = screen.Fade(turns.frame(0).image, turns.frame(1).image, turns.base.image)
        images[f"rotation-{name}-fondu-1-fr-sortie"] = faded(turns.frame(0).image, fade, fade.OUT * 0.5)
        images[f"rotation-{name}-fondu-2-ecran-nu"] = faded(turns.frame(0).image, fade, fade.OUT)
        images[f"rotation-{name}-fondu-3-en-entree"] = faded(turns.frame(0).image, fade, fade.OUT + (1 - fade.OUT) * 0.5)
    for (name, values), code in zip(list(PREVIEWS.items())[3:], ["it", "fr", "es", "it", "fr", "en"]):
        model = screen.model(lang=None, **{**COMMON, **values})
        images[f"rotation-{name}-{code}"] = screen.render(model, size, lang=code).image
    for name, image in images.items():
        path = os.path.join(output, f"{name}.png")
        image.save(path)
        print(path)


def bench(size, rounds=5):
    """Milliseconds for what the TV does: draw a screen, prepare a fade step, copy it."""
    def timed(action):
        samples = []
        for _ in range(rounds):
            started = time.perf_counter()
            action()
            samples.append((time.perf_counter() - started) * 1000)
        return statistics.median(samples)

    for name in ("1-accueil", "3-suivi-telechargement"):
        m = screen.model(lang=None, **{**COMMON, **PREVIEWS[name]})
        turns = screen.Rotation(m, size)
        first, second, bare = turns.frame(0).image, turns.frame(1).image, turns.base.image
        fade = screen.Fade(first, second, bare, steps=screen.Fade.STEPS)
        area = sum((box[2] - box[0]) * (box[3] - box[1]) for box, *_ in fade.parts) / (size[0] * size[1])
        print(f"{name}, {size[0]}×{size[1]}, languages taking turns: the fade covers {area:.0%} of the picture.")
        print(f"  draw one screen:             {timed(lambda: screen.render(m, size, lang='es')):7.1f} ms")
        print(f"  find what changes:           {timed(lambda: screen.Fade(first, second, bare)):7.1f} ms")
        for pixel_format in ("RGB565", "BGRX"):
            def step():
                for box, a, middle, b in fade.parts:
                    screen.encode(fade.picture(a, middle, b, 0.3), pixel_format)

            def whole():
                screen.encode(screen.Image.blend(first, second, 0.3), pixel_format)
            print(f"  prepare one step, {pixel_format:6}:   {timed(step):7.1f} ms   (whole picture: {timed(whole):6.1f} ms)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", nargs="?")
    parser.add_argument("--lang", default="fr", choices=[*sorted(screen.TEXT), "rotation"])
    parser.add_argument("--size", default="1920x1080")
    parser.add_argument("--bench", action="store_true")
    args = parser.parse_args()
    size = tuple(int(value) for value in args.size.split("x"))
    if args.bench:
        return bench(size)
    if not args.output:
        parser.error("OUTPUT_DIR is required")
    os.makedirs(args.output, exist_ok=True)
    if args.lang == "rotation":
        return rotation(args.output, size)
    for name, values in PREVIEWS.items():
        path = os.path.join(args.output, f"{name}.png")
        screen.render(screen.model(lang=args.lang, **{**COMMON, **values}), size).image.save(path)
        print(path)


if __name__ == "__main__":
    main()
