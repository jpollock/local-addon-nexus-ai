/**
 * WP-20d · the guard at the DISPATCH CHOKEPOINTS, exercised through the real
 * `ToolRegistry.call` and the real `AgentDispatcher.dispatch`.
 *
 * WP-19 measured that there are TWO chokepoints and that `McpServer.ts`'s
 * `tools/call` routes `agent__*` names to the dispatcher, reaching
 * `ToolRegistry.call` never. A guard wired at one of them would be a guard with
 * a documented bypass, so both are wired and both are tested here — even though
 * no runbook claims a contributed tool today. The second call site is what
 * makes "gated calls are sequenced" true rather than "gated calls on the path
 * we happened to check are sequenced".
 *
 * The other half of this suite is the part that must NOT happen: a refused call
 * executes no handler, and emits no `task.action.executed`. WP-19's producer is
 * explicit that a refused call did not execute, so recording one would put a
 * false act on the compliance spine.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { armProcedureRun, forgetProcedureRun, registerProcedureTurn } from '../procedureCursor';
import { ToolRegistry } from '../../mcp/tool-registry';
import { AgentDispatcher } from '../../agent-runtime/AgentDispatcher';
import { taskId as mintTaskId } from '../../../intelligence';
import type { McpToolHandler, NexusServices } from '../../mcp/types';

const CAPABILITY = 'cap.bulk_plugin_update';

let core: IntelligenceCore;
let dir: string;
let task: string;
let executed: string[];
let audited: Array<{ operation: string; outcome: string; error?: string }>;

function services(): NexusServices {
  return {
    operationAuditLog: {
      log: (entry: { operation: string; outcome: string; error?: string }) => audited.push(entry),
    },
  } as never;
}

function tool(name: string): McpToolHandler {
  return {
    definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    execute: async () => {
      executed.push(name);
      return { content: [{ type: 'text' as const, text: `ran ${name}` }] };
    },
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wiring-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetProcedureRun('s1');
  task = mintTaskId();
  executed = [];
  audited = [];
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function arm(): void {
  const runbook = core.law!.runbooks.byCapability(CAPABILITY)!;
  armProcedureRun({
    sessionId: 's1',
    capability: CAPABILITY,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
  });
  registerProcedureTurn({ sessionId: 's1', taskId: task });
}

const actions = () =>
  core.ledger.query({ topicPrefix: 'task.action.' }).map((e) => (e.payload as { tool: string }).tool);

// ---------------------------------------------------------------------------

describe('chokepoint 1 — ToolRegistry.call', () => {
  test('an out-of-sequence claimed tool is refused, and the handler never runs', async () => {
    arm();
    const registry = new ToolRegistry();
    registry.register(tool('bulk_plugin_update'));

    const result = await registry.call(
      'bulk_plugin_update', {}, services(), 'mcp', true, undefined, { id: task }
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('rb.bulk-plugin-update');
    expect(result.content[0].text).toContain('cp.consult-history');
    expect(executed).toEqual([]);
  });

  test('the refusal is audited as a failure — a blocked gated attempt leaves a record', async () => {
    arm();
    const registry = new ToolRegistry();
    registry.register(tool('bulk_plugin_update'));

    await registry.call('bulk_plugin_update', {}, services(), 'mcp', true, undefined, { id: task });

    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ operation: 'bulk_plugin_update', outcome: 'failure' });
    expect(audited[0].error).toContain('cp.consult-history');
  });

  test('a refused call emits NO task.action.executed — it did not execute', async () => {
    arm();
    const registry = new ToolRegistry();
    registry.register(tool('bulk_plugin_update'));

    await registry.call('bulk_plugin_update', {}, services(), 'mcp', true, undefined, { id: task });

    // WP-19's producer is explicit that a refusal is not an act. An action
    // event here would put something on the episodic spine that never happened.
    expect(actions()).toEqual([]);
  });

  test('an unclaimed tool is untouched while the same run is armed', async () => {
    arm();
    const registry = new ToolRegistry();
    registry.register(tool('nexus_list_sites'));

    const result = await registry.call(
      'nexus_list_sites', {}, services(), 'mcp', true, undefined, { id: task }
    );

    expect(result.isError).toBeUndefined();
    expect(executed).toEqual(['nexus_list_sites']);
  });

  test('PARITY: with nothing armed, a claimed tool runs exactly as before', async () => {
    const registry = new ToolRegistry();
    registry.register(tool('bulk_plugin_update'));

    const result = await registry.call(
      'bulk_plugin_update', {}, services(), 'mcp', true, undefined, { id: task }
    );

    expect(result.isError).toBeUndefined();
    expect(executed).toEqual(['bulk_plugin_update']);
    // …and the WP-19 emission still happens, because the call happened.
    expect(actions()).toEqual(['bulk_plugin_update']);
  });

  test('PARITY: a call with no task at all is untouched', async () => {
    arm();
    const registry = new ToolRegistry();
    registry.register(tool('bulk_plugin_update'));

    const result = await registry.call('bulk_plugin_update', {}, services(), 'cli');

    expect(result.isError).toBeUndefined();
    expect(executed).toEqual(['bulk_plugin_update']);
  });
});

describe('chokepoint 2 — AgentDispatcher.dispatch', () => {
  /** Minimal contributed registry: one tool, declared Tier 2. */
  function dispatcherFor(name: string, onExecute: () => void) {
    const registered = {
      agentName: 'acme',
      toolName: name,
      permissionTier: 2,
      executionMode: 'function' as const,
      handler: async () => {
        onExecute();
        return { content: [{ type: 'text' as const, text: 'ran' }] };
      },
    };
    const contributedRegistry = {
      get: (agentName: string, toolName: string) =>
        agentName === 'acme' && toolName === name ? registered : undefined,
    };
    // Positional constructor: contributedRegistry, toolRegistry, services, …
    return new AgentDispatcher(
      contributedRegistry as never,
      new ToolRegistry(),
      services(),
      undefined as never,
      undefined as never,
      undefined as never
    );
  }

  test('the guard is in this path too — the McpServer bypass is covered', async () => {
    // No SHIPPED runbook claims a contributed tool, so the decisive pin is a
    // runbook that does: if the qualified name is claimed and out of sequence,
    // this path must refuse it. Asserting "it didn't refuse" would pass just as
    // well with no guard here at all.
    const claimed = {
      id: 'rb.fixture-contributed',
      version: '1.0.0',
      capability: 'cap.fixture_contributed',
      strictness: 'strict' as const,
      path: 'runbooks/fixture.md',
      hash: 'sha256:fixture',
      canonicalBytes: 10,
      checkpoints: [
        {
          id: 'cp.approval',
          attest: 'event' as const,
          evidence: { topic: 'task.rationale.recorded', decision: 'approved' },
          tools: [],
        },
        { id: 'cp.act', attest: 'narrative' as const, tools: [{ name: 'acme/dangerous_tool' }] },
      ],
      steps: [],
      tools: [],
      toolScope: 'advisory' as const,
      body: '',
      canonicalText: '',
      frontmatter: {},
    };
    setIntelligenceCore({
      ...core,
      law: { runbooks: { byCapability: () => claimed, errors: () => [] } },
    } as never);
    armProcedureRun({
      sessionId: 's1',
      capability: 'cap.fixture_contributed',
      runbookId: claimed.id,
      runbookHash: claimed.hash,
    });
    registerProcedureTurn({ sessionId: 's1', taskId: task });

    let ran = false;
    const dispatcher = dispatcherFor('dangerous_tool', () => {
      ran = true;
    });

    const result = await dispatcher.dispatch('acme', 'dangerous_tool', {}, { id: task });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cp.approval');
    expect(result.content[0].text).toContain('acme/dangerous_tool');
    expect(ran).toBe(false);
    // Audited on this path too — the dispatcher owns its own audit write.
    expect(audited[0]).toMatchObject({ operation: 'acme/dangerous_tool', outcome: 'failure' });
  });

  test('PARITY: an unclaimed contributed tool is untouched by the guard', async () => {
    arm();
    const dispatcher = dispatcherFor('harmless_tool', () => {});

    const result = await dispatcher.dispatch('acme', 'harmless_tool', {}, { id: task });

    // It may still fail for its own reasons (this fixture has no agent module
    // on disk) — what it must never carry is the guard's refusal.
    expect(result.content[0].text ?? '').not.toContain('REFUSED by procedure');
  });
});
