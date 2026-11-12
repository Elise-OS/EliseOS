import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAPPING = ROOT / "docker" / "homeassistant" / "custom_components" / "elise_bridge" / "mapping.py"
SPEC = importlib.util.spec_from_file_location("elise_sensor_mapping", MAPPING)
mapping = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(mapping)


class RealZigbeePayloadTests(unittest.TestCase):
    def test_sonoff_snzb_03p_motion_occupancy(self):
        self.assertEqual(mapping.CAPABILITIES[("binary_sensor", "occupancy")], "occupancy")
        self.assertEqual(mapping.payload("occupancy", "on", {}), {"active": True})

    def test_sonoff_snzb_04p_contact_true_means_closed(self):
        # Z2M contact=false becomes HA opening=on; contact=true becomes HA opening=off.
        self.assertEqual(mapping.payload("contact", "on", {}), {"open": True})
        self.assertEqual(mapping.payload("contact", "off", {}), {"open": False})

    def test_sonoff_snzb_02p_temperature_and_humidity(self):
        self.assertEqual(mapping.payload("temperature", 18.7, {"unit_of_measurement": "°C"})["value"], 18.7)
        self.assertEqual(mapping.payload("humidity", 62.5, {"unit_of_measurement": "%"})["value"], 62.5)

    def test_sonoff_snzb_01p_actions(self):
        self.assertEqual(mapping.capability("event.snzb_01p_action", None), "button")
        for action in ("single", "double", "long"):
            self.assertEqual(mapping.payload("button", "2026-11-11T18:00:00Z", {"event_type": action}), {"action": action})

    def test_sonoff_snzb_01p_event_entity_reports_every_press_type(self):
        # Z2M 2.13 (zigbee-herdsman-converters 26.90.0, ewelinkAction) exposes exactly
        # single/double/long; the API raises an SOS for all of them on an assistance button.
        attributes = {"event_types": ["single", "double", "long"], "friendly_name": "Bouton salon Action"}
        self.assertEqual(mapping.capability("event.bouton_salon_action", None), "button")
        for action in attributes["event_types"]:
            self.assertEqual(
                mapping.payload("button", "2026-11-12T08:00:00.000+00:00", {**attributes, "event_type": action}),
                {"action": action},
            )

    def test_unrelated_home_assistant_event_is_not_a_button(self):
        self.assertIsNone(mapping.capability("event.calendar_reminder", None))

    def test_sonoff_snzb_05p_water_leak(self):
        self.assertEqual(mapping.payload("water_leak", "on", {}), {"active": True})

    def test_sonoff_snzb_06p_presence(self):
        self.assertEqual(mapping.payload("occupancy", "off", {}), {"active": False})

    def test_third_reality_plug_measurements(self):
        self.assertEqual(mapping.payload("power", 43.2, {"unit_of_measurement": "W"})["value"], 43.2)
        self.assertEqual(mapping.payload("energy", 1.84, {"unit_of_measurement": "kWh"})["value"], 1.84)

    def test_heiman_hs1sa_e_smoke(self):
        self.assertEqual(mapping.payload("smoke", "on", {}), {"active": True})

    def test_heiman_hs1sa_e_test_button_is_flagged_as_test(self):
        # Z2M 2.13 / zigbee-herdsman-converters 26.90.0: ias_smoke_alarm_1 publishes
        # {"smoke": true, "test": true, ...} on a test press (zoneStatus bits 0 and 8).
        smoke = mapping.payload("smoke", "on", {"device_class": "smoke"})
        self.assertEqual(mapping.with_smoke_test(smoke, "on"), {"active": True, "test": True})

    def test_heiman_hs1sa_e_smoke_without_test_flag_stays_real(self):
        smoke = mapping.payload("smoke", "on", {"device_class": "smoke"})
        for test_state in ("off", None, "unknown", "unavailable"):
            self.assertEqual(mapping.with_smoke_test(smoke, test_state), {"active": True})
        cleared = mapping.payload("smoke", "off", {"device_class": "smoke"})
        self.assertEqual(mapping.with_smoke_test(cleared, "on"), {"active": False})

    def test_heiman_hs1sa_e_test_entity_lookup(self):
        self.assertEqual(
            mapping.smoke_test_unique_id("0x00124b0029a1b2c3_smoke_zigbee2mqtt"),
            "0x00124b0029a1b2c3_test_zigbee2mqtt",
        )
        self.assertIsNone(mapping.smoke_test_unique_id("0x00124b0029a1b2c3_water_leak_zigbee2mqtt"))
        self.assertIsNone(mapping.smoke_test_unique_id(None))
        self.assertEqual(
            mapping.smoke_test_entity_id("binary_sensor.detecteur_fumee_cuisine_smoke"),
            "binary_sensor.detecteur_fumee_cuisine_test",
        )
        self.assertIsNone(mapping.smoke_test_entity_id("binary_sensor.cuisine_fumee"))

    def test_numeric_and_binary_low_battery(self):
        self.assertEqual(mapping.payload("battery", 9, {"unit_of_measurement": "%"})["value"], 9.0)
        self.assertEqual(mapping.payload("battery", "on", {}), {"value": 0, "low": True, "unit": "%"})


if __name__ == "__main__":
    unittest.main()


class ButtonReplayTests(unittest.TestCase):
    """SNZB-01P event entity states as Home Assistant 2026.7 reports them."""

    NOW = mapping.datetime.fromisoformat("2026-11-12T08:00:30+00:00")

    def test_real_press_after_unknown_or_previous_press(self):
        self.assertTrue(mapping.is_new_button_press("unknown", "2026-11-12T08:00:29.512+00:00", self.NOW))
        self.assertTrue(
            mapping.is_new_button_press("2026-11-11T19:00:00.000+00:00", "2026-11-12T08:00:29.512+00:00", self.NOW)
        )

    def test_restored_press_after_home_assistant_restart_is_ignored(self):
        self.assertFalse(mapping.is_new_button_press(None, "2026-11-11T19:00:00.000+00:00", self.NOW))

    def test_restored_press_when_zigbee2mqtt_marks_button_online_again_is_ignored(self):
        self.assertFalse(mapping.is_new_button_press("unavailable", "2026-11-11T19:00:00.000+00:00", self.NOW))
        # Even if the old press was recent, coming back online is not a press.
        self.assertFalse(mapping.is_new_button_press("unavailable", "2026-11-12T08:00:20.000+00:00", self.NOW))

    def test_stale_or_unchanged_timestamp_is_ignored(self):
        self.assertFalse(
            mapping.is_new_button_press("unknown", "2026-11-11T19:00:00.000+00:00", self.NOW)
        )
        same = "2026-11-12T08:00:29.512+00:00"
        self.assertFalse(mapping.is_new_button_press(same, same, self.NOW))
        self.assertFalse(mapping.is_new_button_press("unknown", "not-a-date", self.NOW))


class DeviceModelTests(unittest.TestCase):
    def test_zigbee2mqtt_2_reference_wins_over_description(self):
        # Z2M 2.13 discovery: model "Zigbee PIR sensor", model_id "SNZB-03P".
        self.assertEqual(mapping.device_model("Zigbee PIR sensor", "SNZB-03P"), "SNZB-03P")
        self.assertEqual(mapping.device_model("Zigbee occupancy sensor", "SNZB-06P"), "SNZB-06P")
        self.assertEqual(mapping.device_model("Generic plug", None), "Generic plug")
