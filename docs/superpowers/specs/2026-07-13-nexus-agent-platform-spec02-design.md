# Nexus Agent Platform — Spec 02: Builder Design

**Date:** 2026-07-13
**Branch:** `feat/nexus-agent-platform`
**Status:** Design approved — ready for implementation planning
**Parent:** [vision.md](../../planning/nexus-agent-platform/vision.md)
**Depends on:** Spec 01 (SDK + Runtime) — merged to main at commit a7c1897

---

## What This Spec Covers

Five deliverables that transform the Spec 01 runtime from a skeleton into a usable development platform:

1. **AI client** — replace the `agentAiClient` placeholder with a real agentic loop
2. **TypeScript authoring** — ts-node + `@nexus-ai/agent-sdk` path resolution
3. **Builder CLI** — `create`, `validate`, `install`, `status`, `logs --follow`
4. **Hot reload** — `AgentRegistry.watch()` rewires agents on file save
5. **Run history** — SQLite persistence powering `nexus agent status`

SDK extraction (`@nexus-ai/agent-sdk` as a real npm package) and Atlas publish are Spec 03.

---

## Decisions

| Decision | Rationale |
|---|---|
| AI client calls providers directly (no ChatService) | Agents are not chat sessions; keeping execution independent avoids UI-state coupling. Tool-call format duplication is bounded (~20 lines × 3 providers). |
| TypeScript via ts-node, `transpileOnly: true` at load | Fast load; type errors surface at `nexus agent validate` time, not at runtime. |
| `@nexus-ai/agent-sdk` resolves to addon's compiled lib | No npm publish needed for Spec 02. Agents get types + `defineAgent` for free. |
| No per-agent tsconfig | Registry owns compiler settings; agent dirs stay clean. |
| Hot reload owns only file watching; main/index owns trigger rewiring | Mirrors the initial-load separation already established in Spec 01. |
| Run history retention: last 100 runs per agent | Bounded growth; sufficient for `status` display. |

---

## Section 1: AI Client

### Interface

`AIClient` in `src/main/agent-sdk/types.ts` replaces the `complete` placeholder with `run`:

```typescript
export interface AIClient {
  run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string>;
}

export class AgentAILoopError extends Error {
  constructor(public readonly turns: number) {
    super(`Agent AI loop exceeded ${turns} turns without a final response`);
    this.name = 'AgentAILoopError';
  }
}
```

### AgentAIClient

New file: `src/main/agent-runtime/AgentAIClient.ts`

```typescript
export class AgentAIClient implements AIClient {
  constructor(
    private provider: AIProvider,
    private config: ChatProviderConfig,
    private toolProvider: NexusToolProvider,
  ) {}

  async run(prompt: string, opts?: { maxTurns?: number; model?: string }): Promise<string> {
    const maxTurns = opts?.maxTurns ?? 10;
    const config = opts?.model ? { ...this.config, model: opts.model } : this.config;

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    const tools = this.toolProvider.getProviderToolDefinitions();

    let turns = 0;
    while (turns < maxTurns) {
      turns++;
      const signal = new AbortController().signal;
      const response = await collectStream(this.provider.streamChat(messages, tools, config, signal));

      if (!response.toolCalls?.length) {
        return response.content ?? '';
      }

      // Append assistant turn with tool calls
      messages.push({ role: 'assistant', content: response.content ?? '', toolCalls: response.toolCalls });

      // Invoke each tool and append results
      for (const call of response.toolCalls) {
        const result = await this.toolProvider.invoke(call.name, call.arguments);
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: call.id,
        });
      }
    }

    throw new AgentAILoopError(maxTurns);
  }
}
```

`collectStream` is a small helper that drains an `AsyncGenerator<ProviderStreamEvent>` into a `{ content, toolCalls }` object — no streaming to the renderer.

`NexusToolProvider` gains `getProviderToolDefinitions(): ProviderToolDefinition[]` — returns MCP tool schemas in the provider-agnostic format that `AIProvider.streamChat` already accepts.

### Construction

`AgentAIClient` is constructed inside `AgentRunner.run()`, after the per-run `NexusToolProvider` is built, so it gets the correct agent-scoped tool set:

```typescript
// inside AgentRunner.run(), after toolProvider is built:
const aiClient = new AgentAIClient(
  getProvider(this.resolvedProvider.provider),
  { apiKey: this.resolvedProvider.apiKey, model: agentModel },
  toolProvider,
);
```

`AgentRunner` receives a `ResolvedAIProvider` (from `getAIProvider()`) at construction time. Agent's `model` field overrides the global default per-run.

In `main/index.ts`, the placeholder line is replaced:

```typescript
// Before:
const agentAiClient = { complete: async (_prompt: string) => '' };

// After:
const resolvedAgentProvider = getAIProvider(storage, settings);
// agentAiClient no longer constructed here — AgentRunner builds AgentAIClient per-run
// AgentRunner receives resolvedAgentProvider instead
```

---

## Section 2: TypeScript Authoring

### ts-node registration

`AgentRegistry` registers ts-node once before the first agent load:

```typescript
import { register } from 'ts-node';

const SDK_PATH = path.join(__dirname, '..', 'agent-sdk', 'index.js');

register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    target: 'ES2020',
    strict: true,
    paths: { '@nexus-ai/agent-sdk': [SDK_PATH] },
  },
});
```

`SDK_PATH` points to the compiled addon output (`lib/main/agent-sdk/index.js`), always present — no npm install required.

### Agent file detection

The registry probes for `.ts` before `.js`:

```typescript
const agentFile =
  fs.existsSync(path.join(agentDir, 'agent.ts'))
    ? path.join(agentDir, 'agent.ts')
    : path.join(agentDir, 'agent.js');
```

Both formats remain supported indefinitely.

### Agent template (generated by `nexus agent create`)

```typescript
import { defineAgent, cron } from '@nexus-ai/agent-sdk';

export default defineAgent({
  name: '<name>',
  version: '1.0.0',
  description: 'Describe what this agent does',
  triggers: [cron('0 2 * * *')],   // daily at 2am
  tools: ['nexus_list_sites'],

  async run({ tools, state, ai, log }) {
    log.info('<name>: starting');

    const sites = await tools.invoke('nexus_list_sites', {});
    log.info(`Found ${Array.isArray(sites) ? sites.length : 0} site(s)`);

    // Example: use AI to reason about results
    // const summary = await ai.run('Summarize these sites: ' + JSON.stringify(sites));

    state.set('lastRunAt', Date.now());
    log.info('<name>: done');
  },
});
```

No `tsconfig.json` in the agent directory — compiler settings come from the registry's `register()` call.

### Dependency

`ts-node` added to `dependencies` in `package.json` (currently absent — it must move from devDependencies or be added fresh). Version: `^10.9.2` (stable, supports Node 22).

---

## Section 3: Builder CLI

All commands live in `src/cli/commands/agent/` alongside the existing `list.ts`, `run.ts`, `logs.ts`, `emit.ts`.

### `nexus agent create <name>`

- Resolves agents dir (`~/Library/Application Support/Local/nexus-ai/agents/`)
- Creates `<agentsDir>/<name>/agent.ts` from the template above (substituting `<name>`)
- Errors with a clear message if the directory already exists
- Prints the created path and a usage hint: `nexus agent run <name>`

### `nexus agent validate [name]`

Two-phase validation:

**Phase 1 — TypeScript.** For each target agent, spawn `tsc --noEmit --strict` with the agent file as input and the same compiler options as the registry. Captures and reformats errors as `agent.ts:12:5 — error TS2345: ...`. Exit 1 on any error.

**Phase 2 — Tool declarations.** Load the agent definition via `require()` (ts-node already registered). Cross-reference `agent.tools` against the live MCP tool registry (requires Local running; prints a warning and skips phase 2 if unavailable). Reports unknown tool names.

If `name` is omitted, validates all agents in the agents directory.

### `nexus agent install <package>`

```
nexus agent install @nexus-agents/seo-auditor
```

- Resolves or creates `<agentsDir>/node_modules/` 
- Runs `npm install <package> --prefix <agentsDir>`
- Reads installed package's `package.json` `main` field to find the agent entry point
- Loads and registers the agent with the running registry (via GraphQL `agentReload` mutation, or direct IPC if available)
- Prints confirmation: `Installed: seo-auditor v1.2.0`

### `nexus agent status`

Queries `stateStore.getLastRuns()` for all registered agents and prints a fixed-width table:

```
NAME                  TRIGGERS         LAST RUN              STATUS    DURATION
nightly-updater       cron(0 2 * * *)  2026-07-13 02:00:14   success   4.3s
hello-nexus           cron(0 * * * *)  2026-07-13 09:00:01   success   1.2s
seo-on-publish        event(wp:post.*) never                 —         —
```

Fetches agent list via GraphQL `agentList` (same as `nexus agent list`). Duration shown in seconds with one decimal.

### `nexus agent logs <name> [--follow]`

Log file path: `~/Library/Application Support/Local/nexus-ai/agent-logs/<name>.log`

- Without `--follow`: prints last 100 lines, exits.
- With `--follow`: prints existing tail, then uses `fs.watch` on the log file to stream new lines as they are appended. Ctrl-C exits cleanly (removes watcher, no hanging handle).

---

## Section 4: Hot Reload

### `AgentRegistry.watch()`

```typescript
watch(
  onUnload: (name: string) => void,
  onReload: (def: AgentDefinition) => void,
): void
```

Implementation:
- `fs.watch(agentsDir, { recursive: true }, handler)`
- `handler` extracts the agent name from the changed path (first path segment under agentsDir)
- 300ms debounce per agent name — rapid editor saves collapse into one reload
- On debounce fire:
  1. Call `onUnload(name)` — caller removes from scheduler and event bus
  2. Call `this.loadOne(agentDir)` — re-require (ts-node registered, picks up new source)
  3. On success: call `onReload(def)` — caller re-registers triggers
  4. On error: log and leave agent in unloaded state; next file save retries

### Daemon agents on reload

Before `onUnload`, `DaemonManager.stop(name)` is called if the agent has a stream trigger. After `onReload`, `DaemonManager.start(def)` re-forks. The brief stop window is acceptable for a dev-time feature.

### New agents

When a new directory appears under the agents dir (e.g., after `nexus agent create`), `fs.watch` fires with `eventType = 'rename'`. The handler checks if the dir is new (not in registry) and calls `loadOne` directly, then `onReload`.

### Wiring in `main/index.ts`

```typescript
agentRegistry.watch(
  (name) => {
    agentScheduler.unregister(name);
    agentEventBus.unsubscribeAll(name);
    daemonManager.stop(name);
  },
  (def) => {
    agentScheduler.register(def);
    // reactive/webhook triggers re-wired same as initial load
    for (const trigger of def.triggers) {
      if (trigger.type === 'event') { /* ... */ }
      if (trigger.type === 'webhook') { /* ... */ }
      if (trigger.type === 'stream') { daemonManager.start(def); }
    }
  },
);
```

---

## Section 5: Run History

### Schema

Added to `AgentStateStore` (which already owns the agent SQLite db):

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name  TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status      TEXT    NOT NULL,
  error       TEXT
);
```

### Methods

```typescript
// AgentStateStore
recordRun(result: AgentResult): void;
getLastRun(agentName: string): AgentResult | undefined;
```

`recordRun` inserts the result, then prunes:

```sql
DELETE FROM agent_runs
WHERE agent_name = ?
  AND id NOT IN (
    SELECT id FROM agent_runs WHERE agent_name = ? ORDER BY id DESC LIMIT 100
  );
```

### Write path

`AgentRunner.run()` calls `this.stateStore.recordRun(result)` before returning. One synchronous SQLite write per run — negligible overhead.

---

## Files Created or Modified

| Path | Action |
|---|---|
| `src/main/agent-sdk/types.ts` | Modify — `AIClient.complete` → `AIClient.run`; add `AgentAILoopError` |
| `src/main/agent-runtime/AgentAIClient.ts` | Create — full agentic loop implementation |
| `src/main/agent-runtime/AgentRunner.ts` | Modify — construct `AgentAIClient` per run; accept `ResolvedAIProvider` |
| `src/main/agent-runtime/NexusToolProvider.ts` | Modify — add `getProviderToolDefinitions()` |
| `src/main/agent-runtime/AgentRegistry.ts` | Modify — ts-node registration; `.ts` detection; `watch()` method |
| `src/main/agent-runtime/AgentStateStore.ts` | Modify — `agent_runs` table; `recordRun`; `getLastRun` |
| `src/main/agent-runtime/AgentScheduler.ts` | Modify — add `unregister(name)` |
| `src/main/agent-event-bus/AgentEventBus.ts` | Modify — add `unsubscribeAll(agentName)` |
| `src/main/agent-runtime/DaemonManager.ts` | Modify — ensure `stop(name)` is exported and safe to call on unregistered agents |
| `src/main/index.ts` | Modify — wire `ResolvedAIProvider` into `AgentRunner`; call `agentRegistry.watch()` |
| `src/cli/commands/agent/create.ts` | Create |
| `src/cli/commands/agent/validate.ts` | Create |
| `src/cli/commands/agent/install.ts` | Create |
| `src/cli/commands/agent/status.ts` | Create |
| `src/cli/commands/agent/logs.ts` | Modify — add `--follow` mode |
| `src/cli/commands/agent/index.ts` | Modify — register new subcommands |
| `src/main/graphql/resolvers.ts` | Modify — add `agentReload` mutation (used by `nexus agent install`) |
| `package.json` | Modify — add `ts-node` to `dependencies` |
| `tests/unit/agent-runtime/AgentAIClient.test.ts` | Create |
| `tests/unit/agent-runtime/AgentRegistry-watch.test.ts` | Create |
| `tests/unit/agent-runtime/AgentStateStore-runs.test.ts` | Create |

---

## Testing

- **`AgentAIClient`** — unit tests with a mock `AIProvider`: verify tool calls flow through the loop, verify `AgentAILoopError` throws at maxTurns, verify final text returned on first non-tool response.
- **`AgentRegistry.watch()`** — unit tests with a temp agents directory: verify reload fires after file change, verify debounce collapses rapid saves, verify new agent directory triggers load.
- **`AgentStateStore` run history** — unit tests: insert runs, verify last-run query, verify 100-run retention limit.
- **CLI commands** — unit tests for `create` (file written, errors if exists), `validate` (type error detected, unknown tool detected), `status` (table format).
- **Integration** — existing e2e test (`nexus agent list/run/logs`) extended to cover `status` and `logs --follow` output.
