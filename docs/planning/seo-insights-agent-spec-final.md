# SEO Insights Agent — Product Spec

**Status:** Final
**Author:** Jeremy / Product
**Target platform:** WP Engine Nexus Agent SDK
**Working name:** SEO Insights (branding TBD; candidates: Site Compass, Content Radar)
**Last updated:** July 2026

---

## 1. Summary

A single Nexus agent that answers the question every WordPress site owner eventually asks: *"What should I write next, and what existing content is working against me?"* It treats the WordPress install as its primary data source — reading the site's existing Local Nexus content index for semantic structure and WP-CLI for everything else — building a topical map, then progressively enriching it with Google Search Console demand data and, optionally, live SERP clustering.

The differentiation versus every SEO SaaS tool (Keyword Insights, Thruu, NeuralText, Semrush) is that those tools end at a CSV or dashboard. This agent lives inside the install with WP-CLI access, so it closes the loop: it drafts the missing article as a pending post, proposes the merge-and-redirect for a confirmed cannibalization pair, and fixes internal linking within a topic cluster. Analysis that ships fixes.

One agent, three capability tiers, unlocked progressively:

| Tier | Name | Data required | Value delivered | Cost to user |
|------|------|--------------|-----------------|--------------|
| T0 | Content Map | None (WP install + existing content index) | Topical map, gap candidates, overlap candidates, orphaned content | Free / included |
| T1 | Demand Layer | GSC service-account grant | Confirmed cannibalization, intent classification, demand-weighted gaps, striking-distance queries | Free / included |
| T2 | SERP Verification | SERP API key (DataForSEO or compatible) | SERP-verified keyword clusters, content calendar, competitive overlap | BYO key |

T0 works at enablement with zero configuration — the activation moment and the SDK showcase. T1 is where the analysis becomes authoritative. T2 is the power-user/agency tier and the natural monetization gradient. BYO key at T2 launch; metering only if attach-rate data warrants it.

---

## 2. Problem & opportunity

Site owners and content teams on WP Engine have no native answer for content strategy. The existing market splits into (a) expensive SaaS suites whose clustering features are shallow, (b) point tools that require exporting keyword lists and re-importing CSVs, and (c) DIY Python scripts (Giordano's SERP-Clustering repo is the reference implementation) that require a technical operator. None of them can read the site's actual content, and none can act on the site.

The Nexus SDK changes the economics: the agent already has authenticated access to the install, the WPE environment, WP-CLI, and — decisively — a content index the platform already builds and maintains. The hard parts of every SEO workflow (clean access to what the site contains, semantic representation of it, and the ability to change it) are free. The analysis layer on top is well-understood, mostly rules-based, and cheap to run.

Strategic fit: showcases the Nexus SDK with a broadly appealing use case; validates the "index once, many agents consume" platform pattern (this agent is its first proof); reinforces the ACF structured-content narrative (gap output scaffolds as ACF-backed content briefs); connects the Local and WPE product stories through a shared index that travels with push/pull.

---

## 3. Users & jobs

**Primary — Site owner / solo marketer (T0→T1).** Runs one to a handful of sites. Wants "tell me what to write and what's broken" in plain language. Will complete a one-paste GSC grant. Will never buy a SERP API key.

**Secondary — Content lead at an SMB (T1).** Owns an editorial calendar. Wants demand-weighted prioritization and cannibalization triage. Report output must be shareable with stakeholders — which is why explainability of the clustering method matters: rules they can defend, not black-box ML.

**Tertiary — Agency / SEO practitioner (T2).** Manages many installs, already has DataForSEO or similar. Wants SERP-verified clusters and bulk workflows. This user validates whether SERP clustering deserves to become its own agent later — a v3 decision made from usage data.

**Jobs to be done, in the user's words:**

1. "Show me what my site is actually about and where the holes are."
2. "Tell me if I have pages competing with each other, and fix it."
3. "Give me a prioritized list of what to write next, backed by real demand."
4. "Do the boring parts — draft the post, set up the redirect, fix the links."

---

## 4. Data architecture: consumer, not owner

The agent owns no embedding pipeline and no index. It consumes two existing sources and joins them.

**The Local Nexus content index (SqliteVecStore).** Built and maintained by the platform's ContentPipeline: full post content, sentence-boundary chunking at 500 words max with title prepended to every chunk, embedded with `all-MiniLM-L6-v2-quantized` (384 dimensions, ONNX), stored in sqlite-vec behind the `IVectorStore` interface. Coverage is all published content — posts, pages, all CPTs, WooCommerce products (enriched with price/SKU/attributes), ACF fields merged into the parent document, media, and a synthetic site-settings document — minus a hardcoded exclusion list (revisions, nav menu items, ACF internals, WooCommerce orders). `search()` already deduplicates by `postId` and returns the best-scoring chunk, yielding document-level results with no pooling step required by the agent.

**WP-CLI**, for everything the index doesn't reliably carry: publish/modified dates (stored as empty strings in the index's batch path), word counts, taxonomy assignments, author, and — built by the agent — the internal link graph with inbound/outbound counts per post. Decay detection and staleness analysis run entirely off WP-CLI dates, never index fields.

`inventory_content` is a **join step**: WP-CLI metadata and link graph on one side, document vectors from the index on the other, keyed by `postId`. Smaller than a standalone indexer, but still a distinct and necessary tool.

**Freshness model.** The index has three refresh paths: full rebuild on site start; near-realtime per-post webhook updates via the connector plugin; opt-in 8-hour scheduler. The agent manages none of these. Before every analysis run it reads `IndexEntry.lastIndexed` and:

- Warns when the index is stale beyond 48 hours.
- Flags **degraded entries** — the webhook-incremental path writes a single unchunked, 256-token-truncated document regardless of content length, so a post updated via webhook after a full index has lower-fidelity vectors than its batch-indexed peers. Degraded entries are excluded from overlap-candidate scoring (where vector fidelity directly drives the finding) and included with a confidence note elsewhere.

**Model assumption.** The index records no schema version, model name, or chunking parameters. Until the platform adds a version manifest (§6), the agent hardcodes its assumption (`all-MiniLM-L6-v2-quantized`, 384d, 500-word chunking) and treats absent or anomalous `IndexEntry` data as a warning condition. This interim posture holds only if pipeline changes are coordinated with the agent team before shipping — that coordination is an explicit requirement, not an implicit hope.

---

## 5. Capability tiers in detail

### T0 — Content Map (zero-config)

**Pipeline:**

1. **Inventory.** `inventory_content`: WP-CLI `wp post list` for all published posts and pages (default; CPTs opt-in — see §5.4), merged with index document vectors from `IVectorStore.getAllDocuments(siteId)` (platform dependency §6), keyed by `postId`. Produces the working corpus with both metadata and embeddings per document.

2. **Cluster.** `build_topic_map`: agglomerative clustering over the 384d document vectors; TF-IDF labeling of cluster members to produce human-readable topic names (Giordano's labeling approach applied to the site's own corpus). Runs in `run` execution mode for sites over ~2,000 posts; effectively synchronous for smaller corpora. With embedding cost eliminated, clustering a 500–5,000-post site completes in seconds to under a minute of CPU.

3. **Analyze.** Three findings, surfaced separately:
   - **Gap candidates.** Thin clusters (1–2 documents) adjacent to strong clusters; taxonomy terms with no supporting content; hub pages with no spokes.
   - **Overlap candidates.** Document pairs with cosine similarity above threshold (default 0.85; calibrate against dogfood corpora before beta). Explicitly labeled *"unverified — connect Search Console to confirm."* Semantic overlap is never called cannibalization; two similar pages routinely rank for entirely different queries. Degraded entries excluded.
   - **Structural issues.** Orphaned posts (no inbound internal links, sourced from the link graph), stale cornerstone content (high inbound-link count, old WP-CLI modified date), clusters with no hub document.

T0 output framing is deliberately modest: a map and a set of candidates, plus a visible prompt to connect GSC. The tier exists to deliver a "it read my whole site in under two minutes" moment and to drive the T1 connection.

### T1 — Demand Layer (GSC, service-account pattern)

**Connection flow (no OAuth app required).** The agent surfaces a WPE-managed service-account email. The user adds it as a Restricted user on their Search Console property — one paste in the GSC UI. The agent verifies access on the next run. This removes the Google OAuth app-verification timeline from the critical path entirely. When a platform-level credential layer (`contributes.credentials`) lands, the agent migrates to it; the service-account pattern is the interim.

**Unlocked analyses — all rules-based and explainable:**

- **Cannibalization, confirmed.** GSC query→page pairs; flag queries where ≥2 site URLs receive impressions, with impression/click split and position volatility shown. Supersedes and cross-references T0 semantic candidates — a pair flagged by both signals is the highest-confidence case.
- **Intent classification.** Batched, cached LLM pass over the site's GSC query set (informational / navigational / transactional / commercial). Surfaced as: which intent categories does your content serve vs. which does your demand contain.
- **Demand-weighted gaps.** GSC queries joined against the topic map: queries with impressions but no strongly-matching document (or only a weak match at position 11–30) become the prioritized opportunity list, with a dedicated **striking-distance view** (positions 8–20, meaningful impressions) as the fastest-wins queue.
- **Decay detection.** Clicks/impressions trending down on previously strong documents, joined to WP-CLI modified dates — feeds the refresh queue.

### T2 — SERP Verification (optional, BYO key)

SERP clustering per the reference method (Giordano, MIT-licensed, reimplemented within the SDK at ~200 lines — the method, not the dependency): fetch top-10 results per keyword, build a keyword graph connecting keywords sharing ≥N URLs (default 3; ecommerce guidance: 4), take connected components as clusters, label with TF-IDF. Exposed as an on-demand verification and planning step — never a resident analysis; clustering is episodic planning work.

Inputs: the T1 opportunity list, a pasted keyword list, or a GSC export. Outputs: verified clusters mapped one-cluster-one-article into a content calendar, plus a competitor co-occurrence view (which domains appear across the site's target SERPs). BYO DataForSEO (or compatible) key. Metering revisited only if attach-rate data warrants it — no COGS at launch.

### T0 CPT scope

By default the topical map covers **editorial content only** — `post` and `page` post types. WooCommerce products, media attachments, and other CPTs are opt-in via agent settings. Rationale: CPTs and products often cluster into their own dense semantic regions that crowd out editorial analysis, and most T0 users want "what should I write," not "how is my product catalog structured." The opt-in expansion is one settings toggle; agency users who want full-corpus analysis can enable it.

---

## 6. Platform dependencies & asks

Named explicitly because they gate M1 entry or shape the SDK roadmap. This agent is the forcing function for the "index once, many agents consume" pattern; these are its costs.

**M1-entry gates (blocking):**

1. **`IVectorStore.getAllDocuments(siteId)`.** The interface today exposes `search()`, `lookupById()`, `getSiteStats()`, `listSites()` — top-K retrieval only. Topical clustering requires every document vector. One-method addition; `build_topic_map` cannot exist without it. Proposed signature: `getAllDocuments(siteId: string): Promise<Array<{ id: string; postId: number; postType: string; title: string; content: string; embedding: Float32Array; metadata: string }>>`, with `chunkIndex = 0` to return one representative document per post. Detailed spec in `docs/planning/seo-agent-index-gaps.md`.

2. **Index manifest / schema versioning.** Model name, dimensions, chunking parameters, and a monotonically incrementing schema version recorded in `IndexEntry` (or a manifest table), so consumers can detect mismatch rather than assume compatibility. Interim mitigation — hardcode assumption + warn on absent/stale entry — is acceptable for M1 **only if** the platform team commits that no model or chunking change ships without versioning the manifest first. That commitment is a prerequisite for M1 launch, not a nice-to-have. Detailed spec in `docs/planning/seo-agent-index-gaps.md`.

**Requested fixes (non-blocking; agent degrades gracefully):**

3. **Webhook-incremental chunking parity.** The per-post webhook path writes a single unchunked, 256-token-truncated document regardless of content length, so freshness and semantic fidelity are anti-correlated for recently edited posts. The agent excludes degraded entries from overlap scoring, but this silently shrinks analysis coverage on the most active sites. `check_index_health` surfaces the problem to users; fixing it in the pipeline eliminates it.

4. **Queryable dates in the index.** `post_date_gmt` and `post_modified_gmt` are stored as empty strings in the batch path. The agent works around this via WP-CLI; fixing it benefits every index consumer.

**Named follow-on (separate spec):**

5. **Platform credential layer (`contributes.credentials`-style).** Agent declares provider and scopes; Nexus UI owns consent, storage, and token refresh; WPE owns one verified OAuth app per provider. Not required for this agent's v1 (service-account pattern suffices), but a blocker for the class of agents needing third-party API access. This agent migrates when it lands.

---

## 7. Agent design

### Composition

**One `defineAgent`.** With indexing removed there is no daemon-shaped work. The analyst agent owns everything: conversational entry, cron-triggered reports, analysis tools, and action tools. Action tools stay with the analyst deliberately — the tier-3 approval moment needs the evidence chain sitting adjacent to the proposed action; a prompt that can't show *why* invites blind approvals and defeats the gate.

### Interaction model

- **Conversational.** "What should I write about next?" / "Do I have pages competing for the same keyword?" / "Audit my content" — the agent selects tools and composes the answer. If the topic map hasn't been built yet, inventory-only answers bridge the gap ("here's your corpus shape and orphans; the semantic map is building, approximately one minute").
- **Scheduled audit.** Weekly or monthly cron trigger producing the Site Content Report, delivered to the Nexus inbox. Cadence matches the reality that clustering is periodic planning work.
- **Action follow-through.** Every finding carries proposed actions the user approves in-line: "Draft it", "Merge these", "Fix links".

### Report: the Site Content Report

Single artifact per run, four sections in priority order:

1. **Act now** — confirmed cannibalization pairs and striking-distance queries.
2. **Write next** — demand-weighted gap list; each item expandable into a brief.
3. **Refresh** — decay queue.
4. **Map** — topical overview and structural issues.

Every finding surfaces its evidence chain: which queries, which URLs, what overlap score, what threshold was applied, index-freshness status, and degraded-entry notes where relevant. Explainability is a product requirement — the output's audience is often a stakeholder one step removed from the tool, and findings must be defensible without reference to the agent.

### Tool surface (contributes.tools)

**Analysis tools — read-only, tier-1 safety:**

| Tool | Tier | Description |
|------|------|-------------|
| `inventory_content` | T0 | WP-CLI metadata + internal link graph ⋈ index document vectors, keyed by postId |
| `build_topic_map` | T0 | Enumerate all vectors via `getAllDocuments`, cluster, TF-IDF label; `run` mode for large corpora |
| `find_overlap_candidates` | T0 | Semantic near-duplicate pairs above similarity threshold; degraded entries excluded |
| `find_structural_issues` | T0 | Orphans, stale cornerstones (WP-CLI dates), hubless clusters |
| `check_index_health` | T0 | Staleness, degraded-entry count, coverage vs. WP-CLI inventory, model assumption check |
| `detect_cannibalization` | T1 | GSC query→page pairs with ≥2 site URLs; impression/click split and position volatility |
| `classify_intent` | T1 | Batch intent classification over GSC query set (cached) |
| `find_demand_gaps` | T1 | GSC queries joined against topic map; striking-distance view |
| `detect_decay` | T1 | GSC click/impression trends joined to WP-CLI modified dates |
| `cluster_serps` | T2 | Overlap-coefficient graph clustering over fetched SERPs |
| `build_content_calendar` | T2 | Verified clusters → sequenced article plan with competitor co-occurrence view |

**Action tools — write; tier-3 approval-gated, per invocation:**

| Tool | Description | Guardrail |
|------|-------------|-----------|
| `draft_post` | Generate article draft from gap brief; create as **pending** post | Never publishes; draft status only; AI-drafted flag in post meta |
| `scaffold_brief` | Create structured content brief (ACF field group–backed where ACF present) | Creates draft/brief objects only |
| `propose_merge` | For a confirmed cannibalization pair: recommend canonical survivor, generate merged draft, stage 301 | Redirect staged as disabled proposal; user activates explicitly |
| `update_internal_links` | Add/adjust internal links within a cluster | Single reviewable changeset; dry-run diff shown before any write |

### Guardrails & safety

The agent never publishes, never activates redirects, never deletes content, and never modifies live post content without a shown diff and per-changeset approval. All writes are reversible (drafts, staged redirects, changesets) and logged to the agent activity log. The agent never writes to the content index — read-only consumer by construction. Content sent to the LLM is the site's own content plus the user's GSC data; no third-party content is scraped in T0 or T1. T2 SERP fetching runs through the user's own API account under their terms of service.

---

## 8. Data & privacy

- All analysis state lives in the site's environment; nothing leaves WPE except LLM inference calls (per standard Nexus data handling) and user-initiated T2 SERP calls.
- GSC: Restricted-user service-account grant (read-only by role); revocable by the user in Search Console at any time; query data cached with bounded TTL (default 28 days of rolling data, refreshed on run).
- Telemetry: tier activation, tool invocations, finding counts, action acceptance rate, index-health warning frequency — no content or query text in telemetry payload.

---

## 9. What we reuse

- **The Local Nexus content index.** Consumed, not duplicated. One embedding pipeline, many agent consumers; this agent is the pattern's first proof. The sqlite-vec file travels with the site through push/pull, so an index built locally serves the production agent and vice versa — connecting the Local and WPE product stories at zero marginal cost.
- **Giordano SERP-Clustering method (MIT-licensed).** Graph / overlap-coefficient / TF-IDF approach for T2, reimplemented within the SDK at ~200 lines. The method, not a dependency.
- **Interpretability doctrine.** Rules wherever a rule exists (cannibalization, SERP clustering, structural issues); embeddings only where rules can't reach (topical mapping, gap candidates); every embedding-derived finding surfaces its evidence in human terms.

---

## 10. Metrics

**Activation.** % of installs completing a T0 run within 24h of enablement; time-to-first-insight (target: under 2 minutes on a 500-post site — embedding cost is gone, so the bar tightens from the original 5-minute target).

**Depth.** T0→T1 GSC connection rate (primary funnel metric; target 40%+ of active T0 users within 30 days); T2 key attach rate (instrument only, no target at launch).

**Value.** Action acceptance rate (findings → approved actions — the honest measure of whether insights are trusted); drafts created; merges completed; % of striking-distance queries improving position within 60 days of an accepted action (lagging, cohort-based).

**Retention.** Scheduled-report open/engagement rate; monthly returning users per install.

**Platform signal.** Index-health warning frequency per site-week — the proxy for how often the freshness and degradation gaps bite real users, and the evidence base for prioritizing §6 items 3–4 in the platform backlog.

---

## 11. Milestones

**M0 (gate, not a sprint):** Two platform commitments land or are formally scheduled: `getAllDocuments()` (blocking) and index manifest plan (blocking-with-accepted-interim). Service-account provisioning path confirmed with infra. No agent implementation begins before M0 is satisfied.

**M1 (3–4 weeks):** T0 end-to-end — inventory join, topic map, gap and overlap candidates, structural issues, index health check, Site Content Report. Internal dogfood on the WPE plugin portfolio's marketing sites.

**M2 (+3 weeks):** T1 — service-account connect flow, cannibalization, demand gaps, intent classification, decay detection. First action tools: `draft_post`, `scaffold_brief`.

**M3 (+4 weeks):** `propose_merge`, `update_internal_links`, scheduled reports. Private beta with 20–30 sites across the three user personas.

**M4:** T2 with BYO key. Public availability alongside a Nexus SDK marketing beat.

---

## 12. Risks

1. **M1-entry platform dependencies are outside the agent team's control.** If `getAllDocuments()` slips, M1 slips one-for-one. Mitigate by scoping the method now — it is a one-method addition to a stable interface with a clear implementation path (one SQL join on existing tables).

2. **Silent model drift before the manifest lands.** The interim hardcode-and-warn posture holds only if pipeline changes are coordinated with the agent team before shipping. This requires an explicit agreement, not a ticket — the ticket closes when the manifest ships; the agreement prevents damage in the gap.

3. **Semantic-only T0 findings treated as verdicts.** Mitigated by labeling ("unverified — connect Search Console to confirm"), but copy and report design carry real weight. This is the most likely trust-erosion vector and the one most controllable through product execution.

4. **Degraded webhook entries on active sites.** `check_index_health` surfaces the problem to users, but the real fix is §6 item 3. The agent's mitigation (exclude degraded entries from overlap scoring) silently shrinks coverage on active sites — exactly the sites that matter most for a live editorial team.

5. **Draft quality.** A generic AI-drafted post damages the entire value proposition. Drafts must be grounded in the site's own voice (few-shot from its top content by engagement or inbound-link count) and gap evidence, not just the brief's topic. The `draft_post` action launches with conservative defaults and the voice-grounding behavior on by default.

---

## 13. Open items (require decisions before M2)

| Item | Owner | When needed |
|------|-------|-------------|
| `propose_merge` redirect staging: bundled mechanism vs. ecosystem plugin integration | Agent team + platform | M2 planning |
| Similarity threshold calibration (default 0.85; validate on dogfood corpora) | Agent team | Before M1 beta |
| Naming / branding decision (SEO Insights vs. Site Compass vs. Content Radar) | Product + marketing | Before M3 |
| Fleet/multisite view design constraints: ensure report format is composable for a later roll-up without a rework | Agent team | M1 report design |

---

## 14. Out of scope for v1

Rank tracking, backlink analysis, technical SEO audits (crawlability, Core Web Vitals — NitroPack's territory), multi-site roll-ups, non-Google search engines, index ownership or writes of any kind, any auto-publish behavior. Each is a deliberate cut. The agent's identity is *content strategy from your own data*; scope creep toward "all of SEO" is the primary failure mode for v1.
