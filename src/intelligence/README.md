# Intelligence core (step 1)

The satellite's spine, per the architecture doc's migration sequence §10 and ADRs 1/6/11/14/16:
**local ledger + event envelopes + emission middleware + twins as folds.**

## What's here

```
envelope/   the enforcement fabric as types + validation (nine sources, nine trust
            classes, observed_at ≠ recorded_at, access block reserved per ADR-11)
ledger/     append-only SQLite spine (better-sqlite3, WAL, idempotent by ULID id)
emit/       emission middleware — producers hand over drafts; id/recorded_at/
            actor.via are filled here, so the loop's write side is structural
folds/      cursor-driven fold runner + the first fold (plugin observations →
            twin_facts) + TwinStore with computed freshness against SLOs
host/       the extraction seam (ADR-16): ClockPort, IdentityPort, StoragePort —
            everything the core needs from the addon, and the ONLY way it gets it
```

## The seam rules (ADR-16)

This directory must never import `electron`, `@getflywheel/*`, `react`, or anything
under `src/main` / `src/renderer`. The nested `.eslintrc.json` here enforces that
with `no-restricted-imports` — a violation is a lint **error**, not a convention.
Host access goes through `host/ports.ts`. Hold this line and extracting the core
to a standalone daemon later is packaging, not rewriting.

## Wiring it into the addon (the step-1 integration)

1. Implement `HostPorts` in `src/main` (real storage path under Local's data dir,
   session identity per ADR-14: `actor` = configured user/agent, `via` = machine id).
2. Point the **event_queue** (WP Connector real-time events) at `Emitter.emit` —
   the first producer; today that data is captured and dropped.
3. Wrap the CAPI-sync and WP-CLI-scan write paths: instead of writing
   `SiteMetadataCache` directly, emit `state.*.observed` envelopes and run the
   folds. The caches become views — that inversion IS the migration.
4. Schedule `catchUp(ledger, pluginTwinFold)` after observer runs (or on an
   interval); wire `onDrift` to emit `state.drift.detected`.

## Invariants the tests pin

- Append is idempotent by event id (at-least-once delivery is safe).
- An older `observed_at` never overwrites a newer twin fact (arrival order is
  irrelevant; observation time is truth).
- Every twin fact carries a provenance pointer (`event_id`) and a trust class.
- Freshness is computed from `observed_at` against per-fact SLOs — "synced-at
  is not changed-at" is structurally unexpressible here.
- Envelopes without provenance/access do not enter the ledger (zod gate).

## What step 1 is NOT

No gateway, no assembler, no entity resolver, no sync — those are steps 3–6.
This package only makes the spine exist and the data stop disappearing.

Run the smoke test: `npx jest src/intelligence/__tests__/step1.test.ts`
