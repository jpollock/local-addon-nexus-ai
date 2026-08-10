# `siteScoped` — letting an agent say sites are not its dimension

**Status:** design, not yet planned
**Date:** 2026-08-10
**Branch:** `sdk-and-agents`

## The problem, observed live

`auth-probe`'s Run Now modal offers a picker over 404 sites and a button reading
**"Run on 166 sites"**. The agent ignores every one of them.

It is a 40-line diagnostic. Its signature is `async run({ tools, log })` — it never
destructures scope, never reads `ctx.settings.scope`, never reads `ctx.event`. It makes
three calls: `wpe_get_installs` with no arguments, then `wp_plugin_list` and
`wp_user_list` against a hardcoded `install_name: 'theawfulproduc'`. Its purpose is to
check that WPE OAuth and SSH key auth still work from a cron context.

Pressing that button would call `runner.run()` **166 times** — `ipc-handlers.ts:5101`
loops `for (const siteName of siteNames)` and awaits each. Measured from the live log, an
auth-probe run takes ~8.5s, so that is roughly **23 minutes** of identical, redundant
calls against WP Engine's API. Since the run-id work landed, it would also return 166
unrelated run ids for what the user performed as one action.

**`auth-probe` is not violating the SDK.** It declares `name`, `version`, `triggers`,
`tools` and a `run()`; that is everything `AgentDefinition` requires. The SDK simply has
no way to express "sites are not a dimension of my work."

## Why the gap exists

There is no `ctx.sites`. Site scope never reaches an agent as a first-class thing — it
arrives through `ctx.event` (a targeted run) or through `ctx.settings`, whose own type
comment names *"scan scope"* as an example of agent-specific configuration **"the runtime
has no reason to know about"**.

That is a deliberate position, and the investigation confirms the runtime honours it
almost everywhere:

| trigger | behaviour |
|---|---|
| `AgentScheduler` (cron) | `runner.run(agent, undefined, …)` — **once** |
| event bus | `runner.run(agent, event, …)` — **once**, event may carry a `siteId` |
| GraphQL `agentRun` | `runner.run(agent, undefined, …)` — **once** |
| MCP contributed tools | `dispatcher.dispatch(…)` — **once** |
| **IPC `AGENT_RUN_NOW`** | **loops once per selected site** |

`AGENT_RUN_NOW` is the only fan-out point in the system. It imposes a per-site contract
that the SDK never defines. For `security-sentinel` that loop *is* the delivery
mechanism — 60 references to scope and `installName`, one run per site. For `auth-probe`,
zero references, so the loop only multiplies work.

Two agents on disk, at opposite poles of a distinction the type system cannot see.

## The design

Add a sixth capability declaration to `AgentDefinition`, alongside `allowsProduction`,
`effect`, `producesApprovals`, `producesReports` and `supportsFullRun`:

```ts
/**
 * Whether this agent's work is per-site. Default **true** — the conservative assumption,
 * matching `effect`'s default of 'writes'.
 *
 * Set false for an agent whose run() ignores site scope entirely: it reads neither
 * `ctx.event`'s site nor `settings.scope.siteIds`, and does the same thing regardless of
 * which sites are selected. `auth-probe` is the worked example — a fleet-wide auth
 * diagnostic that makes three fixed calls.
 *
 * When false: the site picker is not offered on any surface, and Run Now performs
 * exactly ONE run with no scoped event. Declaring false while actually reading a site
 * from `ctx.event` means the agent silently receives `undefined`.
 */
siteScoped?: boolean;
```

**Explicit field, not derived.** Deriving it — static analysis of whether an agent's
source reads `ctx.event` or `settings.scope` — is fragile and, worse, fails *open*: a
parse miss would silently mark a site-scoped agent as fleet-wide and drop its scope. An
explicit declaration is checkable, greppable, and consistent with the five fields already
there.

**Default true.** An agent that has not been updated keeps today's behaviour exactly.
Only an author who has read their own `run()` opts out.

### What changes per surface

**1. Run Now (`AgentRunModal.tsx`).** Today the picker renders unconditionally. When
`siteScoped === false`, replace the picker and the "Run on N sites" footer with a plain
confirmation — the modal still exists (it carries the `supportsFullRun` toggle and is the
confirm step), but it states what will happen: one run, fleet-wide, no site selection.

**2. Settings scope editor (`AgentWorkspaceSettings.tsx`).** `renderScanScope()` — the
"SITES IN SCOPE" eyebrow, the sentence, the editor and the drift banner — is not rendered.
In its place, one line saying the agent is not site-scoped.

There is already a precedent for exactly this shape: `scopeLivesInSitesTab` switches
between `renderScanScope()` and `renderScopeElsewhereLine()`. Follow it rather than
inventing a second conditional style.

**3. `AGENT_RUN_NOW` (`ipc-handlers.ts`).** Bypass the loop: one `runner.run(agent,
undefined, { trigger: 'manual', … })`, and broadcast the single resulting run id.

The gate must live **in the handler**, not only in the UI. The renderer is a courtesy; the
CLI and any future caller reach this channel too. This mirrors the rule already written
for `allowsProduction`: *"the same rule must be enforced wherever a scope is actually
applied … the UI lock is a courtesy, not the boundary."*

**4. Nothing else.** The scheduler, event bus, GraphQL and MCP paths already run once.
Drift detection short-circuits on `!scopeUpdatedAt` and so disables itself correctly with
no change. No agent-side change is needed — a non-scoped agent simply keeps not reading
scope.

### The wiring path

`allowsProduction` and `effect` each thread through the same seven steps, and their
consumer sets are the checklist:

1. `src/main/agent-sdk/types.ts` — declare on `AgentDefinition`
2. `src/main/graphql/schema.ts` — add to the `AgentStatus` type
3. `src/main/graphql/resolvers.ts` — `agentStatus` resolver, `(def as any).siteScoped ?? true`
4. `src/renderer/components/agents/AgentStore.ts` — add to the `AgentStatus` interface
5. `src/renderer/components/agents/AgentConsoleTab.tsx` — add to the query string
6. `src/renderer/components/agents/AgentWorkspace.tsx` — read and pass as a prop
7. `AgentRunModal.tsx` / `AgentWorkspaceSettings.tsx` — consume

**Step 5 is the one that silently breaks.** A field absent from the query string arrives
`undefined` in the renderer and falls back to its default, so a `siteScoped: false` agent
would render as scoped with no error anywhere. Any test must assert the field is actually
requested, not merely that the component handles it.

### A defect this surfaces, and a decision needed

**Run Now with zero sites is a silent no-op at the handler.** The loop iterates an empty
array, `AGENT_RUN_COMPLETE` broadcasts `runIds: []`, `doneCount: 0`, `failedCount: 0`, and
the result is indistinguishable from a successful run.

**It is not reachable from the UI today** — `AgentRunModal`'s Run button is
`disabled: selection.size === 0`. So this is defense-in-depth for the CLI and any other
caller of the channel, not a live user-facing bug. (An earlier draft of this document
called it user-visible; that was wrong.) It is still worth closing, because it is
precisely the state a `siteScoped: false` agent would land in if the picker were merely
emptied rather than bypassed. **Decide explicitly:** refuse, or state plainly that nothing
ran — do not leave "success, 0 sites" as the answer. Separate defect, separate task.

## Scope boundary

`auth-probe` is the only agent that would set `siteScoped: false` today. That is enough:
the field is not speculative generality, it is a distinction the system already contains
and cannot currently see. The work is one field, seven wiring steps, two UI branches, one
handler branch, and one adjacent defect.

Explicitly **out** of scope: any change to how site-scoped agents resolve scope,
`resolveScanScope` (agent-side, not shared, deliberately), and the artifact/reports model.
