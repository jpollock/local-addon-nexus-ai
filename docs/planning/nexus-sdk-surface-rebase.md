# Nexus SDK Contributed Tools — Rebase onto Main (Approach A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `nexus-sdk-surface` worktree's contributed-tools feature onto main by extracting a reusable `buildAgentContext()` helper from `AgentRunner`, wiring `ContributedToolRegistry` into the existing `AgentRegistry` and `McpServer`, and discarding the worktree's stub implementations in favour of main's production versions.

**Architecture:** Approach A — extract context construction out of `AgentRunner.run()` into a standalone `buildAgentContext()` function that both `AgentRunner` and the new `AgentDispatcher` call. This gives contributed tool handlers a full, real `AgentContext` (real AI client, real NexusToolProvider, real SQLite state store, real AgentLogger with all 8 methods) without duplicating the wiring logic. The five stub classes from the worktree (`AgentAIClientImpl`, `AgentToolProvider`, `AgentStateStore`, `AgentLogger`, `AgentContextBuilder`) are deleted; the four net-new classes (`ContributedToolRegistry`, `AgentDispatcher`, plus CLI and GraphQL additions) are ported over.

**Tech Stack:** TypeScript, better-sqlite3 (AgentStateStore), commander (CLI), graphql-tag / inline SDL schema, existing `McpServer`/`AgentRegistry`/`AgentRunner` on main.

## Global Constraints

- All code lives in `src/main/` or `src/cli/`; no changes to `agents/` or renderer.
- `buildAgentContext()` is NOT exported publicly — it is an internal helper used by `AgentRunner` and `AgentDispatcher` only.
- `AgentDispatcher.dispatchFunction()` calls `buildAgentContext()` exactly once per invocation; it does not hold a long-lived context.
- `AgentDispatcher` module cache (`Map<string, AgentDefinition>`) is invalidated via `clearCache(agentName)` whenever `AgentRegistry` reloads an agent on disk change.
- `VALID_AGENT_NAME` regex must ban consecutive underscores (`__`) to protect the `agent__<name>__<tool>` MCP delimiter: use `/^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/`.
- GraphQL `nexusInvokeAgentTool` resolver enforces the same tier-3 confirmation gate as the MCP path.
- `McpServerOptions` receives optional `contributedRegistry` and `dispatcher` fields — both nullable; contributed tool routing only fires when both are present.
- Tests run with: `npm test -- --testPathPattern="contributed|dispatcher|context" 2>&1 | tail -15`

---

### Task 1: Extract `buildAgentContext()` from `AgentRunner`

Pull the context-construction block (lines 57–149 of `AgentRunner.ts`) into a standalone unexported helper. `AgentRunner.run()` calls it; behaviour is identical. This is a pure refactor with no observable change.

**Files:**
- Create: `src/main/agent-runtime/buildAgentContext.ts`
- Modify: `src/main/agent-runtime/AgentRunner.ts:57–149`
- Test: `tests/unit/agent-runtime/buildAgentContext.test.ts`

**Interfaces:**
- Produces:
```typescript
// src/main/agent-runtime/buildAgentContext.ts
export interface AgentContextDeps {
  agent: AgentDefinition;
  event?: NexusEvent;
  toolRegistry: ToolRegistry;
  services: NexusServices;
  stateStore: AgentStateStore;
  resolvedProvider: ResolvedAIProvider;
  logDir: string;  // path to write agent.log
}

export function buildAgentContext(deps: AgentContextDeps): {
  ctx: AgentContext;
  agentLog: AgentLogger;
  accFindings: Finding[];
  accActions: AgentAction[];
  accSites: Record<string, { status: string; findings: Finding[] }>;
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent-runtime/buildAgentContext.test.ts`:

```typescript
import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';

const makeAgent = () => ({
  name: 'test-agent',
  version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  logDir: path.join(os.tmpdir(), 'nexus-test-logs'),
});

describe('buildAgentContext', () => {
  it('returns a ctx with log, state, tools, ai, autonomy', () => {
    const { ctx, agentLog, accFindings, accSites } = buildAgentContext({
      agent: makeAgent(),
      ...makeStubs(),
    });
    expect(ctx.log).toBeDefined();
    expect(ctx.state).toBeDefined();
    expect(ctx.tools).toBeDefined();
    expect(ctx.ai).toBeDefined();
    expect(ctx.autonomy).toBe('ask'); // default when cache is empty
    expect(agentLog).toBe(ctx.log);
    expect(Array.isArray(accFindings)).toBe(true);
    expect(accSites).toEqual({});
  });

  it('log.finding pushes to accFindings', () => {
    const { ctx, accFindings } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.finding({ id: 'T-01', severity: 'high', title: 'test', site: 's' });
    expect(accFindings).toHaveLength(1);
    expect(accFindings[0].id).toBe('T-01');
  });

  it('log.siteStatus updates accSites', () => {
    const { ctx, accSites } = buildAgentContext({ agent: makeAgent(), ...makeStubs() });
    ctx.log.siteStatus('my-site', 'clean');
    expect(accSites['my-site'].status).toBe('clean');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --testPathPattern="buildAgentContext" 2>&1 | tail -5
```
Expected: `Cannot find module '../../../src/main/agent-runtime/buildAgentContext'`

- [ ] **Step 3: Create `buildAgentContext.ts`**

Move lines 57–149 from `AgentRunner.run()` into the new file. Keep all imports. Return `{ ctx, agentLog, accFindings, accActions, accSites }`.

```typescript
// src/main/agent-runtime/buildAgentContext.ts
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logging/Logger';
import { getAgentAutonomy } from '../ipc-handlers';
import { NexusToolProvider } from './NexusToolProvider';
import { AgentAIClient } from './AgentAIClient';
import { getProvider } from '../chat/providers/index';
import type { AgentDefinition, NexusEvent, AgentContext, AgentLogger, Finding, AgentAction } from '../agent-sdk/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { NexusServices } from '../mcp/types';
import type { AgentStateStore } from './AgentStateStore';
import type { ResolvedAIProvider } from '../ai/getAIProvider';

export interface AgentContextDeps {
  agent: AgentDefinition;
  event?: NexusEvent;
  toolRegistry: ToolRegistry;
  services: NexusServices;
  stateStore: AgentStateStore;
  resolvedProvider: ResolvedAIProvider;
  logDir: string;
}

export function buildAgentContext(deps: AgentContextDeps): {
  ctx: AgentContext;
  agentLog: AgentLogger;
  accFindings: Finding[];
  accActions: AgentAction[];
  accSites: Record<string, { status: string; findings: Finding[] }>;
} {
  const { agent, event, toolRegistry, services, stateStore, resolvedProvider, logDir } = deps;
  const agentName = agent.name;

  const toolProvider = new NexusToolProvider(
    toolRegistry,
    services,
    agent.tools?.length ? agent.tools : undefined,
  );

  const effectiveProvider = resolvedProvider.useLocalGateway ? 'local-gateway' : resolvedProvider.provider;
  const aiProvider = getProvider(effectiveProvider);
  const agentModel = agent.model ?? resolvedProvider.model;
  const providerConfig = effectiveProvider === 'local-gateway'
    ? { apiKey: services.gatewayAuthToken ?? '', model: agentModel, baseUrl: services.gatewayUrl }
    : { apiKey: resolvedProvider.apiKey, model: agentModel };
  const directProvider = getProvider(resolvedProvider.provider);
  const directConfig = { apiKey: resolvedProvider.apiKey, model: agentModel };
  const aiClient = aiProvider
    ? new AgentAIClient(aiProvider, providerConfig, toolProvider, directProvider ?? undefined, directConfig)
    : {
        run: async (_prompt: string) => { createLogger(`agent:${agentName}`).warn(`AI provider "${resolvedProvider.provider}" unavailable`); return ''; },
        generateObject: async <T>(_opts: unknown): Promise<T> => { createLogger(`agent:${agentName}`).warn(`AI provider "${resolvedProvider.provider}" unavailable`); return {} as T; },
      };

  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  const logFile = path.join(logDir, 'agent.log');
  const appLog = createLogger(`agent:${agentName}`);

  function appendLog(level: string, msg: string): void {
    try { fs.appendFileSync(logFile, `[${level}] ${new Date().toISOString()} ${msg}\n`); } catch { /* non-fatal */ }
  }

  const accFindings: Finding[] = [];
  const accActions: AgentAction[] = [];
  const accSites: Record<string, { status: string; findings: Finding[] }> = {};

  const agentLog: AgentLogger = {
    info:  (msg) => { appLog.info(msg);  appendLog('INFO',  msg); },
    warn:  (msg) => { appLog.warn(msg);  appendLog('WARN',  msg); },
    error: (msg) => { appLog.error(msg); appendLog('ERROR', msg); },
    debug: (msg) => { appLog.debug(msg); appendLog('DEBUG', msg); },
    finding: (f: Finding) => {
      accFindings.push(f);
      const sev = f.severity === 'critical' || f.severity === 'high' ? 'WARN' : 'INFO';
      appendLog(sev, `[${f.severity.toUpperCase()}] ${f.id}: ${f.title}${f.site ? ` (${f.site})` : ''}`);
    },
    action: (a: AgentAction) => {
      accActions.push(a);
      appendLog(a.result === 'failed' ? 'WARN' : 'INFO',
        `[action] ${a.label}${a.result ? ` — ${a.result}` : ''}${a.durationMs ? ` (${a.durationMs}ms)` : ''}`);
    },
    phase: (name, description?) => { appendLog('INFO', `[phase] ${name}${description ? ': ' + description : ''}`); },
    siteStatus: (site, status) => {
      if (!accSites[site]) accSites[site] = { status, findings: [] };
      else accSites[site].status = status;
      const icon = status === 'clean' ? '✓' : status === 'escalated' ? '↑' : status === 'error' ? '✗' : '→';
      appendLog('INFO', `[site] ${site} — ${icon} ${status}`);
    },
  };

  const ctx: AgentContext = {
    trigger: agent.triggers[0],
    event,
    tools: toolProvider,
    state: stateStore.buildHandle(agentName),
    ai: aiClient,
    log: agentLog,
    autonomy: getAgentAutonomy(agentName),
  };

  return { ctx, agentLog, accFindings, accActions, accSites };
}
```

- [ ] **Step 4: Refactor `AgentRunner.run()` to call `buildAgentContext()`**

Replace lines 57–149 in `AgentRunner.ts` with:
```typescript
const { ctx, agentLog, accFindings, accActions, accSites } = buildAgentContext({
  agent,
  event,
  toolRegistry: this.toolRegistry,
  services: this.services,
  stateStore: this.stateStore,
  resolvedProvider: this.resolvedProvider,
  logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', agentName, 'logs'),
});
```

Add `import { buildAgentContext } from './buildAgentContext';` at the top.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="buildAgentContext|AgentRunner" 2>&1 | tail -10
```
Expected: all existing AgentRunner tests pass, 3 new tests pass.

- [ ] **Step 6: Build check + commit**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
git add src/main/agent-runtime/buildAgentContext.ts src/main/agent-runtime/AgentRunner.ts tests/unit/agent-runtime/buildAgentContext.test.ts
git commit -m "refactor(agent-runtime): extract buildAgentContext() from AgentRunner — no behaviour change"
```

---

### Task 2: Port `ContributedToolRegistry` and `AgentDispatcher`

Copy the two net-new classes from the worktree, fix the `__` delimiter bug in `VALID_AGENT_NAME`, wire `AgentDispatcher` to use `buildAgentContext()` instead of the stub `AgentContextBuilder`, and add the `clearCache()` method for hot-reload invalidation.

**Files:**
- Create: `src/main/agent-runtime/ContributedToolRegistry.ts` (copy from worktree, no changes)
- Create: `src/main/agent-runtime/AgentDispatcher.ts` (ported from worktree — replaces `buildAgentContext` call + adds `clearCache`)
- Test: `tests/unit/agent-runtime/contributedToolRegistry.test.ts`
- Test: `tests/unit/agent-runtime/agentDispatcher.test.ts`

**Interfaces:**
- Produces: `ContributedToolRegistry` (unchanged API from worktree), `AgentDispatcher` with new `clearCache(agentName: string): void` method.

- [ ] **Step 1: Write the failing tests**

`tests/unit/agent-runtime/contributedToolRegistry.test.ts`:
```typescript
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

describe('ContributedToolRegistry', () => {
  let reg: ContributedToolRegistry;
  beforeEach(() => { reg = new ContributedToolRegistry(); });

  it('register and get a tool', () => {
    reg.register('my-agent', { name: 'check', description: 'Check', inputSchema: {} });
    const t = reg.get('my-agent', 'check');
    expect(t?.agentName).toBe('my-agent');
    expect(t?.executionMode).toBe('function');
    expect(t?.permissionTier).toBe(1);
  });

  it('getByMcpName parses agent__name__tool', () => {
    reg.register('my-agent', { name: 'check', description: 'c', inputSchema: {} });
    const t = reg.getByMcpName('agent__my-agent__check');
    expect(t?.toolName).toBe('check');
  });

  it('getByMcpName rejects double-underscore agent name', () => {
    // Even if someone manually registers with __, getByMcpName should not
    // accidentally split 'agent__my__agent__check' into wrong parts
    const t = reg.getByMcpName('agent__my__agent__check');
    expect(t).toBeUndefined();
  });

  it('unregisterAgent removes all tools for that agent', () => {
    reg.register('a', { name: 't1', description: '', inputSchema: {} });
    reg.register('a', { name: 't2', description: '', inputSchema: {} });
    reg.register('b', { name: 't3', description: '', inputSchema: {} });
    reg.unregisterAgent('a');
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].agentName).toBe('b');
  });

  it('toMcpDefinitions prefixes with agent__', () => {
    reg.register('acme', { name: 'scan', description: 'Scan', inputSchema: { type: 'object' } });
    const defs = reg.toMcpDefinitions();
    expect(defs[0].name).toBe('agent__acme__scan');
  });
});
```

`tests/unit/agent-runtime/agentDispatcher.test.ts`:
```typescript
import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

const makeReg = () => {
  const reg = new ContributedToolRegistry();
  reg.register('my-agent', { name: 'greet', description: 'Hello', inputSchema: {} });
  return reg;
};
const makeStubs = () => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  agentsDir: '/nonexistent',
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
});

describe('AgentDispatcher', () => {
  it('dispatch returns error when tool not found', async () => {
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    const r = await d.dispatch('my-agent', 'missing', {});
    expect(r.isError).toBe(true);
  });

  it('clearCache removes module from cache', () => {
    const d = new AgentDispatcher(makeReg(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    (d as any).moduleCache.set('my-agent', {});
    d.clearCache('my-agent');
    expect((d as any).moduleCache.has('my-agent')).toBe(false);
  });

  it('loadModule throws on path traversal agent name', () => {
    const d = new AgentDispatcher(new ContributedToolRegistry(), makeStubs().toolRegistry, makeStubs().services, '/nonexistent', makeStubs().resolvedProvider, makeStubs().stateStore);
    expect(() => (d as any).loadModule('../../../etc')).toThrow('Invalid agent name');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- --testPathPattern="contributedToolRegistry|agentDispatcher" 2>&1 | tail -5
```
Expected: module not found errors.

- [ ] **Step 3: Create `ContributedToolRegistry.ts`**

Copy from worktree verbatim. No changes needed.

- [ ] **Step 4: Create `AgentDispatcher.ts` (ported)**

Port from worktree. Key changes from worktree version:
1. Constructor receives `resolvedProvider: ResolvedAIProvider` and `stateStore: AgentStateStore` as additional args (to pass to `buildAgentContext()`).
2. `dispatchFunction()` calls `buildAgentContext({ agent: def, toolRegistry, services, stateStore, resolvedProvider, logDir: ... })` instead of the stub `buildAgentContext()`.
3. Add `clearCache(agentName: string): void { this.moduleCache.delete(agentName); }`.
4. Fix `VALID_AGENT_NAME` regex to ban `__`: `/^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/` — copy this from the worktree's `AgentRegistry.ts` VALID_AGENT_NAME and tighten it here too.

```typescript
// src/main/agent-runtime/AgentDispatcher.ts
import * as path from 'path';
import * as os from 'os';
import type { McpToolResult } from '../mcp/types';
import type { NexusServices } from '../mcp/types';
import type { ToolRegistry } from '../mcp/tool-registry';
import type { ContributedToolRegistry, RegisteredTool } from './ContributedToolRegistry';
import type { AgentDefinition } from '../agent-sdk/types';
import type { ResolvedAIProvider } from '../ai/getAIProvider';
import type { AgentStateStore } from './AgentStateStore';
import { buildAgentContext } from './buildAgentContext';

const VALID_AGENT_NAME = /^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/;
const DEFAULT_AGENTS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');
const HANDLER_TIMEOUT_MS = 30_000;

export class AgentDispatcher {
  private moduleCache = new Map<string, AgentDefinition>();

  constructor(
    private readonly contributedRegistry: ContributedToolRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly services: NexusServices,
    private readonly agentsDir: string = DEFAULT_AGENTS_DIR,
    private readonly resolvedProvider: ResolvedAIProvider,
    private readonly stateStore: AgentStateStore,
  ) {}

  clearCache(agentName: string): void {
    this.moduleCache.delete(agentName);
  }

  async dispatch(agentName: string, toolName: string, args: unknown): Promise<McpToolResult> {
    const registered = this.contributedRegistry.get(agentName, toolName);
    if (!registered) {
      return { content: [{ type: 'text', text: `Tool ${agentName}/${toolName} not found` }], isError: true };
    }
    const start = Date.now();
    let outcome: 'ok' | 'error' = 'ok';
    const result = registered.executionMode === 'run'
      ? await this.dispatchRun(registered, args)
      : await this.dispatchFunction(registered, args);
    if (result.isError) outcome = 'error';
    this.services.auditLogger?.log({
      timestamp: new Date().toISOString(),
      toolName: `${agentName}/${toolName}`,
      tier: registered.permissionTier as 1 | 2 | 3,
      params: (args && typeof args === 'object') ? (args as Record<string, unknown>) : {},
      confirmed: null,
      result: outcome === 'ok' ? 'success' : 'error',
      duration_ms: Date.now() - start,
    });
    return result;
  }

  private loadModule(agentName: string): AgentDefinition {
    if (this.moduleCache.has(agentName)) return this.moduleCache.get(agentName)!;
    if (!VALID_AGENT_NAME.test(agentName)) throw new Error(`Invalid agent name: '${agentName}'`);
    const agentPath = path.join(this.agentsDir, agentName, 'agent.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(agentPath) as { default?: AgentDefinition } | AgentDefinition;
    const def = (mod as { default?: AgentDefinition }).default ?? (mod as AgentDefinition);
    this.moduleCache.set(agentName, def);
    return def;
  }

  private async dispatchFunction(registered: RegisteredTool, args: unknown): Promise<McpToolResult> {
    try {
      const def = this.loadModule(registered.agentName);
      const handler = def.contributes?.tools?.[registered.toolName]?.handler;
      if (!handler) {
        return { content: [{ type: 'text', text: `Handler for ${registered.toolName} not found` }], isError: true };
      }
      const { ctx } = buildAgentContext({
        agent: def,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', registered.agentName, 'logs'),
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('Agent tool handler timed out')), HANDLER_TIMEOUT_MS);
      });
      const result = await Promise.race([
        (async () => {
          const r = await handler(args, ctx);
          clearTimeout(timeoutHandle);
          return r;
        })(),
        timeoutPromise,
      ]);
      return { content: result.content, isError: result.isError };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }], isError: true };
    }
  }

  private async dispatchRun(registered: RegisteredTool, args: unknown): Promise<McpToolResult> {
    // run mode: full agent lifecycle — load module and call agent.run()
    // For now, emits a text result; future: stream via AgentRunner
    try {
      const def = this.loadModule(registered.agentName);
      const { ctx } = buildAgentContext({
        agent: def,
        toolRegistry: this.toolRegistry,
        services: this.services,
        stateStore: this.stateStore,
        resolvedProvider: this.resolvedProvider,
        logDir: path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents', registered.agentName, 'logs'),
      });
      await def.run(ctx);
      return { content: [{ type: 'text', text: 'Run complete' }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Run error: ${err?.message ?? String(err)}` }], isError: true };
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="contributedToolRegistry|agentDispatcher" 2>&1 | tail -10
```
Expected: 5 ContributedToolRegistry tests pass, 3 AgentDispatcher tests pass.

- [ ] **Step 6: Build + commit**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
git add src/main/agent-runtime/ContributedToolRegistry.ts src/main/agent-runtime/AgentDispatcher.ts tests/unit/agent-runtime/contributedToolRegistry.test.ts tests/unit/agent-runtime/agentDispatcher.test.ts
git commit -m "feat(sdk): ContributedToolRegistry + AgentDispatcher using real buildAgentContext()"
```

---

### Task 3: Extend `AgentRegistry` to populate `ContributedToolRegistry`

Add `contributes.tools` scanning to main's existing `AgentRegistry`. When an agent's `nexus.agent.yaml` is first loaded or reloaded on change, register its contributed tools and clear `AgentDispatcher`'s module cache so stale code isn't reused.

**Files:**
- Modify: `src/main/agent-runtime/AgentRegistry.ts` — add optional `ContributedToolRegistry` + `AgentDispatcher` deps + contributes scanning + VALID_AGENT_NAME tightening
- Test: Extend `tests/unit/agent-runtime/agent-registry.test.ts`

**Interfaces:**
- Consumes: `ContributedToolRegistry` (Task 2), `AgentDispatcher.clearCache()` (Task 2)

- [ ] **Step 1: Write the failing tests**

Add to existing `tests/unit/agent-runtime/agent-registry.test.ts`:

```typescript
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';

describe('AgentRegistry — contributed tools', () => {
  it('registers contributes.tools from manifest', () => {
    // Write a temp manifest with contributes.tools
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'my-agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `
name: my-agent
version: 1.0.0
contributes:
  tools:
    - name: ping
      description: Ping
      inputSchema:
        type: object
`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    const tool = reg.get('my-agent', 'ping');
    expect(tool?.toolName).toBe('ping');
    fs.rmSync(dir, { recursive: true });
  });

  it('rejects agent name with double underscore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-reg-'));
    const agentDir = path.join(dir, 'my__agent');
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), `name: my__agent\nversion: 1.0.0\n`);
    const reg = new ContributedToolRegistry();
    const registry = new AgentRegistry(dir, reg);
    registry.scan();
    expect(reg.list()).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npm test -- --testPathPattern="agent-registry" 2>&1 | grep "contributed tools" -A5
```
Expected: tests fail (AgentRegistry doesn't accept ContributedToolRegistry yet).

- [ ] **Step 3: Modify `AgentRegistry`**

Add optional constructor args and contributes scanning:

```typescript
// In AgentRegistry constructor — add optional second + third args:
constructor(
  agentsDir: string,
  private readonly contributedRegistry?: ContributedToolRegistry,
  private readonly dispatcher?: { clearCache(name: string): void },
) { this.agentsDir = agentsDir; }

// In loadAgent(), after the existing manifest load block:
// (after `this.agents.set(def.name, def)`)
if (this.contributedRegistry && manifest.contributes?.tools) {
  this.contributedRegistry.unregisterAgent(manifest.name);
  const tier = manifest.permissions?.tier ?? 1;
  for (const tool of manifest.contributes.tools) {
    this.contributedRegistry.register(manifest.name, tool, tier);
  }
  this.dispatcher?.clearCache(manifest.name);
}
```

Also tighten `VALID_AGENT_NAME`: replace the existing regex with `/^[a-z0-9](?:[a-z0-9]|_(?!_)|-)*[a-z0-9]$|^[a-z0-9]$/`.

Add the `AgentManifest` type extension locally (not exported):
```typescript
type AgentManifestWithContributes = AgentManifest & {
  contributes?: {
    tools?: Array<{ name: string; description: string; executionMode?: string; inputSchema: Record<string, unknown> }>;
  };
  permissions?: { tier?: number };
};
```

- [ ] **Step 4: Run all registry tests**

```bash
npm test -- --testPathPattern="agent-registry" 2>&1 | tail -10
```
Expected: all tests pass including the 2 new contributed-tools tests.

- [ ] **Step 5: Build + commit**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
git add src/main/agent-runtime/AgentRegistry.ts tests/unit/agent-runtime/agent-registry.test.ts
git commit -m "feat(sdk): AgentRegistry scans contributes.tools into ContributedToolRegistry on load/reload"
```

---

### Task 4: Wire into McpServer and startup

Add optional `contributedRegistry` and `dispatcher` to `McpServerOptions`. Wire `tools/list` to append contributed tool definitions and `tools/call` to route `agent__*` calls through the dispatcher with the tier-3 confirmation gate. Initialize both in `src/main/index.ts` and wire into `AgentRegistry`.

**Files:**
- Modify: `src/main/mcp/McpServer.ts` — add optional options + routing
- Modify: `src/main/index.ts` — instantiate `ContributedToolRegistry`, `AgentDispatcher`, pass to `AgentRegistry` and `McpServer`
- Test: No new test file needed (McpServer integration is covered by existing server tests + the two unit tests from Task 2)

**Interfaces:**
- Consumes: All prior tasks

- [ ] **Step 1: Extend `McpServerOptions`**

In `src/main/mcp/McpServer.ts`, add to the `McpServerOptions` interface:
```typescript
contributedRegistry?: import('../agent-runtime/ContributedToolRegistry').ContributedToolRegistry;
dispatcher?: import('../agent-runtime/AgentDispatcher').AgentDispatcher;
```

Store in constructor:
```typescript
private contributedRegistry?: ContributedToolRegistry;
private dispatcher?: AgentDispatcher;

constructor(options: McpServerOptions) {
  // ... existing ...
  this.contributedRegistry = options.contributedRegistry;
  this.dispatcher = options.dispatcher;
}
```

- [ ] **Step 2: Add `tools/list` contributed tool appending**

Find the `case 'tools/list':` block. Replace:
```typescript
return this.jsonRpcResult(id, { tools: this.registry.list(this.services) });
```
With:
```typescript
const builtinTools = this.registry.list(this.services);
const contributedTools = this.contributedRegistry?.toMcpDefinitions() ?? [];
return this.jsonRpcResult(id, { tools: [...builtinTools, ...contributedTools] });
```

- [ ] **Step 3: Add `tools/call` contributed tool routing**

In `case 'tools/call':`, BEFORE the existing `callWithSafety` call, add the agent-tool routing block (copied from worktree `McpServer.ts:303–360` verbatim). This handles the tier-3 gate and dispatcher call.

The check: `if (toolName.startsWith('agent__') && this.contributedRegistry && this.dispatcher) { ... }` — same logic as worktree, no changes needed.

- [ ] **Step 4: Wire in `src/main/index.ts`**

Add after `agentRegistry` is created (find `const agentRegistry = new AgentRegistry`):

```typescript
const contributedRegistry = new ContributedToolRegistry();
const dispatcher = new AgentDispatcher(
  contributedRegistry,
  toolRegistry,
  nexusServices,
  agentsDir,
  resolvedProvider,
  stateStore,
);
// Re-create agentRegistry with contributed registry + dispatcher for cache invalidation
const agentRegistry = new AgentRegistry(agentsDir, contributedRegistry, dispatcher);
```

And pass to `McpServer` constructor:
```typescript
new McpServer({
  // ... existing options ...
  contributedRegistry,
  dispatcher,
});
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
```
Expected: `Done.`

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp/McpServer.ts src/main/index.ts
git commit -m "feat(sdk): wire ContributedToolRegistry + AgentDispatcher into McpServer and startup"
```

---

### Task 5: GraphQL types/resolvers + CLI commands + security fixes

Port the GraphQL schema additions and resolvers, the `nexus agent` CLI commands, and fix the two security issues flagged in review: tier-3 bypass in the GraphQL resolver and the `__` delimiter bug (already fixed in Task 2/3 VALID_AGENT_NAME; confirm the GraphQL resolver enforces the gate).

**Files:**
- Modify: `src/main/graphql/schema.ts` — add `NexusAgentToolGroup`, `NexusAgentToolEntry`, `nexusListAgentTools`, `nexusInvokeAgentTool`
- Modify: `src/main/graphql/resolvers.ts` — add resolvers; enforce tier-3 gate in `nexusInvokeAgentTool`
- Create: `src/cli/commands/agent.ts` — port from worktree verbatim
- Modify: `src/cli/index.ts` — register `nexus agent` command
- Modify: `package.json` — add `zod-to-json-schema` dependency (already added in worktree commit `ee57929`)

- [ ] **Step 1: Add GraphQL schema types**

In `src/main/graphql/schema.ts`, add before the closing `"""` of the SDL:

```graphql
type NexusAgentToolGroup {
  agentName: String!
  tools: [NexusAgentToolEntry!]!
}

type NexusAgentToolEntry {
  name: String!
  description: String!
  executionMode: String!
  permissionTier: Int!
  inputSchema: String!
}
```

And to the `Query` type:
```graphql
nexusListAgentTools: [NexusAgentToolGroup!]!
```

And to the `Mutation` type:
```graphql
nexusInvokeAgentTool(agentName: String!, toolName: String!, args: String): NexusTwinReportResult!
```

(`NexusTwinReportResult` already exists in main's schema.)

- [ ] **Step 2: Add resolvers (with tier-3 fix)**

In `src/main/graphql/resolvers.ts`, add:

```typescript
// Query
nexusListAgentTools: (_: unknown, __: unknown, ctx: NexusGraphQLContext) => {
  const reg = ctx.services.contributedRegistry;
  if (!reg) return [];
  const byAgent = reg.toolsByAgent();
  return Array.from(byAgent.entries()).map(([agentName, tools]) => ({
    agentName,
    tools: tools.map(t => ({
      name: t.toolName,
      description: t.description,
      executionMode: t.executionMode,
      permissionTier: t.permissionTier,
      inputSchema: JSON.stringify(t.inputSchema),
    })),
  }));
},

// Mutation — includes tier-3 gate (fix from review finding #3)
nexusInvokeAgentTool: async (
  _: unknown,
  { agentName, toolName, args }: { agentName: string; toolName: string; args?: string },
  ctx: NexusGraphQLContext,
) => {
  const dispatcher = ctx.services.dispatcher;
  const reg = ctx.services.contributedRegistry;
  if (!dispatcher || !reg) return { success: false, error: 'Dispatcher not available' };
  const registered = reg.get(agentName, toolName);
  if (!registered) return { success: false, error: `Tool ${agentName}/${toolName} not found` };

  // Security: enforce tier-3 gate (GraphQL path previously bypassed this)
  if (registered.permissionTier >= 3) {
    return { success: false, error: 'Tier-3 tools cannot be invoked via GraphQL — use the MCP interface with confirmation token flow.' };
  }

  const parsedArgs = args ? JSON.parse(args) : {};
  const result = await dispatcher.dispatch(agentName, toolName, parsedArgs);
  return { success: !result.isError, error: result.isError ? result.content[0]?.text : undefined };
},
```

Add `contributedRegistry` and `dispatcher` to `NexusServices` type (already done in Task 4 via index.ts; just ensure `ctx.services` has access).

- [ ] **Step 3: Port CLI commands**

Copy `src/cli/commands/agent.ts` from worktree verbatim. Register in `src/cli/index.ts`:
```typescript
import { agentCommand } from './commands/agent';
program.addCommand(agentCommand());
```

Add `zod-to-json-schema` to `package.json` dependencies and run `npm install`.

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Done"
```
Expected: `Done.`

- [ ] **Step 5: Run all tests**

```bash
npm test -- --testPathPattern="contributed|dispatcher|buildAgentContext|agent-registry" 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts src/cli/commands/agent.ts src/cli/index.ts package.json package-lock.json
git commit -m "feat(sdk): nexus agent CLI, GraphQL resolvers, tier-3 gate fix for nexusInvokeAgentTool"
```
