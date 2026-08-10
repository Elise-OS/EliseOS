# Michel OS

Michel OS is a local-first, open-source home reassurance platform for families and caregivers. It learns routines from non-invasive sensors and highlights unusual situations without cameras or microphones. The project is dedicated to Michel.

> Michel OS is a wellbeing product. It is not a medical device, an emergency service, or a substitute for professional care.

## V0 vertical slice

This repository contains the first end-to-end product slice:

- Home Assistant as the universal compatibility layer, with Zigbee2MQTT as one optional radio engine;
- a capability-based Home Assistant bridge over authenticated MQTT;
- Michel Core, PostgreSQL, transactional outbox and alert lifecycle;
- a separate local Isolation Forest service with a guarded 14-day learning period;
- a responsive French/English family dashboard and a React Native/Expo app with local discovery and push notifications;
- automatic secrets, retention, encrypted backup support and CI checks;
- multi-stage ARM64/AMD64 containers ready for the future Raspberry Pi image pipeline.

The flashable appliance image, Wi-Fi captive onboarding and signed OTA channel are later release milestones; they are intentionally not represented as complete in V0.

Any sensor made available to Home Assistant can appear in Élise. Recognized device classes work automatically; unknown entities remain visible to administrators and can be assigned a safe, bounded capability mapping without adding model-specific code.

## Quick start

Requirements: Docker Engine 23+ with Docker Compose. The full contributor toolchain uses Node.js 22–24, pnpm 11 and Python 3.12.

```bash
cp .env.example .env
docker compose up -d
```

On Raspberry Pi, set `ZIGBEE_ADAPTER` to the coordinator's stable `/dev/serial/by-id/...` path and `ZIGBEE_ADAPTER_TYPE` to its Zigbee2MQTT driver (`zstack`, `ember`, `deconz`, or `zigate`) before the first full start. For development without Zigbee hardware, start the core slice:

```bash
docker compose up -d bootstrap postgres mosquitto ai api worker dashboard
```

Open `http://localhost:8080`. On a fresh installation, Michel displays a local three-step
assistant that creates the first administrator account. The setup endpoint is only reachable from
the local network.

Set `MICHEL_DEMO_MODE=true` only when you explicitly need the V0 demonstration account
(`paul@michel.local` / `Michel-Demo-2026!`). PostgreSQL, MQTT, AI and session secrets are generated
into a private Docker volume on first start; no generated secret is committed.

On Raspberry Pi, enable local mobile discovery with the appliance overlay:

```bash
docker compose -f compose.yaml -f compose.raspberry.yaml up -d
```

The Raspberry advertises `_michel._tcp.local` and the Michel mobile app verifies the discovered
server through `/api/v1/discovery` before connecting.

## Contributor workflow

```bash
pnpm install
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Mac development, NAS test deployment

Docker is not required on a contributor Mac. Edit the repository locally, then use the
NAS through Tailscale for the build and browser test:

```bash
cp config/nas-deploy.env.example config/nas-deploy.env
pnpm deploy:nas
```

The NAS connection is configured through the `michel-nas` SSH alias and an SSH key. The
deployment synchronises uncommitted source changes, but deliberately preserves the NAS `.env`,
Docker volumes, secrets, backups and any Git metadata. It rebuilds only `ai`, `api`, `worker`
and `dashboard`; PostgreSQL, Mosquitto, Home Assistant and Zigbee2MQTT are not restarted.

Preview a transfer without changing the NAS:

```bash
pnpm deploy:nas --dry-run
```

For a visual-only Dashboard change, use the fast path. It rebuilds and restarts only the
Dashboard; use the default command for API, Worker, AI, database-model or shared-contract changes.

```bash
pnpm deploy:nas --dashboard
```

The Docker dependency layer is cached on the NAS. Source edits therefore do not reinstall the
workspace dependencies; changing a lockfile or a package manifest intentionally refreshes that cache.

Open the URL configured as `MICHEL_NAS_URL` after a successful deployment.

Useful references:

- [Architecture and safety invariants](docs/architecture.md)
- [Development, secrets and backups](docs/development.md)
- [Privacy and retention](docs/privacy.md)
- [Architecture decisions](docs/adr)

Michel OS is licensed under `AGPL-3.0-only`.
