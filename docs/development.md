# Development guide

## Local toolchain

- Node.js 24 LTS for official builds; Node.js 22 remains accepted for contributors during the transition.
- pnpm 11 and Turborepo.
- Python 3.12 with an isolated virtual environment for Michel AI.
- Docker Engine 23+ and Docker Compose.

Run `pnpm install`, `pnpm db:generate`, then `pnpm build`. The complete local appliance starts with `docker compose up -d`. Set `ZIGBEE_ADAPTER` to the stable `/dev/serial/by-id/...` path of the coordinator on Linux. Without a coordinator, Zigbee2MQTT remains an infrastructure-only development service.

The default V0 starts without demo data and opens the first-administrator assistant. Set
`MICHEL_DEMO_MODE=true` to explicitly load the demonstration account
`paul@michel.local` / `Michel-Demo-2026!`. Demo credentials must never be enabled in an appliance
release.

Use `docker compose -f compose.yaml -f compose.maintenance.yaml up -d` only for diagnostics. Maintenance ports bind to loopback.

## Profiles and secrets

The bootstrap container generates random PostgreSQL, MQTT, AI and session secrets in a private
Docker volume. Runtime containers receive this volume read-only. Repository files never contain
generated credentials.

## Raspberry and mobile discovery

Start the Raspberry deployment with `compose.raspberry.yaml`. Its host-networked mDNS publisher
announces `_michel._tcp` on port 8080. The mobile app uses mDNS first, then `michel.local`, a scan of
port 8080 on the current subnet and finally a manually entered address. mDNS requires an Expo
development build; it is not available in Expo Go.

Webhook delivery is optional. Configure `WEBHOOK_URL` and `WEBHOOK_SECRET`; payloads carry a delivery identifier and an `x-michel-signature: sha256=...` header.

## Backups

`scripts/backup.sh` creates an encrypted PostgreSQL custom-format backup and refuses plaintext by default. Set `MICHEL_BACKUP_RECIPIENT` to an age public recipient. A local-only plaintext backup requires the explicit `MICHEL_BACKUP_ALLOW_PLAINTEXT=true` override. Restore into an isolated test instance before relying on a backup policy.
