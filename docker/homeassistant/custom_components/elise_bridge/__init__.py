"""Home Assistant event bridge for Élise OS."""
from __future__ import annotations

import asyncio
import json
import hashlib
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import paho.mqtt.client as mqtt
import voluptuous_serialize
from homeassistant.config_entries import SOURCE_RECONFIGURE, SOURCE_USER
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .mapping import (
    capability as sensor_capability,
    device_model,
    is_new_button_press,
    payload as sensor_payload,
    smoke_entity_id,
    smoke_remains_after_test,
    smoke_unique_id,
    smoke_test_entity_id,
    smoke_test_unique_id,
    with_smoke_test,
)

DOMAIN = "elise_bridge"
_LOGGER = logging.getLogger(__name__)
SMOKE_PAIR_SETTLE_SECONDS = 0.1
EVENT_TOPIC = "elise/v1/events"
ENTITY_STATE_TOPIC = "elise/v1/entity-states"
INVENTORY_TOPIC = "elise/v1/inventory"
INVENTORY_REQUEST_TOPIC = "elise/v1/inventory/request"
STATUS_TOPIC = "elise/v1/bridge/status"
COMMAND_TOPIC = "elise/v1/commands/#"
COMMAND_RESULT_TOPIC = "elise/v1/commands/results"
DISCOVERY_TOPIC = "elise/v1/discovery"
DISCOVERY_COMMAND_TOPIC = "elise/v1/discovery/commands/#"
DISCOVERY_RESULT_TOPIC = "elise/v1/discovery/results"

ALLOWED_COMMANDS = {
    "light": {"turn_on", "turn_off", "toggle"},
    "switch": {"turn_on", "turn_off", "toggle"},
    "homeassistant": {"turn_on", "turn_off", "toggle"},
    "media_player": {
        "turn_on", "turn_off", "media_play", "media_pause", "media_stop",
        "play_media", "volume_set", "volume_mute",
    },
    "notify": {"send_message"},
    "remote": {"turn_on", "turn_off"},
    "cover": {"open_cover", "close_cover", "stop_cover"},
    "button": {"press"},
}

ACTION_LABELS = {
    "turn_on": "Allumer", "turn_off": "Éteindre", "toggle": "Basculer",
    "media_play": "Lire", "media_pause": "Mettre en pause", "media_stop": "Arrêter",
    "play_media": "Diffuser un média", "volume_set": "Régler le volume",
    "volume_mute": "Couper le son", "send_message": "Envoyer une notification",
    "open_cover": "Ouvrir", "close_cover": "Fermer", "stop_cover": "Arrêter",
    "press": "Appuyer",
}

ACTION_FIELDS = {
    "play_media": ["media_content_id", "media_content_type"],
    "volume_set": ["volume_level"], "volume_mute": ["is_volume_muted"],
    "send_message": ["message", "title"],
}

SENSOR_ENTITY_DOMAINS = {"binary_sensor", "event", "sensor", "switch", "camera"}
INTERNAL_HOME_ASSISTANT_INTEGRATIONS = {
    "analytics",
    "backup",
    "recorder",
    "sun",
    "systemmonitor",
    "time_date",
    "uptime",
    "version",
}


def _is_equipment_candidate(domain: str, platform: str | None) -> bool:
    return (
        bool(domain)
        and platform not in INTERNAL_HOME_ASSISTANT_INTEGRATIONS
        and domain not in {"automation", "group", "scene", "script", "sun", "update"}
    )


def _is_sensor_candidate(domain: str, platform: str | None) -> bool:
    return domain in SENSOR_ENTITY_DOMAINS and _is_equipment_candidate(domain, platform)


def _actions_for(domain: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"{domain}.{service}",
            "domain": domain,
            "service": service,
            "label": ACTION_LABELS.get(service, service.replace("_", " ").title()),
            "fields": ACTION_FIELDS.get(service, []),
        }
        for service in sorted(ALLOWED_COMMANDS.get(domain, set()))
    ]


def _is_zigbee2mqtt_bridge(device: Any | None) -> bool:
    if device is None:
        return False
    identifiers = getattr(device, "identifiers", set())
    return any(
        "zigbee2mqtt_bridge" in str(identifier).lower()
        for identifier in identifiers
    )


def _zigbee2mqtt_identifier(device: Any | None) -> str | None:
    if device is None:
        return None
    for identifier in getattr(device, "identifiers", set()):
        value = str(identifier)
        marker = "zigbee2mqtt_"
        marker_index = value.lower().find(marker)
        if marker_index >= 0 and "zigbee2mqtt_bridge" not in value.lower():
            return value[marker_index + len(marker):].rstrip("')\"]}")
    return None


def _protocol(platform: str | None, device: Any | None = None) -> str:
    if platform in {"zha", "zigbee2mqtt"}:
        return "zigbee"
    # Zigbee2MQTT entities are created by Home Assistant's MQTT integration,
    # therefore their platform is "mqtt". The discovery identifiers retain the
    # Zigbee2MQTT origin and let Élise distinguish them from regular Wi-Fi MQTT
    # devices during onboarding.
    if platform == "mqtt" and device is not None:
        identifiers = getattr(device, "identifiers", set())
        if any("zigbee2mqtt" in str(identifier).lower() for identifier in identifiers):
            return "zigbee"
    if platform == "matter":
        return "matter"
    if platform == "zwave_js":
        return "zwave"
    if platform in {"bthome", "bluetooth"}:
        return "bluetooth"
    if platform == "esphome":
        return "esphome"
    return "wifi"


def _secret(name: str) -> str:
    path = Path(os.getenv("ELISE_SECRETS_DIR", "/run/elise-secrets")) / name
    return path.read_text(encoding="utf-8").strip()


def _payload(capability: str, state: Any) -> dict[str, Any]:
    return sensor_payload(capability, state.state, state.attributes)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="elise-ha-bridge")
    mqtt_password = await hass.async_add_executor_job(_secret, "mqtt_password")
    client.username_pw_set("homeassistant", mqtt_password)
    home_id = os.getenv("ELISE_HOME_ID", "home_demo")

    async def ensure_home_assistant_mqtt() -> None:
        """Connect Home Assistant itself to Élise's local MQTT broker once."""
        broker = os.getenv("MQTT_HOST", "mosquitto")
        port = int(os.getenv("MQTT_PORT", "1883"))
        existing_entries = hass.config_entries.async_entries("mqtt")
        if existing_entries:
            entry = existing_entries[0]
            desired = {
                **entry.data,
                "broker": broker,
                "port": port,
                "username": "homeassistant",
                "password": mqtt_password,
            }
            if entry.data != desired:
                hass.config_entries.async_update_entry(entry, data=desired)
                await hass.config_entries.async_reload(entry.entry_id)
            return
        result = await hass.config_entries.flow.async_init(
            "mqtt",
            context={"source": SOURCE_USER},
        )
        if result["type"] is not FlowResultType.FORM:
            _LOGGER.error("Unable to initialize the managed MQTT configuration flow: %s", result)
            return
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            user_input={
                "broker": broker,
                "port": port,
                "username": "homeassistant",
                "password": mqtt_password,
            },
        )
        if result["type"] is not FlowResultType.CREATE_ENTRY:
            _LOGGER.error("Unable to configure the managed MQTT integration: %s", result)

    hass.async_create_task(ensure_home_assistant_mqtt())

    def entity_capability(entity_id: str, device_class: str | None) -> str | None:
        domain = entity_id.split(".", 1)[0]
        # Zigbee2MQTT exposes the Heiman fall result as an enum sensor rather
        # than a binary_sensor. Keep the enum capability so Élise can alert on it.
        if domain == "sensor" and entity_id.lower().endswith("_fall_status"):
            return "fall_detection"
        # NodOn SDC-4-1-00 is exposed by Zigbee2MQTT as an enum sensor named
        # "dry_contact", rather than as Home Assistant's opening binary sensor.
        if domain in {"sensor", "binary_sensor"} and "dry_contact" in entity_id.lower():
            return "contact"
        return sensor_capability(entity_id, device_class)

    async def publish_inventory() -> None:
        entity_registry = er.async_get(hass)
        device_registry = dr.async_get(hass)
        entities = []
        for entity in entity_registry.entities.values():
            domain = entity.entity_id.split(".", 1)[0]
            if not _is_equipment_candidate(domain, entity.platform) or entity.disabled_by:
                continue
            state = hass.states.get(entity.entity_id)
            source_device = (
                device_registry.async_get(entity.device_id) if entity.device_id else None
            )
            if _is_zigbee2mqtt_bridge(source_device):
                continue
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
                    "domain": domain,
                    "deviceClass": device_class,
                    "unit": state.attributes.get("unit_of_measurement") if state else None,
                    "integration": entity.platform,
                    "protocol": _protocol(entity.platform, source_device),
                    "available": bool(state and state.state not in {"unknown", "unavailable"}),
                    "state": state.state if state else None,
                    "actions": _actions_for(domain),
                    "capability": capability,
                    "compatibility": "RECOGNIZED" if capability else "UNSUPPORTED",
                }
            )
        referenced_device_ids = {
            entity["deviceId"] for entity in entities if entity["deviceId"]
        }
        devices = []
        for device_id in referenced_device_ids:
            device = device_registry.async_get(device_id)
            if device is None:
                continue
            devices.append(
                {
                    "deviceId": device.id,
                    "name": device.name_by_user or device.name or device.id,
                    "manufacturer": device.manufacturer,
                    "model": device_model(device.model, getattr(device, "model_id", None)),
                    "networkIdentifier": _zigbee2mqtt_identifier(device),
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

    def normalize_field(field: dict[str, Any]) -> dict[str, Any]:
        selector = field.get("selector") if isinstance(field.get("selector"), dict) else {}
        selector_type = next(iter(selector), None)
        raw_type = str(field.get("type", "string"))
        field_type = "text"
        if selector_type in {"boolean"} or raw_type == "boolean":
            field_type = "boolean"
        elif selector_type in {"number"} or raw_type in {"integer", "float"}:
            field_type = "number"
        elif selector_type in {"select"} or raw_type in {"select", "multi_select"}:
            config = selector.get("select") or {}
            field_type = "multi_select" if config.get("multiple") else "select"
        elif field.get("name") in {"password", "pin", "code", "access_token", "api_key"}:
            field_type = "password"
        options = []
        config = selector.get("select") if isinstance(selector.get("select"), dict) else {}
        raw_options = config.get("options", field.get("options", []))
        if isinstance(raw_options, dict):
            raw_options = [{"value": key, "label": value} for key, value in raw_options.items()]
        for option in raw_options if isinstance(raw_options, list) else []:
            if isinstance(option, dict):
                value = option.get("value")
                label = option.get("label", value)
            else:
                value = option
                label = option
            if isinstance(value, (str, int, float, bool)):
                options.append({"value": value, "label": str(label)})
        normalized = {
            "name": str(field.get("name", "value")),
            "label": str(field.get("name", "value")).replace("_", " ").title(),
            "type": field_type,
            "required": bool(field.get("required", False)),
            "options": options,
        }
        if "default" in field and field_type != "password":
            normalized["default"] = field["default"]
        return normalized

    def normalize_flow(result: dict[str, Any]) -> dict[str, Any]:
        flow_type = result.get("type")
        type_value = flow_type.value if isinstance(flow_type, FlowResultType) else str(flow_type)
        type_map = {
            "form": "form", "menu": "menu", "external": "external",
            "external_done": "progress", "progress": "progress",
            "progress_done": "progress", "create_entry": "complete", "abort": "error",
        }
        fields = []
        schema = result.get("data_schema")
        if schema is not None:
            try:
                fields = [
                    normalize_field(field)
                    for field in voluptuous_serialize.convert(schema, custom_serializer=cv.custom_serializer)
                ]
            except (TypeError, ValueError):
                _LOGGER.exception("Unable to serialize a Home Assistant discovery form")
        raw_menu = result.get("menu_options", [])
        menu_options = []
        for option in raw_menu if isinstance(raw_menu, list) else []:
            if isinstance(option, dict):
                value = str(option.get("value", ""))
                label = str(option.get("label", value))
            else:
                value = str(option)
                label = value.replace("_", " ").title()
            if value:
                menu_options.append({"value": value, "label": label})
        placeholders = result.get("description_placeholders") or {}
        description = result.get("description") or placeholders.get("description")
        return {
            "type": type_map.get(type_value, "error"),
            "stepId": result.get("step_id"),
            "title": result.get("title"),
            "description": str(description) if description else None,
            "fields": fields,
            "menuOptions": menu_options,
            "externalUrl": result.get("url"),
            "errors": {str(key): str(value) for key, value in (result.get("errors") or {}).items()},
        }

    def discovery_key(flow: dict[str, Any]) -> str:
        context = flow.get("context") or {}
        stable = context.get("unique_id") or context.get("discovery_key") or flow.get("flow_id")
        value = f"{flow.get('handler')}:{context.get('source')}:{stable}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    async def publish_discoveries() -> None:
        discoveries = []
        for flow in hass.config_entries.flow.async_progress():
            context = flow.get("context") or {}
            if context.get("source") in {SOURCE_USER, SOURCE_RECONFIGURE} or flow.get("handler") == "mqtt":
                continue
            try:
                current = await hass.config_entries.flow.async_configure(flow["flow_id"])
            except Exception:
                current = flow
            placeholders = (
                current.get("title_placeholders")
                or context.get("title_placeholders")
                or flow.get("title_placeholders")
                or {}
            )
            title = placeholders.get("name") or current.get("title") or str(flow.get("handler", "Appareil"))
            discoveries.append(
                {
                    "discoveryKey": discovery_key(flow),
                    "flowId": flow["flow_id"],
                    "handler": str(flow.get("handler", "unknown")),
                    "source": str(context.get("source", "discovery")),
                    "title": str(title),
                    "step": normalize_flow(current),
                }
            )
        client.publish(
            DISCOVERY_TOPIC,
            json.dumps(
                {
                    "schemaVersion": "1.0",
                    "homeId": home_id,
                    "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                    "full": True,
                    "discoveries": discoveries,
                },
                separators=(",", ":"),
            ),
            qos=1,
            retain=True,
        )

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

    async def execute_discovery_command(command: dict[str, Any]) -> None:
        command_id = str(command.get("commandId", "unknown"))
        flow_id = str(command.get("flowId", ""))
        action = str(command.get("action", "advance"))
        response: dict[str, Any] = {"commandId": command_id, "flowId": flow_id, "status": "rejected"}
        try:
            flow = hass.config_entries.flow.async_get(flow_id)
            if action == "ignore":
                context = flow.get("context") or {}
                unique_id = context.get("unique_id")
                if unique_id:
                    ignore_context = {"source": "ignore"}
                    if context.get("discovery_key"):
                        ignore_context["discovery_key"] = context["discovery_key"]
                    await hass.config_entries.flow.async_init(
                        flow["handler"],
                        context=ignore_context,
                        data={"unique_id": unique_id, "title": str(command.get("title", "Appareil"))},
                    )
                else:
                    hass.config_entries.flow.async_abort(flow_id)
                response["status"] = "ignored"
            else:
                user_input = command.get("userInput", {})
                if not isinstance(user_input, dict):
                    raise ValueError("userInput must be an object")
                result = await hass.config_entries.flow.async_configure(flow_id, user_input=user_input)
                response["status"] = "completed" if result["type"] is FlowResultType.CREATE_ENTRY else "advanced"
                response["step"] = normalize_flow(result)
                if result["type"] is FlowResultType.CREATE_ENTRY:
                    await publish_inventory()
            await publish_discoveries()
        except Exception as error:
            response["error"] = str(error)[:500]
        client.publish(
            f"{DISCOVERY_RESULT_TOPIC}/{command_id}",
            json.dumps(response, separators=(",", ":")),
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
            mqtt_client.subscribe(DISCOVERY_COMMAND_TOPIC, qos=1)
            mqtt_client.subscribe(INVENTORY_REQUEST_TOPIC, qos=1)
            mqtt_client.publish(
                STATUS_TOPIC,
                json.dumps({"status": "online", "version": "0.1.35"}),
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
        handler = execute_discovery_command if message.topic.startswith("elise/v1/discovery/commands/") else execute_command
        hass.loop.call_soon_threadsafe(hass.async_create_task, handler(command))

    client.on_connect = connected
    client.on_message = command_received
    client.will_set(STATUS_TOPIC, json.dumps({"status": "offline"}), qos=1, retain=True)
    client.connect_async(os.getenv("MQTT_HOST", "mosquitto"), int(os.getenv("MQTT_PORT", "1883")))
    client.loop_start()

    def smoke_test_state(entity_entry: Any, entity_id: str) -> Any:
        test_entity_id = None
        test_unique_id = smoke_test_unique_id(entity_entry.unique_id if entity_entry else None)
        if test_unique_id:
            test_entity_id = er.async_get(hass).async_get_entity_id("binary_sensor", "mqtt", test_unique_id)
        test_entity_id = test_entity_id or smoke_test_entity_id(entity_id)
        test_state = hass.states.get(test_entity_id) if test_entity_id else None
        return test_state.state if test_state is not None else None

    def smoke_state_for_test(entity_entry: Any, entity_id: str) -> tuple[Any, Any]:
        smoke_id = None
        unique_id = smoke_unique_id(entity_entry.unique_id if entity_entry else None)
        if unique_id:
            smoke_id = er.async_get(hass).async_get_entity_id("binary_sensor", "mqtt", unique_id)
        smoke_id = smoke_id or smoke_entity_id(entity_id)
        return smoke_id, hass.states.get(smoke_id) if smoke_id else None

    def publish_sensor_event(
        state: Any,
        entity_entry: Any,
        capability: str,
        occurred_at: str,
        event_id: str,
    ) -> None:
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
                "model": device_model(device.model, getattr(device, "model_id", None)) if device else None,
            },
            "capability": capability,
            "quality": "good" if state.state not in {"unknown", "unavailable"} else "degraded",
            "payload": _payload(capability, state),
        }
        if capability == "smoke":
            payload["payload"] = with_smoke_test(payload["payload"], smoke_test_state(entity_entry, state.entity_id))
        client.publish(EVENT_TOPIC, json.dumps(payload, separators=(",", ":")), qos=1)

    async def state_changed(event: Event) -> None:
        state = event.data.get("new_state")
        if state is None:
            return
        entity_entry = er.async_get(hass).async_get(state.entity_id)
        domain = state.entity_id.split(".", 1)[0]
        if not _is_equipment_candidate(domain, entity_entry.platform if entity_entry else None):
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
        # Availability is carried by ENTITY_STATE_TOPIC. It must not look like a normal
        # inactive/zero reading, which could clear a smoke, leak or door alert.
        if state.state in {"unknown", "unavailable"}:
            return
        if capability is None:
            # If real smoke starts while the detector is still in test mode, the smoke bit
            # remains on and Home Assistant emits no second smoke state change. When the test
            # bit clears, re-read its sibling after the shared MQTT state has settled and emit
            # the real smoke report if it stayed active.
            old_state = event.data.get("old_state")
            if domain == "binary_sensor" and old_state is not None and old_state.state == "on" and state.state == "off":
                await asyncio.sleep(SMOKE_PAIR_SETTLE_SECONDS)
                smoke_id, smoke_state = smoke_state_for_test(entity_entry, state.entity_id)
                if smoke_state is not None and smoke_remains_after_test(old_state.state, state.state, smoke_state.state):
                    smoke_entry = er.async_get(hass).async_get(smoke_id)
                    publish_sensor_event(
                        smoke_state,
                        smoke_entry,
                        "smoke",
                        occurred_at,
                        f"{event_id}-smoke-after-test",
                    )
            return
        if domain == "event":
            old_state = event.data.get("old_state")
            if not is_new_button_press(
                old_state.state if old_state is not None else None,
                state.state,
                datetime.now(UTC),
            ):
                return
        # The sibling smoke/test entities come from one Z2M state. Give Home Assistant a
        # short turn to update both before deciding whether this is a detector test.
        if capability == "smoke" and state.state == "on":
            await asyncio.sleep(SMOKE_PAIR_SETTLE_SECONDS)
        publish_sensor_event(state, entity_entry, capability, occurred_at, event_id)

    async def inventory_changed(_event: Event) -> None:
        await publish_inventory()
        await publish_discoveries()

    unsubscribe = hass.bus.async_listen(EVENT_STATE_CHANGED, state_changed)
    unsubscribe_started = hass.bus.async_listen_once(
        EVENT_HOMEASSISTANT_STARTED,
        inventory_changed,
    )
    unsubscribe_registry = hass.bus.async_listen(
        "entity_registry_updated",
        inventory_changed,
    )
    def flow_changed(_change_type: str, _flow_id: str) -> None:
        hass.async_create_task(publish_discoveries())

    unsubscribe_flows = hass.config_entries.flow.async_subscribe_flow(flow_changed)

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
        "unsubscribe_flows": unsubscribe_flows,
        "unsubscribe_stop": unsubscribe_stop,
    }
    return True
