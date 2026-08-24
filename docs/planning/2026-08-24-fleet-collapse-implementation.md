# Fleet collapse — implementation plan

**Written:** 2026-08-24, on `poc/nexintelligence-data`
**Design record:** the ratified three-screen contract — the designer's sheets
(sites-and-places handoff), the counter-fixture mock
(`docs/intelligence/mock-sites-collapse.html`, one review round complete,
ten points converged), ADRs 21–23, and `docs/intelligence/sites-ia-readiness.md`.
**Defect register:** `docs/planning/2026-08-21-fleet-tool-defects.md` (D1–D25).

## What this builds

Three screens, one unit: the **property** (a web property that exists in one
or more places), its **places** (environments and working copies), and one
**place** read at a distance. The ratified contract, in one paragraph:

Row = property; ~74% of real rows are a single place and render flat, no
caret. "Where" partitions on origin with summing counts; state filters
compose. Search never hides a hit. Four knowledge rungs with `nothing`
leading the header; **ceiling** ("cannot go deeper — no SSH gateway") is a
fact distinct from a rung. A failed check keeps its data, shows its age and
the transport's own reason. Multi-place roll-ups are labelled sets
(`oldest 12h`), never averages. Lineage renders where a recorded link exists
and states its absence with a reason everywhere else — absence is the common
case (20 copy links, 2 content-pull links, ~296 properties). Name collisions
stay separate rows. The place screen offers procedures named with their
runbook and grant, barred ones visible with the reason. Per-place history is
honest; property-level history is assembled from places, never read from the
Site entity graph.

## Phase 0 — rulings and substrate hygiene

Settled during the 2026-08-24 exploration; recorded here as the plan's
ground. Veto any of these before Phase 1 starts, not after.

**0.1 · The screens are served from env-keyed sources plus graph.db grouping —
the Site entity table is not a dependency.** The entity layer's Site family is
split (D20: 692 Site entities for ~296 real properties; 93.8% of episodic
events hang off entities with zero environment links) and nothing in the
three screens needs it: grouping comes from `sites.wpe_site_id` (365/365
coverage), names from `wpe_sites` (D21, fixed and live-verified 270/270),
everything execution-shaped keys on env entities, which are healthy and
converged. The Site table is touched for exactly one thing: the lineage links
(`has_working_copy`, `content_pulled_from`), which live on the healthy mirror
family.

**0.2 · Fix D20 — stop the phantom minting. No ledger migration.**
`graphServiceTap.ts` (:60, :92, :125) and `graphBackfill.ts` (:109, :144,
:178) pass graph row ids into `siteEntityId`/`environmentEntityId`, minting
Sites under `local.site_id.logical` and polluting the `local.site_id`
namespace with `wpe-…` values. Fix: resolve the row's env entity via the
mirror's `graph.site_row` alias, then `EntityService.siteOf(envId)` for the
site stamp; when `siteOf` returns nothing, **omit the stamp rather than
mint** — a wrong identity is worse than an absent one. `wpEventProducer` is
innocent (real Local ids) and unchanged. Old events keep their stamps
(append-only invariant); `chatAssembly`'s documented workaround keeps old
history reachable; the 418 phantom rows stay as inert history. Tests: a graph
row with a mirrored env gets the mirror's Site id; an unmirrored row gets no
site stamp; a local row is unchanged; mutation-check the omit-over-mint line.

**0.3 · D21 is done.** `wpe_sites(id, name, account_id)` collected in the
CAPI sweep, honest-NULL, prune double-gated. Live: 270/270 named, 268/268
install-side properties resolve. (`63923a0e`, verified `2cf78a37`.)

**0.4 · Property names are untrusted text.** A real Site in the live portal
is named `<script>alert()</script>`. Every surface renders names as text —
React `createElement` does this by default; no `innerHTML`/template path may
exist for any property-grain string.

**0.5 · The property-grain audit gate.** D21 existed because no feature ever
consumed the property grain before this one. Before Phase 1 code, walk every
fact the three screens display **at the property level** and confirm each has
a collected source. Known answers: name (`wpe_sites`), account
(`wpe_accounts`), member places (graph rows), copy links (mirror), content
lineage (`readSiteContentStatus` + `content_pulled_from`). Anything else the
renderer wants at that grain gets a register entry before it gets a
workaround.

## Phase 1 — the property-grain read model (main process)

One module that answers all three screens, so every surface derives from one
computation (the house rule: counts are derived, never independently
computed).

**1.1 · `buildFleetCollapse()`** — extends the `siteRows.ts` /
`knowledgeLadder.ts` line rather than starting a rival. Inputs and their
committed sources:

| fact | source |
|---|---|
| WPE property rows | graph `sites` grouped by `wpe_site_id`, `is_active=1`, joined to `wpe_sites` for name/account |
| local-only rows | Local's own store (`sites.json` via `siteData`) minus paired copies |
| copies nested under properties | mirror `has_working_copy` links |
| external rows | graph `source='external'`, ungrouped (siteLinkMirror excludes external — ratified as one-row-per-site) |
| place kind | graph `environment` column (WPE), `production` (external), copy (local paired) |
| knowledge rung | `indexRegistry` completeness → `toKnowledgeRung` — four rungs, `nothing` first-class |
| ceiling | `wpeGatewayStatus.sshGatewayUnavailableReason` per account (D15) |
| checked age + failure reason | pipeline twins `pipeline:l2`/`pipeline:l3` per env entity; 24h history from the ledger |
| lineage sentences | `content_pulled_from` + `readSiteContentStatus`; stated absence otherwise |
| needs-you | **deferred to Phase 3** — the field exists in the shape, `null` until then |

Rules carried from the register: name-keyed lookups constrain by `source`
(the collision floor test drives this); `is_active = 1` on every external
read; a WPE property with no name row renders its grouped install names,
never a derived guess.

**1.2 · Roll-up semantics in the model, not the renderer.** Per-property:
rung set (enumerated when mixed), `oldest` checked age with its label
semantics (fail > never > oldest hours), place count. Header aggregates
(total, per-origin counts that sum, never-looked-inside count, copy count)
computed here once.

**1.3 · The census path (fixes D23 for this surface).** Structured questions
("how many places never indexed", "docs behind version X") are answered by
walking the full population — graph rows, docs-table metadata — never by
filtering retrieval candidates. Where this phase touches
`applyMetadataFilters`, D24/D25's type fixes land first (see queue).

**1.4 · Surface.** A GraphQL query/mutation pair per repo convention (fleet
reads live on the Mutation block) feeding the renderer and
`nexus fleet …` CLI; MCP exposure can follow later.

**Acceptance:** unit tests over a fixture graph covering: multi-install
property with copy; single-install (the 74% case); Autoscale ceiling;
external ungrouped; collision pair; unnamed property fallback;
counts-sum-to-total; labelled-oldest including the fail and never shapes.
Mutation-check the omit/fallback honesty lines, per house practice.

## Phase 2 — the renderer (three screens)

React 16 discipline: class components, `React.createElement`, no hooks, no
JSX; global CSS classes where Local provides them. The mock
(`docs/intelligence/mock-sites-collapse.html`) is the visual contract —
translate, don't redesign. This effectively becomes **Spec 5** of the
`new-ux-v2` line (Sites table, never started).

- **Fleet screen:** origin segments with derived counts; state chips compose;
  search spans everything and labels out-of-filter hits; flat single-place
  rows; caret only where content exists; second click on an open row drills
  to the property; `nothing` callout leads the header.
- **Property screen:** place cards; lineage sentences with stated absence as
  the common case; activity assembled per place with the assembly named.
- **Place screen:** facts with per-fact ages; depth with ceiling reason;
  history; procedures named with runbook + grant, barred ones visible with
  reason and door. Read-only doors first — no new execution paths in this
  phase.

**Acceptance:** renders against the live fleet (~296 rows) without
pagination; every count on screen traces to one read-model field; the
`<script>` Site name renders as text everywhere.

## Phase 3 — per-site needs-you

The one screen element with unresolved decisions. Three, in order:

1. **Entity-keyed attribution.** Situation producers stamp the env/site
   entity id on `SituationSignature` (today `target` is a resolved name —
   collisions fold two sites' counts together). Name stays for display.
2. **The remainder is stated.** Rows with no attributable target are counted
   in the header aside ("N not tied to a site"), never silently dropped —
   per-site badges do not claim to sum to the global badge.
   *Needs designer ratification — the one open designer touchpoint.*
3. **Coalesced rows.** A coalesced situation spanning multiple sites counts
   once per member site (render the set), pending the same ratification.

## Queued behind this plan (ruled 2026-08-24)

| item | slot |
|---|---|
| D22 description retreat (delete the false "link-graph analysis" claim) | first commit of Phase 0 — one line, honest-advertising |
| D22 capability (edge list at index time) | roadmap, spine-shaped; not this plan |
| D24 + D25 (semver / ISO-date typing in `applyMetadataFilters`) | immediately before Phase 1.3, one fix session, D8 treatment |
| D23 (census path) | Phase 1.3 for this surface; `search_site_content`'s own count honesty follows the same pattern after |
| O3 (NaN usage figures → honest NULL) | standalone quick fix, any gap |
| O2 (1801s start-site false failure) | investigation ticket, unscheduled |
| D6 retest (`get_site_structure` post-D14) | five minutes, next time Local is up with a quiet fleet |
| D11, D16, D20-adjacent unexplained `sites.name` writer | unchanged, tracked in the register |

## Sequencing and effort

```
0.2 D20 fix ──┐
0.5 audit ────┼── Phase 1 read model ── Phase 2 renderer ── Phase 3 needs-you
D24/D25 ──────┘         (D23 inside)          (Spec 5)        (designer Q)
```

Rough shape: Phase 0 including D20 is a day; D24/D25 a half-day; Phase 1 two
to three days with its fixture tests; Phase 2 the largest, iterative against
the mock; Phase 3 gated on the designer's answer and sized after Phase 1
proves the attribution join.
