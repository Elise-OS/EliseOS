# Contributing to Élise OS

Thank you for helping build respectful, local-first technology for families and caregivers.

## Principles

- Never introduce a camera, microphone, remote dependency, or secondary use of personal data without an accepted architecture decision record.
- Never present an estimate as certainty. A degraded sensor state must be visible to the family.
- Keep Home Assistant as the home automation engine and Élise Core as the sole business decision authority.
- Keep pull requests focused and use Conventional Commits.

## Workflow

1. Open or reference an issue describing the user outcome.
2. Add an ADR under `docs/adr` before a structural, privacy, security, or compatibility change.
3. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
4. For Home Assistant bridge changes, test the pinned release and the previous monthly release.

All contributions are accepted under AGPL-3.0-only.
