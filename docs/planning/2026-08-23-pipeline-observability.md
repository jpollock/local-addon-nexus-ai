# Pipeline observability inside the intelligence spine

**Owner ruling (2026-08-23):** pipeline observability lives in the intelligence
ledger, not a standalone table. This plan is the keystone of the five-point
data-pipeline arc agreed the same morning; phases 2–4 build on it.

## The problem, measured

The pipeline currently works — L2 fresh <24h: 45/45 local, 365/365 WPE, 3/3
external; L3 indexed <24h: 41/45 local, 282 WPE — but proving that required
ad-hoc Python over four stores (graph.db, SiteMetadataCache,
IndexRegistry, rotated lightning logs). Failure reasons live only in logs that
rotate within a day; success *rates* are not computable at all. Every incident
this week (WP-67's fabricated successes, D10, D14's connection exhaustion) was
diagnosed by forensics that this plan makes unnecessary.

## Shape

One observation per pipeline run — site × layer × trigger, with outcome,
reason, duration — emitted as a ledger event and folded into a twin fact per
site × layer. History (rates, reasons over time) comes from the ledger; current
status comes from the fold. Nothing new is authoritative: both are rebuildable
views over events, per the spine's own rules.

### Taxonomy — no addition needed

`task.run.completed` is already enumerated in architecture.md §4.2 and has no
producer. A pipeline run is precisely a completed run of system work. Payload
schema `pipeline.run/1`:

```jsonc
{
  "layer": "l1" | "l2" | "l3",
  "site_kind": "local" | "wpe" | "external",
  "outcome": "ok" | "skip" | "fail",     // WP-67's three states, exactly
  "trigger": "scheduled" | "adhoc" | "lifecycle" | "startup",
  "duration_ms": 42000,
  "reason": "…"                           // present iff outcome != ok
}
```

- `observed_at` = when the run **finished** (the moment the outcome was true).
- **No change gate**, with `syncProducer`'s justification verbatim: an episodic
  occurrence folds into no current-value comparison; two identical runs are two
  runs, and success *rates* are the entire point.
- Entity: local sites via `environmentEntityId` (`local.site_id`); graph rows
  (wpe/external) via `ensure('env','graph.site_row', rowId)` — the namespace
  `siteLinkMirror` already aliases, so ids are adopted, never minted anew
  (ADR-21). Provisional fallback derives from the same pair.
- Non-fatal by construction; emission happens AFTER the outcome is decided —
  the recorder records, it never blocks the run (WP-19's audit-ordering rule).

### Fold

`pipelineStatusFold` — topicPrefix `task.run.`, consumes only
`schema === 'pipeline.run/1'` (unknown schemas skipped-not-guessed, same as
`stateTwinFold`). Writes `twin_facts` fact `pipeline:<layer>` keyed by the
site's env entity: latest outcome, reason, trigger, duration, finished-at.
`PRIMARY KEY (entity_id, fact)` gives current-status-per-site×layer for free.
Registered in `bootstrap.ts`'s folds array, so WP-17's health surface monitors
its lag from day one.

### Producer

`src/main/intelligence-host/pipelineRunProducer.ts` — one exported
`recordPipelineRun(observation)`; resolves the core via `coreRegistry`
(absent core = silent no-op), resolves the entity, emits, `scheduleFolds()`.
All chokepoint call sites call this one function.

### Instrumentation points (the WP-68 dividend: most layers now have ONE)

| layer | chokepoint | trigger source |
|---|---|---|
| WPE L3 | `indexOneWpeContent` — all three scopes end here | param threaded from callers |
| WPE L2 | `syncInstall` — fleet + single end here | param from `syncAllWPESites`/`syncSingleSite` |
| local L3 | `ContentPipeline.indexSite`/`reindexSite` | optional field on `SiteConnectionInfo` |
| local L2 | `executeGraphSync` AND `lifecycle-hooks siteStarted` — the known duplication; both instrumented now, unified in phase 3 | adhoc / lifecycle |
| external L3 | `ExternalContentIndexService.indexOne` | param |
| external L2 | callers each do collect+write with no shared seam — same disease WP-68 cured; extract `refreshExternalSite()` as the chokepoint, then instrument it | param |
| L1 (both) | **phase 2** — cheap, rarely fails, lowest value first | — |

### Read surface

- `pipelineStatus.ts` (intelligence-host): pure query over core + supplied
  site lists → per source × layer: sites total, ok/skip/fail latest, fresh
  <24h, failure reasons ranked from ledger history (last N days).
- GraphQL `nexusPipelineStatus` → CLI **`nexus pipeline status`** (the table I
  hand-built this morning, always available). MCP tool in phase 2.

## Phases

1. **THIS PACKET:** schema + fold (+tests) → producer (+tests) → instrument
   the six chokepoints (+tests) → read surface + CLI → mutation battery →
   full suite → live verification (run one index per source, see the event,
   the fact, and the CLI row).
2. L1 instrumentation; MCP tool; e2e harness 1→10→50→all sites per source
   asserting **ledger** outcomes, re-run failures twice for reproducibility.
3. Unify local L2 (`lifecycle-hooks` vs `executeGraphSync`) — WP-68's move one
   layer up; the ledger from phase 1 is the before/after instrument.
4. Tune from data: timeouts, local start-ahead batching (owner's start-all
   proposal vs start-ahead N, decided by measured start/stop overhead), external
   L2+L3 chaining per alias.

## Invariants inherited (violating any is a defect even if tests pass)

Emitter-only writes; real `observed_at` (run finish, never "now" for a backfill
— there is no backfill here, deliberately: history starts at ship); seam law
(nothing in `src/intelligence/` imports main/renderer — the fold is pure, the
producer lives host-side); non-fatal everywhere; tests beside code for
`src/intelligence/`, `tests/unit/` for host-side.

## Failure modes this must not introduce

- A recorder throw failing a run (non-fatal wrapper + test).
- Emission before outcome (record after, like the audit chokepoints).
- Double-emission for one run (WPE L3: `indexAllWpeContent` loops
  `indexOneWpeContent` — instrument the inner only; test pins one event per run).
- Trigger defaulting silently to a wrong value — absent trigger is `'adhoc'`
  only at genuinely ad-hoc entries; schedulers must pass `'scheduled'`
  explicitly, pinned per caller.
