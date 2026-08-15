---
id: pat.reader-migration
kind: runbook
version: 1.0.0
strictness: guided
audience: ai-engineering-agent
exemplars:
  - src/main/mcp/modules/fleet/find-sites-with-plugin.ts   # canonical, with drift hints
  - src/main/mcp/modules/fleet/find-sites-with-theme.ts     # same template, second instance
  - src/main/mcp/modules/fleet/find-outdated-sites.ts       # report-shaped variant (overlay + gap-fill)
  - src/main/mcp/modules/fleet/compare-sites.ts             # two-sided variant (per-side ages + skew warning; from WP-02)
  - src/main/mcp/modules/fleet/__tests__/findSitesWithPlugin.test.ts  # test fixture pattern
checkpoints:
  - id: cp.read-exemplar
  - id: cp.entity-join
  - id: cp.enrich
  - id: cp.drift-hint
  - id: cp.output
  - id: cp.test
aborts:
  - id: ab.no-legacy-parity
    on: any existing behavior of the tool changing (output fields lost, matching semantics narrowed)
    do: stop; enrichment is additive — if you cannot add without subtracting, escalate in the packet thread.
---

# Pattern: migrate a fleet reader to twin-backed enrichment

Turn a cache-reading MCP tool into one that ALSO answers from the intelligence
ledger — with observation age, trust class, staleness flags, and drift hints —
while every legacy behavior keeps working identically when the core is absent.

## cp.read-exemplar

Read `find-sites-with-plugin.ts` end to end before writing anything. Your
migration should diff against its file the way that file diffs against its own
pre-migration version (git history on `poc/nexintelligence` shows it). If your
change looks structurally different from the exemplar, justify why in a comment.

## cp.entity-join

Capture a provisional entity id on every match/record the tool builds:
`provisionalEnvironmentId(siteId)` for local entries (IndexRegistry `siteId`),
and add `s.id as site_id` to graph queries so remote rows get
`provisionalEnvironmentId(row.site_id)`. Tools that resolve targets through
`resolveAnySite` get the correct id for free (`resolved.id` is the local store
id for local sites and graph `sites.id` for remote) — use it directly. Never
derive from display names. **Beware: a wrong id source fails silently** — the
twin join returns nothing and enrichment vanishes with no error — so your test
must assert enrichment actually renders (cp.test item 1 exists for this
reason).

## cp.enrich

Get the core via `getIntelligenceCore()` — it may be undefined; the whole
enrichment block lives in a `try { if (core) { ... } } catch {}` so the legacy
path stands alone. Join twin facts (`core.twins.search('<prefix>:')` or
`core.twins.get(entityId, fact)`) to your matches by entity id; attach
`observedAt`, `sourceTrust`, and freshness. `core.twins.freshness(fact)`
returns `{ ageSeconds, sloSeconds, fresh }` — use `sloSeconds` for any
age-comparison logic (skew warnings, thresholds); never hardcode SLO values
in a tool.

Two sharp edges from calibration: **(1)** `ledger.query()` returns
OLDEST-first by default and truncates at `limit` — for any "recent events"
reader pass `order: 'desc'`, and disclose the cap in output rather than
presenting a truncated result as complete (an asc query at its limit silently
drops the newest events). **(2)** Under this repo's tsconfig, a `let`
accumulator (e.g. a running `stalest`) reassigned inside a nested helper
closure narrows to `never` at later read sites — keep the observation loop
inline in the same scope as the accumulator's declaration (build a flat list
first if you have multiple source loops).

## cp.drift-hint

*The universal rule is: name the tool's real ledger-vs-cache disagreement.*
For discovery tools (find-sites-with-*), that disagreement is the twin-only
population, handled below. Tools handed explicit targets (compare_sites and
kin) have no twin-only population — do NOT force an unreachable branch, but
do not skip the checkpoint either: identify what the meaningful disagreement
IS for that tool (for a two-sided comparison it's observation-age skew between
the sides — see compare-sites.ts) and surface that, with a code comment
explaining the substitution.

Three known variants of that disagreement (add yours here if you find a
fourth): **per-fact** — twin facts with no corresponding cache result, for
discovery tools (find-sites-with-*); **per-dimension skew** — observation-age
gaps between compared sides (compare-sites); **population-level** — once per
run, environments the ledger has observed that the tool's own population
never counted (fleet-summary; the "Fleet counts" CLAUDE.md section explains
why the populations legitimately differ).

For all variants: never silently merge; report the disagreement. Skip facts
whose value has `active: false` / `removed: true` when hinting. And keep two
different absences distinct: "the ledger never observed this fact" is a
*pipeline coverage gap*; "observed but unchanged while the cache moved" is
*stable divergence* — merging them hides the coverage gap (see
detect-drift's three-way classification).

## cp.output

Three output shapes, by tool kind:

- **Table tools** (row per site): replace the last column with `Observed` —
  `"{age} ({trust})"` plus `" ⚠ stale"` when past SLO, falling back to the
  legacy value (`indexed {date}`) when un-enriched.
- **Report tools** (aggregated): a `> Observations:` header line (N of M
  ledger-observed, K stale, stalest named).
- **Two-sided tools** (comparisons): a per-side observation-ages section, with
  a **skew warning** when the sides' ages differ by more than the underlying
  fact's `sloSeconds` — name the older side and note that reported differences
  may be data age rather than real drift (see compare-sites.ts). Multi-fact
  dimensions report their stalest observation: a comparison is only as
  trustworthy as its oldest input.

Always add the freshness summary. When stale > 0: table and two-sided tools
include the exact phrase "consider a live re-check" — `verify_site_live` is
the remedy, and those tools name checkable targets. Fleet-wide aggregates may
instead mark stale data "provisional" (a live re-check is a per-target
action; an aggregate has no single target to name) — find-outdated-sites and
fleet-summary are the exemplars of that variant. *(Rule reconciled with the
exemplars per WP-01 finding 1.)*

## cp.test

Tests live under the module's `__tests__/` — one file per tool, or a shared
file covering related migrations (`overnightMigrations.test.ts` covers two;
either is acceptable, but every migrated tool must be covered somewhere).
Follow `findSitesWithPlugin.test.ts`: real `initIntelligenceCore` on a temp
dir + `setIntelligenceCore`, an in-memory graph fixture, `runGraphBackfill`
to seed twins, ~700ms waits for the debounced fold, partial services mock
cast `as never`.

Assert: (1) the enrichment renders (regex on age/trust), (2) the freshness
summary, (3) a drift-hint scenario where applicable (delete a cache row the
ledger knows), (4) **the additive-parity pin** — run the tool once BEFORE
registering the core to capture the baseline output, register the core, run
again, and assert the legacy content is intact. Two techniques by enrichment
shape: appended enrichment (footer sections) → `enriched.startsWith(baseline)`;
header/mid-document enrichment (`> Observations:` lines spliced between legacy
lines) → strip the enrichment's own added lines back out (they carry the `> `
prefix) and assert the remainder EQUALS the baseline — `startsWith`/`toContain`
both fail on mid-document splices. This turns the pattern's own abort
condition into a failing test instead of a judgment call.

If you mutation-test your assertions: **commit before mutating** — a
`git checkout <file>` restore reverts to HEAD, not your working state, and
will silently destroy uncommitted work — and verify each mutation actually
changed the file (checksum before/after), so a non-applying substitution
reports itself instead of masquerading as a caught mutation.

Run `npm test` green (jest's roots cover `src` since WP-05 — no flag needed;
`npx jest src/` narrows to this subsystem), plus any legacy suites covering
your tool (`grep -rl <tool-basename> tests/`).
