# Michel OS

Michel OS is a local-first, open-source home reassurance platform for families and caregivers. It learns routines from non-invasive sensors and highlights unusual situations. Optional cameras can add local person detection, live verification and push-to-talk after explicit consent; media never enters the behavioural observation pipeline. The project is dedicated to Michel.

> Michel OS is a wellbeing product. It is not a medical device, an emergency service, or a substitute for professional care.

## V0 vertical slice

This repository contains the first end-to-end product slice:

- Home Assistant as the universal compatibility layer, with Zigbee2MQTT as one optional radio engine;
- a capability-based Home Assistant bridge over authenticated MQTT;
- Michel Core, PostgreSQL, transactional outbox and alert lifecycle;
- a separate local Isolation Forest service with a guarded 14-day learning period;
- a responsive French/English family dashboard and a React Native/Expo app with local discovery and push notifications;
- optional local RTSP/ONVIF cameras through go2rtc, with encrypted credentials, WebRTC viewing, privacy mode and 24-hour alert snapshots;
- automatic secrets, retention, encrypted backup support and CI checks;
- images conteneur ARM64/AMD64, image Raspberry Pi 4/5 et installateur Ubuntu 24.04 ;
- accès distant privé Tailscale sur un port dédié, sans publication Internet.

Chaque version publie l’image flashable, ses sommes et signatures, le catalogue Raspberry Pi Imager, l’installateur et un manifeste de conteneurs épinglés par digest.

Any sensor made available to Home Assistant can appear in Élise. Recognized device classes work automatically; unknown entities remain visible to administrators and can be assigned a safe, bounded capability mapping without adding model-specific code. Camera person events use the same universal mapping. Live video requires a local RTSP stream, while two-way audio remains a model-level validated capability.

## Installation complète

Sur Ubuntu Server 24.04, une seule commande installe Docker et tous les composants Élise, y compris l’affichage TV, Chromium, Jitsi et les permissions caméra/micro :

```bash
curl -fsSL https://github.com/Elise-OS/EliseOS/releases/latest/download/install-elise.sh | sudo bash
```

Depuis une copie locale du dépôt, utilisez `bash scripts/install-complete.sh`. L’image Raspberry Pi 4/5 lance ce même parcours au premier démarrage. Si Tailscale attend encore son association, le paquet TV se termine automatiquement dès que celle-ci est effectuée.

## Démarrage pour le développement

Requirements: Docker Engine 23+ with Docker Compose. The full contributor toolchain uses Node.js 22–24, pnpm 11 and Python 3.12.

```bash
cp .env.example .env
docker compose up -d
```

On Raspberry Pi and Linux NAS installations, `scripts/detect-zigbee-adapter.sh --write-env .env` detects the coordinator through its stable `/dev/serial/by-id/...` path and selects the matching Zigbee2MQTT driver. Known zStack, EmberZNet, deCONZ, ZiGate and ZBOSS families are classified explicitly; unknown single adapters use Zigbee2MQTT's native probing. Set `ZIGBEE_ADAPTER_MODE=manual` only for a remote or unusual coordinator. For development without Zigbee hardware, start the core slice:

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

To work only on the Dashboard from the Mac while keeping every backend service on the NAS:

```bash
bash scripts/dev-dashboard.sh
```

The local Vite server opens on `http://127.0.0.1:5173` and proxies `/api` to the NAS URL
configured in `config/nas-deploy.env`.

Useful references:

- [Installation Raspberry Pi et Ubuntu](docs/installation.md)
- [Accès à distance privé](docs/acces-distant-prive.md)
- [NAS deployment and clean reset (French)](README-NAS.md)
- [Architecture and safety invariants](docs/architecture.md)
- [Development, secrets and backups](docs/development.md)
- [Privacy and retention](docs/privacy.md)
- [Camera setup, security and compatibility](docs/cameras.md)
- [Architecture decisions](docs/adr)

Michel OS is licensed under `AGPL-3.0-only`.
