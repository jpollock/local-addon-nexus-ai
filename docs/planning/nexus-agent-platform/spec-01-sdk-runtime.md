# Spec 01: SDK + Event Bus + Runtime

**Date:** 2026-07-12  
**Branch:** `feat/nexus-agent-platform`  
**Status:** Design approved — ready for implementation planning  
**Parent:** [vision.md](./vision.md)  

---

## What This Spec Covers

The foundation of the Nexus Agent Platform:

1. **SDK** — the `defineAgent` contract (internal module `src/main/agent-sdk/`)
2. **Event Bus** — durable SQLite-backed event routing (`src/main/agent-event-bus/`)
3. **Runtime** — agent discovery, scheduling, execution, state (`src/main/agent-runtime/`)
4. **Developer surface** — minimal CLI + fixture agent to make the runtime observable without the Builder

Builder (authoring toolchain) and Publisher (Atlas deploy + npm registry) are Spec 02 and 03.

---

## App Lifecycle — How an Agent Gets Built and Run

### 1. Author writes an agent file

The developer creates a directory under `~/Library/Application Support/Local/nexus-ai/agents/`:

```
~/Library/Application Support/Local/nexus-ai/agents/
  nightly-plugin-updater/
    agent.ts
    package.json
```

```typescript
// agent.ts
import { defineAgent, cron } from '@nexus-ai/agent-sdk';

export default defineAgent({
  name: 'nightly-plugin-updater',
  version: '1.0.0',
  triggers: [cron('0 2 * * *')],
  tools: ['wp_plugin_update', 'wp_site_health', 'nexus_list_sites'],
  model: 'claude-sonnet-5',

  async run({ tools, state, ai, log }) {
    const sites = await tools.invoke('nexus_list_sites', {});
    for (const site of sites) {
      log.info(`Updating plugins on ${site.name}`);
      await tools.invoke('wp_plugin_update', { site: site.name, slug: '--all' });
    }
    state.set('lastRun', Date.now());
  },
});
```

No build step required locally — the runtime loads via `ts-node` or pre-compiled JS.

### 2. Local starts — AgentRegistry discovers the agent

On Nexus addon init, `AgentRegistry` scans the agents directory, imports each `agent.ts`, and registers the definition in memory. The agent is **known but not running**.

### 3. Triggers are wired

- `cron(...)` → `AgentScheduler` registers a `node-cron` job. Idle until scheduled time.
- `on(...)` → `EventBus.subscribe()` registers a pattern handler. Idle until matching event.
- `stream(...)` (daemon) → `DaemonManager` forks a child process immediately and keeps it alive.

### 4. Trigger fires → AgentRunner executes

`AgentRunner` builds an `AgentContext`, injects `NexusToolProvider` (scoped to declared tools), `AgentStateHandle` (SQLite-backed), `AIClient` (Nexus AI gateway), and `AgentLogger`. Calls `agent.run(context)`. On completion, records result and flushes state mutations.

**Task and Reactive agents run in the main process** with a configurable timeout (default 5 min).  
**Daemon agents run in a forked child process** via `child_process.fork()` — same pattern as Local's `workerFork`.

### 5. On Atlas (when published)

Same `agent.ts`. The Publisher (Spec 03) bundles it with a self-contained runtime, Atlas-compatible `ToolProvider` (WP REST + CAPI), and a webhook-based event source adapter. No Local dependency at runtime.

---

## Component Design

### SDK (`src/main/agent-sdk/`)

**`defineAgent(def)`** — validates and returns the definition. No side effects at definition time; all wiring happens at runtime.

```typescript
export interface AgentDefinition {
  name: string;
  version: string;
  description?: string;
  triggers: Trigger[];
  tools?: string[];           // scoped Nexus tool names; empty = no tool access
  model?: string;             // default: inherits from Nexus settings
  run: (ctx: AgentContext) => Promise<void>;
  onError?: (err: Error, ctx: AgentContext) => Promise<void>;
}
```

**Trigger types:**

```typescript
cron(expression: string): CronTrigger
on(event: string, filter?: Record<string, string>): EventTrigger  // reactive
stream(pattern: string): StreamTrigger                            // daemon
webhook(path: string): WebhookTrigger
```

**AgentContext — injected by runtime, never constructed by agent authors:**

```typescript
interface AgentContext {
  trigger: Trigger;
  event?: NexusEvent;            // populated for reactive and daemon modes
  tools: ToolProvider;
  state: AgentStateHandle;
  ai: AIClient;
  log: AgentLogger;
}

interface ToolProvider {
  invoke(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface AgentStateHandle {
  get<T>(key: string): T | undefined;   // reads persisted SQLite store
  set(key: string, value: unknown): void;
  delete(key: string): void;
  scratch: Record<string, unknown>;     // ephemeral, this invocation only
}
```

**`ToolProvider` is an interface, not an implementation.** In Local, `NexusToolProvider` fulfills it by calling the existing MCP tool registry, enforcing the agent's declared tool scope. On Atlas, `AtlasToolProvider` fulfills it with direct WP REST / CAPI calls. Same agent code, different provider injected at startup.

---

### Event Bus (`src/main/agent-event-bus/`)

SQLite-backed. Events are written to the database before dispatch — agents that were offline when an event fired can replay missed events on next startup.

**Schema** (new tables in `graph.db`):

```sql
CREATE TABLE agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace   TEXT    NOT NULL,   -- 'wp', 'wpe', 'local', 'webhook'
  type        TEXT    NOT NULL,   -- 'post.published', 'deploy.completed', etc.
  site_id     TEXT,               -- nullable; scopes site-specific events
  payload     TEXT    NOT NULL,   -- JSON
  created_at  INTEGER NOT NULL,   -- unix ms
  consumed_at INTEGER             -- null = unconsumed
);
```

**API:**

```typescript
class AgentEventBus {
  publish(event: NexusEvent): void;
  subscribe(pattern: string, handler: EventHandler): Unsubscribe;
  replay(fromTimestamp: number, pattern?: string): NexusEvent[];
}
```

Pattern matching is glob-style: `wp:post.*` matches `wp:post.published` and `wp:post.deleted`. `wpe:*` matches all platform events.

**Event sources bridged into the bus:**

| Source | Namespace | How bridged |
|---|---|---|
| WordPress sites | `wp:*` | Existing `/wp-events` HTTP handler → `bus.publish()` |
| Local lifecycle | `local:*` | Existing `siteStarted` / `siteStopped` hooks → `bus.publish()` |
| WP Engine platform | `wpe:*` | CAPI webhooks (future) → `bus.publish()` |
| External | `webhook` | Per-agent HTTP endpoint → `bus.publish()` |

**WordPress event examples** (via `nexus-ai-connector` plugin, already capable of sending arbitrary hooks):
`wp:post.published`, `wp:user.registered`, `wp:plugin.activated`, `wp:order.placed`

**Retention:** Events older than 30 days are pruned on startup. Configurable.

---

### Runtime (`src/main/agent-runtime/`)

Five components with clear, single responsibilities:

#### AgentRegistry

Scans `~/Library/Application Support/Local/nexus-ai/agents/` on startup. Each subdirectory with an `agent.ts` or `agent.js` is an agent package. Registers definitions in memory. In dev mode, watches for file changes and hot-reloads.

```typescript
class AgentRegistry {
  load(): Promise<void>;
  get(name: string): AgentDefinition | undefined;
  list(): AgentDefinition[];
  watch(): void;    // dev mode only
}
```

#### AgentScheduler

Manages `CronTrigger` registrations using `node-cron`. On trigger fire, hands off to `AgentRunner`.

```typescript
class AgentScheduler {
  register(agent: AgentDefinition): void;
  unregister(name: string): void;
  start(): void;
  stop(): void;
}
```

#### AgentRunner

Executes Task and Reactive agents in the main process. Builds `AgentContext`, injects providers, calls `agent.run()`, handles timeout and error.

```typescript
class AgentRunner {
  run(agent: AgentDefinition, event?: NexusEvent): Promise<AgentResult>;
}
```

Timeout default: 5 minutes. Configurable per-agent via `AgentDefinition.timeout`. On timeout, `onError` is called if defined, then the run is recorded as failed.

#### DaemonManager

Manages always-on Daemon agents (those with `stream()` triggers). Uses `child_process.fork()` — same pattern as Local's `workerFork`. Each daemon gets its own child process.

```typescript
class DaemonManager {
  start(agent: AgentDefinition): void;
  stop(name: string): void;
  stopAll(): Promise<void>;    // called on Local quit
  status(name: string): DaemonStatus;
}
```

Lifecycle:
- Fork on `start()` — process subscribes to the event bus via IPC
- Monitor heartbeats — restart crashed daemons with exponential backoff (1s → 2s → 4s → … cap 5 min)
- On Local quit — send `SIGTERM`, wait up to 10s for clean exit, then `SIGKILL`
- IPC channel carries log lines and status updates back to main process for UI display

#### AgentStateStore

Single SQLite table. Key-value store, one namespace per agent name.

```sql
CREATE TABLE agent_state (
  agent_name  TEXT    NOT NULL,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,   -- JSON-serialized
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_name, key)
);
```

```typescript
class AgentStateStore {
  get<T>(agentName: string, key: string): T | undefined;
  set(agentName: string, key: string, value: unknown): void;
  delete(agentName: string, key: string): void;
  clear(agentName: string): void;
}
```

---

## Three Execution Modes — Summary

| Mode | Trigger | Process | Lifetime | Missed events |
|---|---|---|---|---|
| **Task** | `cron()` | Main process | Run to completion | N/A (scheduled) |
| **Reactive** | `on()` or `webhook()` | Main process | Run to completion | Replayed from SQLite log on next start |
| **Daemon** | `stream()` | Forked child process | Lifetime of Local | Replayed from SQLite log on fork start |

---

## File Structure

```
src/main/
  agent-sdk/
    index.ts              ← public exports (defineAgent, cron, on, stream, webhook)
    define-agent.ts
    triggers.ts
    types.ts              ← AgentDefinition, AgentContext, ToolProvider, etc.

  agent-event-bus/
    index.ts
    AgentEventBus.ts
    schema.ts             ← SQL for agent_events table
    bridges/
      wp-events-bridge.ts
      local-lifecycle-bridge.ts

  agent-runtime/
    index.ts
    AgentRegistry.ts
    AgentScheduler.ts
    AgentRunner.ts
    DaemonManager.ts
    AgentStateStore.ts
    NexusToolProvider.ts  ← implements ToolProvider using existing MCP ToolRegistry

src/cli/commands/
  agent.ts                ← nexus agent list / run / logs / emit

tests/
  fixtures/
    agents/
      hello-nexus/
        agent.ts          ← fixture agent for unit + integration tests
        package.json
  unit/
    agent-sdk/
    agent-event-bus/
    agent-runtime/
  integration/
    agent-runtime.test.ts ← end-to-end: load fixture → fire trigger → assert state
```

---

## Integration Points with Existing Nexus Code

| Existing module | How used |
|---|---|
| `src/main/mcp/tool-registry.ts` | `NexusToolProvider` wraps it to fulfill the `ToolProvider` interface |
| `src/main/events/` (HTTP `/wp-events`) | `wp-events-bridge.ts` subscribes and publishes to `AgentEventBus` |
| `src/main/chat/providers/` | `AIClient` in `AgentContext` reuses the existing provider abstraction |
| `graph.db` (better-sqlite3) | `AgentEventBus` and `AgentStateStore` add tables to the existing database |
| Local `workerFork` pattern | `DaemonManager` uses the same `child_process.fork()` approach |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **SDK contract churn** | Internal module first — extract to package only when forced. No external consumers until Spec 03. |
| **Daemon resource usage** | Hard limit on concurrent daemon agents (default: 5). Configurable. Heartbeat monitoring with auto-restart backoff prevents zombie accumulation. |
| **Agent sandboxing** | Tool scoping enforced at `NexusToolProvider.invoke()` — undeclared tools throw before reaching the MCP registry. Credential access is restricted to tools the agent declared. |
| **State durability** | SQLite write is synchronous — state is durable before `run()` returns. Failed runs leave state intact for inspection and retry. |
| **Event bus volume** | WordPress hook events can be high-frequency (every page load if misconfigured). The connector plugin must filter aggressively on the WP side before sending. Event schema includes `site_id` for per-site filtering at the bus. |
| **ts-node startup cost** | If cold-start latency matters, pre-compile agents to JS on registration. Measure first; optimize if needed. |

---

## Developer Surface (testability without the Builder)

Without the Builder, the runtime is a black box. These four additions make it observable on day one, without requiring any Builder tooling.

### 1. Fixture agent (`tests/fixtures/agents/hello-nexus/`)

A minimal agent checked into the repo, used for unit tests, integration tests, and manual smoke testing. Exercises all three execution modes across separate fixture files.

```typescript
// tests/fixtures/agents/hello-nexus/agent.ts
export default defineAgent({
  name: 'hello-nexus',
  version: '1.0.0',
  triggers: [cron('* * * * *')],          // every minute — easy to trigger manually
  tools: ['nexus_list_sites'],
  async run({ tools, state, log }) {
    const sites = await tools.invoke('nexus_list_sites', {});
    log.info(`hello-nexus: found ${sites.length} sites`);
    state.set('lastRunSiteCount', sites.length);
  },
});
```

No install required — tests import the fixture directly. For manual testing, symlink or copy into the agents directory.

### 2. Minimal CLI commands

Three commands added to the existing `nexus` CLI (not Builder scope — these are runtime observability):

```bash
# List all registered agents, trigger types, last run timestamp, status
nexus agent list

# Manually trigger any agent immediately (bypasses cron/event scheduling)
nexus agent run <name>

# Tail the agent's log output (last N lines, or follow)
nexus agent logs <name> [--follow] [--lines=50]
```

`nexus agent run` is the primary manual testing tool. It fires the agent's `run()` with a synthetic trigger context, exactly as the scheduler would — same tool injection, same state store, same logging.

### 3. Test event publisher

One command to inject a synthetic event into the bus, enabling manual testing of reactive and daemon agents without a live WordPress site:

```bash
# Publish a synthetic event to the event bus
nexus agent emit <event> [--site <site-name>] [--payload <json>]

# Examples:
nexus agent emit wp:post.published --site mysite --payload '{"post_id": 42}'
nexus agent emit wpe:deploy.completed
nexus agent emit local:site.started --site devsite
```

Events published this way go through the full bus pipeline — written to SQLite, dispatched to subscribers — indistinguishable from real events.

### 4. Unit and integration tests

**Unit tests** (one per runtime component):
- `AgentRegistry` — scan, load, hot-reload
- `AgentScheduler` — cron registration, fire, unregister
- `AgentRunner` — context injection, timeout, error handling, `onError` callback
- `DaemonManager` — fork, heartbeat, restart backoff, clean shutdown
- `AgentStateStore` — get/set/delete, isolation between agents
- `AgentEventBus` — publish, subscribe, pattern matching, replay

**Integration test** (end-to-end with fixture agent):
1. Load `hello-nexus` fixture into a test registry
2. Fire a synthetic cron trigger via `AgentRunner`
3. Assert: `nexus_list_sites` tool was called
4. Assert: `lastRunSiteCount` written to `AgentStateStore`
5. Assert: log lines captured

**Reactive integration test:**
1. Subscribe `hello-nexus` (event variant) to `wp:post.published`
2. Call `bus.publish({ type: 'post.published', namespace: 'wp', ... })`
3. Assert agent ran and produced expected state

---

## Out of Scope (deferred to Spec 02 / 03)

- `nexus agent create` scaffolder (Spec 02)
- `nexus agent dev` hot-reload CLI mode (Spec 02)
- `nexus agent validate` linter (Spec 02)
- `nexus agent publish` → npm registry (Spec 03)
- `nexus agent deploy` → Atlas (Spec 03)
- Visual agent status UI in Local — the IPC channel is designed for it, but the UI surface is Spec 02
- `AtlasToolProvider` implementation (WP REST + CAPI wrappers) (Spec 03)
- Hosted runtime (non-Local execution target) (future)

**Note:** `nexus agent list`, `nexus agent run`, `nexus agent logs`, and `nexus agent emit` are **in scope for Spec 01** — they are runtime observability, not Builder tooling.
