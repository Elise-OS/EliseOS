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

from installer_ui import Disk, LANGUAGES, TextUI, choose_disk, choose_language, confirm_erase, wait_for_ethernet
from installer_ui.preview import STATES, render


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
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "autoinstall.yaml"
            config.write_text(
                "path: __ELISE_TARGET_DISK__\nlocale: __ELISE_LOCALE__\n"
                "layout: __ELISE_KEYBOARD__\ntimezone: __ELISE_TIMEZONE__\n",
                encoding="utf-8",
            )
            with patch.dict(target.os.environ, {"ELISE_AUTOINSTALL_PATH": str(config)}):
                target.configure_autoinstall("/dev/nvme0n1", "it")
            self.assertEqual(
                config.read_text(encoding="utf-8"),
                "path: /dev/nvme0n1\nlocale: it_IT.UTF-8\nlayout: it\ntimezone: Europe/Rome\n",
            )

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

    def test_language_defaults_to_french_and_supports_all_four_choices(self):
        ui, _ = self.ui("enter")
        self.assertEqual(choose_language(ui), "fr")
        ui, _ = self.ui("down", "enter")
        self.assertEqual(choose_language(ui), "en")
        self.assertEqual(list(LANGUAGES), ["fr", "en", "es", "it"])

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


if __name__ == "__main__":
    unittest.main()
