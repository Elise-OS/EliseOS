# ADR 0004 — Isolated local camera media plane

Status: accepted

Date: 2026-08-16

## Context

Michel OS originally excluded cameras and microphones. A family may nevertheless need an optional,
explicitly consented visual verification channel after an alert. Camera media is substantially more
sensitive than normalized sensor facts and must not become an input to behavioural learning.

## Decision

- Camera inventory and bounded person-presence facts continue to enter through Home Assistant.
- RTSP credentials are encrypted in PostgreSQL and are decrypted only by Michel Core when it
  configures the private go2rtc service.
- Video and audio use a separate local media plane. They never enter observation payloads, AI
  features, push messages, logs or normal backups.
- Live access requires an authenticated OWNER, ADMINISTRATOR or CAREGIVER membership and a signed,
  five-minute ticket. Every media request also revalidates consent, capability and privacy state.
- A CAREGIVER may activate privacy mode but only an OWNER or ADMINISTRATOR may reactivate a camera.
- Alert snapshots are optional, limited to the alert room, served with `no-store`, and deleted after
  24 hours.
- Push-to-talk is enabled only for a camera model and firmware combination validated locally. Michel
  does not fall back to a vendor cloud.
- A missing or negative camera event never establishes absence and never reduces the required
  non-camera sensor coverage.

## Consequences

Camera support remains optional and manufacturer-neutral, but it adds a private relay, WebRTC port,
credential lifecycle and hardware validation burden. App privacy cannot guarantee that vendor
firmware or a camera SD card has stopped recording; hardware privacy controls and blocked internet
access are preferred. The first pilot must validate revocation, direct video, talk, alert snapshots,
retention and failure behaviour before cameras are recommended for a household.
