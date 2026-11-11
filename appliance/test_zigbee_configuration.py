import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIGURATION = ROOT / "docker" / "zigbee2mqtt" / "configuration.yaml"


class ZigbeeConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.configuration = CONFIGURATION.read_text(encoding="utf-8")

    def assert_setting(self, name: str, value: str) -> None:
        self.assertRegex(self.configuration, rf"(?m)^\s*{re.escape(name)}:\s*{re.escape(value)}\s*$")

    def test_fresh_network_uses_unique_generated_identifiers(self):
        self.assert_setting("network_key", "GENERATE")
        self.assert_setting("pan_id", "GENERATE")
        self.assert_setting("ext_pan_id", "GENERATE")

    def test_availability_covers_routers_and_sleeping_sensors(self):
        availability = self.configuration.split("availability:", 1)[1].split("advanced:", 1)[0]
        self.assertRegex(availability, r"(?m)^\s+enabled:\s*true\s*$")
        self.assertRegex(availability, r"(?ms)^\s+active:.*?^\s+\s+timeout:\s*10\s*$")
        self.assertRegex(availability, r"(?ms)^\s+passive:.*?^\s+\s+timeout:\s*1500\s*$")

    def test_home_assistant_creates_button_event_entities(self):
        home_assistant = self.configuration.split("homeassistant:", 1)[1].split("mqtt:", 1)[0]
        self.assertRegex(home_assistant, r"(?m)^\s+experimental_event_entities:\s*true\s*$")

    def test_pairing_is_closed_by_default(self):
        self.assert_setting("permit_join", "false")


if __name__ == "__main__":
    unittest.main()
