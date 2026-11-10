"""Unit checks for the Zigbee agent without hardware, Docker or root."""

import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("elise_zigbee_agent", HERE / "elise-zigbee-agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

MODELS = agent.load_models()


def usb(vid, pid, product, manufacturer=None, serial="0001"):
    return {"vid": vid, "pid": pid, "product": product, "manufacturer": manufacturer, "serial": serial}


def identify(descriptor=None, by_id=None, hostname=None, driver=None):
    return agent.identify(MODELS, descriptor, by_id, hostname, driver)


class ModelDatabaseTests(unittest.TestCase):
    def test_database_is_consistent(self):
        ids = [model["id"] for model in MODELS["models"]]
        self.assertEqual(len(ids), len(set(ids)))
        for model in MODELS["models"]:
            technology = MODELS["technologies"][model["technology"]]
            self.assertIn(model["technology"], agent.ADAPTERS)
            self.assertIn(model["baudrate"], agent.BAUDRATES, model["id"])
            self.assertIsInstance(model["rtscts"], bool)
            self.assertIn(model["kind"], ("usb", "network", "gpio"))
            self.assertIn(model["status"], ("recommended", "supported", "experimental", "discouraged"))
            self.assertTrue(model["match"], model["id"])
            patterns = list(model["match"].get("byId", [])) + list(model["match"].get("hostname", []))
            for rule in model["match"].get("usb", []):
                self.assertRegex(rule["vid"], r"^[0-9a-f]{4}$")
                self.assertRegex(rule["pid"], r"^[0-9a-f]{4}$")
                patterns += [rule["product"]] if "product" in rule else []
                for other in rule.get("ambiguousWith", []):
                    self.assertIn(other, ids)
            for pattern in patterns:
                re.compile(pattern)
            self.assertTrue(technology["baudrates"])
        for chip in MODELS["genericChips"]:
            for candidate in chip["candidates"]:
                self.assertIn(candidate["technology"], agent.ADAPTERS)
                self.assertIn(candidate["baudrate"], agent.BAUDRATES)

    def test_every_listed_technology_is_installable_and_probe_aware(self):
        for name, technology in MODELS["technologies"].items():
            self.assertIn(name, agent.ADAPTERS)
            self.assertTrue(all(rate in agent.BAUDRATES for rate in technology["baudrates"]))
            if technology["probe"]:
                self.assertIn(name, agent.PROBES)

    def test_no_python_only_regex_syntax(self):
        text = (HERE / "elise-zigbee-adapters.json").read_text(encoding="utf-8")
        # The same patterns are compiled by JavaScript in the contracts tests.
        self.assertNotIn("(?P<", text)
        self.assertNotIn("(?i", text)


class IdentificationTests(unittest.TestCase):
    def test_sonoff_dongle_p_and_e_share_a_descriptor_so_the_choice_is_ambiguous(self):
        result = identify(
            usb("10c4", "ea60", "Sonoff Zigbee 3.0 USB Dongle Plus", "ITead"),
            "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_abc-if00-port0",
        )
        self.assertEqual(result["confidence"], "ambiguous")
        self.assertEqual([o["technology"] for o in result["options"]], ["zstack", "ember"])
        self.assertIsNone(result["modelId"])

    def test_sonoff_dongle_e_v2_is_recognised(self):
        result = identify(
            usb("10c4", "ea60", "Sonoff Zigbee 3.0 USB Dongle Plus V2", "ITead"),
            "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0",
        )
        self.assertEqual((result["modelId"], result["confidence"]), ("sonoff-zbdongle-e", "high"))
        self.assertEqual(result["options"][0]["technology"], "ember")

    def test_sonoff_dongle_p_is_recognised_from_its_by_id_name(self):
        result = identify(None, "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_P_abc-if00-port0")
        self.assertEqual((result["modelId"], result["confidence"]), ("sonoff-zbdongle-p", "high"))

    def test_known_models_by_usb_id(self):
        cases = [
            (usb("10c4", "ea60", "SkyConnect v1.0", "Nabu Casa"), "nabu-casa-skyconnect", "ember"),
            (usb("10c4", "ea60", "Home Assistant Connect ZBT-1", "Nabu Casa"), "nabu-casa-connect-zbt-1", "ember"),
            (usb("1cf1", "0030", "ConBee II", "dresden elektronik"), "dresden-conbee-ii", "deconz"),
            (usb("0403", "6015", "ConBee III", "dresden elektronik"), "dresden-conbee-iii", "deconz"),
            (usb("0451", "16a8", "CC2531 USB CDC", "Texas Instruments"), "ti-cc2531", "zstack"),
            (usb("067b", "2303", "USB-Serial Controller", "Prolific"), "zigate-usb-ttl", "zigate"),
            (usb("10c4", "ea60", "SLZB-07", "SMLIGHT"), "smlight-slzb-07", "ember"),
            (usb("10c4", "ea60", "zig-a-zig-ah! (zzh)", "Electrolama"), "electrolama-zzh", "zstack"),
        ]
        for descriptor, model_id, technology in cases:
            with self.subTest(model=model_id):
                result = identify(descriptor)
                self.assertEqual(result["modelId"], model_id)
                self.assertEqual(result["options"][0]["technology"], technology)
                self.assertNotEqual(result["confidence"], "unknown")

    def test_conbee_generations_are_not_mixed_up(self):
        self.assertEqual(identify(None, "usb-dresden_elektronik_GmbH_ConBee_II_DE1-if00")["modelId"], "dresden-conbee-ii")
        self.assertEqual(identify(None, "usb-dresden_elektronik_GmbH_ConBee_III_DE1-if00-port0")["modelId"], "dresden-conbee-iii")
        self.assertEqual(identify(usb("0403", "6015", "ConBee", "dresden"))["modelId"], "dresden-conbee")
        self.assertEqual(identify(usb("0403", "6015", "ConBee", "dresden"))["options"][0]["baudrate"], 38400)

    def test_generic_chips_are_ambiguous_with_ordered_proposals(self):
        for descriptor, first in (
            (usb("1a86", "7523", "USB Serial"), "zstack"),
            (usb("1a86", "55d4", "USB Single Serial"), "ember"),
            (usb("10c4", "ea60", "CP2102N USB to UART Bridge Controller"), "zstack"),
        ):
            result = identify(descriptor)
            self.assertEqual(result["confidence"], "ambiguous")
            self.assertEqual(result["source"], "generic")
            self.assertEqual(result["options"][0]["technology"], first)
            self.assertGreaterEqual(len(result["options"]), 2)

    def test_cdc_acm_without_known_id_is_treated_as_generic(self):
        result = identify(usb("dead", "beef", "Some coordinator"), None, None, "cdc_acm")
        self.assertEqual(result["confidence"], "ambiguous")
        self.assertIn("zboss", [o["technology"] for o in result["options"]])

    def test_unknown_key_keeps_its_descriptor_for_a_manual_choice(self):
        result = identify(usb("dead", "beef", "Mystery", "Acme"))
        self.assertEqual((result["confidence"], result["options"]), ("unknown", []))
        self.assertEqual(result["vendor"], "Acme")

    def test_network_keys_are_recognised_by_their_name(self):
        for name, model_id, technology in (
            ("slzb-06", "smlight-slzb-06", "zstack"),
            ("slzb-06m", "smlight-slzb-06m", "ember"),
            ("slzb-06p7", "smlight-slzb-06p7", "zstack"),
            ("tubeszb-efr32-poe", "tubeszb-efr32", "ember"),
            ("tubeszb-cc2652-poe", "tubeszb-cc2652p", "zstack"),
            ("uzg-01", "zigstar-uzg-01", "ember"),
        ):
            with self.subTest(name=name):
                result = identify(None, None, name)
                self.assertEqual(result["modelId"], model_id)
                self.assertEqual(result["options"][0]["technology"], technology)

    def test_a_positive_probe_settles_an_ambiguous_key(self):
        before = identify(usb("10c4", "ea60", "Sonoff Zigbee 3.0 USB Dongle Plus", "ITead"))
        after = agent.apply_probe(MODELS, before, {"technology": "ember", "baudrate": 115200})
        self.assertEqual((after["confidence"], after["source"]), ("high", "probe"))
        self.assertEqual(after["modelId"], "sonoff-zbdongle-e")
        self.assertEqual(len(after["options"]), 1)
        generic = identify(usb("1a86", "7523", "USB Serial"))
        settled = agent.apply_probe(MODELS, generic, {"technology": "zstack", "baudrate": 115200})
        self.assertEqual((settled["confidence"], settled["options"][0]["technology"]), ("high", "zstack"))
        self.assertIsNone(settled["modelId"])


class FakeTree:
    """A fake /dev, /sys and /proc with one Sonoff-like key on ttyUSB0."""

    def __init__(self, root: Path):
        self.dev, self.sys, self.proc = root / "dev", root / "sys", root / "proc"
        for folder in (self.dev / "serial" / "by-id", self.dev / "serial" / "by-path", self.proc):
            folder.mkdir(parents=True)
        self.patches = [
            patch.object(agent, "DEV_ROOT", self.dev),
            patch.object(agent, "SYS_ROOT", self.sys),
            patch.object(agent, "PROC_ROOT", self.proc),
        ]

    def __enter__(self):
        for item in self.patches:
            item.start()
        return self

    def __exit__(self, *_):
        for item in self.patches:
            item.stop()

    def plug(self, tty, by_id=None, descriptor=None, driver="cp210x"):
        (self.dev / tty).touch()
        if by_id:
            (self.dev / "serial" / "by-id" / by_id).symlink_to(self.dev / tty)
        interface = self.sys / "devices" / "usb1" / f"1-1-{tty}" / "1-1:1.0"
        interface.mkdir(parents=True)
        if descriptor:
            parent = interface.parent
            for name, key in (
                ("idVendor", "vid"),
                ("idProduct", "pid"),
                ("manufacturer", "manufacturer"),
                ("product", "product"),
                ("serial", "serial"),
            ):
                if descriptor.get(key):
                    (parent / name).write_text(descriptor[key] + "\n")
        (self.sys / "class" / "tty" / tty).mkdir(parents=True)
        (self.sys / "class" / "tty" / tty / "device").symlink_to(interface)
        driver_dir = self.sys / "bus" / "usb-serial" / "drivers" / driver
        driver_dir.mkdir(parents=True, exist_ok=True)
        (interface / "driver").symlink_to(driver_dir)

    def hold(self, pid, tty, name="minicom"):
        folder = self.proc / str(pid) / "fd"
        folder.mkdir(parents=True)
        (self.proc / str(pid) / "comm").write_text(name + "\n")
        (folder / "3").symlink_to(self.dev / tty)


DONGLE = {"vid": "10c4", "pid": "ea60", "manufacturer": "ITead", "product": "Sonoff Zigbee 3.0 USB Dongle Plus V2", "serial": "abc"}


class UsbScanTests(unittest.TestCase):
    def test_lists_keys_with_descriptor_driver_and_stable_path(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            tree.plug("ttyUSB0", "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0", DONGLE)
            found = agent.scan_usb()
            self.assertEqual(len(found), 1)
            item = found[0]
            self.assertEqual(item["usb"]["vid"], "10c4")
            self.assertEqual(item["usb"]["product"], "Sonoff Zigbee 3.0 USB Dongle Plus V2")
            self.assertEqual(item["driver"], "cp210x")
            self.assertEqual(item["portStability"], "by-id")
            self.assertTrue(item["port"].endswith("Plus_V2_abc-if00-port0"))
            self.assertIsNone(item["busyBy"])
            described = agent.describe(MODELS, item, None)
            self.assertEqual(described["identity"]["modelId"], "sonoff-zbdongle-e")
            self.assertFalse(described["isCurrent"])

    def test_key_without_by_id_falls_back_to_by_path_then_raw(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            tree.plug("ttyUSB0", None, {**DONGLE, "product": "USB Serial", "vid": "1a86", "pid": "7523"})
            (tree.dev / "serial" / "by-path" / "platform-xhci-usb-0:1:1.0-port0").symlink_to(tree.dev / "ttyUSB0")
            tree.plug("ttyUSB1", None, {**DONGLE, "vid": "1a86", "pid": "7523"})
            stability = sorted(item["portStability"] for item in agent.scan_usb())
            self.assertEqual(stability, ["by-path", "raw"])

    def test_two_keys_and_a_busy_port(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            tree.plug("ttyUSB0", "usb-A-if00-port0", DONGLE)
            tree.plug("ttyACM0", "usb-B-if00", {**DONGLE, "vid": "1cf1", "pid": "0030", "product": "ConBee II"}, "cdc_acm")
            tree.hold(4242, "ttyACM0", "modemmanager")
            found = {item["device"].rsplit("/", 1)[1]: item for item in agent.scan_usb()}
            self.assertEqual(set(found), {"ttyUSB0", "ttyACM0"})
            self.assertEqual(found["ttyACM0"]["busyBy"], "modemmanager")
            self.assertIsNone(found["ttyUSB0"]["busyBy"])

    def test_non_serial_by_id_links_are_ignored(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            (tree.dev / "sda").touch()
            (tree.dev / "serial" / "by-id" / "usb-disk").symlink_to(tree.dev / "sda")
            self.assertEqual(agent.scan_usb(), [])


class ProbeTests(unittest.TestCase):
    def test_probe_frames(self):
        self.assertEqual(agent.MT_PING.hex(), "fe00210120")
        self.assertEqual(agent.ASH_RESET.hex(), "1ac038bc7e")
        self.assertEqual(agent.ZIGATE_VERSION[0], 0x01)
        self.assertEqual(agent.ZIGATE_VERSION[-1], 0x03)
        frame = agent.deconz_version_frame(1)
        self.assertEqual((frame[0], frame[-1]), (0xC0, 0xC0))
        body = frame[1:-1]
        # The trailing little-endian word is the two's complement of the byte sum.
        self.assertEqual((sum(body[:-2]) + int.from_bytes(body[-2:], "little")) & 0xFFFF, 0)
        self.assertEqual(frame.hex(), "c00d0100090000000000e9ffc0")

    def test_answer_recognisers(self):
        self.assertTrue(agent.answers_mt(bytes.fromhex("fe026101077 97f".replace(" ", ""))))
        self.assertFalse(agent.answers_mt(b"hello"))
        self.assertTrue(agent.answers_ash(bytes.fromhex("c1020b0a527e")))
        self.assertFalse(agent.answers_ash(b"\x00\x01"))
        self.assertTrue(agent.answers_deconz(bytes.fromhex("c00d0100")))
        self.assertTrue(agent.answers_zigate(bytes.fromhex("0180100002")))

    def test_probe_tries_technologies_and_speeds_in_order(self):
        calls = []

        class Transport:
            def __init__(self, port, baudrate):
                self.baudrate = baudrate
                self.sent = b""

            def write(self, data):
                self.sent = data
                calls.append((self.baudrate, data))

            def read(self, timeout):
                # Only an EmberZNet key at 460800 answers its reset.
                if self.sent == agent.ASH_RESET and self.baudrate == 460800:
                    return bytes.fromhex("c1020b0a527e")
                return b""

            def close(self):
                pass

        result = agent.probe_technology(MODELS, "/dev/x", ["zstack", "ember"], Transport)
        self.assertEqual(result, {"technology": "ember", "baudrate": 460800})
        self.assertEqual([baud for baud, _ in calls], [115200, 115200, 460800])

    def test_probe_returns_none_when_nothing_answers_or_the_port_cannot_open(self):
        class Silent:
            def __init__(self, *_):
                pass

            def write(self, _):
                pass

            def read(self, _):
                return b""

            def close(self):
                pass

        self.assertIsNone(agent.probe_technology(MODELS, "/dev/x", ["zstack", "deconz"], Silent))

        def refuse(*_):
            raise OSError("busy")

        self.assertIsNone(agent.probe_technology(MODELS, "/dev/x", ["zstack"], refuse))


class ParsingTests(unittest.TestCase):
    def test_bridge_topics(self):
        info = {
            "coordinator": {"type": "EZSP v13", "ieee_address": "0x00124b0001", "meta": {"revision": "7.4.4.0 build 0"}},
            "network": {"channel": 15, "pan_id": 6754, "extended_pan_id": [221, 221, 221, 221, 221, 221, 221, 221]},
        }
        devices = [{"type": "Coordinator"}, {"type": "EndDevice"}, {"type": "Router"}]
        output = "\n".join(
            [
                'zigbee2mqtt/bridge/state {"state":"online"}',
                "zigbee2mqtt/bridge/info " + json.dumps(info),
                "zigbee2mqtt/bridge/devices " + json.dumps(devices),
                "not json at all",
            ]
        )
        bridge = agent.parse_bridge(output)
        self.assertEqual(bridge["state"], "online")
        self.assertEqual(bridge["deviceCount"], 2)
        self.assertEqual(bridge["coordinator"]["type"], "EZSP v13")
        self.assertEqual(bridge["coordinator"]["firmware"], "7.4.4.0 build 0")
        self.assertEqual(bridge["coordinator"]["panId"], "0x1a62")
        self.assertEqual(bridge["coordinator"]["extendedPanId"], "0xdddddddddddddddd")
        self.assertEqual(bridge["coordinator"]["channel"], 15)
        self.assertEqual(agent.parse_bridge("")["state"], "unknown")
        self.assertEqual(agent.parse_bridge('zigbee2mqtt/bridge/state {"state":"offline"}')["state"], "offline")

    def test_firmware_hints(self):
        self.assertEqual(agent.firmware_status("zstack", {"firmware": "20240710"}), "ok")
        self.assertEqual(agent.firmware_status("zstack", {"firmware": "20200101"}), "old")
        self.assertEqual(agent.firmware_status("ember", {"firmware": "7.4.4.0 build 0"}), "ok")
        self.assertEqual(agent.firmware_status("ember", {"firmware": "6.10.3.0 build 297"}), "old")
        self.assertEqual(agent.firmware_status("deconz", {"firmware": "0x26580700"}), "old")
        self.assertEqual(agent.firmware_status("deconz", {"firmware": "0x26780700"}), "ok")
        self.assertEqual(agent.firmware_status("zigate", {"firmware": "3.21"}), "unknown")
        self.assertEqual(agent.firmware_status("zstack", None), "unknown")

    def test_failure_classification(self):
        self.assertEqual(
            agent.classify_failure("Error: Configuration is not consistent with adapter state/backup!"),
            "NETWORK_MISMATCH",
        )
        self.assertEqual(agent.classify_failure("Error: Error while opening serialport 'Error: ENOENT'"), "PORT_UNAVAILABLE")
        self.assertEqual(agent.classify_failure("Failed to start zigbee-herdsman"), "NO_ANSWER")
        self.assertIsNone(agent.classify_failure("Zigbee2MQTT started!"))

    def test_avahi_output(self):
        line = "=;eth0;IPv4;SLZB-06M;_slzb-06._tcp;local;slzb-06m.local;192.168.1.50;80;\"radio_type=zigbee\""
        found = agent.parse_avahi("+;eth0;IPv4;SLZB-06M;_slzb-06._tcp;local\n" + line)
        self.assertEqual(found, [{"host": "192.168.1.50", "port": 6638, "name": "slzb-06m", "service": "_slzb-06"}])
        candidate = agent.network_candidate("192.168.1.50", 6638, "slzb-06m", "_slzb-06")
        self.assertEqual(candidate["port"], "tcp://192.168.1.50:6638")
        described = agent.describe(MODELS, candidate, None)
        self.assertEqual(described["identity"]["modelId"], "smlight-slzb-06m")


class CombinedSearchTests(unittest.TestCase):
    """One search = USB keys + mDNS keys; one channel failing never hides the other."""

    SLZB = {"host": "192.168.1.50", "port": 6638, "name": "slzb-06m", "service": "_slzb-06"}

    def usb_key(self):
        return {
            "id": agent.candidate_id("/dev/serial/by-id/usb-x"),
            "kind": "usb",
            "port": "/dev/serial/by-id/usb-x",
            "portStability": "by-id",
            "device": "/dev/ttyUSB0",
            "byIdName": "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0",
            "usb": usb("10c4", "ea60", "Sonoff Zigbee 3.0 USB Dongle Plus V2", "ITead"),
            "driver": "cp210x",
            "network": None,
            "busyBy": None,
        }

    def search(self, usb_result, network_result, include_network=True):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "elise.env").write_text("ZIGBEE_ADAPTER=/dev/null\n")
            agent.NETWORK_MEMORY.update(at=0.0, items=[])
            patches = [
                patch.object(agent, "ENV_FILE", root / "elise.env"),
                patch.object(agent, "STATE_DIR", root / "state"),
                patch.object(agent, "container_id", return_value=None),
                patch.object(agent, "container_state", return_value="missing"),
                patch.object(agent, "read_bridge", return_value=None),
                patch.object(agent, "scan_usb", **usb_result),
                patch.object(agent, "scan_network", **network_result),
            ]
            for item in patches:
                item.start()
            try:
                return agent.build_status(include_network=include_network), agent.build_status()
            finally:
                for item in patches:
                    item.stop()
                agent.NETWORK_MEMORY.update(at=0.0, items=[])

    def network_key(self):
        return agent.network_candidate(self.SLZB["host"], 6638, "slzb-06m", "_slzb-06")

    def test_usb_and_network_keys_come_back_in_one_list(self):
        full, plain = self.search(
            {"return_value": [self.usb_key()]}, {"return_value": ([self.network_key()], "ok")}
        )
        self.assertEqual([c["kind"] for c in full["candidates"]], ["usb", "network"])
        self.assertEqual(full["scan"], {"usb": "ok", "network": "ok"})
        # The cheap status polled in between keeps showing the network key found a moment ago.
        self.assertEqual([c["kind"] for c in plain["candidates"]], ["usb", "network"])
        self.assertEqual(plain["scan"]["network"], "skipped")

    def test_a_failing_network_search_keeps_the_usb_keys(self):
        full, _ = self.search({"return_value": [self.usb_key()]}, {"side_effect": RuntimeError("avahi")})
        self.assertEqual([c["kind"] for c in full["candidates"]], ["usb"])
        self.assertEqual(full["scan"], {"usb": "ok", "network": "failed"})

    def test_a_failing_usb_scan_keeps_the_network_keys(self):
        full, _ = self.search({"side_effect": OSError("sysfs")}, {"return_value": ([self.network_key()], "ok")})
        self.assertEqual([c["kind"] for c in full["candidates"]], ["network"])
        self.assertEqual(full["scan"], {"usb": "failed", "network": "ok"})

    def test_missing_avahi_is_reported_without_failing(self):
        full, _ = self.search({"return_value": [self.usb_key()]}, {"return_value": ([], "unavailable")})
        self.assertEqual(full["scan"]["network"], "unavailable")
        self.assertEqual(len(full["candidates"]), 1)

    def test_network_is_not_searched_unless_asked(self):
        full, _ = self.search(
            {"return_value": [self.usb_key()]}, {"return_value": ([self.network_key()], "ok")}, False
        )
        self.assertEqual(full["scan"], {"usb": "ok", "network": "skipped"})
        self.assertEqual([c["kind"] for c in full["candidates"]], ["usb"])

    def test_nothing_found_is_an_empty_list_not_an_error(self):
        full, _ = self.search({"return_value": []}, {"return_value": ([], "ok")})
        self.assertEqual(full["candidates"], [])
        self.assertEqual(full["scan"], {"usb": "ok", "network": "ok"})
        self.assertEqual(full["state"], "NO_KEY")

    def test_a_slow_service_does_not_block_the_others(self):
        calls = []

        def browse(_avahi, service):
            calls.append(service)
            if service == "_slzb-06._tcp":
                raise subprocess.TimeoutExpired("avahi-browse", 8)
            return [self.SLZB] if service == "_zigstar_gw._tcp" else []

        with patch.object(agent.shutil, "which", return_value="/usr/bin/avahi-browse"), patch.object(
            agent, "browse_service", side_effect=browse
        ):
            found, state = agent.scan_network()
        self.assertEqual(state, "ok")
        self.assertEqual([item["port"] for item in found], ["tcp://192.168.1.50:6638"])
        self.assertCountEqual(calls, agent.MDNS_SERVICES)

    def test_every_service_failing_is_a_failed_search(self):
        with patch.object(agent.shutil, "which", return_value="/usr/bin/avahi-browse"), patch.object(
            agent, "browse_service", side_effect=OSError("no daemon")
        ):
            self.assertEqual(agent.scan_network(), ([], "failed"))
        with patch.object(agent.shutil, "which", return_value=None):
            self.assertEqual(agent.scan_network(), ([], "unavailable"))


class EnvAndConfigTests(unittest.TestCase):
    def test_env_values_are_set_and_removed_atomically(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / "elise.env"
            env.write_text("TZ=Europe/Paris\nZIGBEE_ADAPTER=/dev/null\nZIGBEE_BAUDRATE=9600\n")
            os.chmod(env, 0o640)
            agent.write_env({"ZIGBEE_ADAPTER": "/dev/serial/by-id/usb-A", "ZIGBEE_BAUDRATE": None, "ZIGBEE_RTSCTS": "false"}, env)
            self.assertEqual(
                env.read_text(), "TZ=Europe/Paris\nZIGBEE_ADAPTER=/dev/serial/by-id/usb-A\nZIGBEE_RTSCTS=false\n"
            )
            self.assertEqual(os.stat(env).st_mode & 0o777, 0o640)

    def test_env_rejects_injection_and_foreign_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / "elise.env"
            env.write_text("TZ=Europe/Paris\n")
            for updates in (
                {"ZIGBEE_ADAPTER": "/dev/x\nPOSTGRES_PASSWORD=pwned"},
                {"ZIGBEE_ADAPTER": "/dev/x; reboot"},
                {"ZIGBEE_ADAPTER": "$(id)"},
                {"POSTGRES_PASSWORD": "x"},
            ):
                with self.assertRaises(ValueError):
                    agent.write_env(updates, env)
            self.assertEqual(env.read_text(), "TZ=Europe/Paris\n")

    def test_current_configuration_for_usb_and_network_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / "elise.env"
            with patch.object(agent, "ENV_FILE", env):
                env.write_text("ZIGBEE_ADAPTER=/dev/null\nZIGBEE_ADAPTER_TYPE=auto\n")
                self.assertIsNone(agent.current_config()["port"])
                env.write_text(
                    "ZIGBEE_ADAPTER_MODE=manual\nZIGBEE_ADAPTER=/dev/serial/by-id/usb-A\nZIGBEE_ADAPTER_TYPE=ember\n"
                    "ZIGBEE_BAUDRATE=115200\nZIGBEE_RTSCTS=false\n"
                )
                config = agent.current_config()
                self.assertEqual((config["port"], config["adapter"], config["baudrate"], config["rtscts"], config["mode"]),
                                 ("/dev/serial/by-id/usb-A", "ember", 115200, False, "manual"))
                env.write_text("ZIGBEE_ADAPTER=/dev/null\nZIGBEE_SERIAL_PORT=tcp://10.0.0.5:6638\nZIGBEE_ADAPTER_TYPE=zstack\n")
                self.assertEqual(agent.current_config()["port"], "tcp://10.0.0.5:6638")

    def test_new_network_resets_only_the_network_identifiers(self):
        text = (
            "version: 4\nmqtt:\n  base_topic: zigbee2mqtt\nadvanced:\n  log_level: info\n"
            "  network_key:\n    - 1\n    - 2\n  pan_id: 6754\n  ext_pan_id: [1, 2, 3]\n  channel: 11\n"
            "devices:\n  '0x00124b':\n    friendly_name: Salon\n"
        )
        result = agent.strip_network_keys(text)
        self.assertIn("  network_key: GENERATE\n", result)
        self.assertIn("  pan_id: GENERATE\n", result)
        self.assertIn("  ext_pan_id: GENERATE\n", result)
        self.assertNotIn("- 1", result)
        self.assertIn("  channel: 11\n", result)
        self.assertIn("friendly_name: Salon", result)
        # A configuration that never held them gets them added under advanced.
        added = agent.strip_network_keys("advanced:\n  log_level: info\n")
        self.assertEqual(added.count("GENERATE"), 3)
        self.assertTrue(added.startswith("advanced:\n  network_key: GENERATE"))
        self.assertEqual(agent.strip_network_keys("mqtt:\n  a: 1\n").count("advanced:"), 1)


class RequestValidationTests(unittest.TestCase):
    def request(self, **changes):
        base = {"port": None, "adapter": "ember", "baudrate": 115200, "rtscts": False, "networkMode": "keep"}
        return {**base, **changes}

    def test_accepts_a_plugged_serial_port_and_a_network_address(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            tree.plug("ttyUSB0", "usb-A-if00-port0", DONGLE)
            port = str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0")
            target = agent.validate_install(self.request(port=port), MODELS)
            self.assertEqual((target["port"], target["kind"]), (port, "usb"))
            network = agent.validate_install(self.request(port="tcp://slzb-06m.local:6638"), MODELS)
            self.assertEqual(network["kind"], "network")
            scanned = agent.scan_usb()[0]
            by_candidate = agent.validate_install(self.request(candidateId=scanned["id"]), MODELS)
            self.assertEqual(by_candidate["port"], port)

    def test_rejects_dangerous_or_wrong_input(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            tree.plug("ttyUSB0", "usb-A-if00-port0", DONGLE)
            (tree.dev / "sda").touch()
            (tree.dev / "serial" / "by-id" / "usb-disk").symlink_to(tree.dev / "sda")
            for bad in (
                self.request(port="/etc/passwd"),
                self.request(port=str(tree.dev / "sda")),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-disk")),
                self.request(port=str(tree.dev / "serial" / "by-id" / "missing")),
                self.request(port="tcp://host;reboot:6638"),
                self.request(port="tcp://host:99999"),
                self.request(port="tcp://:6638"),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"), adapter="ezsp"),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"), adapter="rm -rf"),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"), baudrate=1),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"), rtscts="yes"),
                self.request(port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"), networkMode="new"),
                self.request(candidateId="unknown"),
            ):
                with self.subTest(request=bad), self.assertRaises(agent.RequestError):
                    agent.validate_install(bad, MODELS)
            agent.validate_install(
                self.request(
                    port=str(tree.dev / "serial" / "by-id" / "usb-A-if00-port0"),
                    networkMode="new",
                    confirmNewNetwork=True,
                ),
                MODELS,
            )


class InstallHarness:
    """Runs run_install() against a temporary state, env and Zigbee2MQTT data folder."""

    def __init__(self, test: unittest.TestCase, healthy=True, code=None, previous_key=True, cancel_during_verify=False):
        self.test = test
        self.healthy = healthy
        self.code = code
        self.previous_key = previous_key
        self.cancel_during_verify = cancel_during_verify
        self.events = []

    def __enter__(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.env = root / "elise.env"
        self.data = root / "z2m"
        self.data.mkdir()
        (self.data / "configuration.yaml").write_text("advanced:\n  network_key: [1, 2]\n  pan_id: 7\n")
        (self.data / "coordinator_backup.json").write_text('{"old": true}')
        (self.data / "database.db").write_text("{old}")
        old = (
            "ZIGBEE_ADAPTER_MODE=auto\nZIGBEE_ADAPTER=/dev/serial/by-id/usb-OLD\nZIGBEE_ADAPTER_TYPE=zstack\n"
            if self.previous_key
            else "ZIGBEE_ADAPTER_MODE=auto\nZIGBEE_ADAPTER=/dev/null\nZIGBEE_ADAPTER_TYPE=auto\n"
        )
        self.env.write_text("TZ=Europe/Paris\n" + old)
        self.target = {
            "port": "/dev/serial/by-id/usb-NEW",
            "kind": "usb",
            "adapter": "ember",
            "baudrate": 115200,
            "rtscts": False,
            "networkMode": "keep",
            "modelId": "sonoff-zbdongle-e",
            "modelName": "Sonoff ZBDongle-E",
        }
        harness = self

        def fake_wait(_seconds):
            harness.events.append("verify")
            if harness.cancel_during_verify:
                agent.CANCEL.set()
                return False, "CANCELLED", None, None
            if harness.healthy or len(harness.events) > 6 and "rollback-start" in harness.events:
                bridge = {"state": "online", "coordinator": {"type": "EZSP v13", "firmware": "7.4.4.0 build 0", "meta": {}, "ieee": "0x1", "channel": 11, "panId": "0x1a62", "extendedPanId": "0x01"}, "deviceCount": 3}
                return True, None, None, bridge
            return False, harness.code, "Error: boom", None

        def fake_start():
            harness.events.append("start:" + harness.env.read_text().split("ZIGBEE_ADAPTER=")[1].split("\n")[0])
            if "usb-OLD" in harness.events[-1] or harness.events[-1].endswith("/dev/null"):
                harness.events.append("rollback-start")

        self.patches = [
            patch.object(agent, "STATE_DIR", root / "state"),
            patch.object(agent, "ENV_FILE", self.env),
            patch.object(agent, "Z2M_DATA_DIR_OVERRIDE", str(self.data)),
            patch.object(agent, "compose_base", return_value=["docker"]),
            patch.object(agent.shutil, "which", return_value="/usr/bin/docker"),
            patch.object(agent, "port_holders", return_value=[]),
            patch.object(agent, "stop_z2m", side_effect=lambda: self.events.append("stop")),
            patch.object(agent, "start_z2m", side_effect=fake_start),
            patch.object(agent, "wait_for_z2m", side_effect=fake_wait),
            patch.object(agent.os.path, "realpath", side_effect=lambda value, *a, **k: value),
        ]
        for item in self.patches:
            item.start()
        agent.CANCEL.clear()
        return self

    def __exit__(self, *_):
        for item in self.patches:
            item.stop()
        self.folder.cleanup()

    def run(self):
        agent.run_install(self.target)
        return agent.load_install()


class InstallTests(unittest.TestCase):
    def test_successful_install_writes_the_settings_and_reports_the_coordinator(self):
        with InstallHarness(self) as harness:
            install = harness.run()
            env = agent.read_env(harness.env)
            self.assertEqual(install["state"], "SUCCEEDED")
            self.assertEqual(install["progress"], 100)
            self.assertEqual([step["state"] for step in install["steps"]], ["done"] * 5)
            self.assertEqual(install["coordinator"]["type"], "EZSP v13")
            self.assertEqual(env["ZIGBEE_ADAPTER"], "/dev/serial/by-id/usb-NEW")
            self.assertEqual(env["ZIGBEE_ADAPTER_TYPE"], "ember")
            self.assertEqual(env["ZIGBEE_BAUDRATE"], "115200")
            self.assertEqual(env["ZIGBEE_RTSCTS"], "false")
            self.assertEqual(env["ZIGBEE_ADAPTER_MODE"], "manual")
            self.assertEqual(env["TZ"], "Europe/Paris")
            self.assertEqual(harness.events[:2], ["stop", "start:/dev/serial/by-id/usb-NEW"])
            # "keep": the network settings and the coordinator backup are untouched.
            self.assertIn("network_key: [1, 2]", (harness.data / "configuration.yaml").read_text())
            self.assertEqual((harness.data / "coordinator_backup.json").read_text(), '{"old": true}')
            backup = agent.backup_dir(install["backupId"])
            self.assertEqual(json.loads((backup / "env.json").read_text())["ZIGBEE_ADAPTER"], "/dev/serial/by-id/usb-OLD")
            self.assertTrue((backup / "coordinator_backup.json").exists())

    def test_failed_start_rolls_everything_back(self):
        with InstallHarness(self, healthy=False, code="NO_ANSWER") as harness:
            install = harness.run()
            env = agent.read_env(harness.env)
            self.assertEqual(install["state"], "ROLLED_BACK")
            self.assertEqual(install["errorCode"], "NO_ANSWER")
            self.assertTrue(install["rolledBack"])
            self.assertEqual(install["detail"], "Error: boom")
            self.assertEqual(env["ZIGBEE_ADAPTER"], "/dev/serial/by-id/usb-OLD")
            self.assertEqual(env["ZIGBEE_ADAPTER_TYPE"], "zstack")
            self.assertEqual(env["ZIGBEE_ADAPTER_MODE"], "auto")
            self.assertNotIn("ZIGBEE_BAUDRATE", env)
            self.assertIn("start:/dev/serial/by-id/usb-OLD", harness.events)
            self.assertEqual(install["steps"][-1]["state"], "failed")

    def test_new_network_is_restored_when_the_install_fails(self):
        with InstallHarness(self, healthy=False, code="NO_ANSWER") as harness:
            harness.target.update({"networkMode": "new"})
            install = harness.run()
            self.assertEqual(install["state"], "ROLLED_BACK")
            self.assertIn("network_key: [1, 2]", (harness.data / "configuration.yaml").read_text())
            self.assertEqual((harness.data / "coordinator_backup.json").read_text(), '{"old": true}')
            self.assertEqual((harness.data / "database.db").read_text(), "{old}")

    def test_new_network_install_regenerates_the_identifiers(self):
        with InstallHarness(self) as harness:
            harness.target.update({"networkMode": "new"})
            install = harness.run()
            self.assertEqual(install["state"], "SUCCEEDED")
            configuration = (harness.data / "configuration.yaml").read_text()
            self.assertIn("network_key: GENERATE", configuration)
            self.assertFalse((harness.data / "coordinator_backup.json").exists())
            self.assertFalse((harness.data / "database.db").exists())
            self.assertTrue((agent.backup_dir(install["backupId"]) / "database.db").exists())

    def test_network_mismatch_is_reported_with_its_own_code(self):
        with InstallHarness(self, healthy=False, code="NETWORK_MISMATCH") as harness:
            install = harness.run()
            self.assertEqual((install["state"], install["errorCode"]), ("ROLLED_BACK", "NETWORK_MISMATCH"))

    def test_first_key_failure_restores_the_no_key_state(self):
        with InstallHarness(self, healthy=False, code="NO_ANSWER", previous_key=False) as harness:
            install = harness.run()
            env = agent.read_env(harness.env)
            self.assertEqual(install["state"], "ROLLED_BACK")
            self.assertEqual(env["ZIGBEE_ADAPTER"], "/dev/null")
            self.assertNotIn("stop", harness.events[:1])
            self.assertNotIn("start:/dev/null", harness.events)

    def test_cancel_while_verifying_rolls_back(self):
        with InstallHarness(self, cancel_during_verify=True) as harness:
            install = harness.run()
            self.assertEqual(install["state"], "CANCELLED")
            self.assertEqual(agent.read_env(harness.env)["ZIGBEE_ADAPTER"], "/dev/serial/by-id/usb-OLD")

    def test_busy_port_stops_before_touching_anything(self):
        with InstallHarness(self) as harness, patch.object(agent, "port_holders", return_value=["minicom"]):
            before = harness.env.read_text()
            install = harness.run()
            self.assertEqual((install["state"], install["errorCode"], install["detail"]), ("FAILED", "PORT_BUSY", "minicom"))
            self.assertEqual(harness.env.read_text(), before)
            self.assertEqual(harness.events, [])

    def test_unreachable_network_key_stops_before_touching_anything(self):
        with InstallHarness(self) as harness, patch.object(agent.socket, "create_connection", side_effect=OSError("down")):
            harness.target.update({"port": "tcp://10.9.9.9:6638", "kind": "network"})
            before = harness.env.read_text()
            install = harness.run()
            self.assertEqual((install["state"], install["errorCode"]), ("FAILED", "KEY_UNREACHABLE"))
            self.assertEqual(harness.env.read_text(), before)

    def test_network_key_is_written_as_a_tcp_serial_port(self):
        with InstallHarness(self) as harness, patch.object(agent.socket, "create_connection"):
            harness.target.update({"port": "tcp://10.0.0.5:6638", "kind": "network", "adapter": "zstack"})
            install = harness.run()
            env = agent.read_env(harness.env)
            self.assertEqual(install["state"], "SUCCEEDED")
            self.assertEqual(env["ZIGBEE_ADAPTER"], "/dev/null")
            self.assertEqual(env["ZIGBEE_SERIAL_PORT"], "tcp://10.0.0.5:6638")

    def test_crash_in_the_middle_is_recovered_at_start_up(self):
        with InstallHarness(self) as harness:
            agent.make_backup("20260101T000000")
            agent.apply_target({**harness.target})
            (harness.data / "configuration.yaml").write_text("broken")
            interrupted = agent.idle_install()
            interrupted.update({"state": "RUNNING", "backupId": "20260101T000000", "startedAt": agent.now()})
            agent.save_install(interrupted)
            agent.recover_interrupted()
            install = agent.load_install()
            self.assertEqual((install["state"], install["errorCode"]), ("ROLLED_BACK", "INTERRUPTED"))
            self.assertEqual(agent.read_env(harness.env)["ZIGBEE_ADAPTER"], "/dev/serial/by-id/usb-OLD")
            self.assertIn("network_key: [1, 2]", (harness.data / "configuration.yaml").read_text())

    def test_only_five_backups_are_kept(self):
        with InstallHarness(self):
            for index in range(8):
                agent.make_backup(f"2026010{index}T000000")
            agent.prune_backups()
            self.assertEqual(len(list((agent.STATE_DIR / "backups").iterdir())), 5)


class StatusTests(unittest.TestCase):
    def test_status_states(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            root = Path(folder)
            env = root / "elise.env"
            bridge = {
                "state": "online",
                "coordinator": {"type": "EZSP v13", "firmware": "7.4.4.0 build 0", "meta": {}, "ieee": "0x1", "channel": 11, "panId": "0x1", "extendedPanId": "0x2"},
                "deviceCount": 4,
            }
            patches = [
                patch.object(agent, "ENV_FILE", env),
                patch.object(agent, "STATE_DIR", root / "state"),
                patch.object(agent, "container_id", return_value="abc"),
                patch.object(agent, "container_state", return_value="running"),
                patch.object(agent, "read_bridge", return_value=bridge),
            ]
            for item in patches:
                item.start()
            try:
                env.write_text("ZIGBEE_ADAPTER=/dev/null\n")
                self.assertEqual(agent.build_status()["state"], "NO_KEY")

                by_id = "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0"
                tree.plug("ttyUSB0", by_id, DONGLE)
                status = agent.build_status()
                self.assertEqual(status["state"], "NEW_KEY")
                self.assertEqual(status["candidates"][0]["identity"]["modelId"], "sonoff-zbdongle-e")

                port = str(tree.dev / "serial" / "by-id" / by_id)
                env.write_text(f"ZIGBEE_ADAPTER_MODE=manual\nZIGBEE_ADAPTER={port}\nZIGBEE_ADAPTER_TYPE=ember\n")
                status = agent.build_status()
                self.assertEqual(status["state"], "READY")
                self.assertEqual(status["current"]["model"]["name"], "Sonoff ZBDongle-E")
                self.assertEqual(status["current"]["coordinator"]["channel"], 11)
                self.assertEqual(status["current"]["deviceCount"], 4)
                self.assertEqual(status["current"]["firmware"], "ok")
                self.assertTrue(status["candidates"][0]["isCurrent"])
                self.assertEqual(status["issues"], [])

                tree.plug("ttyACM0", "usb-CB-if00", {**DONGLE, "vid": "1cf1", "pid": "0030", "product": "ConBee II"}, "cdc_acm")
                status = agent.build_status()
                self.assertEqual(status["state"], "READY")
                self.assertIn("other-key-plugged", status["issues"])
                self.assertIn("multiple-keys", status["issues"])

                (tree.dev / "serial" / "by-id" / by_id).unlink()
                (tree.dev / "ttyUSB0").unlink()
                status = agent.build_status()
                self.assertEqual(status["state"], "NEW_KEY")

                (tree.dev / "serial" / "by-id" / "usb-CB-if00").unlink()
                (tree.dev / "ttyACM0").unlink()
                self.assertEqual(agent.build_status()["state"], "KEY_MISSING")
            finally:
                for item in patches:
                    item.stop()

    def test_status_flags_a_stopped_or_offline_bridge(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            root = Path(folder)
            env = root / "elise.env"
            by_id = "usb-A-if00-port0"
            tree.plug("ttyUSB0", by_id, DONGLE)
            port = str(tree.dev / "serial" / "by-id" / by_id)
            env.write_text(f"ZIGBEE_ADAPTER={port}\nZIGBEE_ADAPTER_TYPE=ember\n")
            offline = {"state": "offline", "coordinator": None, "deviceCount": None}
            with patch.object(agent, "ENV_FILE", env), patch.object(agent, "STATE_DIR", root / "state"), patch.object(
                agent, "container_id", return_value="abc"
            ), patch.object(agent, "read_bridge", return_value=offline):
                with patch.object(agent, "container_state", return_value="stopped"):
                    status = agent.build_status()
                    self.assertEqual(status["state"], "ATTENTION")
                    self.assertIn("z2m-stopped", status["issues"])
                with patch.object(agent, "container_state", return_value="running"):
                    status = agent.build_status()
                    self.assertIn("z2m-offline", status["issues"])


class AutoTests(unittest.TestCase):
    def setup_auto(self, tree, root, env_text):
        env = root / "elise.env"
        env.write_text(env_text)
        (root / "current").mkdir(exist_ok=True)
        return env

    def test_auto_installs_a_single_certain_key_when_none_is_configured(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            root = Path(folder)
            tree.plug("ttyUSB0", "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0", DONGLE)
            env = self.setup_auto(tree, root, "ZIGBEE_ADAPTER_MODE=auto\nZIGBEE_ADAPTER=/dev/null\n")
            ran = []
            with patch.object(agent, "ENV_FILE", env), patch.object(agent, "ROOT_DIR", root), patch.object(
                agent, "STATE_DIR", root / "state"
            ), patch.object(agent, "run_install", side_effect=lambda target: ran.append(target)), patch.object(
                agent, "build_current", return_value=None
            ), patch.object(agent.subprocess, "run"):
                self.assertEqual(agent.auto(), 0)
            self.assertEqual(len(ran), 1)
            self.assertEqual((ran[0]["adapter"], ran[0]["baudrate"]), ("ember", 115200))

    def test_auto_never_guesses_an_ambiguous_key_or_overrides_a_chosen_one(self):
        with tempfile.TemporaryDirectory() as folder, FakeTree(Path(folder)) as tree:
            root = Path(folder)
            tree.plug("ttyUSB0", "usb-1a86_USB_Serial-if00-port0", {**DONGLE, "vid": "1a86", "pid": "7523", "product": "USB Serial"})
            env = self.setup_auto(tree, root, "ZIGBEE_ADAPTER_MODE=auto\nZIGBEE_ADAPTER=/dev/null\n")
            ran = []
            with patch.object(agent, "ENV_FILE", env), patch.object(agent, "ROOT_DIR", root), patch.object(
                agent, "STATE_DIR", root / "state"
            ), patch.object(agent, "run_install", side_effect=lambda target: ran.append(target)), patch.object(
                agent, "build_current", return_value=None
            ), patch.object(agent.subprocess, "run"):
                agent.auto()
                self.assertEqual(ran, [])
                tree.plug("ttyUSB1", "usb-ITead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2_abc-if00-port0", DONGLE)
                env.write_text("ZIGBEE_ADAPTER_MODE=manual\nZIGBEE_ADAPTER=/dev/serial/by-id/usb-old\n")
                agent.auto()
                self.assertEqual(ran, [])


class ServiceFilesTests(unittest.TestCase):
    def test_service_unit_is_hardened_and_runs_the_agent(self):
        unit = (HERE / "systemd" / "elise-zigbee-agent.service").read_text(encoding="utf-8")
        self.assertIn("ExecStart=/usr/lib/elise/elise-zigbee-agent.py", unit)
        self.assertIn("NoNewPrivileges=true", unit)
        self.assertIn("RuntimeDirectory=elise-zigbee", unit)
        self.assertIn("ELISE_ZIGBEE_MODELS_FILE=/usr/lib/elise/elise-zigbee-adapters.json", unit)


if __name__ == "__main__":
    unittest.main()
