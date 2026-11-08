#!/usr/bin/env python3
"""Draw every TV installation screen into PNG files, without a framebuffer.

Usage: render-install-screen-previews.py OUTPUT_DIR [--lang fr|rotation] [--size 1920x1080]

With --lang rotation: the languages taking turns on the welcome (each language, and the fade
between French and English), then the following screens with their message in one language.
"""
import argparse
import importlib.util
import os
import pathlib

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


def rotation(output, size):
    m = screen.model(lang=None, **{**COMMON, **PREVIEWS["1-accueil"]})
    turns = screen.Rotation(m, size)
    first, base, second = turns.frame(0).image, turns.base.image, turns.frame(1).image
    images = {f"rotation-{index + 1}-{code}": turns.frame(index).image for index, code in enumerate(turns.order)}
    split = turns.FADE_OUT / (turns.FADE_OUT + turns.FADE_IN)
    images["rotation-fondu-1-fr-sortie"] = turns.between(first, base, second, split * 0.5)
    images["rotation-fondu-2-ecran-nu"] = base
    images["rotation-fondu-3-en-entree"] = turns.between(first, base, second, split + (1 - split) * 0.5)
    for (name, values), hero in zip(list(PREVIEWS.items())[2:], ["es", "it", "fr", "es", "it", "fr", "en"]):
        model = screen.model(lang=None, **{**COMMON, **values})
        images[f"rotation-{name}-{hero}"] = screen.render(model, size, hero=hero).image
    for name, image in images.items():
        path = os.path.join(output, f"{name}.png")
        image.save(path)
        print(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--lang", default="fr", choices=[*sorted(screen.TEXT), "rotation"])
    parser.add_argument("--size", default="1920x1080")
    args = parser.parse_args()
    size = tuple(int(value) for value in args.size.split("x"))
    os.makedirs(args.output, exist_ok=True)
    if args.lang == "rotation":
        return rotation(args.output, size)
    for name, values in PREVIEWS.items():
        path = os.path.join(args.output, f"{name}.png")
        screen.render(screen.model(lang=args.lang, **{**COMMON, **values}), size).image.save(path)
        print(path)


if __name__ == "__main__":
    main()
