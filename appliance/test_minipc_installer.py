#!/usr/bin/env python3
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parent / "minipc-installer" / "select-target.py"
SPEC = importlib.util.spec_from_file_location("elise_minipc_target", MODULE_PATH)
target = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(target)


def disk(path, size, *, model="Disk", removable=False, transport=None, children=None):
    return {
        "name": path,
        "path": path,
        "type": "disk",
        "size": size,
        "model": model,
        "rm": removable,
        "tran": transport,
        "children": children or [],
    }


class TargetSelectionTest(unittest.TestCase):
    def test_chooses_largest_internal_disk_and_never_usb(self):
        devices = [
            disk(
                "/dev/sda",
                128_000_000_000,
                transport="usb",
                children=[{"name": "/dev/sda1", "path": "/dev/sda1", "pkname": "/dev/sda", "type": "part"}],
            ),
            disk("/dev/nvme0n1", 256_000_000_000, model="Internal 256"),
            disk("/dev/nvme1n1", 512_000_000_000, model="Internal 512"),
        ]
        chosen, rejected = target.select_target(devices, "/dev/sda1")
        self.assertEqual(chosen["path"], "/dev/nvme1n1")
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
        chosen, _ = target.select_target(devices, "/dev/vda1")
        self.assertEqual(chosen["path"], "/dev/vdb")

    def test_refuses_disk_below_32_decimal_gb(self):
        chosen, rejected = target.select_target([disk("/dev/vda", 16 * 1024**3)], "/dev/sr0")
        self.assertIsNone(chosen)
        self.assertEqual(rejected[0][1], "too-small")

    def test_accepts_marketed_32_gb_disk(self):
        chosen, _ = target.select_target([disk("/dev/vda", 32_000_000_000)], "/dev/sr0")
        self.assertEqual(chosen["path"], "/dev/vda")

    def test_replaces_exactly_one_autoinstall_target(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "autoinstall.yaml"
            config.write_text("path: __ELISE_TARGET_DISK__\n", encoding="utf-8")
            original = target.os.environ.get("ELISE_AUTOINSTALL_PATH")
            target.os.environ["ELISE_AUTOINSTALL_PATH"] = str(config)
            try:
                target.set_target("/dev/nvme0n1")
            finally:
                if original is None:
                    target.os.environ.pop("ELISE_AUTOINSTALL_PATH", None)
                else:
                    target.os.environ["ELISE_AUTOINSTALL_PATH"] = original
            self.assertEqual(config.read_text(encoding="utf-8"), "path: /dev/nvme0n1\n")

    def test_screen_writer_supports_unbuffered_binary_console(self):
        console = io.BytesIO()
        target.write_screen(console, ["Élise OS", "Installing"])
        self.assertIn("Élise OS".encode(), console.getvalue())

    def test_autoinstall_matches_any_predictable_ethernet_name(self):
        user_data = (MODULE_PATH.parent / "user-data").read_text(encoding="utf-8")
        self.assertIn('name: "en*"', user_data)
        self.assertIn("dhcp4: true", user_data)


if __name__ == "__main__":
    unittest.main()
