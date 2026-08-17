# Implementation audit — the shipped layer vs. the three-layer model

*2026-08-16. Deep review of every intelligence-layer file (core + host + readers
+ chat) against `reconciliation-site-environment-model.md`, run as two
independent audits (core substrate; host/readers) plus architect verification
of contested findings against the live checkout. Method note: one audit finding
("siteLinkMirror unwired") was a FALSE POSITIVE from a stale snapshot —
verified wired at `index.ts:759` — and is excluded. One finding was confirmed
live and is registered as a defect (A7).*

**Headline verdict: the model is adoptable, fully additively, on the shipped
substrate — with ONE forbidden path, TWO places where my reconciliation doc
overclaimed and has been corrected, and THREE new packets registered.**

---

## A. The findings, consolidated and ranked

### A1 · THE ID TRAP — layer classification must be relational, never re-derived. (The one forbidden path.)

The entity id embeds the type token: `ent_${type}_${derive26(namespace, value)}`
(`entityService.ts:87`), and local sandboxes are shipped as `ent_env_…` from
`local.site_id`. Reclassifying them by minting a `working_copy` type would
change every id, orphaning all ledger history and twin facts — and would
desynchronize the pure fallback (`provisionalEnvironmentId`) from the service
path, breaking the ids-identical-by-construction invariant the whole
zero-migration adoption rests on. Additionally, `siteLinkMirror.ts:99` mints
WPE *graph rows* through the same `local.site_id` namespace, so the namespace
does not even mean "local" — it means "graph sites.id".

**Ruling (binding on ADR-21 adoption):** ids are frozen forever; the `env`
token and the `local.site_id` namespace are declared OPAQUE LEGACY. Layer
membership is expressed relationally — link kinds and/or aliases — never in
the id string. `entities.type` stays `'env'` for shipped rows.

### A2 · Fold role precedence — the one two-kind assumption on the write path

Both folds resolve `event.entity.environment ?? event.entity.site`
(`stateTwinFold.ts:56`, `pluginTwinFold.ts:37`). A `working_copy` envelope
role would silently fall through to `site`, writing sandbox facts onto the
logical Site — the exact conflation the model dissolves. Resolution: fold v2
with precedence `working_copy ?? environment ?? site` + twin rebuild
(sanctioned — twins are rebuildable by construction; replay of existing
history is byte-identical since no shipped event carries the new role).
Producers additively stamp the third role (`entity: {site, environment,
working_copy}`) on local-site events; every shipped reader keeps working via
the retained `environment` role.

### A3 · The assembler has no routing — and episodic scope is wrong TODAY

`AssembleRequest.targets` is a flat list; `EntityRef.role` is never read;
freshness/episodic/semantic all iterate the same targets identically. The §4
routing table is currently inexpressible — expected for M3 (the task frame is
scheduled). But one piece is wrong *now*: `chatAssembly.resolveTargets`
returns only the local env entity, so **episodic retrieval is copy-scoped
where the model (and the substrate!) support Site scope** — producers dual-
stamp `site` on every event and `Ledger.query`'s entityId filter matches any
role. Immediate additive fix: `resolveTargets` also returns a
`{role:'site'}` target. The full frame (`{site, workingCopy, production,
perTypeRouting}`) lands with M3 per the model's §7.

### A4 · The lineage record does NOT exist yet — my doc overclaimed; corrected

The model's §2 said the pull/push events "ARE the lineage record; no new
bookkeeping required." **False for the ledger half.** Exhaustive audit of all
emission sites: no producer emits any pull/push/promote/sync event.
`OperationTracker` (which observes exactly these operations) is never
connected to the core; the `'pull_lineage'` EstablishedBy value is shipped
but dormant — nothing passes it. Local's own sync history exists, but outside
the layer. Content lineage FITS the shipped schema with zero change
(`link(copy, prodEnv, 'content_pulled_from', 1.0, 'pull_lineage', at=pullTime)`).
**Corrected at WP-14: the "PK upserts, so the pointer MOVES" mechanism was
half-false** — the PK is (from, to, kind), so re-pulling from the SAME
environment upserts, but pulling from a DIFFERENT one inserts a second
edge, leaving a copy claiming two content origins at once. WP-14 built
`linkExclusive()` (which never retires a user_link) to make the pointer
genuinely exclusive-move. Caught by a failing pin, not by reading. Code lineage
(branch/sha) does not fit links (a sha is not an entity); it rides event
payloads (`code_ref`) per the model, or a v3 `entity_links.detail` column.
→ **WP-14 registered** (the sync producer). The reconciliation doc §2 is
amended to say "requires one new producer."

### A5 · Cross-entity divergence is a new comparator — and the right measurement currently lives in the wrong tool

The shipped drift machinery is strictly temporal (one `(entity, fact)` row vs
its own past; `DriftNotice` cannot even name two entities). The model's
copy-vs-upstream divergence is a different computation — enabled by the fact
that fact keys are entity-independent, so two entities' twins are directly
comparable (compare-sites proves the pair-diff today). Meanwhile the
*un-migrated* `wpe_detect_drift` performs exactly this cross-entity
measurement — but on graph caches joined by `hostConnections` install-name:
right measurement, wrong substrate (bypasses site_links precedence, entity
ids, freshness, and has no flow decomposition). Unification needs three
inputs: pair-from-links (A6's edges), twin-diff per fact with per-side
freshness, and the sync-event zero point ("diverged since the pull at T" —
A4). → **WP-15 registered.** No change to the shipped folds; `DriftNotice`
stays single-entity by type.

### A6 · The graph's edge vocabulary collapses Layer 3 into Layer 2

`siteLinkMirror` writes the sandbox as `has_environment` of the Site — the
old doctrine verbatim, now asserted in the graph itself; and
`environmentsOf()` is the only traversal, so a lineage reader either counts
sandboxes as environments or can't see them. Resolution (additive): keep the
shipped edge; ALSO write `has_working_copy` (Site→copy) now, and let WP-14's
producer maintain `tracks_content`/`tracks_code` (copy→env, `at` = event
time) edges; add `workingCopiesOf()` beside `environmentsOf()`. Folded into
WP-14's scope.

### A7 · CONFIRMED LIVE DEFECT — `verify_site_live` mints ids outside the sanctioned namespaces

For WPE targets it derives `environmentEntityId(entities, installName)` —
i.e. `ensure('env','local.site_id', <install NAME>)` — a *write* that
registers a divergent entity whenever graph row id ≠ install name. The
name-match fallback rescues reads, but the emit path then stamps a
name-derived `site` entity, splitting history the lineage work must later
join. Violates the entity-identity reconciliation's namespace table (WPE envs
alias under `graph.site_row` + `wpe.install_id`; install name is neither).
Verified against the current checkout. → **WP-16 registered** (resolve
through `entities.resolve(installName,'wpe.install_name')` first; derivation
last).

### A8 · Flat-fleet reader semantics — contextualize now, version later

`fleet_summary`'s "Total sites: N" counts environments + copies as sites;
`find_outdated_sites` calls an intentionally-behind sandbox "outdated";
readers list one row per copy. Under the model these are category errors —
but they are pinned by additive-parity tests and user expectations, so they
CANNOT be fixed in place additively. They CAN be contextualized additively
(appended grouped-by-Site sections, via FleetAssembler now and entity_links
as data fills), with the true semantic change deferred to the post-M4 product
inversion the model already schedules. No packet yet; noted for M3 reader
work.

### A9 · Minor seams (all additive, none urgent)

Envelope validator's entity-id regex forbids multi-word type tokens (moot
under A1's ruling, noted for completeness). `FreshnessRecord.served: 'twin'`
cannot express routed-from-another-entity provenance — widen the union +
optional `sourceEntityId` when routing lands. `RemoteEnv` is a closed
three-value enum (external hosts unrepresentable) and `promote` is named in
rule text but absent from `RemoteOperation` — extend when ADR-23 lands, and
add the `c.two-flow-push` constraint to `law/policy/ops-default.md` (pure
authored-policy addition; the S4 refusal-with-safe-split currently has no
constraint expressing it). Producer discipline to pin at ADR-21 adoption:
every event stamps `site` alongside its physical role, or Site-threading
silently loses that producer.

## B. What conforms (the substrate held)

The envelope is the best-conforming surface: `EntityRefs` is an open
role→id record and payloads are open — the third role and `code_ref` need
zero schema change. The ledger's entityId query matches any role → Site-scoped
episodic threading is a query, not a migration (contingent on A9's stamping
discipline). Permission gates are keyed by *target* environment — "safety
lives on the edges" was already true before it was written down. The entities
table's type column is an open vocabulary; entity_links' free-text `kind`
carries the new edges; `content_pulled_from` needs no schema at all.

## C. Registered actions

| Item | What | Class |
|---|---|---|
| WP-14 | Sync-event producer (pull/push/promote → `episodic.sync.*` via OperationTracker tap) + lineage edges (`has_working_copy`, `tracks_content`/`tracks_code`) + `workingCopiesOf()` + activates `pull_lineage` | M3 opener; makes A4/A6 real |
| WP-15 | Divergence comparator (pair-from-links + twin diff + sync zero-point) + lineage-aware enrichment of `wpe_detect_drift` | M3; depends WP-14 |
| WP-16 | `verify_site_live` identity fix (resolve before derive) | Defect; small; immediate |
| Doc | Reconciliation §2 corrected ("requires one new producer"); ADR-21 candidate gains the id-freeze ruling (A1) | Done in this pass |
| Quick fix | `resolveTargets` adds the Site target (episodic → Site scope) | Can ride WP-16 or WP-14 |
