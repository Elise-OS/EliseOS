#!/usr/bin/env python3
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

APPLIANCE = Path(__file__).parent
MODULE_PATH = APPLIANCE / "minipc-installer" / "select-target.py"
os.sys.path.insert(0, str(APPLIANCE))
SPEC = importlib.util.spec_from_file_location("elise_minipc_target", MODULE_PATH)
target = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(target)

import itertools

from installer_ui import (
    Disk, LANGUAGES, TEXT, TextUI, choose_disk, choose_language, confirm_erase, open_ui, wait_for_ethernet,
)
from installer_ui.monitor import Progress
from installer_ui.preview import SAMPLE_DISKS, STATES, picture, render

try:
    from installer_ui import graphics
except ImportError:  # Pillow is absent: the installer itself falls back to text.
    graphics = None

SIZES = [(1920, 1080), (1280, 800), (1366, 768), (3840, 2160)]


def disk(path, size, *, model="Disk", removable=False, transport=None, children=None, **extra):
    return {
        "name": path,
        "path": path,
        "type": "disk",
        "size": size,
        "model": model,
        "rm": removable,
        "tran": transport,
        "children": children or [],
        **extra,
    }


class KeySequence:
    def __init__(self, *keys):
        self.keys = iter(keys)

    def __call__(self):
        return next(self.keys)


class TargetSelectionTest(unittest.TestCase):
    def test_lists_internal_disks_largest_first_and_never_usb(self):
        devices = [
            disk(
                "/dev/sda",
                128_000_000_000,
                transport="usb",
                children=[{"name": "/dev/sda1", "path": "/dev/sda1", "pkname": "/dev/sda", "type": "part"}],
            ),
            disk("/dev/nvme0n1", 40_000_000_000, model="Internal 40"),
            disk("/dev/nvme1n1", 100_000_000_000, model="Internal 100"),
        ]
        candidates, rejected = target.eligible_disks(devices, "/dev/sda1")
        self.assertEqual([item.path for item in candidates], ["/dev/nvme1n1", "/dev/nvme0n1"])
        self.assertIn("installation-media", {reason for _, reason in rejected})

    def test_excludes_install_media_even_when_not_marked_removable(self):
        devices = [
            disk(
                "/dev/vda",
                64_000_000_000,
                children=[{"name": "/dev/vda1", "path": "/dev/vda1", "pkname": "/dev/vda", "type": "part"}],
            ),
            disk("/dev/vdb", 40_000_000_000),
        ]
        candidates, _ = target.eligible_disks(devices, "/dev/vda1")
        self.assertEqual([item.path for item in candidates], ["/dev/vdb"])

    def test_refuses_disk_below_32_decimal_gb(self):
        candidates, rejected = target.eligible_disks([disk("/dev/vda", 16 * 1024**3)], "/dev/sr0")
        self.assertEqual(candidates, [])
        self.assertEqual(rejected[0][1], "too-small")

    def test_accepts_marketed_32_gb_disk(self):
        candidates, _ = target.eligible_disks([disk("/dev/vda", 32_000_000_000)], "/dev/sr0")
        self.assertEqual(candidates[0].path, "/dev/vda")

    def test_marks_existing_partition_table_or_partition_as_data(self):
        table = disk("/dev/vda", 40_000_000_000, pttype="gpt")
        partition = disk(
            "/dev/vdb", 100_000_000_000,
            children=[{"name": "/dev/vdb1", "path": "/dev/vdb1", "pkname": "/dev/vdb", "type": "part"}],
        )
        candidates, _ = target.eligible_disks([table, partition], "/dev/sr0")
        self.assertTrue(all(item.has_data for item in candidates))

    def test_replaces_disk_and_language_tokens_exactly_once(self):
        expected = {
            "it": "locale: it_IT.UTF-8\nlayout: it\ntimezone: Europe/Rome\n",
            "pt": "locale: pt_PT.UTF-8\nlayout: pt\ntimezone: Europe/Lisbon\n",
        }
        for language, settings in expected.items():
            with self.subTest(language=language), tempfile.TemporaryDirectory() as directory:
                config = Path(directory) / "autoinstall.yaml"
                config.write_text(
                    "path: __ELISE_TARGET_DISK__\nlocale: __ELISE_LOCALE__\n"
                    "layout: __ELISE_KEYBOARD__\ntimezone: __ELISE_TIMEZONE__\n",
                    encoding="utf-8",
                )
                with patch.dict(target.os.environ, {"ELISE_AUTOINSTALL_PATH": str(config)}):
                    target.configure_autoinstall("/dev/nvme0n1", language)
                self.assertEqual(config.read_text(encoding="utf-8"), "path: /dev/nvme0n1\n" + settings)

    def test_saves_installer_language_for_the_target(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(target, "STATE_DIR", Path(directory)):
            output = target.save_language("es")
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["source"], "installer")
            self.assertEqual(output.stat().st_mode & 0o777, 0o644)

    def test_autoinstall_uses_subiquity_default_and_target_matches_any_ethernet_name(self):
        user_data = (MODULE_PATH.parent / "user-data").read_text(encoding="utf-8")
        install_target = (MODULE_PATH.parent / "install-target.sh").read_text(encoding="utf-8")
        self.assertNotIn("\n  network:", user_data)
        self.assertIn('name: "en*"', install_target)
        self.assertIn("dhcp4: true", install_target)
        for token in (target.LOCALE_TOKEN, target.KEYBOARD_TOKEN, target.TIMEZONE_TOKEN, target.TARGET_TOKEN):
            self.assertEqual(user_data.count(token), 1)

    def test_bootstrap_leaves_preparation_port_free_for_signed_installer(self):
        install_target = (MODULE_PATH.parent / "install-target.sh").read_text(encoding="utf-8")
        firstboot_unit = (APPLIANCE / "systemd" / "elise-minipc-firstboot.service").read_text(encoding="utf-8")
        enabled_services = install_target.split("for service in ", 1)[1].split("; do", 1)[0]
        self.assertNotIn("elise-preparation.service", enabled_services)
        self.assertNotIn("elise-preparation.service", firstboot_unit)
        self.assertIn("systemctl start elise-preparation.service", (APPLIANCE / "elise-minipc-firstboot.sh").read_text())


class InstallerUITest(unittest.TestCase):
    def ui(self, *keys, language="fr"):
        output = io.BytesIO()
        return TextUI(output, language=language, key_reader=KeySequence(*keys)), output

    def test_language_defaults_to_french_and_supports_all_five_choices(self):
        ui, _ = self.ui("enter")
        self.assertEqual(choose_language(ui), "fr")
        ui, _ = self.ui("down", "enter")
        self.assertEqual(choose_language(ui), "en")
        ui, _ = self.ui("down", "down", "down", "down", "enter")
        self.assertEqual(choose_language(ui), "pt")
        self.assertEqual(list(LANGUAGES), ["fr", "en", "es", "it", "pt"])

    def test_largest_disk_is_preselected_but_arrows_can_choose_another(self):
        disks = [Disk("/dev/vdb", "Large", 100_000_000_000), Disk("/dev/vda", "Small", 40_000_000_000)]
        ui, output = self.ui("enter")
        self.assertEqual(choose_disk(ui, disks).path, "/dev/vdb")
        self.assertIn(b"Large", output.getvalue())
        ui, _ = self.ui("down", "enter")
        self.assertEqual(choose_disk(ui, disks).path, "/dev/vda")

    def test_one_disk_skips_the_list(self):
        only = Disk("/dev/vda", "Only", 40_000_000_000)
        ui, output = self.ui()
        self.assertIs(choose_disk(ui, [only]), only)
        self.assertEqual(output.getvalue(), b"")

    def test_erase_confirmation_is_safe_by_default_and_explicit_to_accept(self):
        disk_choice = Disk("/dev/vda", "Disk", 40_000_000_000)
        ui, _ = self.ui("enter")
        self.assertFalse(confirm_erase(ui, disk_choice))
        ui, _ = self.ui("down", "enter")
        self.assertTrue(confirm_erase(ui, disk_choice))

    def test_ethernet_screen_retries_until_probe_succeeds(self):
        attempts = iter((False, False, True))
        sleeps = []
        ui = TextUI(io.BytesIO(), sleeper=sleeps.append)
        wait_for_ethernet(ui, lambda: next(attempts), interval=0.25)
        self.assertEqual(sleeps, [0.25, 0.25])

    def test_preview_renders_every_state_without_hardware(self):
        for language in LANGUAGES:
            for state in STATES:
                with self.subTest(language=language, state=state):
                    self.assertIn("ÉLISE OS", render(state, language))

    def test_side_arrows_move_between_the_two_buttons(self):
        disk_choice = Disk("/dev/vda", "Disk", 40_000_000_000)
        ui, _ = self.ui("right", "enter")
        self.assertTrue(confirm_erase(ui, disk_choice))
        ui, _ = self.ui("right", "left", "enter")
        self.assertFalse(confirm_erase(ui, disk_choice))

    def test_ethernet_screen_says_what_is_missing(self):
        states = iter(("no-cable", "no-internet", "online"))
        output = io.BytesIO()
        ui = TextUI(output, language="en", sleeper=lambda _seconds: None)
        wait_for_ethernet(ui, lambda: next(states))
        self.assertIn(TEXT["en"]["ethernet_waiting"].encode(), output.getvalue())
        self.assertIn(TEXT["en"]["ethernet_no_internet"].encode(), output.getvalue())

    def test_network_state_requires_a_cable_carrier(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(target.network_state(root), "no-cable")
            (root / "wlan0").mkdir()
            (root / "wlan0" / "carrier").write_text("1\n")
            self.assertEqual(target.network_state(root), "no-cable")
            (root / "enp1s0").mkdir()
            (root / "enp1s0" / "carrier").write_text("0\n")
            self.assertEqual(target.network_state(root), "no-cable")
            self.assertFalse(target.ethernet_ready(root))

    def test_disk_words_are_translated_and_sizes_read_like_the_box(self):
        nameless = Disk("/dev/sda", "", 128_035_676_160)
        self.assertEqual(nameless.name("fr"), "Disque interne")
        self.assertNotIn("Internal disk", nameless.label("fr"))
        self.assertEqual(nameless.size_text("fr"), "128 Go")
        self.assertEqual(Disk("/dev/sda", "", 42_949_672_960).size_text("es"), "42,9 GB")
        self.assertEqual(Disk("/dev/sda", "", 1_000_204_886_016).size_text("en"), "1.0 TB")
        self.assertEqual(Disk("/dev/sda", "", 2_000_398_934_016).size_text("fr"), "2,0 To")
        candidates, _ = target.eligible_disks([disk("/dev/sda", 64_000_000_000, model=None)], "/dev/sdz")
        self.assertEqual(candidates[0].model, "")

    def test_every_language_has_the_same_words(self):
        reference = TEXT["fr"]
        for language, texts in TEXT.items():
            with self.subTest(language=language):
                self.assertEqual(set(texts), set(reference))
                for key, value in reference.items():
                    if isinstance(value, dict):
                        self.assertEqual(set(texts[key]), set(value), key)
                    elif isinstance(value, list):
                        self.assertEqual(len(texts[key]), len(value), key)
                    else:
                        for placeholder in ("{version}", "{n}", "{total}", "{percent}", "{message}", "{count}"):
                            self.assertEqual(placeholder in texts[key], placeholder in value, key)
                        self.assertTrue(texts[key].strip(), key)

    def test_text_mode_is_forced_by_environment(self):
        with patch.dict(os.environ, {"ELISE_INSTALLER_UI": "text"}):
            self.assertIs(type(open_ui(io.BytesIO())), TextUI)


class FakeDisplay:
    def __init__(self, size=(1280, 800), broken=False):
        self.size = size
        self.broken = broken
        self.images = []

    def show(self, image, origin=(0, 0)):
        if self.broken:
            raise OSError("framebuffer gone")
        self.images.append(image)


def assert_inside(test, paint, size, label):
    """Every word on screen, inside the safe margins, readable and alone in its place."""
    margin = 60 * paint.k
    for text, (left, top, right, bottom) in paint.boxes:
        test.assertGreaterEqual(left, margin - 1, f"{label}: {text!r}")
        test.assertLessEqual(right, size[0] - margin + 1, f"{label}: {text!r}")
        test.assertGreaterEqual(top, 0, f"{label}: {text!r}")
        test.assertLessEqual(bottom, size[1], f"{label}: {text!r}")
    for text, _kind, pixels in paint.typefaces:
        test.assertGreaterEqual(pixels / paint.k, 19.5, f"{label}: {text!r} shrank too much")
    for (first, a), (second, b) in itertools.combinations(paint.boxes, 2):
        overlap = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
        test.assertFalse(overlap[0] > 1 and overlap[1] > 1, f"{label}: {first!r} overlaps {second!r}")


@unittest.skipIf(graphics is None, "Pillow is not installed")
class GraphicUITest(unittest.TestCase):
    def test_every_state_and_language_fits_every_screen(self):
        for state, language, size in itertools.product(STATES, LANGUAGES, SIZES):
            with self.subTest(state=state, language=language, size=size):
                paint = picture(state, language, size)
                self.assertEqual(paint.image.size, size)
                assert_inside(self, paint, size, f"{state}/{language}/{size}")

    def test_variants_fit_too(self):
        many = tuple(Disk(f"/dev/sd{letter}", "WDC WD40EFRX-68N32N0 Red Plus 4 To NAS", 4_000_787_030_016, True)
                     for letter in "abcdef")
        variants = [
            ("ethernet", {"retry": False, "network": "no-cable"}),
            ("ethernet", {"retry": True, "network": "no-internet"}),
            ("disk", {"disks": many, "selected": 5}),
            ("confirmation", {"disk": many[0], "selected": 1}),
            ("confirmation", {"disk": SAMPLE_DISKS[1], "selected": 0}),
            ("error", {"message": "x" * 400}),
            ("error", {"message": ""}),
        ] + [("progress", {"step": step, "percent": 100}) for step in graphics.STEP_IDS]
        for (state, data), language in itertools.product(variants, LANGUAGES):
            with self.subTest(state=state, data=str(data)[:60], language=language):
                assert_inside(self, picture(state, language, (1366, 768), **data), (1366, 768), state)

    def test_the_focus_is_visible_and_cancel_comes_first(self):
        cancel = picture("confirmation", "fr", (640, 360), selected=0).image
        erase = picture("confirmation", "fr", (640, 360), selected=1).image
        self.assertIsNotNone(graphics.E.ImageChops.difference(cancel, erase).getbbox())

    def test_language_screen_speaks_the_highlighted_language(self):
        for language, size in (("it", (1280, 800)), ("pt", (1280, 720))):
            texts = [text for text, _box in picture("language", language, size).boxes]
            self.assertIn(TEXT[language]["language_eyebrow"], texts)
            for name in (item["name"] for item in LANGUAGES.values()):
                self.assertIn(name, texts)

    def test_graphic_ui_keeps_the_keyboard_and_draws_each_move(self):
        display = FakeDisplay()
        states = []
        ui = graphics.GraphicUI(io.BytesIO(), display=display, key_reader=KeySequence("down", "enter"),
                                state_logger=states.append)
        self.assertEqual(choose_language(ui), "en")
        self.assertEqual(len(display.images), 2)
        self.assertEqual(states, ["language", "language"])
        ui = graphics.GraphicUI(io.BytesIO(), display=display, key_reader=KeySequence("enter"))
        self.assertFalse(confirm_erase(ui, SAMPLE_DISKS[0]))

    def test_a_broken_screen_falls_back_to_text_without_losing_the_choice(self):
        output = io.BytesIO()
        ui = graphics.GraphicUI(output, display=FakeDisplay(broken=True), key_reader=KeySequence("down", "enter"))
        self.assertEqual(choose_disk(ui, list(SAMPLE_DISKS)).path, SAMPLE_DISKS[1].path)
        self.assertTrue(ui.failed)
        self.assertIn("Disque interne".encode(), output.getvalue())

    def test_open_ui_falls_back_to_text_without_framebuffer(self):
        messages = []
        with patch.object(graphics.E, "Framebuffer", side_effect=OSError("no /dev/fb0")):
            ui = open_ui(io.BytesIO(), log=messages.append)
        self.assertIs(type(ui), TextUI)
        self.assertIn("no /dev/fb0", messages[0])


class ProgressMonitorTest(unittest.TestCase):
    def test_subiquity_events_move_the_steps_forward_only(self):
        progress = Progress(0)
        self.assertEqual((progress.key, progress.percent(0)), ("disk", 0))
        progress.feed('"MESSAGE":"subiquity/Install/install/curtin_install/run_curtin_step: executing curtin install extract step"', 10)
        self.assertEqual(progress.key, "copy")
        self.assertGreaterEqual(progress.percent(10), 0)
        self.assertLess(progress.percent(100_000), 40)
        progress.feed("partitioning step", 20)
        self.assertEqual(progress.key, "copy")
        progress.feed("subiquity/Install/install/postinstall/run_unattended_upgrades", 30)
        self.assertEqual(progress.key, "updates")
        self.assertGreaterEqual(progress.percent(30), 39)
        progress.feed("start: subiquity/Shutdown/shutdown: mode=REBOOT", 40)
        self.assertEqual(progress.key, "restart")
        self.assertLessEqual(progress.percent(10**9), 100)

    def test_reloading_the_configuration_does_not_jump_to_the_restart(self):
        """Seen on the real ISO: these events come before the disk is even touched."""
        progress = Progress(0)
        for line in (
            "start: subiquity/Late/load_autoinstall_data: ",
            "start: subiquity/Shutdown/load_autoinstall_data: ",
            "finish: subiquity/Shutdown/apply_autoinstall_config: ",
        ):
            progress.feed(line, 1)
        self.assertEqual(progress.key, "disk")
        progress.feed("start: subiquity/Late/run: ", 2)
        self.assertEqual(progress.key, "elise")
        progress.feed("start: subiquity/Shutdown/copy_logs_to_target: ", 3)
        self.assertEqual(progress.key, "restart")

    def test_bios_without_nx_is_refused_before_any_disk_is_touched(self):
        """JGINYUE B350I with NX Mode off: no EFI variables, so GRUB could never be installed."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            efi, cpuinfo = root / "efi", root / "cpuinfo"
            (efi / "efivars").mkdir(parents=True)
            cpuinfo.write_text("processor\t: 0\nflags\t\t: fpu vme de pse sse2 svm\n", encoding="ascii")
            self.assertEqual(target.firmware_problem(efi, cpuinfo), "no-efi-variables nx=missing")
            cpuinfo.write_text("flags\t\t: fpu nx sse2\n", encoding="ascii")
            self.assertEqual(target.firmware_problem(efi, cpuinfo), "no-efi-variables")
            (efi / "efivars" / "BootOrder-8be4df61").write_bytes(b"\0")
            self.assertIsNone(target.firmware_problem(efi, cpuinfo))
            self.assertIsNone(target.firmware_problem(root / "legacy-bios", cpuinfo))

    def test_failure_detail_names_the_failed_step_and_its_error(self):
        spec = importlib.util.spec_from_file_location("elise_report", MODULE_PATH.parent / "report-failure.py")
        report = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(report)
        log = (
            "start: cmd-install/stage-curthooks/builtin/cmd-curthooks/install-grub: installing grub\n"
            "finish: cmd-install/stage-curthooks/builtin/cmd-curthooks/install-grub: FAIL: installing grub to target devices\n"
            "finish: cmd-install/stage-curthooks/builtin/cmd-curthooks: FAIL: curtin command curthooks\n"
            "Stdout: ''\n"
            "Stderr: EFI variables are not supported on this system.\n"
        )
        self.assertEqual(
            report.failure_detail(log),
            "install-grub: installing grub to target devices — EFI variables are not supported on this system.",
        )
        self.assertEqual(report.failure_detail(""), "")

    def test_the_app_link_follows_the_chosen_language(self):
        from installer_ui import app_link

        self.assertEqual(app_link("fr"), "https://eliseos.paulbreton.dev/application/")
        self.assertEqual(app_link("it"), "https://eliseos.paulbreton.dev/it/app/")

    def test_keys_come_straight_from_the_keyboard_whatever_the_console(self):
        """HP G4 Mini: the picture stayed while the console with the keys was another one."""
        from installer_ui.keyboard import EVENT, Keyboards, is_keyboard

        self.assertTrue(is_keyboard("10000 7 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe"))
        self.assertFalse(is_keyboard("4 0 0 0 0 0"))  # a power button: no Enter, no arrows
        read, write = os.pipe()
        keyboards = Keyboards()
        keyboards.open["event3"] = read
        os.write(write, b"".join(EVENT.pack(0, 0, 1, code, value) for code, value in (
            (108, 1), (108, 0), (108, 2), (30, 1), (28, 1),  # down, release, repeat, "a", Enter
        )))
        self.assertEqual([keyboards.read(None, lambda: "tty") for _ in range(3)], ["down", "down", "enter"])
        keyboards.close()
        os.close(write)
        tty_read, tty_write = os.pipe()
        os.write(tty_write, b"x")
        self.assertEqual(Keyboards().read(tty_read, lambda: "from-tty"), "from-tty")  # no keyboard: the terminal
        os.close(tty_read)
        os.close(tty_write)

    def test_language_cards_carry_their_flags(self):
        if graphics is None:
            self.skipTest("Pillow absent")
        for code in LANGUAGES:
            image, mask = graphics.flag_image(code, 72, 48)
            self.assertEqual(image.size, (72, 48))
            self.assertGreater(len(image.getcolors(maxcolors=1 << 16) or ()), 1, code)
        # Portugal: green at the hoist, red at the fly, the yellow sphere on the boundary.
        image, _mask = graphics.flag_image("pt", 72, 48)
        green, red, sphere = image.getpixel((6, 24)), image.getpixel((66, 24)), image.getpixel((29, 38))
        self.assertGreater(green[1], green[0])
        self.assertGreater(red[0], red[1] + 100)
        self.assertGreater(min(sphere[0], sphere[1]), 180)

    def test_failed_install_mark_is_written_by_error_commands(self):
        user_data = (MODULE_PATH.parent / "user-data").read_text(encoding="utf-8")
        self.assertIn("/run/elise-installer/failed", user_data)

    def test_early_command_uses_the_live_python_not_subiquitys_snap(self):
        """The snap's python3 is 3.10 and cannot load the vendored cp312 Pillow."""
        user_data = (MODULE_PATH.parent / "user-data").read_text(encoding="utf-8")
        command = next(line for line in user_data.splitlines() if "select-target.py" in line and line.strip().startswith("-"))
        self.assertIn("env -i ", command)
        self.assertIn("/usr/bin/python3 -E ", command)


class InstallerBuildTest(unittest.TestCase):
    def test_iso_carries_pinned_pillow_and_the_tv_engine(self):
        build = (APPLIANCE / "build-minipc-installer.sh").read_text(encoding="utf-8")
        self.assertRegex(build, r'PILLOW_SHA256="[0-9a-f]{64}"')
        self.assertIn('sha256sum -c -', build)
        for name in ("elise-install-screen.py", "elise_install_state.py", "elise_install_texts.py",
                     "elise_language.py", "elise-logo.png"):
            self.assertIn(name, build)
        self.assertIn('"$engine/fonts/"', build)


class TVSettingsLabelTest(unittest.TestCase):
    def test_settings_step_names_the_raspberry_pi_only_on_a_raspberry_pi(self):
        import elise_install_texts as tv

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"ELISE_PLATFORM": ""}):
            model = Path(directory) / "model"
            model.write_bytes(b"Raspberry Pi 5 Model B Rev 1.0\x00")
            self.assertTrue(tv.raspberry_pi(str(model)))
            self.assertFalse(tv.raspberry_pi(str(Path(directory) / "absent")))
        for code, (label, _lead) in tv.DEVICE_SETTINGS.items():
            self.assertNotIn("Raspberry", label)
            self.assertIn(code, tv.TEXT)


if __name__ == "__main__":
    unittest.main()
