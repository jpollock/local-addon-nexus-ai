---
title: Agent SDK
description: Writing your own Nexus agent — definition, triggers, context API, contributed tools, manifest, testing
keywords: [agents, sdk, defineAgent, nexus.agent.yaml, contributed tools, triggers]
---

# Agent SDK

This guide covers how to write your own agent. It is written against the source in
`src/main/agent-sdk/` and `src/main/agent-runtime/`, not against the SDK spec
(`docs/planning/nexus-agent-sdk-v1.md`), which is still marked **Draft** and does not
always match what shipped. If this page and the code disagree, the code is right; please
fix this page.

For the four agents that ship with Nexus, see [Agents](agents.md). Their source in the
repo's `agents/` directory is the best set of worked examples:

- `log-processor`: contributed tools, credentials, a private SQLite database
- `seo-insights`: AI calls, sandboxes, reports
- `web-analytics`: OAuth credentials, several accounts
- `security-sentinel`: findings, remediation plans, approvals

---

## Quick start

```bash
nexus agent create my-agent              # scaffold (default --mode run)
# edit ~/Library/Application Support/Local/nexus-ai/agents/my-agent/agent.ts
nexus agent validate my-agent            # type-check
nexus agent run my-agent                 # run it once, now
nexus agent logs my-agent --follow       # watch it
```

A new agent starts **opted out of automatic runs**. The first time an agent is seen, it
gets these settings:

```
enabled: true, scheduleEnabled: false, eventsEnabled: false, autonomy: 'ask'
```

Existing settings are never overwritten (`seedAgentDefaultsIfMissing`). As a result, a
brand-new agent's cron and event triggers do nothing until someone turns on "Schedule" or
"Events" in its workspace. `nexus agent run` works regardless of those two settings.

---

## Where agents live and how they load

Each agent is a directory under
`~/Library/Application Support/Local/nexus-ai/agents/<name>/` containing:

| File | Required | Purpose |
|---|---|---|
| `agent.ts` or `agent.js` | yes | Default-exports the result of `defineAgent({...})`. `.ts` wins if both exist. |
| `nexus.agent.yaml` | only for contributed tools | The manifest. See [below](#the-manifest-nexusagentyaml). |
| `README.md` | no | Scaffolded. Shown to users as the agent's documentation. |

**Loading** (`AgentRegistry`):
- `.ts` files are compiled on the fly with `ts-node` (`transpileOnly`). The loader does not type-check; run `nexus agent validate` for that.
- `import ... from '@nexus-ai/agent-sdk'` is resolved by the runtime to Nexus's own compiled SDK. You do not install it.
- Any other package you import must be resolvable from the agent's directory. Install it into `agents/node_modules`.
- Packages published to npm are also loaded from `agents/node_modules/<pkg>` when their `package.json` `main` is `agent.ts` or `agent.js`. `nexus agent install <package>` runs `npm install --prefix <agentsDir>` and reloads the agent registry.

**Hot reload:** the agents directory is watched. Saving any `.ts`, `.js`, `.yaml` or `.yml`
file under an agent's directory triggers these steps, debounced 300ms:

1. Unsubscribe the agent's triggers.
2. Stop its daemon, if it has one.
3. Close its databases.
4. Re-`require` the agent.
5. Wire its triggers again.

**Names:** `^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$`. Lowercase, digits, `-` and single `_`
only. A double underscore is banned because contributed tools are exposed as
`agent__<agent>__<tool>`. (`nexus agent create` is stricter: lowercase, digits and hyphens
only.)

---

## `defineAgent`

```ts
import { defineAgent, cron, on } from '@nexus-ai/agent-sdk';

export default defineAgent({
  name: 'my-agent',
  version: '1.0.0',
  description: 'What this agent does',
  triggers: [cron('0 2 * * *')],
  tools: ['nexus_list_sites'],

  async run(ctx) {
    const sites = await ctx.tools.invoke('nexus_list_sites', {});
    ctx.log.info(`found ${Array.isArray(sites) ? sites.length : 0} sites`);
    return { summary: 'done' };
  },
});
```

`defineAgent` throws if `name` is empty or `triggers` is empty. The registry skips any
module whose export has no `name` or no `run`.

### Fields

| Field | Default | Meaning |
|---|---|---|
| `name`, `version` | — | Required. `name` is the key for settings, state, logs and databases. |
| `description` | — | Shown in the agent list. |
| `triggers` | — | Required, at least one. See [Triggers](#triggers). |
| `tools` | *unrestricted* | Built-in tools this agent may call. See [Tool access](#tool-access). **Leaving it out allows every non-destructive tool; `[]` allows none.** |
| `model` | Nexus setting | Model for `ctx.ai`. |
| `timeoutMs` | `300_000` (5 min) | Deadline for `run()`. A run that passes it has status `timeout`, and `onError` is called. `seo-insights` uses 20 min. |
| `credentials` | `[]` | OAuth or API-key credentials the agent needs. See [Credentials](#credentials). |
| `contributes.tools` | — | Tools this agent provides to chat, MCP, the CLI and other agents. See [Contributed tools](#contributed-tools). |
| `onError(err, ctx)` | — | Called on a timeout or a thrown error, if the context was built. Errors inside it are swallowed. |
| `effect` | `'writes'` | `'readonly'` \| `'writes'`. Chooses the production warning in the site picker ("scanned" or "modified"). Must match what `run()` actually does. |
| `allowsProduction` | `true` | `false` locks production sites out of the scope picker. The UI lock is a courtesy; enforce the same rule wherever you apply a scope. |
| `siteScoped` | `true` | `false` for an agent that ignores site scope. No site picker is shown, and Run Now performs exactly one run with no scoped event. |
| `producesApprovals` | `false` | Whether the agent creates findings or actions that need sign-off. This controls the Approvals tab. |
| `producesReports` | `false` | Whether the agent produces a standalone report meant to be read on its own. |
| `supportsFullRun` | `false` | Shows an "Always do full run" toggle in Run Now. The agent reads the choice from `ctx.fullRun`. |

### Returning a result

`run()` may return nothing or a `Partial<AgentResult>`. The runtime keeps these fields from
what you return: `verdict`, `findings`, `plan`, `sites` and `summary`. Everything else
(status, timings, run ids, log paths) belongs to the runtime.

- `summary` is free text. It is written to `logs/run-<ts>-report.md` next to the run's log and shown in the run drawer.
- Findings and site statuses you record through `ctx.log.finding()` and `ctx.log.siteStatus()` are collected automatically. A returned `findings` or `sites` value replaces them.
- Every run is recorded in `agent_runs` (the last 100 per agent), the inbox and the event log (`run.start` and `run.end`). An agent that fails repeatedly in the same way is **auto-paused**.

---

## Triggers

```ts
import { cron, on, stream, webhook } from '@nexus-ai/agent-sdk';
```

| Helper | Fires when | Gate |
|---|---|---|
| `cron('0 3 * * *')` | On the node-cron schedule | `enabled` and `scheduleEnabled` |
| `on('wp:plugin.*')` | A matching event is published on the agent event bus | `enabled` and `eventsEnabled` |
| `webhook('path')` | An event with key `webhook:<path>` is published | **none** (see [Known issues](#known-issues)) |
| `stream('pattern')` | Starts a long-lived daemon process (experimental) | — |

All automatic runs are also blocked while the agent is auto-paused, or when the remote
release policy has turned agents off.

**The schedule a user picks overrides yours.** Your cron expressions are the default. If a
user explicitly picks a cadence in the agent's settings, that single cadence replaces all of
your cron triggers (`resolveAgentCron`, `src/main/agent-runtime/schedule.ts`). An agent with
no cron trigger is never given a schedule.

**Triggers come from `agent.ts`, not from the YAML manifest.** The runtime schedules and
subscribes using the triggers in your `defineAgent` call. A `triggers:` block in
`nexus.agent.yaml` is not read by the runtime.

### Event patterns

Event keys are `namespace:type`. Patterns are globs: `*` matches anything, including dots.

| Key | Published by |
|---|---|
| `local:site.started` / `site.stopped` / `site.removed` | Local's lifecycle hooks |
| `wp:post.created` / `post.updated` / `post.deleted` / `post.published` | WordPress webhook events from Local sites (MU plugin) |
| `wp:plugin.installed` / `activated` / `deactivated` / `updated` / `deleted` | same |
| `wp:theme.installed` / `activated` / `deleted` | same |
| `wp:user.created` / `updated` / `deleted`, `wp:site.initialized` | same |
| `wpe:sync.completed` | `WpeRefreshScheduler`, once for **every** stale install it refreshes in a cycle (opt-in) |
| anything | `nexus agent emit <ns:type> [--site id] [--payload json]` |

Your run receives the event as `ctx.event`: `namespace`, `type`, `key`, `siteId` and
`payload`.

!!! warning "Fleet-wide events launch fleet-wide runs"
    One `wpe:sync.completed` scheduler cycle can fire your agent for dozens of different installs
    at once, and nothing in the event tells you whether a user or the scheduler caused it.
    `security-sentinel` and `seo-insights` both **removed** this trigger for that reason (see the
    comment above `triggers` in `agents/seo-insights/agent.ts`). A cooldown per site does not help,
    because each install is a different site. For per-site work, use Run Now or a cron trigger with
    `settings.scope.siteIds`.

---

## The context (`ctx`)

| Member | What it is |
|---|---|
| `ctx.trigger` | **The agent's first declared trigger**, not the one that fired. Use `ctx.event` to tell an event run apart. |
| `ctx.event` | The triggering event, or `undefined` for cron runs and unscoped manual runs. |
| `ctx.tools` | Tool invocation. See [Tool access](#tool-access). |
| `ctx.state` | Persistent key/value store for this agent. |
| `ctx.ai` | The model client. |
| `ctx.log` | Freeform and structured logging. |
| `ctx.db` | Private SQLite databases. |
| `ctx.credentials` | Access to credentials the agent declared. |
| `ctx.settings` | This agent's persisted settings, read-only. |
| `ctx.autonomy` | `'suggest'` (report only), `'ask'` (wait for approval) or `'auto'`. Your agent must honour it. |
| `ctx.fullRun` | The user asked for a full, non-incremental run. |
| `ctx.task`, `ctx.contextBundle` | Intelligence-layer identity and context. **Optional**: absent when the intelligence core is unavailable. |

### `ctx.state`

```ts
state.get<T>(key) / state.set(key, value) / state.delete(key)
state.isCoolingDown(key, durationMs)   // true if setCooldown(key) was called < durationMs ago
state.setCooldown(key)                 // records now
state.scratch                          // plain object, reset every run — not persisted
```

Values are persisted in SQLite per agent and survive restarts. A cooldown's length is
chosen when you *check* it, not when you set it.

### `ctx.log`

`info` / `warn` / `error` / `debug(msg)` write to three places at once:

- the agent's per-run log file (`agents/<name>/logs/run-<ts>.log`, or `agent.log`)
- the main process log
- the structured event log (`nexus-YYYY-MM-DD.log` and `agents/<name>-YYYY-MM-DD.log`, correlated by `run=<id>`)

The structured methods are what the UI renders:

```ts
log.phase('scan', 'checking plugins');
log.siteStatus('mysite', 'findings');           // 'running'|'clean'|'findings'|'escalated'|'error'
log.finding({ id: 'weak-salts', severity: 'high', title: 'Default salts', site: 'mysite' });
log.action({ label: 'Deactivated plugin', site: 'mysite', result: 'ok', durationMs: 812 });
log.mutation({ op: 'plugin.update', target: 'mysite', before: '1.2', after: '1.3', ok: true });
```

- Per-run log files and reports are pruned to the most recent 20 per agent. `agent.log` is rotated.
- You do **not** need to call `log.mutation()` for tool calls. The runtime emits `tool.call` for every tool invocation and `mutation` for mutating tools itself. Use `log.mutation()` only for changes made outside the tool layer.

### `ctx.ai`

```ts
const text = await ai.run(prompt, { maxTurns: 10, model });     // tool-using loop
const obj  = await ai.generateObject<T>({ prompt, system, schema, schemaName, noTools });
```

- `run()` is an agent loop with access to the same tools as `ctx.tools`, minus Tier 3 tools, which are never offered to the model. It throws `AgentAILoopError` after `maxTurns` turns (default 10) without a final answer.
- `generateObject()` takes a JSON Schema and returns an object matching it. `noTools: true` forces a single structured answer.
- Calls always go straight to the configured provider, never through the Local AI Gateway.
- Calls count against the optional daily USD budget (`dailyUsdBudget`).
- If the provider is unavailable, `run()` returns `''` and `generateObject()` returns `{}`, with a warning. Plan for empty results.

### `ctx.db`

```ts
const db = ctx.db.open('cache');   // <agentsDir>/<name>/cache.sqlite, connection cached
db.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY)');
db.prepare('INSERT OR IGNORE INTO seen VALUES (?)').run(id);
```

A better-sqlite3 handle that belongs only to your agent. It is closed on hot reload, so do
not keep it in a module-level variable across reloads.

### `ctx.settings`

`ctx.settings` holds whatever the agent's settings panel persisted. The site scope is at
`settings.scope.siteIds`.

- It is `{}` when nothing has been saved. Treat a missing value as the **safe** choice, not the permissive one: a permissive fallback here is how `security-sentinel` once swept the whole fleet every 15 minutes.
- Do not re-implement gating from `enabled`, `scheduleEnabled` or `eventsEnabled`. The runtime has already applied them before `run()` is called.

---

## Tool access

`ctx.tools.invoke(name, args)` calls a built-in Nexus tool (the same registry chat and MCP
use), or a tool contributed by another agent. It returns the tool's text output, parsed as
JSON when possible. It throws on a tool error or a refusal.

The gates run in this order (`NexusToolProvider.invokeInner`):

1. **Scope.** If you declared `tools`, a name that is not on the list is refused.
2. **Tier 3 is always refused.** A destructive tool (`wpe_delete_install`, `local_wpe_push`, `local_delete_site`, …) needs a human to confirm, and an autonomous agent has none. No setting changes this.
3. **Refusal from the intelligence layer.** When the run's context was assembled in fail-closed mode, every call of Tier 2 or above is refused, and the run keeps read-only access.
4. **Sandbox scope.** Free-form tools that need approval in chat (`wp_eval`, `wp_search_replace`) only work against a site you registered with `ctx.tools.registerSandbox(siteId)`. With none registered they are refused, even for an agent with no `tools` list.
5. **Operation permissions.** The call then goes through `ToolRegistry.call(..., 'agent', ...)`, so every normal gate still applies: capability grants for this agent (made in its workspace under "Procedures this agent may run"), per-environment WP Engine permissions, and the account write bound. Production writes are refused unless a human granted them.

Tier 2 and Tier 3 calls that reach a tool are written to `operation-audit.log` with this
run's id.

**Calling another agent's tool:** add its bare tool name, for example `get_log_aggregates`, to
your `tools` list. If no built-in tool has that name, the runtime dispatches to the agent that
contributes it. That agent must be enabled.

`nexus agent validate` type-checks your agent, but it does not currently check tool names
(see [Known issues](#known-issues)). A misspelt tool name only shows up at run time.

---

## Credentials

Declare what you need. The runtime handles consent, storage and refresh:

```ts
credentials: [
  { provider: 'google', scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    optional: true, reason: 'Reads GA4 traffic to diagnose site problems' },
  { provider: 'aws', type: 'api_key', optional: true, reason: 'Reads access logs from S3' },
],
```

`reason` is shown word for word in the consent prompt. At run time:

```ts
const status = await ctx.credentials.getStatus('google');       // 'connected'|'not_connected'|'revoked'
const token  = await ctx.credentials.getToken('google');        // throws NotConnectedError, RevokedError, …
await ctx.credentials.requestConnection('google');              // asks the UI to show the connect flow
const keys   = await ctx.credentials.getSecret?.('aws');        // api_key credentials — feature-detect
const accts  = await ctx.credentials.listConnections?.('google'); // multiple accounts — feature-detect
```

`getToken` never opens UI. The typed errors (`NotConnectedError`, `RevokedError`,
`ScopeInsufficientError`, `SafeStorageUnavailableError`, `TemporarilyUnavailableError`) are
exported from the SDK. Refresh tokens are never exposed.

---

## Contributed tools

An agent can publish tools that chat, MCP clients, the CLI and other agents can call. Each
is exposed as `agent__<agent>__<tool>`.

```ts
contributes: {
  tools: {
    get_thing: {
      description: 'Return the thing for a site',
      inputSchema: { type: 'object', properties: { siteId: { type: 'string' } }, required: ['siteId'] },
      executionMode: 'function',
      permissionTier: 1,
      handler: async (args: { siteId: string }, ctx) => ({
        content: [{ type: 'text', text: JSON.stringify(await load(ctx, args.siteId)) }],
      }),
    },
  },
},
```

**The manifest is what registers a tool.** `AgentRegistry` registers contributed tools from
`nexus.agent.yaml`'s `contributes.tools`. `agent.ts` only supplies the handlers. A tool with
a complete handler but no manifest entry is "not found". Keep the two in step, including
`executionMode` and `permissionTier`.

| `executionMode` | Behaviour |
|---|---|
| `function` (default) | Calls `handler(args, ctx)` with a full agent context. 5-minute timeout. |
| `run` | **Ignores the tool name and calls the agent's `run()`**, passing the arguments as an event payload. This is almost never what you want. `log-processor` moved every tool to `function` after `run` mode silently ran a nightly sync instead of the requested operation. |

**Tiers:** `permissionTier` on a manifest entry overrides the agent-level
`permissions.tier`. Tier 2 means modifying (needs acknowledgement); Tier 3 means destructive
(needs a confirmation token, and can only be called through MCP). A disabled agent's tools
refuse every call.

**From the CLI:**

```bash
nexus agent tools list [agent]
nexus agent tools invoke my-agent get_thing --arg siteId=mysite
nexus agent tools build [agentPath]          # regenerate contributes: from agent.ts
nexus agent tools build --check              # CI: fail if the manifest is stale
```

---

## The manifest (`nexus.agent.yaml`)

```yaml
name: my-agent
version: 1.0.0
description: What this agent does
permissions:
  tier: 1            # default tier for contributed tools; 2 = reversible writes, 3 = production mutations
tools: []            # informational; the runtime uses agent.ts's `tools`
credentials: []      # keep in step with agent.ts
contributes:
  tools:
    - name: get_thing
      description: Return the thing for a site
      executionMode: function
      permissionTier: 1        # optional per-tool override
      inputSchema: { type: object, properties: { siteId: { type: string } }, required: [siteId] }
```

The runtime reads `name`, `permissions.tier` and `contributes.tools` from this file. The
triggers, the tool list and the credentials that take effect all come from `agent.ts`.

---

## Testing

```ts
import { mockContext, testTool } from '@nexus-ai/agent-sdk';
import agent from './agent';

test('run lists sites', async () => {
  const ctx = mockContext({
    tools: { nexus_list_sites: async () => [{ name: 'a' }] },
    settings: {},                  // default — exercise the nothing-configured case
    autonomy: 'ask',
  });
  await agent.run(ctx);
  expect(ctx.state.get('lastRunAt')).toBeDefined();
});

test('get_thing', async () => {
  const ctx = mockContext();
  const res = await testTool(agent, 'get_thing', { siteId: 'a' }, ctx);
  expect(res.isError).toBeFalsy();
});
```

What the mocks do:

| Mock | Behaviour |
|---|---|
| `tools` | Throws for any tool you did not mock. The error message tells you what to pass. |
| `ai` | `run()` returns `'mock AI response'`; `generateObject()` returns `{}`. |
| `db` | In-memory SQLite. |
| `credentials` | Every provider is not connected, and `getSecret` is absent. |
| Logger | Does nothing. |
| `state` | In-memory, but **`setCooldown` always lasts 60s** whatever `durationMs` you check with. The real store uses your `durationMs`. |

For the full path (context construction, gates, logging), run the agent in Local with
`nexus agent run <name>` and read `nexus agent logs <name>`.

---

## CLI reference

| Command | Purpose |
|---|---|
| `nexus agent list` / `status [--json]` | Registered agents and the result of each one's last run |
| `nexus agent create <name> [--mode run\|tools\|both]` | Scaffold `agent.ts`, `nexus.agent.yaml` and `README.md` |
| `nexus agent validate [name]` | `tsc --noEmit` against the SDK types |
| `nexus agent run <name> [--install <wpe>]` | Run now. `--install` works by emitting `wpe:sync.completed`, so it does nothing for agents without that trigger. |
| `nexus agent logs <name> [--lines n] [--follow]` | Show or tail the agent's log |
| `nexus agent emit <ns:type> [--site id] [--payload json]` | Publish a synthetic event |
| `nexus agent install <package>` | Install an agent published to npm |
| `nexus agent tools list\|invoke\|build` | Contributed tools (see above) |

---

## Known issues

Found while writing this page (2026-09-25) by reading the code, plus one reproduction.
Remove each entry here when it is fixed.

1. **`nexus agent create --mode tools` produces an agent that cannot load.** The template has
   no `triggers` and no `run`. `defineAgent` throws `Agent must have at least one trigger`
   (reproduced), and the registry would skip it anyway for lacking `run`. Until the template
   is fixed, use `--mode both`, or add a trigger and a `run`.
2. **The `tools` and `both` templates use `schema: z.object(...)` (Zod).** Neither matches
   the SDK. `ContributedToolDefinition` has `inputSchema`, not `schema`, so strict
   type-checking rejects it. `zod` is also not installed in `agents/node_modules` by default.
   `nexus agent tools build` does convert `schema` to JSON Schema, but writing `inputSchema`
   directly is simpler.
3. **`nexus agent tools build` drops per-tool `permissionTier`** and rewrites the entire
   manifest with `yaml.dump`, which also loses comments. Running it on `log-processor` would
   silently move `fetch_log_window` from Tier 2 to the agent's Tier 1. Re-add tier overrides
   by hand after a build.
4. **`nexus agent validate` never checks tool names.** It queries a GraphQL field
   (`mcpTools`) that no resolver defines. The error is swallowed, and it always prints "Tool
   check skipped (Local not running)".
5. **The `filter` argument of `on(pattern, filter)` is ignored.** Only `pattern` is used to
   subscribe. Filter in `run()` yourself.
6. **Webhook triggers skip the enable gates.** Unlike cron and event triggers, a `webhook`
   trigger runs without checking `enabled` or `eventsEnabled`. Nothing in Nexus publishes
   `webhook:*` events except `nexus agent emit`.
7. **Stream (daemon) agents get a stub context.** The forked worker gives `run()` only
   `trigger`, `event`, `tools` (calls forwarded over IPC) and `log`. `state` does not persist.
   `ai` has neither `run` nor `generateObject`. There is no `db`, `credentials`, `settings` or
   `autonomy`. At most 5 daemons run at once. Treat `stream()` as experimental.
8. **`ctx.trigger` is always the first declared trigger**, not the one that fired.
