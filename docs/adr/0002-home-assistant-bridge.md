# ADR 0002 — Home Assistant bridge

Status: accepted

## Decision

Install a Michel Bridge custom integration that reads the supported Home Assistant event bus and publishes privacy-minimised capability events over authenticated MQTT QoS 1.

## Alternatives

Direct Zigbee2MQTT consumption duplicates device semantics. User-managed Home Assistant OAuth is supported but exposes an internal product and prevents zero-touch onboarding. Editing Home Assistant storage is rejected as unsupported and fragile.

## Consequences

Michel remains independent of manufacturer payloads. The bridge becomes a compatibility surface that must be regression-tested every month.
