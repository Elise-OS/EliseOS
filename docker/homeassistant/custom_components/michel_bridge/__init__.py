"""Home Assistant event bridge for Michel OS."""
from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

DOMAIN = "michel_bridge"
EVENT_TOPIC = "michel/v1/events"
ENTITY_STATE_TOPIC = "michel/v1/entity-states"
INVENTORY_TOPIC = "michel/v1/inventory"
INVENTORY_REQUEST_TOPIC = "michel/v1/inventory/request"
STATUS_TOPIC = "michel/v1/bridge/status"
COMMAND_TOPIC = "michel/v1/commands/#"
COMMAND_RESULT_TOPIC = "michel/v1/commands/results"

ALLOWED_COMMANDS = {
    "light": {"turn_on", "turn_off", "toggle"},
    "switch": {"turn_on", "turn_off", "toggle"},
    "homeassistant": {"turn_on", "turn_off", "toggle"},
}

CAPABILITIES = {
    ("binary_sensor", "motion"): "motion",
    ("binary_sensor", "occupancy"): "occupancy",
    ("binary_sensor", "door"): "contact",
    ("binary_sensor", "opening"): "contact",
    ("sensor", "temperature"): "temperature",
    ("sensor", "humidity"): "humidity",
    ("sensor", "power"): "power",
    ("sensor", "energy"): "energy",
    ("sensor", "battery"): "battery",
    ("event", "button"): "button",
}


def _secret(name: str) -> str:
    path = Path(os.getenv("MICHEL_SECRETS_DIR", "/run/michel-secrets")) / name
    return path.read_text(encoding="utf-8").strip()


def _payload(capability: str, state: Any) -> dict[str, Any]:
    if capability in {"motion", "occupancy"}:
        return {"active": state.state == "on"}
    if capability == "contact":
        return {"open": state.state == "on"}
    if capability == "button":
        action = state.attributes.get("event_type") or state.attributes.get("action") or state.state
        return {"action": str(action)}
    try:
        value: str | float = float(state.state)
    except (TypeError, ValueError):
        value = state.state
    return {"value": value, "unit": state.attributes.get("unit_of_measurement")}


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="michel-ha-bridge")
    client.username_pw_set("homeassistant", _secret("mqtt_password"))
    home_id = os.getenv("MICHEL_HOME_ID", "home_demo")

    def entity_capability(entity_id: str, device_class: str | None) -> str | None:
        domain = entity_id.split(".", 1)[0]
        return CAPABILITIES.get((domain, device_class or ""))

    async def publish_inventory() -> None:
        entity_registry = er.async_get(hass)
        device_registry = dr.async_get(hass)
        devices = []
        for device in device_registry.devices.values():
            devices.append(
                {
                    "deviceId": device.id,
                    "name": device.name_by_user or device.name or device.id,
                    "manufacturer": device.manufacturer,
                    "model": device.model,
                }
            )
        entities = []
        for entity in entity_registry.entities.values():
            state = hass.states.get(entity.entity_id)
            device_class = (
                (state.attributes.get("device_class") if state else None)
                or entity.original_device_class
            )
            capability = entity_capability(entity.entity_id, device_class)
            entities.append(
                {
                    "entityId": entity.entity_id,
                    "deviceId": entity.device_id,
                    "name": entity.name or entity.original_name or entity.entity_id,
                    "domain": entity.entity_id.split(".", 1)[0],
                    "deviceClass": device_class,
                    "unit": state.attributes.get("unit_of_measurement") if state else None,
                    "available": bool(state and state.state not in {"unknown", "unavailable"}),
                    "capability": capability,
                    "compatibility": "RECOGNIZED" if capability else "UNSUPPORTED",
                }
            )
        payload = {
            "schemaVersion": "1.0",
            "homeId": home_id,
            "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "full": True,
            "devices": devices,
            "entities": entities,
        }
        client.publish(INVENTORY_TOPIC, json.dumps(payload, separators=(",", ":")), qos=1)

    async def execute_command(command: dict[str, Any]) -> None:
        command_id = str(command.get("commandId", "unknown"))
        domain = str(command.get("domain", ""))
        service = str(command.get("service", ""))
        result: dict[str, Any] = {"commandId": command_id, "status": "rejected"}
        try:
            if service not in ALLOWED_COMMANDS.get(domain, set()):
                raise ValueError("Command is not allow-listed")
            target = command.get("target")
            data = command.get("data")
            if target is not None and not isinstance(target, dict):
                raise ValueError("target must be an object")
            if data is not None and not isinstance(data, dict):
                raise ValueError("data must be an object")
            await hass.services.async_call(
                domain,
                service,
                service_data=data or {},
                target=target,
                blocking=True,
            )
            result["status"] = "completed"
        except Exception as error:  # Home Assistant reports provider-specific errors here.
            result["error"] = str(error)[:500]
        client.publish(
            f"{COMMAND_RESULT_TOPIC}/{command_id}",
            json.dumps(result, separators=(",", ":")),
            qos=1,
        )

    def connected(
        mqtt_client: mqtt.Client,
        _userdata: Any,
        _flags: Any,
        reason_code: Any,
        _properties: Any,
    ) -> None:
        if reason_code == 0:
            mqtt_client.subscribe(COMMAND_TOPIC, qos=1)
            mqtt_client.subscribe(INVENTORY_REQUEST_TOPIC, qos=1)
            mqtt_client.publish(
                STATUS_TOPIC,
                json.dumps({"status": "online", "version": "0.1.0"}),
                qos=1,
                retain=True,
            )

    def command_received(_client: mqtt.Client, _userdata: Any, message: mqtt.MQTTMessage) -> None:
        if message.topic == INVENTORY_REQUEST_TOPIC:
            hass.loop.call_soon_threadsafe(hass.async_create_task, publish_inventory())
            return
        try:
            command = json.loads(message.payload.decode("utf-8"))
            if not isinstance(command, dict):
                raise ValueError("Command payload must be an object")
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            return
        hass.loop.call_soon_threadsafe(hass.async_create_task, execute_command(command))

    client.on_connect = connected
    client.on_message = command_received
    client.will_set(STATUS_TOPIC, json.dumps({"status": "offline"}), qos=1, retain=True)
    client.connect_async(os.getenv("MQTT_HOST", "mosquitto"), int(os.getenv("MQTT_PORT", "1883")))
    client.loop_start()

    async def state_changed(event: Event) -> None:
        state = event.data.get("new_state")
        if state is None:
            return
        device_class = state.attributes.get("device_class", "")
        capability = entity_capability(state.entity_id, device_class)
        occurred_at = state.last_changed.astimezone(UTC).isoformat().replace("+00:00", "Z")
        event_id = f"{event.context.id}-{state.entity_id}-{occurred_at}"
        raw_state: str | float | bool | None = state.state
        try:
            raw_state = float(state.state)
        except (TypeError, ValueError):
            pass
        client.publish(
            ENTITY_STATE_TOPIC,
            json.dumps(
                {
                    "schemaVersion": "1.0",
                    "eventId": f"raw-{event_id}",
                    "homeId": home_id,
                    "entityId": state.entity_id,
                    "occurredAt": occurred_at,
                    "state": raw_state,
                },
                separators=(",", ":"),
            ),
            qos=1,
        )
        if capability is None:
            return
        entity_entry = er.async_get(hass).async_get(state.entity_id)
        device = dr.async_get(hass).async_get(entity_entry.device_id) if entity_entry and entity_entry.device_id else None
        payload = {
            "schemaVersion": "1.0",
            "eventId": event_id,
            "occurredAt": occurred_at,
            "receivedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "homeId": home_id,
            "source": {
                "platform": "home-assistant",
                "entityId": state.entity_id,
                "deviceId": entity_entry.device_id if entity_entry else None,
                "name": (entity_entry.name or entity_entry.original_name) if entity_entry else None,
                "manufacturer": device.manufacturer if device else None,
                "model": device.model if device else None,
            },
            "capability": capability,
            "quality": "good" if state.state not in {"unknown", "unavailable"} else "degraded",
            "payload": _payload(capability, state),
        }
        client.publish(EVENT_TOPIC, json.dumps(payload, separators=(",", ":")), qos=1)

    unsubscribe = hass.bus.async_listen(EVENT_STATE_CHANGED, state_changed)
    unsubscribe_started = hass.bus.async_listen_once(
        EVENT_HOMEASSISTANT_STARTED,
        lambda _event: hass.async_create_task(publish_inventory()),
    )
    unsubscribe_registry = hass.bus.async_listen(
        "entity_registry_updated",
        lambda _event: hass.async_create_task(publish_inventory()),
    )

    def stop(_event: Event) -> None:
        client.publish(STATUS_TOPIC, json.dumps({"status": "offline"}), qos=1, retain=True)
        client.disconnect()
        client.loop_stop()

    unsubscribe_stop = hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
    hass.data[DOMAIN] = {
        "client": client,
        "unsubscribe": unsubscribe,
        "unsubscribe_started": unsubscribe_started,
        "unsubscribe_registry": unsubscribe_registry,
        "unsubscribe_stop": unsubscribe_stop,
    }
    return True
