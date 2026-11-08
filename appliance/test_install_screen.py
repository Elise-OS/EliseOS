"""Unit checks for the TV installation screen, without a television nor a framebuffer."""

import importlib.util
import itertools
import json
import os
import pathlib
import random
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import elise_install_state as install  # noqa: E402

SCREEN = pathlib.Path(__file__).with_name("elise-install-screen.py")
spec = importlib.util.spec_from_file_location("elise_install_screen", SCREEN)
screen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screen)
PREPARATION = pathlib.Path(__file__).with_name("elise-preparation.py")
spec = importlib.util.spec_from_file_location("elise_preparation", PREPARATION)
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)

try:
    import zxingcpp
except ImportError:
    zxingcpp = None

KINDS = ["welcome", "progress", "action", "problem", "ready", "pair", "installing"]
SIZES = [(1920, 1080), (1280, 720)]


def sample(kind, lang="fr", **values):
    defaults = dict(
        step={"welcome": 0, "action": 3, "problem": 1}.get(kind, 4 if kind == "progress" else 5),
        percent=41, images=(3, 12) if kind == "progress" else None, ip="192.168.1.42", minutes=14,
        version="v0.1.22", remote=None,
        problem={"step": 1, "category": "network", "message": "Internet est indisponible."} if kind == "problem" else None,
    )
    return screen.model(kind, lang=lang, **{**defaults, **values})


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.memory = {"step": 0, "seen": False}
        for name, value in (("images_progress", None), ("local_address", "192.168.1.42"),
                            ("tailscale", {"running": False, "ip": None, "name": None})):
            patcher = patch.object(install, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def status(self, message, error=False, auth=False):
        return install.build_status({"message": message, "error": error, "needsGithubAuth": auth}, self.memory)

    def follow(self, *messages, done=False, saved=False):
        tracker = screen.Tracker()
        view = None
        for message in messages:
            status = self.status(*message) if isinstance(message, tuple) else install.build_status(None, self.memory) \
                if message is None else self.status(message)
            view = tracker.update(status, done, saved)
        return view

    def test_status_keeps_the_mobile_api_and_adds_remote_access(self):
        status = preparation.read_status()
        for key in ("message", "error", "needsGithubAuth", "step", "steps", "percent", "address", "ipAddress",
                    "version", "startedAt", "tailscaleAddress"):
            self.assertIn(key, status)
        self.assertEqual([step["id"] for step in status["steps"]], screen.STEP_IDS)

    def test_first_screen_is_the_welcome_even_without_status(self):
        self.assertEqual(self.follow(None)["kind"], "welcome")
        self.assertEqual(self.follow("Application des réglages du Raspberry Pi…")["kind"], "welcome")

    def test_progress_does_not_go_back_to_the_welcome(self):
        view = self.follow("Connexion au réseau…", "Application des réglages du Raspberry Pi…")
        self.assertEqual(view["kind"], "progress")

    def test_progress_follows_the_download(self):
        with patch.object(install, "images_progress", return_value=(5, 10)):
            status = self.status("Téléchargement des composants Élise")
        self.assertEqual(status["step"], "download")
        self.assertEqual(status["percent"], round(25 + 65 * 0.5))
        self.assertEqual(screen.Tracker().update(status, False, False)["kind"], "progress")

    def test_github_account_request_survives_the_retry_until_saved(self):
        asked = ("Indiquez le compte bot GitHub d’Élise pour télécharger les composants.", False, True)
        view = self.follow(asked, "Application des réglages du Raspberry Pi…", "Connexion au réseau…")
        self.assertEqual(view["kind"], "action")
        self.assertEqual(view["step"], 3)
        resumed = self.follow(asked, "Application des réglages du Raspberry Pi…", saved=True)
        self.assertEqual(resumed["kind"], "progress")

    def test_missing_internet_stays_explained_while_elise_retries(self):
        offline = "Internet est indisponible. Élise réessaiera automatiquement ; vérifiez le câble ou le Wi-Fi."
        view = self.follow("Connexion au réseau…", offline, "Application des réglages du Raspberry Pi…", "Connexion au réseau…")
        self.assertEqual(view["kind"], "problem")
        self.assertEqual(view["problem"]["category"], "network")
        self.assertEqual(self.follow(offline, "Synchronisation de l’horloge…")["kind"], "progress")

    def test_installer_error_is_calm_then_progress_resumes(self):
        failure = ("Erreur : le téléchargement a été interrompu ; relancez la même commande.", True)
        view = self.follow("Téléchargement des composants Élise", failure, "Connexion au réseau…")
        self.assertEqual(view["kind"], "problem")
        self.assertEqual(view["problem"]["category"], "other")
        self.assertEqual(view["step"], 4)
        self.assertEqual(self.follow(failure, "Téléchargement des composants Élise")["kind"], "progress")

    def test_finished_screen_depends_on_the_resident_screen(self):
        view = self.follow("Démarrage et vérification d’Élise", None, done=True)
        self.assertEqual(screen.choose_screen(view, screen_enabled=False, tailscale_running=False), "ready")
        self.assertEqual(screen.choose_screen(view, screen_enabled=True, tailscale_running=False), "pair")
        self.assertEqual(screen.choose_screen(view, screen_enabled=True, tailscale_running=True), "installing")



class TailscaleTests(unittest.TestCase):
    def test_tailscale_is_optional(self):
        with patch.object(install, "_tailscale", {"at": -60.0, "value": {}}), \
                patch.object(install.subprocess, "run", side_effect=FileNotFoundError):
            self.assertEqual(install.tailscale(), {"running": False, "ip": None, "name": None})
        answer = json.dumps({"BackendState": "Running", "Self": {"TailscaleIPs": ["fd7a::1", "100.101.42.7"], "DNSName": "elise.tail.ts.net."}})
        with patch.object(install, "_tailscale", {"at": -60.0, "value": {}}), \
                patch.object(install.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, answer, "")):
            self.assertEqual(install.tailscale(), {"running": True, "ip": "100.101.42.7", "name": "elise.tail.ts.net"})
        logged_out = json.dumps({"BackendState": "NeedsLogin", "Self": {"TailscaleIPs": []}})
        with patch.object(install, "_tailscale", {"at": -60.0, "value": {}}), \
                patch.object(install.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, logged_out, "")):
            self.assertFalse(install.tailscale()["running"])


class LanguageTests(unittest.TestCase):
    def language(self, env="", locale="LANG=C.UTF-8\n", keyboard='XKBLAYOUT="us"\n'):
        with tempfile.TemporaryDirectory() as folder:
            paths = {}
            for name, content in (("locale", locale), ("keyboard", keyboard)):
                paths[name] = os.path.join(folder, name)
                pathlib.Path(paths[name]).write_text(content, encoding="utf-8")
            with patch.object(screen, "LOCALE_FILE", paths["locale"]), patch.object(screen, "KEYBOARD_FILE", paths["keyboard"]), \
                    patch.object(install, "read_env", side_effect=lambda key: env if key == "ELISE_LANGUAGE" else ""):
                return screen.language()

    def test_french_by_default_on_the_untouched_image(self):
        self.assertEqual(self.language(), "fr")

    def test_configured_language_wins(self):
        self.assertEqual(self.language(env="it", locale="LANG=es_ES.UTF-8\n"), "it")

    def test_locale_then_keyboard_hint_the_language(self):
        self.assertEqual(self.language(locale="LANG=es_ES.UTF-8\n"), "es")
        self.assertEqual(self.language(keyboard='XKBLAYOUT="it"\n'), "it")
        self.assertEqual(self.language(locale="LANG=de_DE.UTF-8\n"), "en")

    def test_catalogue_is_complete_in_every_language(self):
        def shape(value):
            if isinstance(value, dict):
                return {key: shape(item) for key, item in value.items()}
            return len(value) if isinstance(value, list) else "{" in value and sorted(
                part.split("}")[0] for part in value.split("{")[1:])

        for lang in ("en", "es", "it"):
            self.assertEqual(shape(screen.TEXT[lang]), shape(screen.TEXT["fr"]), lang)


class RenderTests(unittest.TestCase):
    def test_every_screen_renders_inside_the_tv_without_overlapping_text(self):
        for kind, lang, size in itertools.product(KINDS, screen.TEXT, SIZES):
            for remote in (None, "100.101.42.7"):
                with self.subTest(kind=kind, lang=lang, size=size, remote=remote):
                    paint = screen.render(sample(kind, lang, remote=remote), size)
                    self.assertEqual(paint.image.size, size)
                    margin = 60 * paint.k
                    for text, (left, top, right, bottom) in paint.boxes:
                        self.assertGreaterEqual(left, margin, text)
                        self.assertLessEqual(right, size[0] - margin, text)
                        self.assertGreaterEqual(top, 0, text)
                        self.assertLessEqual(bottom, size[1], text)
                    for (first, a), (second, b) in itertools.combinations(paint.boxes, 2):
                        overlap = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
                        self.assertFalse(overlap[0] > 1 and overlap[1] > 1, f"{first!r} overlaps {second!r}")

    def test_screen_without_network_or_qr_library_still_renders(self):
        with patch.object(screen, "qrcode", None):
            paint = screen.render(sample("welcome", ip=None))
        self.assertIn("http://elise.local", [text for text, _ in paint.boxes])

    def test_other_shapes_of_screen_are_centred(self):
        paint = screen.render(sample("progress"), (1024, 768))
        self.assertEqual(paint.image.size, (1024, 768))
        self.assertGreater(paint.oy, 0)

    def test_live_marker_breathes_inside_the_picture(self):
        paint = screen.render(sample("progress"))
        self.assertIsNotNone(paint.pulse)
        for phase in (0, 0.25, 0.5):
            region, box = screen.pulse_frame(paint.image, paint.pulse, phase)
            self.assertEqual(region.size, (box[2] - box[0], box[3] - box[1]))

    @unittest.skipIf(zxingcpp is None or screen.qrcode is None, "QR decoder unavailable")
    def test_qr_code_opens_the_preparation_page(self):
        for size in SIZES:
            image = screen.render(sample("welcome"), size).image
            self.assertEqual([code.text for code in zxingcpp.read_barcodes(image)], ["http://192.168.1.42"])


class FramebufferTests(unittest.TestCase):
    def test_rgb565_matches_the_reference_packing(self):
        rng = random.Random(4)
        image = Image.new("RGB", (17, 5))
        image.putdata([tuple(rng.randrange(256) for _ in range(3)) for _ in range(17 * 5)])
        expected = bytearray()
        for red, green, blue in image.getdata():
            value = (red >> 3) << 11 | (green >> 2) << 5 | blue >> 3
            expected += value.to_bytes(2, "little")
        self.assertEqual(screen.encode(image, "RGB565"), bytes(expected))
        swapped = Image.merge("RGB", image.split()[::-1])
        self.assertEqual(screen.encode(swapped, "BGR565"), bytes(expected))

    def test_xrgb8888_is_stored_blue_first(self):
        data = screen.encode(Image.new("RGB", (2, 1), (10, 20, 30)), "BGRX")
        self.assertEqual(len(data), 8)
        self.assertEqual((data[0:3], data[4:7]), (bytes([30, 20, 10]), bytes([30, 20, 10])))
        self.assertEqual(screen.pixel_format(32, 16), "BGRX")
        self.assertEqual(screen.pixel_format(32, 0), "RGBX")
        self.assertEqual(screen.pixel_format(16, 11), "RGB565")
        self.assertEqual(screen.pixel_format(16, None), "RGB565")
        with self.assertRaises(ValueError):
            screen.pixel_format(8, None)

    def fake(self, folder, width, height, bits, stride):
        sysfs = os.path.join(folder, "fb0")
        os.mkdir(sysfs)
        for name, value in (("virtual_size", f"{width},{height}"), ("bits_per_pixel", bits), ("stride", stride)):
            pathlib.Path(sysfs, name).write_text(f"{value}\n", encoding="ascii")
        device = os.path.join(folder, "device")
        pathlib.Path(device).write_bytes(bytes(stride * height))
        return device, sysfs

    def test_writes_rows_with_padding_and_regions(self):
        with tempfile.TemporaryDirectory() as folder:
            device, sysfs = self.fake(folder, 4, 3, 32, 20)
            display = screen.Framebuffer(device, sysfs)
            self.assertEqual((display.size, display.format), ((4, 3), "BGRX"))
            display.show(Image.new("RGB", (4, 3), (1, 2, 3)))
            display.show(Image.new("RGB", (2, 1), (9, 8, 7)), (1, 2))
            display.close()
            data = pathlib.Path(device).read_bytes()
            self.assertEqual(data[0:3], bytes([3, 2, 1]))
            self.assertEqual(data[16:20], bytes(4))  # padding untouched
            self.assertEqual(data[40 + 4:40 + 7], bytes([7, 8, 9]))
            self.assertEqual(data[40:43], bytes([3, 2, 1]))

    def test_notices_the_driver_replacing_the_early_framebuffer(self):
        with tempfile.TemporaryDirectory() as folder:
            device, sysfs = self.fake(folder, 4, 3, 32, 16)
            display = screen.Framebuffer(device, sysfs)
            self.assertFalse(display.replaced())
            pathlib.Path(sysfs, "virtual_size").write_text("8,6\n", encoding="ascii")
            self.assertTrue(display.replaced())
            display.close()

    def test_full_frame_in_rgb565(self):
        with tempfile.TemporaryDirectory() as folder:
            device, sysfs = self.fake(folder, 1280, 720, 16, 2560)
            display = screen.Framebuffer(device, sysfs)
            display.show(screen.render(sample("progress"), display.size).image)
            display.close()
            self.assertNotEqual(pathlib.Path(device).read_bytes()[:2560], bytes(2560))


if __name__ == "__main__":
    unittest.main()
