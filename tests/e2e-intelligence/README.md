# `tests/e2e-intelligence/` — layers 5 and 6

*WP-18. Read `docs/intelligence/TESTING_STRATEGY.md` first; this directory
implements its top two environment-dependent layers.*

Every real incident this project has caught was found by hand-driving the MCP
surface of a **running** Local instance. This is that, written down.

| | what it is | when it runs |
|---|---|---|
| **Layer 5** — MCP journeys | `npm run test:e2e:intelligence` | pre-merge-to-main, pre-release |
| **Layer 6** — real-ledger replay | `npm run replay:ledger` | manual / pre-release |

Neither is in `npm test`, and neither may ever be. Both depend on state that
exists only on a machine that has actually run the addon.

---

## Layer 5 · the journeys

```bash
npm run test:e2e:intelligence
```

**Requires Local running** with the Nexus AI addon loaded. When it is not, the
run stops at the gate with a fenced banner and **exit code 2** — deliberately
not 1, which is what jest exits with when a test fails, so "never ran" can
never be read as "ran and failed". There is no skip path: a skipped e2e that
reads as green is worse than no e2e at all.

| journey | what it drives | what it proves |
|---|---|---|
| `01-health` | `nexus_intelligence_health` + Local's own log | the layer reports on itself, every silent line is explained, and WP-17's startup line reached the log **at this boot** |
| `02-verify-live` | `verify_site_live` on a running local site | the live re-check reconciles **and** the ledger takes the write |
| `03-enrichment` | `find_sites_with_plugin` | enrichment renders real observation ages and trust classes, not the legacy fallback |
| `04-chat-manifest` | `nexus_intelligence_health` | a `task.context.assembled` manifest exists and is inside its SLO |

### Manual precondition for `04-chat-manifest`

Send **one message in the Nexus AI docked panel** before running, if none has
been sent in the last 7 days. The journey's header explains why it cannot do
this itself: `assembleForChatTurn` is reachable only through `CHAT_SEND`, an
`ipcMain.handle` channel with no GraphQL mutation, no CLI command and no MCP
tool in front of it. Driving it headlessly would mean adding a production seam
whose only consumer is a test. The health tool's manifest-age line is the
sanctioned fallback detector, and what it does *not* prove — that **this run**
produced a manifest — is stated in the journey rather than papered over.

### Two rules this directory keeps

**Journeys are `*.journey.ts`, never `*.test.ts`.** That name is what keeps
them out of `npm test`: jest's default `testMatch` collects `*.test.ts` and
`__tests__/`, and neither matches. `layout.test.ts` pins it, because the
failure mode of getting it wrong is silent — `npm test` would simply start
requiring a running Local.

**Journeys never import better-sqlite3.** While Local holds the addon, this
tree's native module is built for Electron; a journey that opened the ledger
directly would die with a `NODE_MODULE_VERSION` error that reads as a broken
intelligence layer. Evidence about the ledger comes from the live MCP surface
instead — the health tool's whole-ledger event count and its "Other sources"
line are what journey 2 measures the write with. Pinned in `layout.test.ts`,
by scanning import specifiers rather than raw text (the first version of that
guard fired on a comment explaining the rule).

**Do not create a `lib/` directory here.** The root jest config ignores every
path containing `/lib/`, so pins placed there collect zero tests, silently.

---

## Layer 6 · the real-ledger replay

```bash
npm run replay:ledger
```

Rebuilds every wired fold from event 0 against a copy of your own
`~/Library/Application Support/Local/nexus-ai/ledger.db` — the messiest fixture
this project will ever have — and asserts:

- no throw;
- event ids strictly increasing (every fold cursor is an `id >` comparison);
- every `state.drift.detected` event well-formed, schema-version aware;
- twin counts inside stated bounds (`twins ≤ state observations`, and not zero
  facts folded from a non-empty stream);
- **the replayed twin set matches the live one** — value, `observed_at`,
  trust and provenance pointer alike. The determinism claim that has been ADR
  prose since M1, finally tested against real data.

**Your ledger is never opened for writing.** The only handle on the live file is
a `readonly: true` connection used for one `VACUUM INTO` (which writes the
destination, and captures WAL contents a file copy would miss). Everything after
that runs on copies in a temp directory, and the core it boots is given
in-memory storage so no marker of yours is touched. The copies are left in place
and the path is printed, for inspecting a failure.

**The fold list is not maintained here.** `initIntelligenceCore` is booted on the
temp copy and its own `core.folds` is what runs — the same list the health
surface measures lag against. A hand-copied list would rot silently and the
replay would certify a fold it never ran.

Runs under **system Node**, so better-sqlite3 must be built for it. The shared
ABI preflight (`tests/intelligence-evals/nativeModule.ts`, WP-13c) prints the
remedy instead of a raw `NODE_MODULE_VERSION` stack trace:

```bash
npm run pretest    # build better-sqlite3 for system Node (this tool, jest)
npm run rebuild    # build it back for Electron (before loading Local again)
```

Which means **layer 5 and layer 6 cannot run at the same time**: the journeys
need Local up (Electron ABI), the replay needs system Node. Run the journeys,
then `npm run pretest`, then the replay.

### First run, 2026-08-17 — measured

9,332 events · 8,966 state observations · 365 drift · 6,331 twin facts over 382
entities · **PASS**, replayed twin set identical to live.

One finding, folded back into the checker: 328 of the 365 drift events carry
`actor.id = act_fold_plugin_twin` at schema `drift.detected/1`, the other 37
`act_fold_state_twin` at `/2` — the actor id was renamed alongside the schema
bump, while `source.system` was already `fold:state-twin` in both. The check now
accepts both ids as a **set** (an unknown actor is still flagged) rather than
reporting a developer's entire drift history as malformed.

---

## Transport

Both halves reuse what already exists rather than reinventing it:

- **MCP transport:** `tests/e2e-cli/helpers/mcp-client.ts` — `loadConnectionInfo()`
  reads `nexus-ai-mcp-connection-info.json` from Local's data directory, and
  `NexusMcpClient` speaks JSON-RPC to `<url>/mcp/messages` with the bearer token.
- **ABI preflight:** `tests/intelligence-evals/nativeModule.ts` (WP-13c).

`runner/` holds the readers the journeys assert with — each one pinned in its
own `*.test.ts`, which **do** run in `npm test`. That is deliberate: the runner
is code, and a parser that quietly returned nothing would make every journey
assertion vacuously true.
