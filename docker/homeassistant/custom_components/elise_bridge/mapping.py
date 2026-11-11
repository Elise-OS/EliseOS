"""Pure Home Assistant → Élise sensor mapping, kept dependency-free for release tests."""
from __future__ import annotations

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
