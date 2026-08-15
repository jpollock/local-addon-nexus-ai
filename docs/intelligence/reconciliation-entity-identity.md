# Reconciliation: entity service v0 × Track-1 fleet identity

*2026-08-15 · Decision record for WP-07's precondition. Inputs:
`src/main/fleet/{SiteLinkStore,SiteLinkResolver,FleetAssembler,types}.ts`
(Track 1, shipped and wired) vs `src/intelligence/entity/entityService.ts`
(v0 draft, unwired) + architecture.md §5.*

## What each system is

**Track 1 (`site_links`)** is the *operational* identity system: a graph.db
table keyed by `local_site_id` mapping to a WPE install, with
`link_source: 'user' | 'hostConnection' | 'inferred'` and the invariant that
user links are authoritative (the resolver short-circuits on them; CAPI never
overwrites a human). It has a CAPI-backed resolution sweep with per-site
timeouts, an unresolved-sites report explicitly designed for human follow-up,
MCP tools (`nexus_fleet_list`, `nexus_link_site`), a Fleet renderer tab, and
`FleetAssembler`, which groups installs under **`wpe_site_id`** and stamps
every row with a four-rung `DataProvenance`.

**Entity service v0** is the *ledger-side* identity spine: stable entity ids
that deterministically adopt the producers' provisional ids (so all emitted
events and twin facts already key to them), aliases with
confidence + `established_by`, typed links, evidence-carrying resolution, and
heuristic pairing *proposals* that never link automatically.

Both encode the same principles, independently arrived at: identity is an
assertion with provenance; human links outrank inference; a silently wrong
join is worse than a missing one. That convergence is the strongest possible
evidence the principles are right — and having two stores enforce them
separately is how they eventually diverge.

## The decision

**Track 1 keeps runtime ownership. The entity service becomes a consumer, not
a competitor.** Specifically:

1. **`site_links` remains the operational source of truth** for local↔install
   attachment. Its UX, sweep, tools, and precedence invariant are untouched.
2. **The entity service mirrors `site_links` one-way** (site_links → entity
   aliases/links) during its wiring step. Mapping:
   - `link_source: 'user'` → `established_by: 'user_link'`, confidence 1.0
   - `link_source: 'hostConnection'` → `established_by: 'host_connection'`
     (NEW enum value; confidence 0.95 — deterministic platform config, but not
     a human assertion)
   - `link_source: 'inferred'` → `established_by: 'name_heuristic'`, ≤0.5
   - `verified_at` → the alias's freshness.
3. **`wpe_site_id` is adopted as the logical Site's canonical external
   alias** (namespace `wpe.site_id`). Track 1's grouping already proves the
   container relationship; for WPE-hosted sites, "pairing" is largely *given*
   by CAPI, not inferred. The model's Site-logical/Environment-physical split
   maps exactly: FleetSiteGroup ≈ Site entity, FleetInstall ≈ env entity,
   sandbox ≈ the local env entity of the same Site.
4. **`proposePairings()` demotes to gap-filler**: it runs ONLY over the
   resolver's `unresolved` report (sites Track 1 could not attach) and local
   sites with no host connection — and its proposals feed the existing
   `nexus_link_site` confirmation path rather than a new queue. Track 1
   already built the human-in-the-loop surface; the entity service supplies
   candidates to it.
5. **`DataProvenance` (display) and envelope provenance (ledger) stay
   separate concerns** for now. They are compatible — `deriveProvenance`'s
   rungs are a display projection of the same freshness discipline — and any
   future unification (FleetAssembler reading twin freshness) is post-WP-07.

## The subtle trap this resolves (record it or someone re-trips)

Producers derive provisional env-entity ids from **graph `sites.id`**, but
`FleetAssembler` addresses installs by **`remote_install_id ?? id`**. For WPE
rows those can differ. Without reconciliation, twin facts and site_links
would key to *different ids for the same install* and every join would
silently miss (the failure mode the reader-migration pattern warns about).
Resolution: the entity service aliases BOTH — graph row id under
`graph.site_row`, install id under `wpe.install_id` — onto one env entity,
and `ensure()`'s adoption of the graph-row-derived provisional id keeps all
existing ledger history attached.

## Consequences for the code (WP-07's new scope)

- Add `'host_connection'` to `EstablishedBy` in `entityService.ts`.
- Wiring imports `site_links` on init + subscribes to link changes (or
  re-mirrors on each sweep) — one-way, idempotent.
- `proposePairings()` gains an `unresolvedOnly` input; the MCP surface for
  proposals routes through/beside `nexus_link_site`, not a parallel tool.
- New namespaces: `wpe.install_id`, `wpe.install_name`, `wpe.site_id`,
  `graph.site_row`.
- Assembler bundles (WP-11, later) key targets by entity id and can therefore
  trust that a target's local sandbox and WPE install resolve to one Site.

## What was rejected

- *Entity service replaces site_links*: rejected — Track 1 is shipped, wired
  to UI/tools, and owns a CAPI dependency the entity service shouldn't grow.
- *Two independent stores*: rejected — guaranteed drift, and agents extending
  both (the hazard that triggered this note).
- *site_links consumes the entity service*: rejected for v0 — inverts a
  working dependency for no near-term gain; revisit if/when the hub makes the
  ledger the canonical store (M3).
