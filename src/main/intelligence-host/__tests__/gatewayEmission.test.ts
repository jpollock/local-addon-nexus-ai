/**
 * WP-19 · The registry chokepoint emits — and refuses to lie.
 *
 * `ToolRegistry.call` is the funnel every dispatch surface routes through
 * (MCP, chat, CLI/GraphQL resolvers, the agent runtime), which is exactly why
 * the durable audit write lives there. The ledger emission joins it.
 *
 * Two pins here are about what must NOT be recorded:
 *   - a call REFUSED by the Tier-3 gate never executed, so it gets no
 *     `task.action.executed`;
 *   - a Tier-1 read is not an act.
 * And two are about the ordering rule: the gate blocks, the audit records —
 * a throwing emitter must not change a call's result, and a handler that
 * throws must still leave its failure in the ledger.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { ACTION_EXECUTED_TOPIC, OUTCOME_RECORDED_TOPIC } from '../actionProducer';
import { ToolRegistry } from '../../mcp/tool-registry';
import { AgentDispatcher } from '../../agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../agent-runtime/ContributedToolRegistry';
import type { McpToolHandler, NexusServices } from '../../mcp/types';

// The dispatcher consults agent settings and builds an agent context; neither
// is what this suite is about. Same two mocks the dispatcher's own suite uses.
jest.mock('../../ipc-handlers', () => ({ getAgentSetting: () => true }));
jest.mock('../../agent-runtime/buildAgentContext', () => ({
  buildAgentContext: () => ({ ctx: {} }),
}));

const silent = { info: () => {}, error: () => {} };
const TASK = 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN';

function newCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-gateway-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

const services = {} as NexusServices;

function handler(name: string, execute: McpToolHandler['execute']): McpToolHandler {
  return {
    definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    execute,
  } as McpToolHandler;
}

function registryWith(...handlers: McpToolHandler[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const h of handlers) registry.register(h);
  return registry;
}

const ok = async () => ({ content: [{ type: 'text' as const, text: 'done' }] });

let core: IntelligenceCore;
beforeEach(() => {
  core = newCore();
});
afterEach(() => {
  core.close();
  setIntelligenceCore(undefined as never);
});

const topics = () => core.ledger.query({ topicPrefix: 'task.', limit: 100 }).map((e) => e.topic);

test('a Tier-2 call through the registry lands in the ledger, correlated to the turn', async () => {
  const registry = registryWith(handler('wp_plugin_update', ok));

  await registry.call('wp_plugin_update', { site: 'x' }, services, 'mcp', true, undefined, {
    id: TASK,
  });

  const actions = core.ledger.query({ topicPrefix: ACTION_EXECUTED_TOPIC, limit: 10 });
  const outcomes = core.ledger.query({ topicPrefix: OUTCOME_RECORDED_TOPIC, limit: 10 });
  expect(actions).toHaveLength(1);
  expect(outcomes).toHaveLength(1);
  expect(actions[0].correlation).toBe(TASK);
  expect(actions[0].payload).toMatchObject({ dispatch: 'registry', access_method: 'mcp' });
  expect(outcomes[0].payload).toMatchObject({ result: 'success' });
});

test('a call with no task frame still records the act, with no correlation', async () => {
  const registry = registryWith(handler('wp_plugin_update', ok));

  await registry.call('wp_plugin_update', { site: 'x' }, services, 'cli');

  const [action] = core.ledger.query({ topicPrefix: ACTION_EXECUTED_TOPIC, limit: 10 });
  expect(action).toBeDefined();
  expect(action.correlation).toBeUndefined();
});

test('a Tier-1 read through the registry records nothing', async () => {
  const registry = registryWith(handler('wp_plugin_list', ok));

  await registry.call('wp_plugin_list', { site: 'x' }, services, 'mcp');

  expect(topics()).toEqual([]);
});

test('a handler that throws leaves a failure in the ledger and still returns an error result', async () => {
  const registry = registryWith(
    handler('wp_plugin_update', async () => {
      throw new Error('WP-CLI blew up');
    })
  );

  const result = await registry.call('wp_plugin_update', { site: 'x' }, services, 'mcp');

  expect(result.isError).toBe(true);
  const [outcome] = core.ledger.query({ topicPrefix: OUTCOME_RECORDED_TOPIC, limit: 10 });
  expect(outcome.payload).toMatchObject({ result: 'failure' });
});

test('a tool returning isError records a failed outcome, not a success', async () => {
  const registry = registryWith(
    handler('wp_plugin_update', async () => ({
      content: [{ type: 'text' as const, text: 'site not running' }],
      isError: true,
    }))
  );

  await registry.call('wp_plugin_update', { site: 'x' }, services, 'mcp');

  const [outcome] = core.ledger.query({ topicPrefix: OUTCOME_RECORDED_TOPIC, limit: 10 });
  expect(outcome.payload).toMatchObject({ result: 'failure', error: 'site not running' });
});

test('a call REFUSED by the Tier-3 gate emits nothing — it never executed', async () => {
  let executed = false;
  const registry = registryWith(
    handler('wpe_delete_install', async () => {
      executed = true;
      return { content: [{ type: 'text' as const, text: 'deleted' }] };
    })
  );

  await registry.call('wpe_delete_install', { install_id: 'x' }, services, 'mcp');

  expect(executed).toBe(false);
  expect(topics()).toEqual([]);
});

test('a throwing emitter cannot change the call\'s result', async () => {
  (core as unknown as { emitter: { emit: () => never } }).emitter = {
    emit: () => {
      throw new Error('ledger is on fire');
    },
  };
  const registry = registryWith(handler('wp_plugin_update', ok));

  const result = await registry.call('wp_plugin_update', { site: 'x' }, services, 'mcp');

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toBe('done');
});

test('with no intelligence core, the registry behaves exactly as it did before', async () => {
  setIntelligenceCore(undefined as never);
  const registry = registryWith(handler('wp_plugin_update', ok));

  const result = await registry.call('wp_plugin_update', { site: 'x' }, services, 'mcp');

  expect(result.content[0].text).toBe('done');
  expect(topics()).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// Chokepoint two — the contributed dispatcher
//
// ChatService is only ONE of its callers (McpServer is the other), which is
// why the emission lives in the dispatcher rather than in the chat branch.
// These pins drive the dispatcher directly, as an MCP client would.
// ───────────────────────────────────────────────────────────────────────────

function dispatcherFor(tier: number, handlerBody = `async () => ({ content: [{ type: 'text', text: 'ok' }] })`): AgentDispatcher {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp19-agent-'));
  fs.mkdirSync(path.join(dir, 'log_processor'));
  fs.writeFileSync(
    path.join(dir, 'log_processor', 'agent.js'),
    `module.exports = { contributes: { tools: { rescan: { handler: ${handlerBody} } } } };`
  );
  const contributed = new ContributedToolRegistry();
  contributed.register('log_processor', { name: 'rescan', description: 'Rescan', inputSchema: {} }, tier);
  return new AgentDispatcher(
    contributed,
    new ToolRegistry(),
    {} as never,
    dir,
    {} as never,
    { buildHandle: () => ({}) } as never
  );
}

test('an MCP client calling a contributed tool is recorded, with NO correlation', async () => {
  // No task frame exists on that surface. The act is still recorded; the
  // correlation is absent rather than invented.
  await dispatcherFor(2).dispatch('log_processor', 'rescan', {});

  const [action] = core.ledger.query({ topicPrefix: ACTION_EXECUTED_TOPIC, limit: 10 });
  expect(action.payload).toMatchObject({ tool: 'log_processor/rescan', dispatch: 'contributed' });
  expect(action.correlation).toBeUndefined();
});

test('a contributed tool that fails records a failed outcome', async () => {
  // Returns an error result rather than throwing: `dispatchFunction`'s catch
  // path leaves its 5-minute timeout handle uncleared (pre-existing, reported
  // as a WP-19 finding), and a leaked timer makes this suite's output noisy
  // about something it is not testing.
  await dispatcherFor(
    2,
    `async () => ({ content: [{ type: 'text', text: 'bucket unreachable' }], isError: true })`
  ).dispatch('log_processor', 'rescan', {});

  const [outcome] = core.ledger.query({ topicPrefix: OUTCOME_RECORDED_TOPIC, limit: 10 });
  expect(outcome.payload).toMatchObject({ result: 'failure' });
  expect(String(outcome.payload.error)).toContain('bucket unreachable');
});

test('a throwing emitter cannot turn a successful dispatch into an error', async () => {
  (core as unknown as { emitter: { emit: () => never } }).emitter = {
    emit: () => {
      throw new Error('ledger is on fire');
    },
  };

  const result = await dispatcherFor(2).dispatch('log_processor', 'rescan', {});

  expect(result.isError).toBeFalsy();
  expect(result.content[0].text).toBe('ok');
});
