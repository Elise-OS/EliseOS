"""Unit checks for the TV installation screen, without a television nor a framebuffer."""

import importlib.util
import itertools
import json
import os
import pathlib
import random
import subprocess
import sys
import re
import tempfile
import textwrap
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import elise_install_state as install  # noqa: E402
import elise_language  # noqa: E402

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
    # (what Imager or cloud-init left on the card, language expected; None = every language in turn)
    CASES = [
        ("untouched image", dict(locale="C.UTF-8", layout="us", zone="Etc/UTC", keyboard_chosen=False), None),
        ("cloud-init's default locale", dict(locale="en_US.UTF-8", layout="us", zone="Etc/UTC", keyboard_chosen=False), None),
        ("French keyboard in Paris", dict(layout="fr", zone="Europe/Paris"), "fr"),
        ("French keyboard in Madrid", dict(layout="fr", zone="Europe/Madrid"), "fr"),
        ("Belgian keyboard in Brussels", dict(layout="be", zone="Europe/Brussels"), "fr"),
        ("Swiss French keyboard", dict(layout="ch", variant="fr", zone="Europe/Zurich"), "fr"),
        ("Swiss German keyboard", dict(layout="ch", zone="Europe/Zurich"), None),
        ("Canadian French keyboard", dict(layout="ca", zone="America/Toronto"), "fr"),
        ("Canadian English keyboard", dict(layout="ca", variant="eng", zone="America/Toronto"), "en"),
        ("US keyboard in Toronto", dict(layout="us", zone="America/Toronto"), None),
        ("Spanish keyboard", dict(layout="es", zone="Europe/Madrid"), "es"),
        ("Latin American keyboard", dict(layout="latam", zone="America/Mexico_City"), "es"),
        ("Italian keyboard", dict(layout="it", zone="Europe/Rome"), "it"),
        ("British keyboard in Paris", dict(layout="gb", zone="Europe/Paris"), "en"),
        ("US keyboard in New York", dict(layout="us", zone="America/New_York"), "en"),
        ("US keyboard in Paris", dict(layout="us", zone="Europe/Paris"), None),
        ("German keyboard", dict(layout="de", zone="Europe/Berlin"), None),
        ("German keyboard in Paris", dict(layout="de", zone="Europe/Paris"), None),
        ("time zone alone, image keyboard", dict(layout="us", zone="Europe/Rome", keyboard_chosen=False), "it"),
        ("Brussels alone", dict(zone="Europe/Brussels"), None),
        ("Zurich alone", dict(zone="Europe/Zurich"), None),
        ("Buenos Aires alone", dict(zone="America/Argentina/Buenos_Aires"), "es"),
        ("Reunion alone", dict(zone="Indian/Reunion"), "fr"),
        ("several layouts, the first counts", dict(layout="it,us", zone="Europe/Rome"), "it"),
        ("a chosen locale wins", dict(locale="es_ES.UTF-8", layout="fr", zone="Europe/Paris"), "es"),
        ("British locale", dict(locale="en_GB.UTF-8", layout="us", zone="Etc/UTC", keyboard_chosen=False), "en"),
        ("unsupported locale, French keyboard", dict(locale="de_DE.UTF-8", layout="fr"), "fr"),
        ("nothing at all", dict(), None),
    ]

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = folder.name
        self.choice = os.path.join(self.root, "var/lib/elise/language.json")
        self.env = {}
        for patcher in (
            patch.object(elise_language, "CHOICE_FILE", self.choice),
            patch.object(install, "read_env", side_effect=lambda key: self.env.get(key, "")),
            patch.object(elise_language, "_detected", {"at": -60.0, "root": None, "value": None}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def write(self, path, content):
        target = pathlib.Path(self.root, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def test_guess_from_what_the_card_says(self):
        for name, hints, expected in self.CASES:
            with self.subTest(name):
                self.assertEqual(elise_language.guess(**hints), expected)

    def test_offered_languages_follow_the_apps(self):
        source = pathlib.Path(__file__).parents[1].joinpath("packages/i18n/src/index.ts").read_text(encoding="utf-8")
        block = source.split("export const LANGUAGES = [", 1)[1].split("] as const", 1)[0]
        self.assertEqual(tuple(re.findall(r"code: '([a-z]+)'", block)), elise_language.LANGUAGES)
        self.assertEqual(set(screen.TEXT), set(elise_language.LANGUAGES))

    def test_reads_imager_user_data_before_cloud_init_applies_it(self):
        self.write("boot/firmware/user-data", textwrap.dedent("""\
            #cloud-config
            hostname: elise
            users:
            - name: paul
              groups: users,adm
            keyboard:
              model: pc105
              layout: "it"
            timezone: Europe/Rome
            write_files: []
        """))
        self.write("etc/default/keyboard", 'XKBMODEL="pc105"\nXKBLAYOUT="us"\n')
        self.write("etc/default/locale", "LANG=C.UTF-8\n")
        self.assertEqual(elise_language.hints(self.root), {
            "locale": "C.UTF-8", "layout": "it", "variant": "", "zone": "Europe/Rome", "keyboard_chosen": True,
        })
        self.assertEqual(elise_language.detect(self.root), "it")
        self.write("boot/firmware/user-data", "#cloud-config\nkeyboard: {model: pc105, layout: 'ch', variant: fr}\n")
        self.assertEqual(elise_language.detect(self.root), "fr")

    def test_reads_the_system_files_otherwise(self):
        self.write("etc/default/keyboard", 'XKBLAYOUT="ch"\nXKBVARIANT="fr"\n')
        self.write("etc/timezone", "Europe/Zurich\n")
        self.assertEqual(elise_language.detect(self.root), "fr")
        os.remove(os.path.join(self.root, "etc/timezone"))
        self.write("etc/default/keyboard", 'XKBLAYOUT="us"\n')
        os.symlink("/usr/share/zoneinfo/Europe/Madrid", os.path.join(self.root, "etc/localtime"))
        self.assertEqual(elise_language.hints(self.root)["zone"], "Europe/Madrid")
        self.assertEqual(elise_language.detect(self.root), "es")
        self.assertIsNone(elise_language.detect(os.path.join(self.root, "missing")))

    def test_chosen_beats_detected_beats_taking_turns(self):
        self.assertEqual(elise_language.current(self.root), {"language": None, "source": None})
        self.write("etc/default/keyboard", 'XKBLAYOUT="fr"\n')
        elise_language._detected["at"] = -60.0
        self.assertEqual(elise_language.current(self.root), {"language": "fr", "source": "detected"})
        self.assertEqual(elise_language.save("es", "browser"), ({"language": "es", "source": "browser"}, True))
        self.assertEqual(elise_language.current(self.root), {"language": "es", "source": "browser"})
        self.env["ELISE_LANGUAGE"] = "it"
        self.assertEqual(elise_language.current(self.root), {"language": "it", "source": "config"})
        self.assertEqual(elise_language.save("en", "app"), ({"language": "en", "source": "app"}, True))
        self.assertEqual(elise_language.current(self.root), {"language": "en", "source": "app"})

    def test_the_app_wins_over_a_browser_and_saving_again_changes_nothing(self):
        elise_language.save("it", "app")
        before = os.stat(self.choice).st_mtime_ns
        self.assertEqual(elise_language.save("it", "app"), ({"language": "it", "source": "app"}, False))
        self.assertEqual(elise_language.save("fr", "browser"), ({"language": "it", "source": "app"}, False))
        self.assertEqual(os.stat(self.choice).st_mtime_ns, before)
        self.assertEqual(json.loads(pathlib.Path(self.choice).read_text())["language"], "it")
        self.assertEqual(elise_language.save("es", "app"), ({"language": "es", "source": "app"}, True))

    def test_only_offered_languages_are_kept(self):
        for language, source in (("de", "app"), ("es-ES", "app"), ("", "app"), ("fr", "tv")):
            with self.subTest(language=language, source=source), self.assertRaises(ValueError):
                elise_language.save(language, source)
        self.assertFalse(os.path.exists(self.choice))
        self.write("var/lib/elise/language.json", '{"language": "de", "source": "app"}')
        self.assertIsNone(elise_language.chosen())

    def test_catalogue_is_complete_in_every_language(self):
        def shape(value):
            if isinstance(value, dict):
                return {key: shape(item) for key, item in value.items()}
            return len(value) if isinstance(value, list) else "{" in value and sorted(
                part.split("}")[0] for part in value.split("{")[1:])

        for lang in ("en", "es", "it"):
            self.assertEqual(shape(screen.TEXT[lang]), shape(screen.TEXT["fr"]), lang)


class PreparationServerTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.choice = os.path.join(folder.name, "language.json")
        for patcher in (
            patch.object(elise_language, "CHOICE_FILE", self.choice),
            patch.object(elise_language, "detect", return_value=None),
            patch.object(elise_language, "_detected", {"at": -60.0, "root": None, "value": None}),
            patch.object(install, "read_env", return_value=""),
            patch.object(install, "images_progress", return_value=None),
            patch.object(install, "local_address", return_value="192.168.1.42"),
            patch.object(install, "tailscale", return_value={"running": False, "ip": None, "name": None}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        server = preparation.ThreadingHTTPServer(("127.0.0.1", 0), preparation.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.url = f"http://127.0.0.1:{server.server_address[1]}"

    def request(self, path, body=None, content_type="application/json"):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        request = urllib.request.Request(self.url + path, data=data, headers={"content-type": content_type})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, error.read().decode()

    def post_language(self, language, source="app", **options):
        status, body = self.request("/language", {"language": language, "source": source}, **options)
        return status, json.loads(body) if body.startswith("{") else body

    def test_the_app_sets_the_language_once_and_it_lasts(self):
        status, body = self.request("/status.json")
        self.assertEqual((json.loads(body)["language"], json.loads(body)["languageSource"]), (None, None))
        self.assertEqual(self.post_language("es"), (200, {"language": "es", "languageSource": "app", "changed": True}))
        self.assertEqual(self.post_language("es"), (200, {"language": "es", "languageSource": "app", "changed": False}))
        self.assertEqual(json.loads(pathlib.Path(self.choice).read_text())["language"], "es")
        status = json.loads(self.request("/status.json")[1])
        self.assertEqual((status["language"], status["languageSource"]), ("es", "app"))
        discovery = json.loads(self.request("/api/v1/discovery")[1])
        self.assertEqual(discovery["preparation"]["language"], "es")

    def test_a_browser_counts_until_the_app_answers(self):
        self.assertEqual(self.post_language("it", "browser")[1]["languageSource"], "browser")
        self.assertEqual(self.post_language("fr", "app")[1]["language"], "fr")
        self.assertEqual(self.post_language("en", "browser"), (200, {"language": "fr", "languageSource": "app", "changed": False}))

    def test_unknown_languages_and_odd_requests_are_refused(self):
        for language in ("de", "ES-es", None, 3):
            with self.subTest(language=language):
                status, body = self.post_language(language)
                self.assertEqual(status, 400)
                self.assertEqual(body["languages"], list(elise_language.LANGUAGES))
        self.assertEqual(self.post_language("fr", "tv")[0], 400)
        self.assertEqual(self.request("/language", b"[]")[0], 400)
        self.assertEqual(self.request("/language", b"{", )[0], 400)
        self.assertEqual(self.request("/language", b"language=fr", content_type="application/x-www-form-urlencoded")[0], 415)
        self.assertFalse(os.path.exists(self.choice))

    def test_only_the_home_network_may_choose(self):
        with patch.object(preparation, "is_local", return_value=False):
            status, body = self.post_language("it")
        self.assertEqual(status, 403)
        self.assertEqual(body["code"], "page_local_only")
        self.assertFalse(os.path.exists(self.choice))
        self.assertFalse(preparation.is_local("100.101.42.7"))
        self.assertTrue(preparation.is_local("192.168.1.20"))

    def test_page_carries_every_language(self):
        status, page = self.request("/")
        self.assertEqual(status, 200)
        self.assertNotIn("__TEXTS__", page)
        texts = json.loads(page.split("const TEXTS=", 1)[1].split(";\n", 1)[0])
        self.assertEqual(set(texts), set(elise_language.LANGUAGES))
        self.assertEqual(texts["es"]["steps"]["download"], screen.TEXT["es"]["steps"]["download"])

    def test_github_answers_keep_their_french_message_and_gain_a_code(self):
        status, body = self.request("/github-auth", {"username": "", "token": ""})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["code"], "page_auth_invalid")
        self.assertEqual(json.loads(body)["message"], "Nom de compte ou jeton non valide.")


class RotationTests(unittest.TestCase):
    def tearDown(self):
        screen.Fade.steps = screen.Fade.STEPS

    def test_every_language_takes_turns_without_overflow(self):
        for kind, size in itertools.product(KINDS, SIZES):
            for lang in ("", *elise_language.LANGUAGES):
                with self.subTest(kind=kind, size=size, lang=lang):
                    assert_inside(self, screen.render(sample(kind, None), size, lang=lang), size)

    def test_the_whole_screen_speaks_one_language_at_a_time(self):
        for lang in elise_language.LANGUAGES:
            others = [code for code in elise_language.LANGUAGES if code != lang]
            texts = [text for text, _ in screen.render(sample("progress", None), lang=lang).boxes]
            t = screen.TEXT[lang]
            for words in (t["steps"]["download"], t["steps"]["start"], t["progress_eyebrow"],
                          t["version"].format(version="v0.1.22"),
                          t["remote_value"].format(value=t["remote_later"])):
                self.assertIn(words, texts, lang)
            for other in others:
                for words in (screen.TEXT[other]["steps"]["start"], screen.TEXT[other]["reassure"]):
                    if words not in screen.TEXT[lang].values() and words != t["steps"]["start"]:
                        self.assertNotIn(words, texts, f"{other} words on the {lang} screen")

    def test_what_has_no_words_never_moves(self):
        for kind in KINDS:
            with self.subTest(kind=kind):
                m = sample(kind, None, remote="100.101.42.7")
                bare = screen.render(m, lang="")
                fixed = [box for text, box in bare.boxes]  # addresses, percentage, brand, counters
                fixed.append(bare.box((120, 70, 204, 154)))  # logo
                if kind == "progress":
                    fixed.append(bare.box((120, 820, 980, 838)))  # progress bar
                if kind not in ("progress", "problem"):
                    fixed.append(bare.box((1320, 308, 1720, 708)))  # QR code
                self.assertGreater(len(fixed), 3)
                for lang in elise_language.LANGUAGES:
                    frame = screen.render(m, lang=lang).image
                    for box in fixed:
                        self.assertEqual(frame.crop(box).tobytes(), bare.image.crop(box).tobytes(), f"{lang} {box}")

    def test_fades_through_the_bare_screen_to_the_next_language(self):
        rotation = screen.Rotation(sample("progress", None), (640, 360), since=0)
        self.assertEqual(rotation.language, "fr")
        self.assertFalse(rotation.due(4.5))
        self.assertTrue(rotation.due(5.0))
        self.assertEqual(screen.Rotation.HOLD["welcome"], 3.0)
        while not rotation.prepare():
            pass
        first, second = rotation.frame().image, rotation.frame(1).image
        fade = rotation.fade
        self.assertEqual(len(fade.frames), screen.Fade.STEPS)
        for box, a, middle, b in fade.parts:
            self.assertEqual(fade.picture(a, middle, b, 0).tobytes(), a.tobytes())
            self.assertEqual(fade.picture(a, middle, b, fade.OUT).tobytes(), middle.tobytes())
            self.assertEqual(fade.picture(a, middle, b, 1).tobytes(), b.tobytes())
        # Copying only the prepared steps: no drawing while the words fade.
        shown, waits = first.copy(), []
        with patch.object(screen, "render", side_effect=AssertionError("drawn during the fade")):
            rotation.advance(lambda packed: shown.paste(*packed), sleep=waits.append)
        self.assertEqual(rotation.language, "en")
        self.assertEqual(len(waits), screen.Fade.STEPS)
        self.assertEqual(shown.tobytes(), second.tobytes())
        area = sum((box[2] - box[0]) * (box[3] - box[1]) for box, *_ in fade.parts)
        self.assertLess(area, 0.6 * 640 * 360)  # the fade leaves the still parts alone
        for _ in range(3):
            rotation.advance()
        self.assertEqual(rotation.language, "fr")

    def test_every_step_of_a_fade_keeps_the_still_parts(self):
        m = sample("welcome", None)
        rotation = screen.Rotation(m, (960, 540))
        base = rotation.base
        first, bare = rotation.frame().image, base.image
        fade = screen.Fade(first, rotation.frame(2).image, bare)
        still = [box for _, box in base.boxes] + [base.box((1320, 308, 1720, 708)), base.box((120, 70, 204, 154))]
        picture = first.copy()
        while not fade.prepare():
            pass
        for frame in fade.frames:
            for image, origin in frame:
                picture.paste(image, origin)
            for box in still:
                self.assertEqual(picture.crop(box).tobytes(), first.crop(box).tobytes(), box)

    def test_a_slow_board_gets_fewer_steps_rather_than_a_jerky_fade(self):
        m = sample("progress", None)
        first, second, bare = (screen.render(m, (640, 360), lang=lang).image for lang in ("fr", "en", ""))
        ticks = itertools.count(step=0.4)  # 0.4 s for each step: four times a Raspberry Pi 4
        with patch.object(screen.time, "perf_counter", side_effect=lambda: next(ticks)):
            fade = screen.Fade(first, second, bare)
            while not fade.prepare():
                pass
        self.assertEqual(screen.Fade.steps, screen.Fade.MIN_STEPS)
        self.assertEqual(screen.Fade(first, second, bare).count, screen.Fade.MIN_STEPS)
        waits = []
        screen.Fade(first, second, bare).play(lambda packed: None, sleep=waits.append)
        self.assertAlmostEqual(sum(waits), screen.Fade.DURATION, delta=0.3)


def assert_inside(test, paint, size):
    margin = 60 * paint.k
    for text, (left, top, right, bottom) in paint.boxes:
        test.assertGreaterEqual(left, margin, text)
        test.assertLessEqual(right, size[0] - margin, text)
        test.assertGreaterEqual(top, 0, text)
        test.assertLessEqual(bottom, size[1], text)
    for (first, a), (second, b) in itertools.combinations(paint.boxes, 2):
        overlap = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
        test.assertFalse(overlap[0] > 1 and overlap[1] > 1, f"{first!r} overlaps {second!r}")


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

    def test_serif_is_for_titles_only(self):
        titles = {"welcome_title", "action_title", "problem_network", "problem_other", "done_title"}
        for kind, lang in itertools.product(KINDS, screen.TEXT):
            t = screen.TEXT[lang]
            allowed = {t[key] for key in titles} | set(t["steps"].values())  # the step is the title
            paint = screen.render(sample(kind, lang), (1920, 1080))
            for text, typeface, _ in paint.typefaces:
                if typeface == "serif" and not text.rstrip("%").strip().isdigit():
                    self.assertTrue(any(text in title for title in allowed), f"{kind}/{lang}: {text!r} in serif")

    def test_the_lead_keeps_its_distance_from_a_title_on_two_lines(self):
        for size, lang in itertools.product(SIZES, screen.TEXT):
            paint = screen.render(sample("welcome", lang), size)
            t = screen.TEXT[lang]
            drawn = [(text, box, typeface) for (text, box), (_, typeface, _) in zip(paint.boxes, paint.typefaces)]
            title = [box for text, box, typeface in drawn if typeface == "serif"]
            lead = [box for text, box, typeface in drawn if typeface == "sans" and text in t["welcome_lead"]]
            gap = min(box[1] for box in lead) - max(box[3] for box in title)
            # From the lowest letter of the title to the top of the lead: a third of the title's size.
            self.assertGreaterEqual(gap, 80 * 0.3 * paint.k, (size, lang, len(title)))
        lines = [text for text, typeface, _ in screen.render(sample("welcome", "it")).typefaces if typeface == "serif"]
        self.assertEqual(len(lines), 2)  # the title once seen too close to its lead

    def test_the_detail_of_a_problem_reads_from_the_sofa(self):
        message = "Erreur : le téléchargement a été interrompu ; relancez la même commande. " * 3
        for size in SIZES:
            paint = screen.render(sample("problem", problem={"step": 4, "category": "other", "message": message}, step=4), size)
            lines = [(text, pixels) for text, typeface, pixels in paint.typefaces
                     if any(word in text for word in ("Erreur", "relancez", "commande", "interrompu"))]
            self.assertTrue(lines[0][0].startswith("Détail : Erreur"))
            self.assertEqual(len(lines), 2, lines)  # two lines at most, cut on a word
            self.assertTrue(lines[-1][0].endswith("…") and not lines[-1][0].endswith((" …", ";…")), lines[-1][0])
            for _, pixels in lines:
                self.assertGreaterEqual(pixels, round(28 * paint.k))

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
            for image in (screen.render(sample("welcome"), size).image,
                          screen.render(sample("welcome", None), size, lang="it").image):
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
