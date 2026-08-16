# Reconciliation — the Site / Environment / Working-Copy model

*Decision record, 2026-08-16. Companion to `reconciliation-entity-identity.md`
(which reconciled WHO owns identity; this reconciles WHAT the identities mean).
Governs: the assembler's task frame, instrument routing (M3), lineage
provenance, and the product-surface contract. Origin: owner review session —
"we have a mental model in Local today that doesn't match where we are going."*

---

## 1. The problem, stated once

Local's surface model says: a local site is a thing; it may be *linked* to one
WP Engine environment; wanting all three environments of a Site connected means
three local sites. This forces the user to answer a question that has no stable
answer — **"which environment IS this local copy?"** — and it makes
intelligence routing incoherent: a strategist working in a development sandbox
legitimately needs production's analytics, yesterday's staging deploy history,
and her sandbox's own file state, *in the same conversation*.

The intelligence layer already disagrees with the surface model, in the right
direction: ADR-4 (site-logical / environment-physical) and WP-07's entity
graph store one logical Site with N environment entities. This document takes
that model one layer further and pins the routing, flow, and surface rules
that keep it simple.

## 2. The model — three layers, not two

**Layer 1 · Site (logical).** One per real-world web property. Owns intent
("never break the live site"), audience identity, client policy, and the
episodic thread that spans environments. Nothing executes here; it is the
thing everything else is a version of.

**Layer 2 · Environment (durable runtime).** wpe_production, wpe_staging,
wpe_development, external hosts. Addressable, long-lived, with its own state
observations, its own write gates, and (for exactly one of them, normally
production) the audience's actual attention. Environments are the *remote
branches* of the analogy: they exist whether or not anyone has them checked
out.

**Layer 3 · Working copy (mutable snapshot with lineage).** A local sandbox
is the common case; a disposable preview environment is the same species. A
working copy has:

- **Stable identity** — its own entity (WP-07 already mints it), its own twin
  facts (correct: it diverges the moment it is touched).
- **Per-flow upstream pointers, which MOVE** — pulled from production
  Tuesday, pushed to staging Thursday: same entity, different lineage edges
  over time. Local's sync history already records these operations —
  *outside* the ledger. **(Corrected per the 2026-08-16 implementation
  audit, `implementation-audit-three-layer.md` A4: no producer emits sync
  events yet — `OperationTracker` observes pull/push but is not connected to
  the core, and the `pull_lineage` EstablishedBy ships dormant. The ledger
  half of the lineage record requires ONE new producer — WP-14 — after which
  this bullet's original claim becomes true.)**
- **Measurable divergence** — the copy's twins vs. the upstream environment's
  twins is exactly what `detect_drift` computes today.

The question "which environment is this local site?" is dissolved, not
answered: a working copy is not an environment; it *tracks* environments, per
flow, and can always say how far behind or ahead it is.

## 3. The two flows — code up, content down

WordPress's oldest operational fact, made first-class:

| Flow | Direction | Vehicle | Canonical source | "Ship it" means |
|---|---|---|---|---|
| **Code** (themes, plugins, ACF definitions, config-as-code) | UP: branch → dev → staging → production | git / promotion | the workstream (branch), then production once promoted | promote through environments |
| **Content** (posts, media, most of the DB) | DOWN: production → lower copies | pull / db copy | production, always (it is authored live) | publish ON production; never promote a stale DB over it |

A working copy therefore has **two upstreams**: its code lineage (a branch/sha)
and its content lineage (an environment @ a pull timestamp). The honest
description of the strategist's sandbox is *"code: ahead of dev on
`campaign-acf`; content: 11 days behind production"* — a sentence no single
environment label can express, and one composed entirely of facts the ledger
already holds.

**The cardinal hazard this table exists to prevent:** an eager "push it all
live" that promotes a stale database over production's live content. Any
plan that moves a working copy's changes upward MUST decompose into the two
flows and treat them separately. `rb.staging-promotion` already treats the DB
as a separate scope decision; that checkbox is this table, enforced.

**Git-backed environments** are not a special kind: an environment's identity
is stable; what varies is what is deployed onto it. State observations of
git-backed environments gain an optional `code_ref` (branch + sha) in the
payload — provenance, not identity — so "dev had plugin X at v2" becomes
answerable per-deployment. (Envelope change: payload-level, no new topic; the
schema-version bump follows the normal escalation path when implemented.)

## 4. Intelligence routing — each type has a home

The answer to "from where is intelligence pulled?" is a **per-type routing
table**, applied by the assembler, invisible to the asker:

| Type | Resolves to | Rule |
|---|---|---|
| **State** | the entity being touched | Always per-entity, always age-labeled (shipped: twins + freshness). A working copy's state is its own. |
| **Audience / market (instruments)** | **production, always** | Reality is only measured where the audience is. A sandbox has no visitors, ever; audience queries route through to production regardless of where the asker stands, and the answer says so. Binds to the Site, sourced from the production environment. |
| **Semantic (content & structure)** | the flow's canonical source | Content: production (with the working copy's pulled-at age disclosed). Code/structure: the workstream. |
| **Procedural (runbooks)** | the Site (with environment parameters) | A promotion runbook is Site-level; its gates evaluate per target environment. |
| **Policy** | intent at Site level; gates per environment; **edges carry the target's gates** | "Don't break the live site" is Site intent. `push.production=false` is an environment gate. A write THROUGH a working copy toward an upstream is governed by the upstream's gates, not the copy's — safety lives on the edges, not the nodes. |
| **Episodic** | the Site, threaded across environments | The most valuable entries are the edges: promotions, pulls, the push that broke prod. Query by Site scope; the entity links (WP-07) make this a join, not a migration. |

## 5. The surface contract — how this stays simple

The model above is for builders. Users and agents get a five-phrase surface
(*the live site, staging, your copy, pulled from, behind*) and four rules:

**S1 · Pick a site and an intent, never a topology.** "Work on Alpine
Outfitters without touching the live site" is a complete instruction; the
system selects/creates the working copy and sets the frame.

**S2 · Reads route silently; writes name their target.** A question is never
answered with a question. "Top-performing content?" arrives as *"From the
live site's analytics, last 30 days"* — routed by the table in §4, provenance
stated, zero decisions demanded. An action states its blast radius before
running: *"This changes only your copy."*

**S3 · "Where am I?" always has a four-line answer,** generated from the
entity graph + sync history:

> You're in a safe copy of Alpine Outfitters.
> Code: the campaign-acf branch.
> Content: pulled from the live site, 11 days ago.
> Nothing you do here touches the live site.

That paragraph IS the model, rendered. It is the only teaching the surface
ever does unprompted.

**S4 · Guardrails substitute for understanding; the deep model surfaces only
at flow collisions, as an offer.** Users need deep mental models only where
mistakes are unguarded; the policy plane makes the shallow model safe.
The one mandatory surfacing: "push my changes live" decomposes —
*"Your field changes and theme tweak can go up through staging. Pushing your
content copy would overwrite 11 days of live edits — those pieces should be
published on the live site instead. Want the safe split?"*

**For AI agents, the assembler is the complexity absorber.** Bundles arrive
pre-routed: audience facts already resolved to production and stamped, state
scoped to the working copy with ages, gates pre-evaluated for the writes in
play. The agent contract stays the three shipped obligations: use the ids you
were handed; relay the disclosures in your prose; stop at the gates. Routing
intelligence lives in exactly one place — `assemble()` — so a hundred actors
stay simple because one function is smart. Sequential depth lives in runbooks
(complexity frozen into procedure), and evals test the contract, not the
actor's cleverness.

## 6. Acceptance test — the strategist walkthrough

A content strategist plans a campaign on a Site whose production is live and
git-backed. She must: read traffic data; add ACF fields; draft content
pieces; make a small theme adjustment; ship without breaking the live site.
The model passes if ALL of the following hold:

1. She starts with one sentence (S1) and is never asked to choose an
   environment for a read.
2. Her traffic question is answered from production instruments with the
   source stated, while she stands in the working copy (§4 routing).
3. Field + theme changes land in the working copy on a branch; the system
   states blast radius (S2).
4. Content drafts are created in the working copy with its content-age known
   and disclosed when relevant (§3 content lineage).
5. "Ship it" decomposes into the safe split (S4): code up through the
   promotion runbook (gates + backup + approval per rb.staging-promotion);
   content published on production through its own gated path.
6. At no point does she encounter the words entity, twin, lineage, upstream,
   or any term this document introduced. If a term leaks, the surface is
   wrong; if a step needed a term, the model is wrong.

## 7. What changes, and when

| Change | Where | Milestone |
|---|---|---|
| AssembleRequest gains a task frame: {site, workingCopy, perTypeRouting defaults} | `src/intelligence/assemble/types.ts` + `chatAssembly.ts` | M3, first packet after instruments |
| Instrument summaries bind to Site with source-environment provenance (production) | M3 instruments work (per the summaries-in ruling) | M3 |
| `code_ref` (branch+sha) on state observations of git-backed environments | wpEventProducer / graph sync payloads, schema bump via escalation | M3 |
| Lineage reading: working-copy status ("where am I?") derived from sync history + entity links | new small module; surfaces as a tool first (`site_status`-adjacent), UI later | M3 |
| Two-flow decomposition of upward writes ("the safe split") | runbook + assembler planning surface | M3/M4 |
| Product UI inversion: one Site card, N environments, local copies as tracked snapshots | product surface, beyond the intelligence layer; the entity graph is the substrate that makes it a rendering change, not a data migration | Post-M4 / product roadmap |

Nothing in M1/M2 changes retroactively: the entity model already conforms
(ADR-4, WP-07); this document adds the working-copy layer, the routing table,
and the surface contract on top of shipped substrate.

## 8. Candidate ADRs (for adoption into architecture.md)

- **ADR-21 · Three-layer identity: Site / Environment / Working copy.**
  Working copies are entities with stable identity and per-flow moving
  upstream pointers (code lineage: branch/sha; content lineage: environment @
  pull-time). "Which environment is this copy?" is an invalid question by
  design; divergence-from-upstream is the valid one, and drift detection
  answers it. **Adoption ruling (binding, from the implementation audit A1):
  entity ids are FROZEN — the `ent_env_` prefix and `local.site_id` namespace
  on shipped entities are opaque legacy, never re-derived. Layer membership
  is expressed RELATIONALLY (link kinds `has_working_copy`,
  `tracks_content`/`tracks_code`; optionally a layer alias), never in the id
  string. Envelope-side, producers additively stamp a third `working_copy`
  role while keeping `environment` for shipped readers; folds bump to v2
  with role precedence `working_copy ?? environment ?? site` + rebuild.**
- **ADR-22 · Per-type intelligence routing.** The §4 table is normative. The
  assembler applies it; actors never route. Audience/market intelligence
  always resolves to the production environment and binds to the Site.
- **ADR-23 · Two-flow write decomposition.** Any operation moving a working
  copy's changes toward an upstream must decompose into code-flow and
  content-flow legs with independent gates; a combined "push everything"
  against a production target is refused by construction, with the safe
  split offered.

## 9. Open questions (deliberately not resolved here)

1. **Preview environments** — same species as working copies here; WPE
   product direction may make them durable enough to be Layer 2. Revisit when
   real ones appear in the fleet.
2. **Multiple working copies of one Site** (two team members, two laptops) —
   the model supports it (each is an entity with lineage); the hub/satellite
   sync story (M3) decides how their episodic records merge.
3. **Content merge** — the down-flow model assumes content conflicts are
   avoided (publish on production), not merged. True content merge (parallel
   authoring in copies) is out of scope until WordPress itself has a story.
4. **Where "where am I?" renders** — chat answer first (cheap, shipped
   surface); persistent UI status is a product decision.
