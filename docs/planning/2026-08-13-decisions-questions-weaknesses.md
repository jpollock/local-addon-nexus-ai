# Fleet Workspace — Decisions, Open Questions, and Known Weaknesses

**Date:** 2026-08-13
**Covers:** the design doc, the four track plans, and the Track 1 implementation
**Why this exists:** most of this work was designed and built ahead of settled requirements. This records what was decided on the user's behalf, what remains genuinely unanswered, and where the code is shaped by a gap rather than by a choice. Every decision below is reversible; the point is that reversing one should be a decision too, not a discovery.

---

## Part 1 — Critical decisions taken, and what each costs if wrong

### D1. `nexusd` extraction is justified on quality, not future-proofing

The extraction was first framed as unlocking the paid tier. That made it easy to defer. It was re-argued on the grounds that V1's central interaction is a fleet-wide assessment, and that is precisely the workload that freezes Local's UI today (`T-PERF-THREAD`).

**If wrong:** we spend a large effort on a process boundary when worker threads inside Electron would have sufficed. Recoverable, but the sunk cost is real, and the paid-tier redeployment argument would then be carrying weight it was explicitly not supposed to carry alone.

### D2. Credentials are injected at spawn and held in memory only

`KeyVault` uses Electron `safeStorage`, which `nexusd` will not have. Rather than add an OS-keychain dependency, Local unlocks and injects; the daemon never writes secrets to disk.

**Accepted consequence:** closing Local revokes the daemon's ability to act on anything. For a V1 with no always-on tier this reads as a safety property. **It becomes a blocker the moment the paid tier exists**, and the server-side secret store is deliberately unsolved.

### D3. Fleet grain is WPE installs grouped by WPE site, with local-only sites retained

Grouping follows CAPI's own shape rather than an invented one. Local-only sites stay in the list even though the fleet is WPE-primary.

**Why the second half matters:** Local's install base is far larger than WP Engine's customer base. A WPE-installs-only list opens empty for most Local users, which quietly undercuts the "free tier for Local users" distribution argument that justified desktop-first in the first place. Keeping them costs almost nothing and preserves the conversion path.

**If wrong:** if most users turn out to have no WPE account, the fleet is a mostly-empty room and the product's centre of gravity is wrong.

### D4. `site_links.local_site_id` is the sole primary key

The design sketched a composite key. A sandbox is pulled from exactly one install, so one row per local site is the truer model; two local sites may still point at one install.

**If wrong:** a genuine need for one local site linked to several installs requires a migration. Low cost, low likelihood.

### D5. A `user` link is permanently authoritative

Automatic resolution never overwrites a human's answer, and `resolveOne` does not even call CAPI for a user-linked site.

**If wrong:** a user who mislinks a site has no self-healing path — the system will never correct itself. The final review found this compounding with unvalidated identifiers and it was fixed (ids are now verified against `graph.db` and the install name derived rather than trusted), but the underlying asymmetry stands by design: **a wrong human answer is sticky.** `nexus_unlink_site` is the escape hatch and must stay discoverable.

### D6. Both lenses emit one findings list

Site health and content health are ranked together, not segregated. The design mockups arrived at the same answer independently.

**If wrong:** users need to filter by lens constantly and the unified list is noise. Cheap to reverse — `Finding.lens` is carried for exactly this reason.

### D7. Own-data only; no market intelligence

No Ahrefs, no SERP or AI Overview scraping, no YouTube. Content intelligence reads the customer's own content index and their own Search Console.

**Rationale beyond scope:** the strategy document's own risk section says WP Engine would compete with "fundamentally incomplete data" against specialists. The one place that reverses is `log-processor`'s access-log analysis, which sees what AI crawlers actually did on infrastructure we own — data Ahrefs cannot obtain.

**If wrong:** we cede the AEO conversation to tools that scrape, and the "own data" line reads as a limitation rather than a position.

### D8. Sandboxes persist after push

With an explicit discard action. Ephemeral is the better answer and is deferred.

**Known cost:** users accumulate working copies. This was chosen for V1 simplicity, not because it is right.

### D9. Track 1 shipped with no UI

The shell is being replaced and the design is directional, so the whole track is verified through MCP tools and unit tests.

**If wrong:** we have built a data layer against an interface that never materialises in the shape assumed. Mitigated by the layer being UI-agnostic by construction.

### D10. Implementation proceeded on a branch, not a fresh worktree

`design/native-fleet-workspace` is not `main`, which was the binding constraint, and the repo already carries 15 stale worktrees.

**Cost:** design documents and implementation share a branch and must be reviewed and merged together.

### D11. The Track 1 fix wave included a scope expansion

The final review found that `reconcileAll`'s unresolved list was computed and then discarded — nothing could read it, so `nexus_link_site` required knowledge only reconciliation could produce. Surfacing it was ruled into the fix wave rather than deferred, because the design calls that surface "required, not a fallback path."

**Cost:** a wider fix wave than a pure defect fix. Judged worth it — the alternative was a track that did not deliver its own stated outcome.

---

## Part 2 — Open questions that genuinely block work

Ordered by how much is waiting on each.

### Q1. Is the desktop shell an evolution of Local's renderer, or a replacement? **(blocks the most)**

The design-team mockups look nothing like Local's current UI, which points at replacement. The design handoff README instructs building inside `app/renderer/` with `@getflywheel/local-components`, which assumes evolution. **These contradict, and the designer was not told which is true.**

Waiting on it: Track 2 Stage 3.4 (re-pointing ~135 renderer IPC channels) is wasted work under replacement. Track 3 Stage 4 and Track 4 Stage 4.4 are both gated on it. Answer this before Track 2 Stage 3.4, not after.

### Q2. Who owns Nexus? — PARTIALLY ANSWERED 2026-08-13

**Answer given:** "me, but I work for WP Engine."

That is not yet a clean answer, and it should be made one before anything ships rather than after. The practical position today: the repository is on a personal GitHub remote, publishes to a personal npm scope, is MIT-licensed, and is built on WP Engine's APIs against WP Engine's strategy documents, with WP Engine's design team producing assets for it. Work produced by an employee within the scope of their employment generally belongs to the employer, which means the current arrangement is probably a paperwork gap rather than a genuine ambiguity — but it is not for an engineer or an assistant to decide.

**Not blocking:** continuing to build.
**Blocking:** bundling with Local, publishing, or anything that puts WP Engine's name on the distribution. Concretely that means a repo transfer, an npm scope move, a decision on the MIT choice, and `T-UNBUNDLE-AI` — redistributing a third party's GPL plugin is a materially different question when WP Engine is the distributor rather than an individual.

### Q2-original. Who owns Nexus?

The repository is under a personal GitHub account, publishes to `@local-labs-jpollock`, and `main` is 1,276 commits ahead of an origin it has never been pushed to in bulk. Shipping this as WP Engine software needs a transfer, a licensing pass, and a decision on `T-UNBUNDLE-AI` — redistributing a third party's GPL plugin is a materially different question when WP Engine is the distributor.

Waiting on it: all of Track 2 Stage 4 (bundling and default-on).

### Q3. Who is the ICP? — ANSWERED 2026-08-13

**Answer given:** an agency developer managing tens to hundreds of sites, and building new ones.

**What this confirms.** Desktop-first is right — this is exactly who Local already serves, and the strongest North Star responses (the two 5/5 ratings) were solo agency owners. The safety-boundary finding, which I had flagged as well-evidenced for developers and unevidenced for marketers, is now squarely on-ICP; that tension dissolves. The 200-site calm problem is real rather than hypothetical, and the performance work moves from speculative to critical-path.

**What this challenges — two things, both worth deciding.**

**C-1. "And building new ones" is half the stated job, and the design does not address it at all.** Everything designed so far is fleet *management* — see, understand, act, verify on installs that already exist. Site creation is a different job with a different shape: blueprints, scaffolding, standing up a new client site from a template. Local already does this and the design mockups gestured at it ("Landing page", "Save as Blueprint"), but no track covers it. If building is genuinely half of what this user does, the fleet-workspace framing is half a product.

**C-2. An agency developer's hundred client sites are almost certainly not all on WP Engine.** External SSH hosts were scoped out on the basis that "WPE is primary" — a decision taken *before* the ICP was named. For an in-house team, WPE-primary is obviously right. For an agency managing a hundred inherited client sites, a fleet that only shows the WP Engine subset may show a minority of their actual fleet, and the "connective tissue" claim weakens sharply. Nexus already supports arbitrary SSH hosts, so this is a scoping decision rather than a build. **Recommend re-opening it.**

### Q3-original. Who is the ICP?

Ten North Star sessions are in, and not one is with a marketer — while the Q326 strategy is premised on the expanding marketer. The strongest adopters so far (5/5) are solo agency owners, a segment the strategy does not centre.

The architecture is robust to the answer. **Surface priority is not.** Which UI ships first, and whether wp-admin is a client, both depend on it.

### Q4. What does the paid tier attach to, and where does it run?

The WP Engine account was chosen as the identity anchor. Nothing else is settled: no hosting substrate, no server-side secret store (see D2), no billing. Track 2 Stage 6 cannot be planned past its shape.

### Q5. Free tier inference — bring-your-own-key, or included?

BYO keeps marginal cost at zero but puts a signup wall in front of the first magic moment, and Ollama-only means the free experience is as good as the user's laptop. Included inference makes it genuinely free but reintroduces the per-user cost that desktop-first was supposed to eliminate. Both shapes are already supported in code, so this is a product decision, not a build.

### Q6. Does the "Local is the safety boundary" finding transfer to marketers?

It is well-evidenced for developers and agency owners. Marketers already work in wp-admin on cloud staging. If it does not transfer, the containment story is a segment preference rather than a product constraint, and some deferred options reopen.

---

## Part 3 — Weaknesses the code carries because requirements were thin

These are not defects that passed review. They are places where the absence of an answer shaped the code, and a future reader should know it was a gap and not a preference.

### W1. `site_links` has exactly one reader

The table exists to replace the `hostConnections` → CAPI inference. It does not yet. `remote-exec.ts` and `get-site-changes.ts` — the two operational consumers of install identity — still call `resolveWpeInstall` directly.

**Effect today:** a user who corrects a link sees the fleet list change and nothing else. Remote WP-CLI still routes by the broken inference, while `nexus_link_site`'s description tells the model the link is authoritative. That is true of the row and false of the system.

**Why it happened:** Track 1 was scoped as identity-and-provenance, and nobody asked which callers consume identity. Assigned to Track 3 Stage 3, which is what actually routes remote execution.

### W2. The provenance ladder was derived from a column the guaranteed sync path never writes

`deriveProvenance` originally read `last_sync_at`, which only the triple-gated SSH sync writes — so CAPI-populated rows reported "never successfully reached" while displaying data CAPI returned seconds earlier. Caught only by the whole-branch review; all five unit tests hand-fed the column.

**Fixed**, and the fix added the missing `external-api` rung. **The lesson is the weakness:** the plan specified a provenance rule without anyone tracing which code path actually populates its input. Track 4 has the same exposure across many more detectors.

### W3. Test fixtures were, in two places, shaped so a bug would pass

The sandbox-naming test would have passed with the wrong field because the fixture made both names identical — caught in plan self-review. The provenance tests all supplied `last_sync_at` — caught only in final review.

**Both share a cause:** tests written from the same understanding as the implementation, in the same pass. The review layers caught them; a thinner process would not have.

### W4. There is no identity model, so every permissions requirement is deferred

Every research participant raised permissions — developer versus contributor, restricted client access, per-agent rules. Nexus has excellent *tool* authorization and no concept of *who is asking*. Track 3's approval surface is therefore single-actor, and "approved by" cannot be recorded.

**Effect:** the sandbox approval is a trust mechanism with no audit subject. Acceptable for single-user V1; it is the first thing that breaks under collaboration, which is the strategy's own step-change assertion.

### W5. Divergence detection inherits MagicSync's known weaknesses

Track 3 Stage 2.2 rests on manifest diffing that is mtime-based rather than content-based, uses two different exclusion lists for preview versus transfer, and fetches its rsync exclusion list from a remote URL at push time. The plan works around this by hashing the changed set, but the underlying machinery is not trustworthy and was not built for automated use.

### W6. `withTimeout` bounds the sweep but cannot cancel the CAPI call

The Critical startup fix bounds each per-site resolve, but `resolveWpeInstall` has no cancellation token, so a late completion still runs and writes its link. Harmless today; it is unbounded work continuing after the thing that wanted it gave up. The same gap exists in `AgentAIClient` (a known `TODO` about threading an `AbortSignal`), and the design mockups have already promised a Stop button that depends on it.

### W7. Two eval tests fail, pre-existing

`tests/eval/instructions-quality` has two failures on the branch point: a discovery-first regex that no longer matches the current wording, and a `<15000` character ceiling that has been stale since the server instructions grew past 37k. Verified pre-existing by stashing. They are not this work's failures, but they mean **the eval suite is not currently a gate**, and the routing-table additions landed with that gate already red.

### W8. The fleet's reach is bounded by WPE account ownership

Retaining local-only sites (D3) mitigates the empty-app problem, but the differentiated capability — health assessment from CAPI data — is only available to WP Engine customers. The free tier's reach and the product's differentiation point at different populations, and no one has reconciled them.

---

## Part 4 — What I would want answered first

If only three of the questions above can be answered soon, these are the three that unblock the most and cost the most to guess wrong:

1. **Q1, the shell** — because it decides whether a large, mechanical piece of Track 2 is worth doing at all.
2. **Q2, ownership** — because it gates bundling, and because everything built so far lives on a personal remote.
3. **Q3, the ICP** — not because it changes the architecture, but because it decides what to build after the loop closes, and Talissa's recruitment is already in flight.
