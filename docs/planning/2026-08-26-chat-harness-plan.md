# Chat harness: providers, tool budget, and the discovery invariant

**Date:** 2026-08-26 · **Branch:** `spike/power-ai-sdk` (spike landed: `792606fe`)
**Status:** charter — approved problem set; P1's probe result steers two workstreams.

## The originating incident

2026-08-25, session `hmbk49fexj`: chat told the owner it had no web-analytics
capability while a bound GA4 property for `acfprod` sat in `graph.db` and the
`agent__web-analytics__*` tools worked over MCP ten minutes earlier. Root
cause chain, each link measured:

1. Chat runs on Power (`nexus-ai_settings.json → aiProvider: power`).
2. `POWER_MAX_TOOLS = 128` (`ChatService.ts`, commit `502d3554`) slices the
   tool array; contributed `agent__*` tools are appended **last** by
   `adaptToolsForChat` (`tool-adapter.ts:29`), so all 15 are structurally
   guaranteed to be in the dropped tail — along with 64 others, including
   `fleet_overview`, all eight fleet tools the system prompt names, and
   `search_tools` itself (index 190 of 207).
3. Nothing told the model anything was withheld, so it converted "not given
   to me" into "does not exist" — confidently, with plugin recommendations.

Every workstream below traces back to a root cause of that one failure. The
problem list was derived backwards from a real user-visible lie, not forwards
from ambition.

## Global constraints

- **The audit chokepoints do not move.** `ToolRegistry.call()` and
  `AgentDispatcher.dispatch()` remain the only dispatch paths; tier gating,
  PII masking, budget guard, and freeform withholding ride them. Any adoption
  that would put a framework's loop between the model and those chokepoints
  is out of scope by constraint, not preference (see the
  `services.operationAuditLog` never-assigned incident, CLAUDE.md).
- **Ships dark, flips on evidence.** New implementations land behind flags at
  parity; defaults flip only after live verification (the spike's pattern).
- TDD per item; full suite between commits; no push/tag/version without the
  owner's explicit word.
- **Measured claims only.** This branch killed five plausible claims in one
  session (the 128 count-cap, the dev-machine usage stats, context-gating the
  tools array, the search-tools round-trip as primary path, "Electron 42 runs
  Node 22.20"). A number quoted here without a measurement method is a defect.

## Workstreams

### P1 — The Power 400 — **CLOSED 2026-08-26: cap deleted; no trigger exists anymore**

**How it resolved.** Three live probes (owner's key), each killing a
hypothesis:
1. `spike-power-aisdk-live.mjs` — **200 dummy tools accepted** → count dead.
2. `spike-power-real-tools-probe.mjs` — **all 207 real schemas (145,928B)
   accepted** → content and bytes dead.
3. `spike-power-matrix-probe.mjs` — one variable at a time off the good
   baseline: `stream:true` ok, `max_tokens:8192` ok, ~9KB system prompt ok,
   the exact combined chat shape ok on **sonnet-4-5 AND sonnet-5** → shape
   and model dead. All five cells pass.

**Conclusion:** the route was fixed upstream between 2026-08-25 16:20 and
2026-08-26 morning. The original diagnosis chain (model → route-takes-no-
tools → 128 count cap) was chasing a moving target; the cap "worked" only
because the retest happened after sending fewer tools, coincident with or
after the upstream fix.

**Done:** `POWER_MAX_TOOLS` deleted from `ChatService.ts`;
`powerToolCap.test.ts` rewritten to pin the FULL toolset (207 sent, no warn)
with the three-probe history in its header. Regression posture: if the route
ever rejects again, the failure is `power.ts`'s actionable "incompatible
with the selected model" sentence — loud, never a silent 79-tool amputation.

**Consequence for P5:** the forcing function is gone; tool selection is now
purely a quality/cost workstream, not a correctness one. P2 (discovery
invariant) loses none of its force — the incident happened because
withholding was silent, and any future bound (grants, selection) can recreate
that without P2's disclosures.

### P2 — The discovery invariant — **DONE 2026-08-26 (ca2efc87)**

**Evidence.** The system prompt hand-lists eight fleet tools that were not in
the payload; `search_tools` was itself droppable; no withheld-tools signal.
Two independent systems converged on the fix: Walt's shipped prompt rules
("never invent template names — the catalog changes and training data is
stale", `system_prompt.py:265,285`) and Anthropic's API, which **rejects**
requests where every tool is deferred (400 `All tools have defer_loading
set`).

**Plan.**
1. `search_tools` becomes un-droppable: first in registration order, exempt
   from any cap or bound, pinned by test.
2. The prompt's tool section is **generated from the actual payload** —
   never a hand-written list. Test: every tool named in the prompt exists in
   the tools array sent.
3. When tools are withheld (any cap/bound), one disclosure sentence enters
   the system prompt: *"N tools were not included this turn; call
   `search_tools` before concluding a capability is unavailable."*

**Confidence:** invariant, not a design choice. No downside identified.

### P3 — Prompt caching, and the prefix built backwards — **DONE 2026-08-26** (reorder 8087793e; breakpoints 061ceb61, dark)

**Evidence.** `grep cache_control src/main/chat src/main/ai` → zero hits.
~36.8k tokens of schemas are re-sent at full price every loop iteration.
`buildSystemPrompt` (`ChatService.ts:786`) puts volatile fleet counts at
position 0, ahead of all static content — the prefix-invalidation
anti-pattern.

**Plan.** `cache_control` on the tools + static-system prefix
(`providerOptions.anthropic.cacheControl` once P4's Anthropic provider
lands; tool-definition caching is merged in the AI SDK — vercel/ai #3820 →
PR #7552). Reorder: static first, volatile blocks (fleet context, ambient
block) to the tail. Verify with `usage.cache_read_input_tokens` non-zero on
a second identical-prefix request.

**Killed alternative, recorded so it stays dead:** context-gating the tools
array per request (Walt's `method_only` port). It mutates the front of the
prefix and destroys the cache it coexists with. Tool search / deferral
appends rather than swaps, which is why it composes with caching and gating
does not.

### P4 — Provider layer: Vercel AI SDK, providers only, loop stays ours

**Evidence.** Three independent evaluations (this session's survey, the
VoltAgent-prompted check, the external measured survey of seven frameworks)
converged. Disqualifiers found on facts, not taste: VoltAgent's core phones
home un-disableably on import; OpenAI Agents SDK traces to api.openai.com by
default; Genkit opens a dev port from its constructor; frameworks-as-runtime
re-derive four compliance properties inside someone else's loop.

**Spike result (`792606fe`), all green:**
- `PowerAiSdkProvider` behind the existing `AIProvider` contract —
  `ChatService` unchanged; 12/12 parity tests driving the SDK's real SSE
  parser (mocked `fetch`, nothing inside the SDK mocked).
- `maxRetries: 0` pinned — the SDK's default retry turned a 429 into a
  silent 6s stall `power.ts` never had.
- Compiled CJS output loads ESM `ai` via `require(esm)` under Electron 42's
  measured **Node 24.15.0** (`ELECTRON_RUN_AS_NODE`).
- Live Power: text ✓, forced tool call ✓ (the `generateObject` contract).
- Full suite after the jest ESM-transform change: 686/686 suites, 9401
  passed, 2 skipped (baseline), exit 0.
- Dark: `power.ts` default; `NEXUS_POWER_AISDK=1` opts in, same `'power'` id.

**Remaining steps, in order:**
1. ~~Flip Power default~~ **DONE 2026-08-26** — live parity drive (streamed
   chat + tool calls), defaults flipped, `NEXUS_*_AISDK=0` is the escape
   hatch for one release cycle, then the hand-rolled clients delete.
2. ~~`@ai-sdk/anthropic` + cacheControl~~ **DONE + FLIPPED 2026-08-26** —
   measured live: cacheRead=59,455 tokens/turn from turn 2 (96% of input at
   ~10% price); `fleet_overview` + 4/4 citations in the owner's session.
3. `@ai-sdk/openai`, `@ai-sdk/google`. Delete each hand-rolled client as its
   replacement proves out; `http-utils.ts` dies with the last one.
4. Ollama: **open decision** — community `ai-sdk-ollama` vs keeping the
   hand-rolled client (it is small and stable). Decide when reached.
5. Guard test: no bare-string model IDs ever reach `streamText` — bare
   strings route to Vercel's AI Gateway (`globalThis.AI_SDK_DEFAULT_PROVIDER
   ?? gateway`), which must stay dead code.

**Leave on the shelf:** `ToolLoopAgent`. The loop is where tiers, audit, and
citations live.

### P5 — Tool selection — stages 1–4 DONE 2026-08-26; stage 5 gated

Stage 1 namespace field (9d390378) · stage 2 B-03 harness (6f4c9c48,
recall@12 now 3/3 both selectors after the fleet_overview description fix —
"descriptions are the index," demonstrated) · stage 3 append-only grants
(3568133e) · stage 4 hybrid ranker, live in search_tools (d8546afe).
Stage 5 (provider-native deferral) gates on: AI SDK defer_loading
passthrough verification, the resident/deferred split (owner's bucket-1
review), and the anthropic dark-flag live flip — plus the breakpoint
relocation fuse commented in anthropic-aisdk.ts. Grants remain UNPOPULATED
in production; flipping selection on is a B-03 decision with real cases,
not a code milestone.

#### Original problem statement

**Evidence of the problem:** 207 tools, 147,225B of schema, no relevance
strategy. **Evidence gap for the solution:** the 83k-call usage analysis
that sized "top 10 = 96.2%" was this dev machine's exhaust (schedulers,
suites, benchmarks) — the owner caught it; it sizes nothing.

**Direction (design references, not dependencies):**
- Namespace-first routing on metadata only Nexus has: safety tier and the
  `local / wpe / external` source taxonomy.
- Mastra's `ToolSearchProcessor` config surface as the interface spec
  (topK, minScore, autoLoad, TTL, request-aware filter, state derived from
  messages).
- Provider split: Anthropic-native `defer_loading` + tool-search tool where
  available (appends → cache-compatible); collapse-to-data on
  OpenAI-compatible routes (`wpe_api(resource, action, params)` + a
  discovery tool — the `fleet_sql` pattern, per Walt's templates-as-data).

**Ranking authority (added 2026-08-26).** The market prioritization doc
(State of WordPress Agencies 2026 + vendor landscape) is the bucket
authority: 40 / 64 / 76 / 27 across four buckets, rubric = market weight
first, usage as check, tier as brake. Verified against audit logs: the
claimed zero-call bucket-1 tools measure 0 (bulk_plugin_update,
wpe_backup_and_verify, fleet_search, fleet_filter…) — the top of the market
is the bottom of the dev data, confirming usage-driven ranking would have
buried jobs 1/2/4. Hierarchy: resident tier ⊂ bucket 1 (the care-plan loop,
40 tools, 37 enumerated + 3 behind the doc's ellipsis) ⊂ namespace pool.
Encoded in docs/planning/2026-08-26-tool-inventory.csv (priority column).
Product gap surfaced: job 3 (client reporting) has NO tool — a composed
care-report tool over nexus_site_audit/wpe_user_audit/traffic_summary/
fleet_summary would be bucket 1 the day it exists.

**B-03 harness (tests/eval/b03-tool-selection/) exists as of 2026-08-26:**
case format, jobs-weighted 50-case plan, lexical-baseline runner
(mirrors search_tools scoring), recall@k scoring, resident-tier exemption.
4 seed cases, all traced to real sources (the 2026-08-25 incident is case
#1, escape-hatch by construction). First baseline run: recall@12 = 2/3 —
the miss is "how many sites do I have?" → fleet_overview, zero lexical
overlap, from the owner's own sessions: the hybrid-ranker justification,
measured. Escape-hatch cases skip until stage 3 (append-only) lands.

**Prerequisites before any build:**
1. `accessMethod: 'chat'` added to the union and passed at
   `ChatService.ts:612` (currently `'mcp'` — chat is indistinguishable from
   external MCP clients in every sink).
2. A real usage source: production telemetry (D1 `nexus-analytics`,
   `/v1/stats` — needs the owner's ADMIN_TOKEN or `wrangler login`; check
   `installations.active_30d` vs `total` for the same dev-machine bias), or
   an eval suite over candidate tool configurations. The eval is the
   stronger instrument: telemetry says what users did with the tools they
   had, not what they'd do with a different set.

### P6 — Context compaction and token budget: the confirmed gap

**Evidence — CORRECTED 2026-08-26.** This section originally claimed a grep
for "compaction|trimming|token budget" returned nothing and that no result
pruning existed. **False negative — wrong grep terms** (the
verify-the-measurement-method failure): `ChatService.compressStaleToolResults`
(`ChatService.ts:951`) is live, called every turn (`:247`) — tool results
older than the last two assistant messages are trimmed 800→600 chars. So
result AGEING partially exists. Genuinely missing: a per-result byte cap
with an honest truncation tail ("N rows omitted, re-query with a filter"),
spill-to-store for large payloads (a fleet_sql over 300 installs should
never sit in the transcript twice), the never-resend-what-the-model-
summarized rule, and any token budgeting. Seam correction from the P5 design
review: result policy belongs at ChatService/AgentAIClient (or registry.call
to cover all surfaces) — NOT AgentDispatcher, which sees only agent__*
dispatch, not chat results.

**Direction:** `pruneMessages` (arrives free with P4) for mechanical
tool-result pruning; LangGraph's `summarizationMiddleware` /
`contextEditingMiddleware` as the reference design for the judgment half —
reference, not dependency. Wire in `AgentAIClient`, where the budget guard
and transcript writer already measure the right numbers.
**Status:** right problem, right seam, design unvalidated. Own spike before
its own plan.

## Third-party components and licensing (measured 2026-08-26)

**Certain (committed):** `ai@7.0.79`, `@ai-sdk/openai-compatible@3.0.37`.
Runtime closure: 11 packages, ~12.5MB, **zero native modules** — no
better-sqlite3/electron-rebuild interaction.

| Packages | License |
|---|---|
| `ai`, `@ai-sdk/{provider,provider-utils,openai-compatible,gateway}`, `@workflow/serde`, `@vercel/oidc` | Apache-2.0 |
| `undici`, `eventsource-parser`, `@standard-schema/spec` | MIT |
| `json-schema` (pre-existing in tree) | AFL-2.1 OR BSD-3-Clause → elect BSD-3-Clause |

**Assessment:** no issues. All permissive, all compatible with the addon's
MIT license; nothing viral; Apache-2.0's patent grant is a benefit. None of
the Apache-2.0 packages ships a NOTICE file, so §4 has nothing to propagate;
each package carries its LICENSE in its own directory, so tarballs bundling
`node_modules` satisfy retention automatically. Precedent exists:
`THIRD_PARTY_LICENSES.md` already lists Apache-2.0 components
(apache-arrow, the ONNX model).

**Planned, same family, not yet certain:** `@ai-sdk/anthropic`,
`@ai-sdk/openai`, `@ai-sdk/google` (all Apache-2.0). Ollama open (P4.4).
**Explicitly not dependencies:** Mastra, LangGraph, VoltAgent, Deep Agents,
Genkit, Walt — patterns and disqualifier evidence only.

**Merge-gate checklist (layer one → main):**
- [ ] `THIRD_PARTY_LICENSES.md`: add one row for the AI SDK family
      (`ai` + `@ai-sdk/*`, Apache-2.0, github.com/vercel/ai); bump the
      reconciled date.
- [ ] Gateway-stays-dead guard test (P4.5).
- [ ] `npm run rebuild` disclosure in the PR body (suite runs leave
      better-sqlite3 on system Node).

## Order and gates

| # | Item | Status |
|---|---|---|
| 1 | P1 probes → cap deleted | **done** (54af4f5e; live-verified by owner) |
| 2 | P2 discovery invariants | **done** (ca2efc87) |
| 3 | P3 prefix reorder | **done** (8087793e) |
| 4 | `accessMethod: 'chat'` | **done** (b9550951) — P5 data clock started |
| 5 | P4.2 Anthropic + cache breakpoints | **done, dark** (061ceb61) — NEXUS_ANTHROPIC_AISDK=1 |
| 6 | Flip Power / Anthropic defaults | open — each needs a live session on its flag |
| 7 | P4.3 openai/google; P4.4 ollama decision | open |
| 8 | P5/P6 planning docs | open — P5 waits on accrued 'chat'-labeled data; P6 needs its spike |

**v7 lesson recorded:** the AI SDK rejects `role:'system'` in `messages`; the
system prompt rides streamText's `system` option (`splitModelMessages`,
aisdk-shared.ts). The spike's parity fixtures missed it by never carrying a
system message — parity suites must include one from now on.

## Non-goals

- Any framework as the runtime/loop (audit constraint).
- VoltAgent, Genkit, OpenAI Agents SDK, Mastra-as-dependency,
  Deep Agents (disqualified on measured defaults or wrong layer).
- Vercel AI Gateway (network hop, reportedly downgrades the 1h Anthropic
  cache; unneeded).
- `search_tools` as the *primary* selection path (Walt measured and removed
  that round-trip; it is the un-droppable floor, not the mechanism).
- Context-gating the tools array (cache conflict, recorded under P3).
- Deleting tools based on dev-machine usage counts.

## Open questions

1. P1: content vs size — probe pending (owner's key).
2. Ollama client: community package vs keep hand-rolled (P4.4).
3. P5 data source: telemetry access (ADMIN_TOKEN / `wrangler login`) vs
   eval-first; and whether production `installations` is big enough to mean
   anything.
4. P6 trigger policy: when to compact and what survives — needs its spike.

## Session references

Commits: `502d3554` (the cap, hypothesis now dead), `792606fe` (the spike).
Scripts: `scripts/spike-power-aisdk-live.mjs`,
`scripts/spike-power-real-tools-probe.mjs`.
Walt (pattern source): `wpe-internal-walt/agent/app/system_prompt.py`,
`template_catalog.py`, `toolbus/catalog.py`, `mcp_adapter.py`,
`docs/superpowers/plans/2026-07-22-context-window-management.md`.
External framework survey (2026-08-26): install footprints, disqualifiers,
and the three-layer split — line counts independently verified against this
repo (977 / 27,522 exact).
