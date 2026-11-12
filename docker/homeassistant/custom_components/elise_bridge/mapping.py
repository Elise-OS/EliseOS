"""Pure Home Assistant → Élise sensor mapping, kept dependency-free for release tests."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

# A Home Assistant event entity keeps the time of its last press as its state.
FRESH_BUTTON_EVENT_SECONDS = 60


CAPABILITIES = {
    ("binary_sensor", "motion"): "motion",
    ("binary_sensor", "occupancy"): "occupancy",
    ("binary_sensor", "presence"): "person_presence",
    ("binary_sensor", "door"): "contact",
    ("binary_sensor", "opening"): "contact",
    ("binary_sensor", "window"): "contact",
    ("binary_sensor", "garage_door"): "contact",
    ("binary_sensor", "battery"): "battery",
    ("camera", ""): "camera",
    ("sensor", "temperature"): "temperature",
    ("sensor", "humidity"): "humidity",
    ("sensor", "power"): "power",
    ("sensor", "energy"): "energy",
    ("sensor", "current"): "current",
    ("sensor", "voltage"): "voltage",
    ("sensor", "battery"): "battery",
    ("event", "button"): "button",
    ("binary_sensor", "moisture"): "water_leak",
    ("binary_sensor", "smoke"): "smoke",
    ("binary_sensor", "carbon_monoxide"): "carbon_monoxide",
    ("binary_sensor", "vibration"): "vibration",
    ("sensor", "carbon_dioxide"): "co2",
    ("sensor", "volatile_organic_compounds"): "voc",
    ("sensor", "pm25"): "pm25",
    ("sensor", "aqi"): "air_quality",
    ("sensor", "illuminance"): "illuminance",
    ("sensor", "signal_strength"): "signal_strength",
    ("switch", ""): "switch",
}


def capability(entity_id: str, device_class: str | None) -> str | None:
    domain = entity_id.split(".", 1)[0]
    # Z2M 2.x experimental action entities are MQTT event entities named
    # ``*_action`` without a Home Assistant device_class.
    if domain == "event" and entity_id.lower().endswith("_action"):
        return "button"
    return CAPABILITIES.get((domain, device_class or ""))


def payload(capability: str, value: Any, attributes: dict[str, Any]) -> dict[str, Any]:
    if capability == "fall_detection":
        fall_status = str(value).strip().lower()
        if fall_status in {"fall_warning", "fall_alarm"}:
            return {"active": True, "fallStatus": fall_status}
        if fall_status == "normal":
            return {"active": False, "fallStatus": fall_status}
        return {"fallStatus": fall_status}
    if capability in {
        "motion",
        "occupancy",
        "person_presence",
        "water_leak",
        "smoke",
        "carbon_monoxide",
        "vibration",
    }:
        return {"active": value == "on"}
    if capability == "contact":
        return {"open": str(value).lower() in {"on", "open", "contact_open", "true"}}
    if capability == "button":
        action = attributes.get("event_type") or attributes.get("action") or value
        return {"action": str(action)}
    # Zigbee2MQTT exposes battery_low as a binary battery-class entity. Treat it as a
    # conservative percentage as well as the regular numeric battery measurement.
    if capability == "battery" and value in {"on", "off"}:
        return {"value": 0 if value == "on" else 100, "low": value == "on", "unit": "%"}
    try:
        normalized: str | float = float(value)
    except (TypeError, ValueError):
        normalized = value
    return {"value": normalized, "unit": attributes.get("unit_of_measurement")}


def is_new_button_press(old_value: Any, new_value: Any, now: datetime) -> bool:
    """Tell a real press from a restored event entity.

    Home Assistant restores the last press (timestamp state and event_type) after a
    restart, and again when Zigbee2MQTT marks the button available after being offline.
    Those state changes must never become a new SOS.
    """
    if old_value is None or old_value == "unavailable" or old_value == new_value:
        return False
    try:
        pressed_at = datetime.fromisoformat(str(new_value).replace("Z", "+00:00"))
    except ValueError:
        return False
    if pressed_at.tzinfo is None:
        return False
    return abs((now - pressed_at).total_seconds()) <= FRESH_BUTTON_EVENT_SECONDS


def device_model(model: str | None, model_id: str | None) -> str | None:
    """Zigbee2MQTT 2.x gives Home Assistant its description as model and the real
    reference (e.g. SNZB-03P) as model_id; Élise recognises sensors by reference."""
    return model_id or model


# Zigbee2MQTT 2.13 publishes one MQTT state for the HEIMAN HS1SA-E, decoded by
# zigbee-herdsman-converters ``ias_smoke_alarm_1``: ``smoke`` is zoneStatus bit 0 and
# ``test`` is bit 8. Home Assistant discovery turns them into two entities of the same
# device, ``binary_sensor.<name>_smoke`` (unique_id ``<ieee>_smoke_<base_topic>``) and a
# diagnostic ``binary_sensor.<name>_test`` (unique_id ``<ieee>_test_<base_topic>``).
_Z2M_SMOKE_UNIQUE_ID = re.compile(r"^(0x[0-9a-fA-F]{16})_smoke_(.+)$")
_Z2M_TEST_UNIQUE_ID = re.compile(r"^(0x[0-9a-fA-F]{16})_test_(.+)$")


def smoke_test_unique_id(smoke_unique_id: str | None) -> str | None:
    """unique_id of the Zigbee2MQTT ``test`` entity next to a ``smoke`` entity."""
    match = _Z2M_SMOKE_UNIQUE_ID.match(smoke_unique_id or "")
    return f"{match.group(1)}_test_{match.group(2)}" if match else None


def smoke_unique_id(test_unique_id: str | None) -> str | None:
    """unique_id of the Zigbee2MQTT ``smoke`` entity next to a ``test`` entity."""
    match = _Z2M_TEST_UNIQUE_ID.match(test_unique_id or "")
    return f"{match.group(1)}_smoke_{match.group(2)}" if match else None


def smoke_test_entity_id(smoke_entity_id: str) -> str | None:
    """Default entity_id of the ``test`` entity, used when the unique_id is unknown."""
    if smoke_entity_id.startswith("binary_sensor.") and smoke_entity_id.endswith("_smoke"):
        return f"{smoke_entity_id[: -len('_smoke')]}_test"
    return None


def smoke_entity_id(test_entity_id: str) -> str | None:
    """Default entity_id of the ``smoke`` entity, used when the unique_id is unknown."""
    if test_entity_id.startswith("binary_sensor.") and test_entity_id.endswith("_test"):
        return f"{test_entity_id[: -len('_test')]}_smoke"
    return None


def smoke_remains_after_test(test_old_state: Any, test_state: Any, smoke_state: Any) -> bool:
    """A test ended while smoke stayed active: it must now be treated as real smoke.

    This closes the safety gap where the smoke bit does not change between a detector test
    and real smoke, so Home Assistant emits only the sibling ``test`` state change.
    """
    return test_old_state == "on" and test_state == "off" and smoke_state == "on"


def with_smoke_test(event_payload: dict[str, Any], test_state: Any) -> dict[str, Any]:
    """Mark a smoke report as a test press only when Zigbee2MQTT says so.

    Without a ``test`` entity at "on", the report stays a real smoke alarm: safety first.
    """
    if event_payload.get("active") is True and test_state == "on":
        return {**event_payload, "test": True}
    return event_payload
