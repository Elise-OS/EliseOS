# ADR 0001 — Ubuntu-based appliance

Status: accepted

## Decision

Use Ubuntu Server 24.04 LTS ARM64 as the V0 and appliance baseline for Raspberry Pi 4 and 5, with 4 GB RAM minimum and SSD storage recommended.

## Alternatives

Home Assistant OS simplifies its own lifecycle but constrains Michel to Supervisor apps. Raspberry Pi OS has a smaller footprint but diverges from the Ubuntu development and support target.

## Consequences

Michel owns container updates, backups, host hardening, first boot and rollback. In exchange, Home Assistant remains replaceable infrastructure inside an independent product.
