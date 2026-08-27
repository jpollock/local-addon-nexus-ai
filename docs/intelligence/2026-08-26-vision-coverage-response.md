# Response to the vision coverage review — what verified, what did not, what it missed

*2026-08-26 · a check of `2026-08-26-vision-coverage-review.md` against the tree
at `0b042a5a` (`fixes-082526`, since fast-forwarded to `main`). Method: four
independent verification passes — the packet record, the eval registry, the
emission/consumption seams, and the ADR/residual claims — each required to quote
`file:line` rather than agree. Where this document and the review disagree, the
evidence is named so a third reader can settle it without either of us.*

**Standing on the review as a whole:** its shape is right and its method is
sound. The core loop is built, bucket (a) is a real open list and a genuine
superset of the roadmap's own "Next locks," and its structural findings about
the closed loop survive checking. What follows is not a rebuttal; it is the
delta.

---

## 1. What changes

Two of the review's load-bearing numbers do not survive, and both feed its top
recommendation.

**The 18 BLOCKED eval criteria are not owned by one surface, and 11 of them
cite a surface that already shipped.**

| blocker | count | evidence |
|---|---|---|
| UX build 2 (`needsYou` — Home needs-you rows + audit view) | **11** | `tests/intelligence-evals/checks.ts:1245,1256,1264,1276,1287,1299,1307,1315,1323,1331,1343` |
| UX build 1.5 (`refusalTurn` — M4 companion densities) | **5** | `checks.ts:1376,1387,1402,1418,1429` |
| The comparator surface (incident→cell join) | **1** | `checks.ts:2033-2046` |
| WP-18 (automated agent runner producing a transcript) | **1** | `checks.ts:986-999` |

The review's "the comparator surface … single-handedly owns the 18 BLOCKED
criteria" is wrong twice over: the comparator owns one, and the comparator
itself shipped at WP-41.

The deeper problem is the 11. They are produced by `journeyGapCheck`
(`checks.ts:1150-1168`), which returns `blocked(...)` on **every** path and only
decorates the evidence with a measurement. `needsYou` is live in five renderer
files — `PropertiesTab.tsx`, `return/Arrival.tsx`, `return/arrivalModel.ts`,
`DockedPanel/DockedPanelContainer.tsx`, `DockedPanel/headerAmbient.ts` — since
WP-46 (2026-08-20). So those criteria print evidence reading *"present"*
directly above a `⊘ BLOCKED` verdict.

The registry forbids this in its own words, `checks.ts:1733`:

> a BLOCKED that goes on citing a shipped surface is the stale gap the
> harness's own rule forbids.

WP-41 and WP-46 both fixed their checks to gate on
`ctx.probes.surfaces.absentFromRenderer(TOKEN)` (`checks.ts:1817`, `:2266`), so
a shipped surface flips the verdict. `journeyGapCheck` never received that
treatment; WP-46's header concedes it moved out only the ten J-Return/J-Glance
criteria it touched, leaving the eight J-Act-small entries unrevisited. The five
UX build 1.5 entries are *legitimately* blocked — `refusalTurn` returns zero
hits under `src/`.

**The tally has not been re-run since its premises changed.** `50 / 0 / 18 / 10`
is arithmetically correct against the code as committed (78 criteria: B-03 15 ·
E-01 10 · E-02 9 · J-Act-small 8 · J-Glance 8 · J-Inspect 8 · J-Refusal 12 ·
J-Return 8; 18 unconditional `blocked()`, 10 unconditional owner-pending, the
remaining 50 passing). But it is a **2026-08-25 reading**, and `probes.ts`
changed on **2026-08-26** in `79860f87` — the agent-addressed-grants fail-closed
flip, which revokes every platform-wide grant on a v1 machine. That is exactly
the class of change that knocks out a probe premise and converts PASS → BLOCKED
through the fallback paths at `checks.ts:1539/1618/1673/2877/2922/2958`. Five
further grants/permissions commits landed the same day. None re-ran the
registry; the last receipted run inside `WORK_PACKETS.md` is at `:21168`, in
WP-49 (2026-08-20).

Consequence: **the first move is not to build UX build 2.** It is to make the
harness capable of telling the truth about it, then ask again.

Structural note on why this went unnoticed: the criteria live as YAML
(`docs/intelligence/anchor-slice/evals/*.yaml`) but the **verdicts live in
executable TypeScript** (`tests/intelligence-evals/checks.ts`) and are computed
at run time. The tally is never persisted anywhere machine-readable — its only
durable form is prose in `WORK_PACKETS.md`, `INTELLIGENCE_ROADMAP.md` and review
documents like this one. A number that only exists in prose goes stale silently
and gets copied forward. `CHANGELOG.md:12` already carries the worst version of
this: "eval registry 50 PASS / 0 FAIL," with the BLOCKED and OWNER-PENDING
columns dropped entirely, which reads as a clean bill of health.

---

## 1A. Measured, after the fix (2026-08-26, same day)

`journeyGapCheck` now distinguishes the two walls, and the registry was RUN —
the first receipted run since WP-49 (2026-08-20). **The totals are unchanged:
50 PASS / 0 FAIL / 18 BLOCKED / 10 OWNER-PENDING**, which is itself a result:
the grants packet's changes to `probes.ts` knocked no premise out, so §1's
staleness worry about the tally was a real risk that did not materialize.

**The composition is not what anyone said it was.** Measured breakdown of the
18:

| blocker | count | note |
|---|---|---|
| an acceptance driver for `needsYou` in this harness | **11** | the surface SHIPPED at WP-46; nothing walks it |
| UX build 1.5 (`refusalTurn`) | 5 | genuinely absent — 0 files under `src/`, renderer or not |
| WP-18 (an automated runner producing a transcript) | 1 | |
| a packet joining WP-25's incident producer to the comparator cell | 1 | |

**So UX build 2 owns none of them as a build.** The review said it owned 11 and
I repeated that; both of us were reading a verdict that named the render. The
render is present. What stands between here and those 11 is eleven acceptance
drivers in `tests/intelligence-evals`, following the pattern WP-41 and WP-46
already use — gate on `absentFromRenderer`, then drive the real surface.

That is a different packet with a different owner, and it moves the eval tally
by more than any UI work available today. **§5's order is superseded on this
point: what was step 3 is not a UI build.**

The report's verdict block now says which wall each BLOCKED is against, and
`CriterionResult` carries a typed `blockedOn: 'product' | 'harness'` so the
summary cannot drift from the detail again.

---

## 2. Verified — the review's findings that hold

Recorded so they are not re-litigated:

- **Agents emit but do not consume.** Assembly happens (`AgentRunner.ts:119-127`)
  and the bundle's only live use is its `failClosed` boolean → refusal bind
  (`buildAgentContext.ts:109`, `agentAssembly.ts:149`). `grep -rn "contextBundle"
  agents/` returns zero. The tree says so about itself in three places —
  `agentAssembly.ts:33-38` ("zero change to any agent's model call"),
  `AgentRunner.ts:145-146`, `agent-sdk/types.ts:146-150`. Retrieval is
  deliberately omitted from the agent assemble call (`agentAssembly.ts:262-268`),
  so the agent bundle is thinner than chat's by construction.
- **The instrument class is dark.** Zero `state.instrument` in `src/`. Both
  analytics agents live outside `src/`, import only `@nexus-ai/agent-sdk`, and
  are `tier: 1` (`agents/web-analytics/nexus.agent.yaml:6-7`), so even the
  runner-level gated-act path never fires for them. The only ledger trace an
  analytics run leaves is its generic run frame.
- **`semantic.content.indexed` is never emitted** — zero occurrences in `src/`
  in any category (no type, no fixture, no producer). The only `semantic.*`
  producer is `semantic.content.changed` (`wpEventProducer.ts:109`). The
  allowance is declared in `docs/digital-twin-data.md` §5.2 and policed by
  `tests/unit/docs/documented-topics.test.ts:271-282`.
- **`episodic.*` has four live producers and no import path** —
  `syncProducer.ts:139-141` (pulled/pushed), `incidentProducer.ts:701-703`,
  `agentFailureProducer.ts:258-260`. No ledger-import surface of any kind exists.
- **The refusal bind has no UI** — a thrown `Error`
  (`NexusToolProvider.ts:252-261`) plus the `fail_closed` manifest, and nothing
  in `src/renderer/`. (The ~25 renderer hits for "refusal" are WP-44's chat and
  Govern doors — a different mechanism with its own copy table.)
- **§8 is contract-level only**, and §3A says so plainly (`architecture.md:106`):
  *"There is no hub and no Postgres: the satellite is the whole system."* No
  `gw_hub`, no replication cursor, no mutual-TLS transport in `src/`.
- **The two partial ADRs cannot be named from this repository.** The verdict
  appears exactly once (`INTELLIGENCE_ROADMAP.md:272-275`); `architecture.md` §9
  records every ADR as Accepted; no per-ADR audit table exists anywhere.
- **WP-29 is genuinely open**; WP-58b, WP-51a and WP-30b are registrations with
  no build entry; WP-53 and WP-66 were never used.

---

## 3. Corrected — eight findings that did not survive

**3.1 · WP-67's WPE reason sentence already landed** — 2026-08-22, four days
before the badge half, as D12 (`da2118ff`). `WPESyncService.ts:703-728` now
distinguishes a failed read from an empty one; the false string *"No content
returned by the extractor"* survives in `src/` only as a comment recording its
removal (`externalBulkOps.ts:149`). The "external read-failure honesty" item the
review guessed at is the **external/SSH sibling**
(`ExternalContentIndexService.ts:78-88`), not the WPE one — its own commit body
says "the WPE sibling D12 was already fixed." Root cause of the mistake:
`INTELLIGENCE_ROADMAP.md:261-263` still lists both as the next packet's first
items. The review inherited a stale roadmap line rather than checking the tree.

**3.2 · WP-64's corrections did land in the repo.** `architecture.md` carries
them — 368 active rows (`:133`), three link kinds (`:190`), the
`content_pulled_from` lineage edge (`:211`), the three-tier `resolveUpstream`
box (`:216`), `twin_facts · fold_cursors` drawn (`:132`). What is owed is a
republish of the **externally published artifact**, an owner action outside the
repo that needs the artifact URL (`WORK_PACKETS.md:31424`,
`2026-08-25-docs-truth-sweep.md:161`). *Before anyone republishes from it:*
correction **A8** ("remote capped at 200 — structural, no pagination") is now
false — `RemoteContentExtractor.ts:41-45` pages until a short page, with
`REMOTE_MAX_POSTS = 5000`. The corrections file is dated evidence, not live
truth.

**3.3 · "7 false positives" is 9.** Ten headings still read `[ ]` — WP-20, 20c,
20d, 20e, 20f, 20g, 26, 27, 29, 30 — and nine of them have later merge or
acceptance entries in the same file. WP-29 is the only true open. The review's
own sentence lists ten items, so "7" is inconsistent with its own text as well
as with the file.

**3.4 · The checkbox convention ends after WP-42, not WP-33.** `[x]` headings
continue past WP-33 (`:11215` WP-33b, `:14141` WP-39, `:14898` WP-42); from
WP-44 onward the file switches to LOCK ANNOUNCE / GATE REPORT / MERGED /
MERGE ACCEPTED sections with no checkbox at all. Any explanatory note must name
WP-42 or it will mislead the next reader the same way.

**3.5 · Two of the five micros landed.** Verdict mechanization and the
empty-match MET fix were folded into WP-42, a checked, merged packet
(`WORK_PACKETS.md:14786-14788`, `:14898`), and the post-Wave-6 standing micro
list no longer names them. Genuinely unlanded: citation-peek supply, grant-fold,
`--json`/stdout.

**3.6 · G4 and G5 are swapped.** "All accumulated intelligence survives model
swaps" is **G4**; **G5** is "the closed loop is structural: acting through the
system emits history by construction" (`architecture.md:17-18`). This matters to
the argument rather than being pedantry: G5 **is** satisfied for agents now —
WP-57/WP-59 made emission structural. What is unmet is G4's promise and §6's
entire reason for existing. "The loop is half-closed" is the right instinct
attached to the wrong goal.

**3.7 · Milestone 3 is not closed.** M1 is closed and live-smoked
(`INTELLIGENCE_ROADMAP.md:22`); M2 closed 2026-08-17 with an owner sitting
(`:29`). M3 **opens** at Wave 3 (`:84`) and carries an explicit remainder under
"Later — deliberately not now" (`:347`): assembler task frame, instruments,
`code_ref`, surfaces B/C/D, hub + tenancy + sync. Most of the review's bucket
(c) is that documented remainder rediscovered, not uncharted territory — which
is reassuring about the docs and slightly deflating about the finding.

**3.8 · Only 7 of the 10 OWNER-PENDING need the API key.** Seven are B-03
sittings requiring `NEXUS_EVAL_API_KEY` (`checks.ts:157-183`). The other three
need a person at a rebuilt Electron tree and no key at all: the E-02 rationale
judgement (`checks.ts:1006-1030`, read the last
`task.rationale.recorded` payload), the J-Refusal design sitting
(`checks.ts:1101-1128`), and the J-Inspect prose check (`checks.ts:2063-2086`).
All four prompts require recording the verdict back into `WORK_PACKETS.md`.

---

## 4. Missed — and the first one is mine

### 4.1 · §D.7 shipped unruled: the gate checks the contributor

The agent-actor design note is unambiguous
(`agent-actor-design-note.md:458-474`). Cross-agent contributed tools are
*"a security ruling, not sequencing"*; both candidate defaults have holes —
check the caller and B's capability surface is annexed by anyone who declares
one of its tool names; check the contributor and A escapes its own scope. The
note therefore requires the ruling **before** actor-scoping ships:

> an unruled default here is a hole that arrives *with* the mechanism meant to
> close one.

Actor-scoping shipped 2026-08-26. The packet spec
(`docs/planning/2026-08-26-agent-addressed-grants.md`) contains the word
"contributed" **zero times**. The code silently adopted option (B):
`NexusToolProvider.ts:330` dispatches with `contributed.agentName`, and
`AgentDispatcher.ts:103` passes that same name as the grantee to
`checkCheckpointSequence`. **The gate checks the contributor, not the caller.**

The population is real and shipped: `agents/seo-insights/nexus.agent.yaml:31`
declares log-processor's `get_log_aggregates`. No test covers the case — the
wiring suites drive a single agent, `acme`
(`src/main/intelligence-host/__tests__/sequenceGuardWiring.test.ts:248` et seq),
and `grep -rn "cross-agent\|contributor\|annex"` across the grant tests returns
nothing.

**It is doubly latent, and that is the argument for doing it now.** No grantee
holds anything (the fail-closed flip revoked every grant), and no runbook in
`law/` names an agent-contributed tool — `reachRefusal` computes `declaring`
from capabilities that name the tool, so today the refusal path never engages
for these calls either way. Nothing is exploitable. But the default is *set*, in
code, with no ruling, no comment and no pin, and it becomes load-bearing the
moment either condition changes — the first re-grant, or the first runbook
authored against a contributed tool (which is also open question 3 in the same
note, and a phase-5 precondition).

Cost to close: one owner ruling, a small change at the dispatch seam, and a test
that drives A→B. An afternoon now; a migration later.

*Provenance, since it matters: I built the grants packet. This is my gap, found
by checking the design note against my own diff rather than by the review.*

### 4.2 · The review contradicts itself on phase 3

It lists the 2026-08-26 packet (agent-addressed grants) as delivered, then
repeats WP-59's residual — *"v0 holds no capability grant for agents — the
procedure plane stays dark on agent runs until phase 3 lands"* — under
"residuals nothing has since picked up." Phase 3's grant model **is** that
packet. Agents can hold grants now, granted per agent in its own workspace
(`AgentWorkspaceSettings.tsx:661-669`, "Procedures this agent may run");
materialization seeds only `chat` and `mcp-client`
(`capabilityGrants.ts:238`), so an agent holds only what a human granted it. The
accurate statement is *dark by design on a fresh upgrade*, not *dark for want of
a mechanism* — a different problem with a different fix (grant something and
watch it, rather than build the model).

What genuinely remains of phase 3 is §D.7 above.

### 4.3 · The topic-taxonomy guard cannot see `/agents/`

`tests/unit/docs/documented-topics.test.ts` scans `SRC_ROOT = <repo>/src` only
(`:48`) and skips `__tests__`. Its guarantee is therefore "nothing in `src/`
emits these," not "nothing in the repo does." The gap sits exactly where the
risk is: `/agents/` is where an instrument-class producer would be written, and
the instrument class is the taxonomy's largest unbuilt allowance. The
conclusion holds today (both agents genuinely emit nothing), but the guard is
weaker than it reads.

### 4.4 · The ADR verdict does not add up

"ADRs 1–24 (9 confirmed, 2 partial)" sums to 11 across a range of 24. Whatever
the intended scope was, the sentence as recorded cannot be reconstructed — and
with the two partials unnameable, the whole verdict is currently unusable as
evidence. Worth resolving before it is cited a fourth time.

---

## 5. The order this argues for

1. **Rule §D.7 and pin it.** Free while every grant is revoked; not free after.
2. **Fix `journeyGapCheck` to gate on `absentFromRenderer`, then run the
   registry.** Half a day. It converts "UX build 2 owns 11 BLOCKED" from an
   assumption into a measurement, and re-establishes the 50 PASS against
   post-flip probes.
3. **UX build 2**, sized by what step 2 returns.
4. **The consumption question, as an eval-design problem before a build.** Three
   source comments state the additive shape is deliberate pending evidence.
   Wiring prose into agent prompts before there is a way to measure whether it
   helps moves the unknown rather than resolving it. Design the eval that would
   answer it, then build to that.
5. WP-58b · WP-51a · the three surviving micros · the two sittings · pipeline
   observability phases 2–4.

## 6. Record hygiene to fold in

- A top-of-file note in `WORK_PACKETS.md`: checkbox headings end **after WP-42**;
  from WP-44 the LOCK ANNOUNCE / GATE REPORT / MERGED / MERGE ACCEPTED entries
  are the record. (Nine of the ten surviving `[ ]` headings are stale; WP-29 is
  the exception.)
- `INTELLIGENCE_ROADMAP.md:261-263` — both WP-67 items are paid (WPE 08-22,
  badge 08-26); the line should say so.
- The roadmap's "Next locks" omits WP-29, WP-51a, WP-30b and the micro bundle,
  and understates bench progress (P5 ranking has since landed).
- Name the two partial ADRs, or retract the verdict.
- Note A8's staleness inside `wp64-figure-corrections.md` before the artifact is
  republished from it.

## 7. Limits of this check

The eval runner was **not executed** — it seeds a fixture ledger, which is a
write. Section 1's counts are static reads of `checks.ts` reconciled against
`checks.test.ts:506` (44 journey criteria) and the eight YAML specs. A true
"as of now" tally still requires
`npx ts-node --project tsconfig.test.json tests/intelligence-evals/run.ts`
(expect exit 2), and should be run **after** the `journeyGapCheck` fix, not
before — otherwise it will reproduce the same 11 stale verdicts and appear to
confirm them.

Nothing in this document was taken from the review's own text as evidence for
itself; where the review is the only source for a claim, that is said.
