# Recon — the Ask/Tell context path

*WP-10 · read-only reconnaissance · base `poc/nexintelligence` @ `a096bc09` ·
2026-08-15*

**Purpose.** ADR-19 names "the product's own agent surface" as the actor that
drives the anchor slice. This document maps how that surface builds context
**today**, so WP-11 (context assembler v0) can be specced against the real call
graph rather than against a guess. Every claim carries a `file:line` citation
against the commit above; line numbers drift, so spot-check with the symbol
name, not the number alone.

Vocabulary is architecture.md's: the four distribution patterns
(**ambient** policy · **pushed** procedure/runbook · **retrieve**-on-demand
semantic + episodic · **pull-live** state), the `AssembleRequest` →
`ContextBundle` contract (§6.1), the assembly algorithm (§6.2), the cache/live
boundary (§6.3), the manifest (§6.4), and ADR-7's fail-closed rule.

**Nothing was implemented. No production file was modified by this packet.**

---

## 0. Scope and method

Starting point per the packet: `src/main/ipc-handlers.ts`, following what it
routes chat turns to.

Directory census (all four named in the packet exist):

| Directory | Exists | Part of the Ask/Tell context path? |
|---|---|---|
| `src/main/chat/` | yes | **Yes — the primary path.** `ChatService.ts` (708 lines), `chat-ipc-handlers.ts`, `tool-adapter.ts`, `providers/` |
| `src/main/assistant/` | yes | **Yes — two roles.** Owns the prompt builder that `chat/` imports, *and* the separate single-shot Assistant path |
| `src/main/agent-runtime/` | yes | **Yes — a third, structurally different actor.** Scheduled/event agents |
| `src/main/ai-context/` | yes | **No — red herring.** See §6 |

Four actor surfaces reach a model in this product. Three are in-process; the
fourth is the ADR-19 "second consumer".

---

## 1. The context-assembly call graph

### 1.1 Surface map

| # | Surface | Renderer entry | IPC channel | Main-process owner | Tools? | Conversation state | System prompt built at |
|---|---|---|---|---|---|---|---|
| **A** | Docked Panel chat + Chat tab | `DockedPanel/PanelChat.tsx`, `ChatTab.tsx` | `CHAT_SEND` | `chat/ChatService.ts` | **yes**, ~190 | in-memory `Map` + SQLite | `ChatService.buildSystemPrompt` |
| **B** | Assistant panel ("Ask/Tell"-style single shot) | `AssistantPanel.tsx` | `ASSISTANT_QUERY` | `ipc-handlers.ts` inline | no | renderer-held only | `buildWordPressSystemPrompt` (per call) |
| **C** | Agent runtime | Preferences / scheduler / event | n/a (in-process) | `agent-runtime/AgentRunner` → `AgentAIClient` | yes, scoped | per-run `messages[]`, discarded | **nowhere — no system message at all** |
| **D** | External MCP clients | — | JSON-RPC `initialize` | `mcp/McpServer.ts` | yes | client-side | `mcp/instructions/` + live fleet snapshot |

Surface A is the ADR-19 actor. Surfaces B/C/D matter because an assembler
wired only into A leaves three surfaces ungoverned, and because C and D each
already contain a mechanism the assembler could reuse.

### 1.2 Surface A — the primary path, end to end

```
PanelChat.tsx:506-513         ipcRenderer.invoke(CHAT_SEND, sessionId, message, providerId, model, siteId)
ChatTab.tsx:523-525           ← same channel, different component, its own sessionId (ChatTab.tsx:232)
   │
chat-ipc-handlers.ts:42-66    ipcMain.handle(CHAT_SEND)
   │                            keyVault.getKey(providerId)   ← key read FRESH per turn (line 54)
   ▼
ChatService.sendMessage        ChatService.ts:109-168
   ├─ getProvider(providerId)                       :115
   ├─ session = this.sessions.get(sessionId)        :121   ← in-memory Map, process-lifetime
   ├─ IF ABSENT:
   │    ├─ getSession(db, sessionId)                :127-128  ← SQLite chat_messages
   │    ├─ IF persisted rows exist:                 :130-138
   │    │     history = rows filtered to user|assistant|system, non-empty, not incomplete
   │    │     session.messages = history            ← ***NO buildSystemPrompt CALL***  (R1)
   │    └─ ELSE:  systemPrompt = await this.buildSystemPrompt(siteId)   :141
   │              session.messages = [{role:'system', content: systemPrompt}]  :144
   ├─ session.messages.push({role:'user', content: userMessage})        :157
   ├─ session.messages = this.compressStaleToolResults(session.messages) :165
   └─ runAgentLoop(session, providerId, config)                          :167
         │
         └─ for iteration in 0..CHAT_DEFAULTS.MAX_AGENT_ITERATIONS(25)   :182  (constants.ts:448-451)
              ├─ tools = adaptToolsForChat(registry, services)           :185   ← RECOMPUTED EVERY ITERATION
              ├─ provider.streamChat(
              │     maskToolResultsForProvider(session.messages),        :196
              │     tools, config, abortSignal)                          :192-200
              ├─ collect tokens / tool_call_end events                   :204-227
              ├─ session.messages.push(assistantMsg)                     :235
              ├─ if stopReason !== 'tool_use' → done                     :238-241
              └─ for each toolCall: executeToolCall()                    :244-272
                    └─ session.messages.push({role:'tool', ...})         :250-255
```

**`buildSystemPrompt` (ChatService.ts:553-660)** is the whole of surface A's
context assembly. It composes, in this order:

| Order | Content | Source | Size |
|---|---|---|---|
| 1 | Fleet context block + WordPress domain knowledge | `buildFleetContext` (AssistantService.ts:9-60) → `buildWordPressSystemPrompt(ctx, agentMode=true)` (wordpress-knowledge.ts:156-205) | `WP_KNOWLEDGE` ≈ 2.0 KB + a computed fleet paragraph |
| 2 | Identity/role lines | literal, ChatService.ts:570-572 | — |
| 3 | `UNTRUSTED_DATA_DIRECTIVE` | `mcp/pii.ts:39-44` | ≈ 0.4 KB |
| 4 | Tool-use doctrine, fleet tool catalogue, content-search workflow, task-completion protocol, async-op protocol, site-lifecycle note | literal, ChatService.ts:576-629 | — |
| 5 | *(conditional)* `Current site:` block — name, domain, WP/PHP version, active theme, active plugins | ChatService.ts:631-657, from `indexRegistry.get(site.id).structure` or a live `fileScanner.scan` | — |

Measured on the source: the literal block (lines 567-629) emits ≈ 4.8 KB;
`WP_KNOWLEDGE` is 2,001 chars; the untrusted-data directive ≈ 375 chars. Call
it **≈ 7–8 KB / ~2k tokens of system prompt**, before the site block.

The `agentMode=true` argument at ChatService.ts:564 is load-bearing: it
suppresses `WP_KNOWLEDGE_JSON_FORMAT` (2,721 chars of JSON-output instructions,
wordpress-knowledge.ts:110-147), which exists only for surface B and
"confuses tool-calling models" per the comment at wordpress-knowledge.ts:108-109.

**Nothing else enters context per turn.** There is no retrieval step, no policy
load, no runbook, no freshness disclosure, and no per-turn refresh of the fleet
or site block. The system prompt is computed **once, on session creation**, and
then is a frozen `messages[0]` for the life of the session.

### 1.3 Where tools are granted (surface A)

`adaptToolsForChat` (tool-adapter.ts:10-53) is the *only* tool-granting call
site for chat (`grep adaptToolsForChat` → tool-adapter.ts:10, ChatService.ts:11,
ChatService.ts:185 — nothing else). It:

- takes `registry.list(services)` — every registered handler whose optional
  `isAvailable(services)` returns true (tool-registry.ts:133-142),
- appends contributed agent tools `agent__<agent>__<tool>` from
  `contributedRegistry.toMcpDefinitions()` (tool-adapter.ts:17-26),
- deep-clones each `inputSchema` and strips `_confirmationToken`
  (tool-adapter.ts:30-45).

**It filters nothing by capability, tier, environment, or task.** Tier-3 tools
*are* offered to the chat model; the gate is at execution time
(`requiresHumanApproval`, ChatService.ts:332) via a UI approval card, and again
inside `ToolRegistry.call()`. Contrast the agent runtime, which does not even
advertise Tier 3 (`NexusToolProvider.getProviderToolDefinitions`,
NexusToolProvider.ts:105-118).

Scale: 17 `register*Tools(registry)` calls at `index.ts:450-467`, plus
`search_tools` at `index.ts:471`. A static count of tool `name:` literals under
`src/main/mcp/modules/` is **190**. `search-tools.ts:3-5` states the problem in
its own header: *"With 160+ tools, Claude cannot reliably pick the right one by
scanning all descriptions internally."* That meta-tool is the current, informal
answer to the assembler's §6.2 step 4 — and it is opt-in, model-initiated, and
does nothing to shrink what is sent.

### 1.4 Where conversation state lives (surface A)

Two stores, and they disagree about what a conversation contains.

| Store | Written by | Contains |
|---|---|---|
| `ChatService.sessions: Map<string, ChatSession>` (ChatService.ts:95, interface :73-82) | main process, per turn | `messages[]` **including the system message and all `role:'tool'` messages**, `abortController`, `pendingApprovals` |
| `chat_sessions` / `chat_messages` tables (`ipc/chat-sessions.ts:4-58`) | **the renderer**, via `CHAT_SESSION_SAVE` (ipc-handlers.ts:6503-6513) | user + assistant text only |

The renderer is the persistence author, and it strips the system message:
`PanelChat.persistSession` filters `m.role !== 'system'` and drops empty
assistant turns (PanelChat.tsx:540-550). `ChatTab.tsx` never calls
`CHAT_SESSION_SAVE` at all — its sessions are in-memory only.

`ChatService` reads that renderer-authored table back on session rehydration
(ChatService.ts:127-138) and, crucially, takes the "restore" branch *instead of*
the "build system prompt" branch. See R1.

Also in-memory only, and lost on rehydration: every `role:'tool'` message.
The restore filter (ChatService.ts:135) keeps only `user | assistant | system`.

Tier-2/3 tool executions bump a durable `action_count` on the session row
(ChatService.ts:258-271) — the nearest thing today to `task.action_executed`.

### 1.5 Surface B — the single-shot Assistant path

```
AssistantPanel.tsx:127-128   invoke(ASSISTANT_QUERY, {messages: history, mode, siteId})
   │                           history = user/assistant text only (AssistantPanel.tsx:116-125)
ipc-handlers.ts:2827-2930    safeHandle(ASSISTANT_QUERY)
   ├─ context = buildSiteContext(...) | buildFleetContext(...)     :2846-2849
   ├─ systemPrompt = buildWordPressSystemPrompt(context)           :2851   ← agentMode DEFAULTS FALSE
   │                                                                        → JSON output format included
   ├─ queryAssistant(messages, systemPrompt, settings, apiKeys)    :2854   (AssistantService.ts:363-434)
   │     └─ provider.streamChat([{system}, ...messages], [], ...)          (AssistantService.ts:420-428)
   │           ← empty tool array; 15s hard timeout (AssistantService.ts:416)
   ├─ parseQueryPlan(rawText)                                              (AssistantService.ts:325-357)
   ├─ IF intent==='fleet-filter': executeAssistantFilter(...)      :2858-2862
   │     ← the model's `sites[]` is DISCARDED and replaced with a real graph.db query
   └─ IF contentQuery / intent==='content-search':
         searchService.searchFleet(query, undefined, {limit: 8})   :2878, :2901
```

Two properties make this surface interesting to WP-11 despite being the lesser
one:

1. **It is stateless and rebuilds context on every turn** (ipc-handlers.ts:2846-2851).
   That is the assembler's own §6.5 shape, already present.
2. **It already runs a post-hoc grounding step**: `executeAssistantFilter`
   (AssistantService.ts:142-319) replaces model-authored site lists with real
   query results, and the prompt tells the model to leave `sites` empty
   (wordpress-knowledge.ts:111-115). This is a hand-rolled, single-purpose
   ancestor of `retrieved: RetrievedItem[]` — worth reading before designing
   the real one.

`ASSISTANT_CONTEXT` (ipc-handlers.ts:2811-2824) is the same context builders
exposed for the UI's proactive-insight strip — a read-only sibling, no model
involved.

### 1.6 Surface C — the agent runtime

```
buildAgentContext.ts:53-270
   ├─ toolProvider = new NexusToolProvider(registry, services, agent.tools, aiEvents)   :79-88
   │     └─ getProviderToolDefinitions(): registry.list() minus non-allowed minus Tier 3  (NexusToolProvider.ts:105-118)
   ├─ aiClient   = new AgentAIClient(provider, config, toolProvider, ..., budgetGuard)   :122-123
   └─ ctx = { trigger, event, tools, state, ai, log, autonomy, settings, credentials, db, fullRun }  :255-267

AgentAIClient.run(prompt)   AgentAIClient.ts:126-191
   messages = [{ role: 'user', content: prompt }]       :132   ← ***NO SYSTEM MESSAGE***
   tools    = toolProvider.getProviderToolDefinitions() :133
   loop maxTurns (default 10)                           :139
```

Findings that bear directly on WP-11:

- **Agents have no system prompt.** The agent author's prompt string is the
  entire context; `ctx.ai.run()` sends one user message. `generateObject`'s
  optional `system` is *concatenated into the user message*, not sent as a
  system role (AgentAIClient.ts:215-216, and again at :258-259).
- **Tool scoping already exists here and nowhere else.** `agent.tools` is an
  allow-list; `undefined` means unrestricted, `[]` means deny-all and must not
  be collapsed (buildAgentContext.ts:81-87). This is the closest existing thing
  to `ContextBundle.tools: ToolGrant[]`.
- **`ctx.autonomy`** (buildAgentContext.ts:262, `getAgentAutonomy`) is the
  closest existing thing to ADR-7's autonomy class — the input that selects
  fail-closed vs. warn-and-proceed. It is per-agent, not per-task.
- A per-run budget guard already exists (`DailyBudgetGuard`,
  buildAgentContext.ts:113-121) — a precedent for `AssembleRequest.budget`,
  though it counts dollars, not tokens.

### 1.7 Surface D — external MCP clients

`McpServer.dispatch`'s `initialize` handler (McpServer.ts:284-307) returns
`result.instructions` = the static registry from `mcp/instructions/`
(`server-instructions.ts` + `resources/*.md` + `resources/workflows/*.md`)
**concatenated with a live fleet snapshot** built from storage and
`graphService` (McpServer.ts:296-301), wrapped so a failure is non-fatal.

This is the only place in the codebase that already implements something
shaped like ambient distribution: authored text plus computed state, handed to
the actor before the first turn. Its limitation is the one the assembler is
designed to fix — it fires **once per session**, so both the authored half and
the state half age silently for the rest of the connection.

---

## 2. Injection points, per distribution pattern

Read against `ContextBundle` (architecture.md §6.1) and the assembly algorithm
(§6.2). "Grade" is my read of how well the site fits the pattern's semantics,
not how easy the edit is.

### 2.1 Ambient — `bundle.ambient: PolicySet`

| Candidate site | File:line | Grade | Notes |
|---|---|---|---|
| **`ChatService.buildSystemPrompt`, appended after the untrusted-data directive** | ChatService.ts:574-576 | **A** | Correct semantics (always present, never trimmed), correct precedence (before the tool doctrine, after the security directive). Single call site. **But fires once per session** — see R1/R2. |
| A per-turn re-assert in `sendMessage` after the user push | ChatService.ts:157 | **A−** | The only way ambient policy actually stays present for a long session and survives rehydration. Must be a **user**-role or tool-result carrier, not a second system message — see R3. |
| `buildWordPressSystemPrompt` | wordpress-knowledge.ts:200-204 | B | Reaches surfaces A *and* B in one edit. But it is a pure string builder over `AssistantContext`; passing a `PolicySet` through it widens a type that four call sites share. |
| `ipc-handlers.ts` ASSISTANT_QUERY | ipc-handlers.ts:2851 | A (for surface B) | Stateless — the bundle is rebuilt every turn for free. |
| MCP `initialize` instructions | McpServer.ts:296-301 | B | Right shape, wrong cadence (once per connection). |
| Agent runtime | AgentAIClient.ts:132 | C | Requires introducing a system message where none exists. Cheap, but changes every agent's prompt shape at once. |

### 2.2 Pushed procedure — `bundle.procedure: Runbook | null`

A runbook is *pushed with the capability*, i.e. it arrives when the task is
recognised, not at session start. Surface A has no notion of a task, so this is
the pattern with the weakest existing hook.

| Candidate site | File:line | Grade | Notes |
|---|---|---|---|
| **Tool-result suffix, alongside the auto-lifecycle note** | ChatService.ts:371, :394 | **A** | The existing precedent: `_note3`/`_note` append platform-authored text to a tool result *after* execution. Provider-safe (survives Anthropic/Google, see R3). Natural carrier for "you have just invoked a gated capability; here is its runbook." |
| Pre-execution, inside `executeToolCall` before `registry.call` | ChatService.ts:368-369 (approval path), :391-392 (direct path) | A− | Lets the bundle *precede* the act. Two call sites, easy to let drift apart — note there are already two, plus the `agent__` branch at :304-325 that reaches neither. |
| A first-turn intent classifier in `sendMessage` | ChatService.ts:157-167 | C | Adds a model call before the model call. Defer. |
| `agent.tools` allow-list analogue for chat | tool-adapter.ts:14 | B | Would let a granted capability narrow the offered tool set to the runbook's steps — a real ADR-12 "strict" enabler, but it is the largest behavioural change on this page. |

**CORRECTION (WP-19): the contributed bypass has TWO callers, not one —
`McpServer.ts:326` also dispatches `agent__*` for external MCP clients.
Emission therefore lives in `AgentDispatcher.dispatch` (the true second
chokepoint), not in either caller.** Original note follows.
Note ChatService.ts:304-325: contributed `agent__*` tools bypass
`ToolRegistry.call()` entirely and dispatch straight to `AgentDispatcher`. Any
procedure hook placed at the registry call site misses them — the same class of
gap CLAUDE.md documents for the audit chokepoints.

### 2.3 Retrieved — `bundle.retrieved: RetrievedItem[]` (semantic + episodic)

| Candidate site | File:line | Grade | Notes |
|---|---|---|---|
| **`sendMessage`, between the user push and `runAgentLoop`** | ChatService.ts:157-167 | **A** | Has the user's text (the retrieval query) and `siteId` (the targets). One call site. Emit as a `role:'tool'`-shaped or user-role carrier, *not* into `messages[0]`. |
| Surface B's post-plan search | ipc-handlers.ts:2876-2915 | A | Already does semantic retrieval (`searchService.searchFleet`, limit 8) and merges by intent. Episodic (`ledger.query({entityId, topicPrefix})`) drops in beside it with no new plumbing. |
| Existing episodic store | `Ledger.query(QueryOptions)`, `src/intelligence/ledger/ledger.ts:13-27, :92` | — | `topicPrefix`, `entityId`, `limit`, and `order:'desc'` are all present. E-01's mandatory "prior incidents touching these entities" query is a `query({entityId, topicPrefix:'state.drift.', order:'desc'})` today. |
| Existing semantic store | `services.searchService.searchFleet` (used at ipc-handlers.ts:2878) | — | Fleet-wide; B-04's scope discipline will need a per-entity variant. |

**Do not deliver retrieved items as compressible tool results.**
`compressStaleToolResults` (ChatService.ts:667-696) truncates any `role:'tool'`
message over 800 chars down to 600 once two assistant turns have passed. See R5.

### 2.4 Pull-live state — `bundle.tools: ToolGrant[]` + twin SLOs

The architecture is explicit (§6.2 step 4) that state must **not** be copied
into the bundle: attach grants and SLOs, let state enter at execution time,
stamped.

| Candidate site | File:line | Grade | Notes |
|---|---|---|---|
| **`adaptToolsForChat`** | tool-adapter.ts:10-53, called ChatService.ts:185 | **A** | Recomputed **every loop iteration**, so a grant set can change mid-task without touching the message array. The single highest-leverage seam on this page. |
| Freshness disclosure text | ChatService.ts:631-657 (site block) | B | Today's site block copies `wpVersion`/`phpVersion`/plugins straight into the prompt with no age and no source — exactly the A-01 stale-twin trap. `TwinStore.freshness()` + `sloFor()` (`src/intelligence/folds/twinStore.ts:79`, `index.ts` exports `sloFor`, `DEFAULT_FRESHNESS_SLOS`) supply the honest version. |
| `NexusToolProvider` allow-list | NexusToolProvider.ts:105-118 | — | The working model for scoped grants; reuse its shape rather than inventing one. |

---

## 3. Risks

Ordered by how badly each would corrupt an assembler wired naively.

**R1 · A rehydrated session runs with no system prompt at all.** *(Live defect,
independent of this work.)* `ChatService.sendMessage` takes the persisted-history
branch (ChatService.ts:130-138) *instead of* calling `buildSystemPrompt`
(:141) — and the renderer never persists the system message
(`PanelChat.persistSession` filters `m.role !== 'system'`, PanelChat.tsx:541).
So a Docked-Panel session reopened from the sidebar after a Local restart runs
with **no fleet context, no `UNTRUSTED_DATA_DIRECTIVE`, and no tool doctrine**.
Reopening an old session is a normal user action, not an edge case.
Consequence for WP-11: **anything the assembler puts in `messages[0]` silently
vanishes on the most ordinary resumption path in the product**, including the
policy set that ADR-7 says must be present or the actor must fail closed. An
assembler that injects only at session creation would inherit a fail-*open*
hole. (ChatTab.tsx is unaffected — it never persists — which is why this has
survived: the two chat surfaces behave differently.)

**R2 · Context is computed once and never refreshed.** `buildSystemPrompt` runs
only inside the `if (!session)` branch. `siteId` is a `CHAT_SEND` parameter on
*every* turn (chat-ipc-handlers.ts:50, PanelChat.tsx:512) but is read only at
session creation (ChatService.ts:141). Changing the selected site mid-session
therefore never changes the context; nor does a plugin update the user just
performed through the same conversation. Ambient policy version-age (ADR-7's
staleness clock) cannot be evaluated per-task in this shape.

**R3 · A second system message is silently dropped on two of four providers.**
`anthropic.ts:43-44` and `google.ts:72-73` both do
`messages.find(m => m.role === 'system')` + `filter(m => m.role !== 'system')` —
**first system message wins, the rest are discarded with no error**.
`openai.ts:62` passes every system message through inline; `ollama.ts:246-251`
only augments index 0. So "append the bundle as a fresh system message" is a
provider-dependent no-op — it would appear to work in OpenAI testing and fail
invisibly on the default Anthropic path. Any per-turn re-assert must ride a
`user` or `tool` role, or must *rewrite* `messages[0]`.

**R4 · Token budget is already the binding constraint, and nothing measures it.**
~190 tools' full JSON schemas are re-sent on **every one of up to 25 loop
iterations** (`adaptToolsForChat` at ChatService.ts:185 inside the loop at :182;
`MAX_AGENT_ITERATIONS: 25` at constants.ts:450). The system prompt adds ~2k
tokens. `search_tools` exists precisely because the list is unmanageable
(search-tools.ts:3-5). There is no token counter anywhere in `ChatService`, and
`compressStaleToolResults` is a char-count heuristic, not a budget.
`AssembleRequest.budget.tokens` (§6.1) and the manifest's
`budget: {tokens_used, of}` (§6.4) have **no existing source of truth to read
from** — WP-11 must bring its own estimator, and should treat the tool-schema
payload, not the prose, as the thing to cut.

**R5 · Retrieved content delivered as a tool result will be silently truncated.**
`compressStaleToolResults` (ChatService.ts:667-696) trims any `role:'tool'`
message over 800 chars to 600 plus a marker, for everything older than the last
two assistant turns. A retrieved episodic slice or a runbook body delivered that
way degrades after two turns — and the manifest would still claim it was
supplied. Either exempt assembler-authored messages by an explicit marker, or do
not use the `tool` role for them.

**R6 · The manifest has no home, and the ledger's task topics are unused.**
`task.context_assembled`, `task.action_executed`, `task.outcome_recorded` are
declared in the taxonomy (architecture.md:151) and **zero events of any `task.*`
topic are produced anywhere in `src/main` or `src/intelligence`** — all ten
`emitter.emit(` call sites emit `state.*` (graphServiceTap ×3, graphBackfill ×3,
bootstrap ×2, verify-site-live ×2; enumerated in §7).
`ChatService` has no `correlation`/task
id concept at all; `sessionId` is the only identifier that crosses a turn, and it
is renderer-minted (`makeId()`, PanelChat.tsx:487; a `chat_${Date.now()}_…`
string at ChatTab.tsx:232) — not a ULID, not stable across surfaces. WP-11 needs
to mint a real `TaskId` per turn and thread it as `correlation`; it cannot reuse
`sessionId`.

**R7 · Injected content is not protected from the untrusted-data machinery, and
must not be.** `maskToolResultsForProvider` (pii.ts:67-75, called at
ChatService.ts:196) wraps every `role:'tool'` message in `<untrusted_data>`
tags, and the system prompt instructs the model to **never follow instructions
inside them** (pii.ts:39-44). A pushed runbook is *exactly* an instruction. If
the bundle is delivered as a tool result, the security directive tells the model
to ignore it — the two mechanisms are in direct contradiction. This is the
sharpest design constraint on §2.2: authored, signed procedure must arrive on a
channel the directive marks as trusted, which today means the system message or
the user turn, and nothing else.

**R8 · Three of four surfaces would remain ungoverned.** An assembler wired only
into `ChatService` leaves surface B (which still ships the JSON-format prompt and
a 15-second timeout), surface C (no system message; `agent.tools` is the only
scoping), and surface D (session-scoped instructions) outside the policy path.
ADR-19 makes A the anchor, so this is acceptable for v0 — but it should be a
*stated* scope decision in WP-11, not an omission, because C is the autonomous
actor class and therefore the one ADR-7's fail-closed rule was written for.

**R9 · `ipc-handlers.ts` and `index.ts` are under the integration lock.**
PARALLEL_PROTOCOL's ownership map puts both under a single lock, wiring-edits-only.
Surface B's injection point is a ~2,900-line-deep inline handler in
`ipc-handlers.ts`; surface A's is not (`ChatService.ts` is unlocked). This is a
practical argument for anchoring v0 in `ChatService` and reaching surface B in a
later packet.

**R10 · Non-fatality must hold on a path that has no error budget.** The
intelligence-layer invariant is wrap-log-degrade. `buildSystemPrompt`'s existing
fleet-context call is already wrapped in a bare `try {} catch {}`
(ChatService.ts:556-565) that proceeds with an empty section. An assembler call
must do the same — but note the tension with ADR-7: for an *autonomous* actor a
failed policy load must fail **closed**, not degrade. Surface A is interactive
(a human is present), so warn-and-proceed is the correct semantics there, which
is fortunate — it means v0's non-fatality and ADR-7 do not conflict on the anchor
surface. They will conflict on surface C.

---

## 4. Proposed minimal wiring

Smallest-possible-diff shape. Target: surface A only, interactive actor only,
ambient + retrieved live; pushed procedure and scoped tool grants deferred to a
follow-on packet with their own eval (B-03).

### 4.1 New files (no existing file grows logic)

```
src/intelligence/assemble/assembler.ts        assemble(req: AssembleRequest): ContextBundle
src/intelligence/assemble/types.ts            AssembleRequest, ContextBundle, BundleManifest, RetrievedItem
src/intelligence/assemble/__tests__/…         per the layer's convention (tests beside code)
src/main/intelligence-host/chatAssembly.ts    the host adapter — see 4.2
```

`assembler.ts` sits under `src/intelligence/` and therefore obeys the ADR-16
seam: no electron, no `src/main` imports, host access through
`host/ports.ts`. It reads `Ledger` and `TwinStore` (already exported from
`src/intelligence/index.ts`) and takes the policy set from whatever WP-11's
policy-repo v0 lands as.

`chatAssembly.ts` is the only new file in `src/main/`. It owns:

- `getIntelligenceCore()` (coreRegistry.ts) with the mandatory
  `undefined`-means-degrade contract,
- building the `AssembleRequest` from what `ChatService` has (user text,
  `siteId`, provider/actor identity),
- rendering `ContextBundle` → two strings: `ambientBlock` (for the system
  prompt) and `turnBlock` (for the per-turn re-assert),
- emitting `task.context_assembled` and returning the `TaskId` for correlation,
- swallowing every failure and returning `null`.

Placing all of that here — not in `ChatService` — is what keeps the diff in the
chat path to the three call sites below, and mirrors the WP-04 ruling that
inlined logic in a locked handler is the thing to avoid.

### 4.2 Exact call sites in existing files

**Three edits, all in `src/main/chat/ChatService.ts`. No edit to
`ipc-handlers.ts`, `index.ts`, or any renderer file.**

| # | Site | Current line | Edit |
|---|---|---|---|
| 1 | `buildSystemPrompt`, after the `UNTRUSTED_DATA_DIRECTIVE` line | ChatService.ts:574 | Insert `ambientBlock` if the assembler returned one. Placement is deliberate: after the security directive (so injected text is unambiguously trusted, R7) and before the tool doctrine (so policy outranks tool enthusiasm). |
| 2 | `sendMessage`, immediately **before** the user push | ChatService.ts:157 | `const bundle = await assembleForChatTurn({...})`. Then push the user message, then push `turnBlock` as a **`role:'user'`** message (never a second system message — R3; never a `role:'tool'` message — R5, R7) carrying ambient re-assert + retrieved items. This one edit closes R1 and R2 for both fresh and rehydrated sessions, because it runs on **every** turn regardless of which branch built the session. |
| 3 | `runAgentLoop`, the tool-adapter call | ChatService.ts:185 | Pass the bundle's grant list through: `adaptToolsForChat(this.registry, this.services, bundle?.tools)`, with `undefined` preserving today's unrestricted behaviour exactly. **Signature-only in v0** — do not populate grants until the procedure packet, so the parity pin is trivial. |

Plus one signature widening in `src/main/chat/tool-adapter.ts:10-13` (a third
optional parameter, defaulted, filtering the mapped list when present).

Rationale for anchoring at edit #2 rather than #1: `buildSystemPrompt` is
reachable on exactly one of the two session paths, and it is the one a returning
user does *not* take. A per-turn carrier is the only injection point in this
codebase where "the bundle was present" is a property of the turn rather than of
how the session happened to start.

### 4.3 Deliberately deferred

| Deferred | Why |
|---|---|
| Surface B (`ASSISTANT_QUERY`) | Locked file (R9); stateless so it is cheap later; not the ADR-19 actor. |
| Surface C (agent runtime) | Needs a system message where none exists (AgentAIClient.ts:132), and is the autonomous class where ADR-7 fail-closed bites — deserves its own packet and its own eval. |
| Surface D (MCP `initialize`) | ADR-19 explicitly sequences external clients second. |
| Populating `ToolGrant[]` | Changes what the model can see; needs B-03 as its gate. |
| Fixing R1 (system prompt lost on rehydration) | A real live defect but **out of WP-11's scope** — edit #2 makes the assembler immune to it without fixing it, and the fix touches renderer persistence. Should be its own packet; recorded here so it is not lost. |

### 4.4 What WP-11's spec must additionally pin

1. **A `TaskId` per turn** (ULID, via `taskId()` from `src/intelligence`), used
   as `correlation` on every event that turn produces. Not `sessionId` (R6).
2. **The manifest's write destination.** §6.4 says it is the audit artifact;
   this codebase has three audit sinks with documented drift (CLAUDE.md
   "Three sinks, not one"). The manifest is an *event*
   (`task.context_assembled`), so the ledger is the right home — but say so
   explicitly, because the pull toward `operation-audit.log` will be strong.
3. **A token estimator**, since none exists (R4), and the budget numbers in the
   manifest are otherwise fabricated.
4. **The freshness disclosure format** for twin-served facts — `TwinStore.freshness()`
   and `sloFor()` exist; the prose contract (A-01's disclosure half) does not.
5. **The additive-parity pin**: with no policy set and no retrieval configured,
   the assembled prompt must be byte-identical to today's. That is the
   reader-migration pattern's requirement applied to a writer, and it is what
   makes edit #1 safe to land before any policy exists.

---

## 5. Open questions for the owner

1. **Is surface A the Docked Panel, the Chat tab, or both?** They are separate
   components with separate session-id schemes and different persistence
   behaviour (§1.4), and R1 only affects one of them. The anchor-slice demo
   should name which one it runs in.
2. **Ambient policy on every turn, or on change?** Re-asserting the whole policy
   set each turn is correct per §6.2 step 6 ("never trimmed") but multiplies its
   cost by the turn count. A version-hash re-assert with the full set only on
   change is cheaper and still auditable — but it is a departure from the doc.
3. **Does the interactive actor's staleness warning (ADR-7) need to be visible
   to the user, or only to the model?** The chat UI has no channel for a
   platform-authored notice today; the closest thing is the tool-result
   `[Auto-lifecycle: …]` suffix.
4. **Should R1 be fixed first?** WP-11 does not need it fixed, but every future
   context-injection packet will trip over it.

---

## 6. Files that do NOT participate (checked, so nobody re-checks)

- **`src/main/ai-context/`** — `AIContextGenerator.ts` and `auto-generate.ts`
  generate an `AI-CONTEXT.md` **file written into a WordPress site's directory**
  for third-party coding assistants (Copilot, Cursor, Cline, Continue —
  AIContextGenerator.ts:1-12). It never touches a chat turn, a system prompt, or
  a model call. The name collides with this packet's subject; the code does not.
- **`src/main/chat/providers/`** — transport only, except for the system-message
  handling that produces R3.
- **`src/main/mcp/modules/ollama/ask-ollama.ts`** — has its own local
  `buildSiteContext` (ask-ollama.ts:83), unrelated to
  `assistant/AssistantService.ts`'s function of the same name. A grep for
  `buildSiteContext` returns both; they share nothing.

---

## 7. Evidence index

Every non-obvious claim above, with its citation, for spot-checking:

| Claim | Citation |
|---|---|
| `CHAT_SEND` is the chat entry point | chat-ipc-handlers.ts:42-66 |
| Two renderer components share it | PanelChat.tsx:506-513; ChatTab.tsx:523-525 |
| Rehydration skips the system prompt | ChatService.ts:130-138 vs :141 |
| Renderer strips the system message when persisting | PanelChat.tsx:540-550 |
| `ChatTab` never persists | grep `CHAT_SESSION_SAVE` in ChatTab.tsx → no hits |
| System prompt composition | ChatService.ts:553-660 |
| `agentMode=true` suppresses the JSON format block | ChatService.ts:564; wordpress-knowledge.ts:108-109, :156-159, :204 |
| Tools re-sent every loop iteration | ChatService.ts:182 (loop), :185 (adapt) |
| 25 iterations max | constants.ts:448-451 |
| Tool adapter has one caller | grep `adaptToolsForChat` → tool-adapter.ts:10, ChatService.ts:11, :185 |
| Tools are unfiltered by capability | tool-adapter.ts:14-45 |
| ~190 tools registered | index.ts:450-471; static count of `name: '` under `src/main/mcp/modules/` = 190 |
| "160+ tools" is documented in-tree | search-tools.ts:3-5 |
| Agent runtime scopes tools; chat does not | NexusToolProvider.ts:105-118 vs tool-adapter.ts:14 |
| Agents get no system message | AgentAIClient.ts:132; :215-216; :258-259 |
| Anthropic/Google keep only the first system message | anthropic.ts:43-44; google.ts:72-73 |
| OpenAI passes all system messages | openai.ts:62 |
| Tool results are wrapped untrusted | pii.ts:39-44, :67-75; ChatService.ts:196 |
| Tool results are compressed after 2 turns | ChatService.ts:667-696 |
| Platform text already rides tool results | ChatService.ts:371, :394, :467-481 |
| Contributed tools bypass the registry | ChatService.ts:304-325 |
| Surface B rebuilds context per turn | ipc-handlers.ts:2846-2851 |
| Surface B replaces model-authored sites with real data | ipc-handlers.ts:2858-2862; AssistantService.ts:142-319 |
| Surface B already retrieves | ipc-handlers.ts:2876-2891, :2895-2915 |
| MCP `initialize` injects instructions + live snapshot | McpServer.ts:284-307 |
| Ledger supports episodic queries | src/intelligence/ledger/ledger.ts:13-27, :92 |
| Twin freshness/SLO API exists | src/intelligence/folds/twinStore.ts:79; src/intelligence/index.ts exports `sloFor`, `DEFAULT_FRESHNESS_SLOS` |
| Core is reachable but optional | intelligence-host/coreRegistry.ts (whole file); bootstrap.ts:31-45 |
| No `task.*` producer exists | grep for `'task.…'` topic literals across `src/main` + `src/intelligence` (non-test) → **zero hits**. The ten `emitter.emit(` call sites are graphServiceTap.ts:56, :88, :121; graphBackfill.ts:105, :140, :174; bootstrap.ts:91 (drift fold), :141 (`draftFromWpEvent`); verify-site-live.ts:169, :181 — all `state.*` |
| `ai-context/` is unrelated | AIContextGenerator.ts:1-12 |
