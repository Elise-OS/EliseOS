# ADR 0003 — Separate AI, Core decision authority

Status: accepted

## Decision

Run Élise AI as a local Python/FastAPI service using explainable Isolation Forest scoring. Élise Core owns facts and alerts; a worker supplies features through a versioned API and applies confidence, persistence, coverage and rule gates.

## Alternatives

Rules alone are reliable but do not learn routines. A TypeScript ML runtime reduces languages but weakens the scientific toolchain. An AI-owned event stream would couple models to devices and permit unsafe decisions.

## Consequences

The service can evolve independently and use established ARM64 scientific packages. Its model artifact volume joins the backup set, while the database remains the source of truth.
