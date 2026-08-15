---
id: pat.add-a-producer
kind: runbook
version: 1.0.0
strictness: strict            # producers write the ledger; the invariants are not adaptable
audience: ai-engineering-agent
exemplars:
  - src/main/intelligence-host/wpEventProducer.ts      # event-driven producer (webhooks)
  - src/main/intelligence-host/graphServiceTap.ts      # wrap-a-chokepoint producer
  - src/main/intelligence-host/graphBackfill.ts        # one-shot seeding producer
  - src/main/mcp/modules/fleet/verify-site-live.ts     # on-demand producer (live re-check)
checkpoints:
  - id: cp.pick-shape
  - id: cp.observed-at
  - id: cp.envelope
  - id: cp.dedup
  - id: cp.entity
  - id: cp.nonfatal
  - id: cp.fold
  - id: cp.test
aborts:
  - id: ab.new-topic-namespace
    on: needing a topic outside the existing taxonomy (architecture.md §4.2)
    do: stop and propose the topic in the packet thread — taxonomy additions are an owner decision.
  - id: ab.fabricated-time
    on: the source offering no usable observation timestamp for historical data
    do: do NOT stamp "now" on old facts; escalate — laundering staleness is the one unforgivable producer bug.
---

# Pattern: add an observation producer

Feed a new source of facts into the ledger, correctly stamped, deduped, and
non-fatal.

## cp.pick-shape

Four producer shapes exist — copy the matching exemplar: event-driven (a hook
fires per change), chokepoint tap (wrap an existing write path, additive, no
edits to the wrapped module), one-shot backfill (seed from an existing store,
marker-guarded), on-demand (a tool call observes live). If none fits, escalate.

## cp.observed-at

`observed_at` = when the fact was true at its source: the event's own time for
webhooks, the row's `updated_at` for store-derived data (`rowTimeToIso`
handles s/ms), "now" ONLY for genuinely live observation. `recorded_at` is
filled by the emitter — never set it yourself.

## cp.envelope

Emit through `core.emitter.emit()` with an `EventDraft` — never construct ids,
never touch the ledger directly. `source.class` + `source.trust` from the
nine-source taxonomy (`envelope/types.ts`); `source.system` names the concrete
path specifically (`'graph-sync:wpe'`, `'live-recheck:local'`) — provenance
queries group by it. Reuse existing payload schemas (`plugin.observed/1` etc.)
when the shape matches; version-bump, don't mutate, when it doesn't.

## cp.dedup

Recurring producers (taps, syncs) go through `createChangeGate(core)` — emit
change, not repetition. Backfills use the gate too. On-demand live checks are
the exception: they emit unconditionally, because re-stamping freshness IS
their job.

## cp.entity

Entity refs via `provisionalEnvironmentId` / `provisionalSiteId` from the
stable platform identifier (Local site id, graph row id) — never from display
names. If your source has a genuinely new kind of identifier, that's an
entity-service question: escalate rather than inventing a namespace.

## cp.nonfatal

The producer wraps its body in try/catch and logs through the provided logger.
A producer failure must never break the flow it observes. If wrapping a method
(tap shape), the original is always called and its result always returned.

## cp.fold

Call `core.scheduleFolds()` after emitting. If your payloads introduce a new
fact shape, extend `stateTwinFold.ts`'s EXTRACTORS (unknown topics must remain
skipped-not-guessed) and pin the new mapping in `step1`-style tests.

## cp.test

Follow `graphServiceTap.test.ts` / `graphBackfill.test.ts`: real core on temp
dir, fixture source, assert (1) emission count and topics, (2) dedup on repeat,
(3) `observed_at` provenance (an aged fixture stays aged), (4) twin fold
result, (5) the non-fatal path (a throwing source doesn't propagate).
