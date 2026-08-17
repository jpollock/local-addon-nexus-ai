/**
 * WP-19 · Both dispatch paths emit — and the BYPASS is the pin that matters.
 *
 * Contributed `agent__<agent>__<tool>` calls dispatch straight to
 * AgentDispatcher and reach `ToolRegistry.call` never (recon §2.2; the same
 * gap CLAUDE.md documents for the audit chokepoints). A producer wired only
 * at the registry would leave those acts out of the ledger while the report
 * claimed coverage — an audit record that lies by omission is worse than one
 * that is visibly absent.
 *
 * Everything here drives the REAL ChatService through its public
 * `sendMessage`, so the TaskId threading (assembly → runAgentLoop →
 * executeToolCall → both dispatch paths) is exercised end to end rather than
 * asserted on a private method.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { ChatService } from '../../../src/main/chat/ChatService';
import { AgentDispatcher } from '../../../src/main/agent-runtime/AgentDispatcher';
import { ContributedToolRegistry } from '../../../src/main/agent-runtime/ContributedToolRegistry';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { createSessionTables } from '../../../src/main/ipc/chat-sessions';
import { initIntelligenceCore, IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  OUTCOME_RECORDED_TOPIC,
  RATIONALE_RECORDED_TOPIC,
} from '../../../src/main/intelligence-host/actionProducer';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { McpToolHandler } from '../../../src/main/mcp/types';

const TASK = 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN';

// The assembler is mocked at the host-adapter boundary, as WP-11's own wiring
// suite does — this suite is about what happens to the TaskId afterwards.
const mockAssemble = jest.fn();
jest.mock('../../../src/main/intelligence-host/chatAssembly', () => ({
  assembleForChatTurn: (...args: unknown[]) => mockAssemble(...args),
}));

jest.mock('../../../src/main/chat/tool-adapter', () => ({
  adaptToolsForChat: () => [],
}));

// The contributed path runs a REAL AgentDispatcher against a temp agent module
// (see `contributedDispatcher`), because the emission lives inside the
// dispatcher chokepoint — a mocked dispatcher would prove nothing about it.
// These two mocks are what the dispatcher's own suite uses for the same reason.
jest.mock('../../../src/main/ipc-handlers', () => ({
  getAgentSetting: () => true,
}));
jest.mock('../../../src/main/agent-runtime/buildAgentContext', () => ({
  buildAgentContext: () => ({ ctx: {} }),
}));

let mockProviderInstance: any = null;
jest.mock('../../../src/main/chat/providers/index', () => ({
  getProvider: () => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

/** Yields ONE tool call on the first turn, then ends. */
function toolCallingProvider(call: { id: string; name: string; arguments: Record<string, unknown> }) {
  let turn = 0;
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat() {
      if (turn++ === 0) {
        yield { type: 'tool_call_end', ...call };
        yield { type: 'done', stopReason: 'tool_use' };
        return;
      }
      yield { type: 'token', text: 'all set' };
      yield { type: 'done', stopReason: 'end_turn' };
    },
    async listModels() {
      return ['mock-model'];
    },
    async validateKey() {
      return null;
    },
  };
}

const silent = { info: () => {}, error: () => {} };

function newCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-chat-gw-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

/**
 * A real dispatcher over a real (temp) agent module. `tier` is the tool's
 * DECLARED permission tier — the value both the durable audit and the ledger
 * gate on.
 */
function contributedDispatcher(tier: number): AgentDispatcher {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp19-agent-'));
  fs.mkdirSync(path.join(dir, 'log_processor'));
  fs.writeFileSync(
    path.join(dir, 'log_processor', 'agent.js'),
    `module.exports = { contributes: { tools: { rescan: { handler: async () => ({ content: [{ type: 'text', text: 'rescanned' }] }) } } } };`
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

interface Harness {
  service: ChatService;
  events: Array<{ type: string; id?: string; name?: string }>;
}

function harness(options: {
  registry?: ToolRegistry;
  dispatcher?: AgentDispatcher;
  approve?: boolean;
}): Harness {
  const db = new Database(':memory:');
  createSessionTables(db);

  const services = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    indexRegistry: { get: () => null, listAll: () => [] },
    fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
    graphService: { getDb: () => db },
    contributedRegistry: {
      getByMcpName: (mcpName: string) => {
        const [, agentName, toolName] = mcpName.split('__');
        return { agentName, toolName };
      },
    },
    dispatcher: options.dispatcher,
  } as unknown as NexusServices;

  const events: Array<{ type: string; id?: string; name?: string }> = [];
  let service!: ChatService;
  service = new ChatService({
    registry: options.registry ?? new ToolRegistry(),
    services,
    sendToRenderer: (_channel: string, ...args: unknown[]) => {
      const sessionId = args[0] as string;
      const event = args[1] as { type: string; id: string };
      events.push(event);
      if (event?.type === 'tool_call_approval_needed' && options.approve !== undefined) {
        setImmediate(() => service.resolveApproval(sessionId, event.id, options.approve!));
      }
    },
  });
  return { service, events };
}

function registryWith(name: string, execute: McpToolHandler['execute']): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    execute,
  } as McpToolHandler);
  return registry;
}

const providerConfig = { providerId: 'mock', model: 'mock-model' };

let core: IntelligenceCore;
beforeEach(() => {
  core = newCore();
  mockAssemble.mockReset().mockResolvedValue({
    taskId: TASK,
    ambientBlock: null,
    turnBlock: null,
    grants: undefined,
  });
});
afterEach(() => {
  core.close();
  setIntelligenceCore(undefined as never);
});

const query = (topic: string) => core.ledger.query({ topicPrefix: topic, limit: 50 });

// ───────────────────────────────────────────────────────────────────────────
// The bypass
// ───────────────────────────────────────────────────────────────────────────

test('a contributed agent__ tool call is recorded, though it never touches the registry', async () => {
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'agent__log_processor__rescan',
    arguments: { bucket: 'wpe-logs' },
  });
  const { service } = harness({ dispatcher: contributedDispatcher(2) });

  await service.sendMessage('s1', 'rescan the logs', providerConfig);

  const actions = query(ACTION_EXECUTED_TOPIC);
  expect(actions).toHaveLength(1);
  expect(actions[0].payload).toMatchObject({
    tool: 'log_processor/rescan',
    dispatch: 'contributed',
    tier: 2,
  });
  // The turn's TaskId travelled from the assembler, through the agent loop and
  // the chat branch, into a dispatcher that had never heard of chat.
  expect(actions[0].correlation).toBe(TASK);
  expect(query(OUTCOME_RECORDED_TOPIC)).toHaveLength(1);
});

test('a Tier-1 contributed tool is NOT recorded — the tool\'s declared tier decides', async () => {
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'agent__log_processor__rescan',
    arguments: {},
  });
  const { service } = harness({ dispatcher: contributedDispatcher(1) });

  await service.sendMessage('s1', 'rescan the logs', providerConfig);

  // Tier 1 is where the durable audit stops too; the two records must cover
  // the same population or one of them is lying about coverage.
  expect(query(ACTION_EXECUTED_TOPIC)).toHaveLength(0);
});

// ───────────────────────────────────────────────────────────────────────────
// The registry path, driven from chat
// ───────────────────────────────────────────────────────────────────────────

test('a registry tool called from chat carries the turn\'s TaskId into the ledger', async () => {
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'wp_plugin_update',
    arguments: { site: 'acme', plugin: 'woocommerce' },
  });
  const registry = registryWith('wp_plugin_update', async () => ({
    content: [{ type: 'text' as const, text: 'updated' }],
  }));
  const { service } = harness({ registry });

  await service.sendMessage('s1', 'update woocommerce', providerConfig);

  const [action] = query(ACTION_EXECUTED_TOPIC);
  expect(action.payload).toMatchObject({ tool: 'wp_plugin_update', dispatch: 'registry' });
  expect(action.correlation).toBe(TASK);
});

// ───────────────────────────────────────────────────────────────────────────
// Approval → rationale → action → outcome
// ───────────────────────────────────────────────────────────────────────────

test('an approved Tier-3 call records the human decision and chains causation', async () => {
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'wpe_delete_install',
    arguments: { install_id: 'inst-1' },
  });
  const registry = registryWith('wpe_delete_install', async () => ({
    content: [{ type: 'text' as const, text: 'deleted' }],
  }));
  const { service } = harness({ registry, approve: true });

  await service.sendMessage('s1', 'delete the install', providerConfig);

  const [rationale] = query(RATIONALE_RECORDED_TOPIC);
  const [action] = query(ACTION_EXECUTED_TOPIC);
  const [outcome] = query(OUTCOME_RECORDED_TOPIC);

  expect(rationale.payload).toMatchObject({ tool: 'wpe_delete_install', decision: 'approved' });
  // The rationale is the card the human was shown — verbatim, not composed.
  expect(String(rationale.payload.prompt).length).toBeGreaterThan(0);
  expect(action.causation).toBe(rationale.id);
  expect(outcome.causation).toBe(action.id);
  for (const e of [rationale, action, outcome]) expect(e.correlation).toBe(TASK);
});

test('a DENIED approval records the refusal and no action at all', async () => {
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'wpe_delete_install',
    arguments: { install_id: 'inst-1' },
  });
  let executed = false;
  const registry = registryWith('wpe_delete_install', async () => {
    executed = true;
    return { content: [{ type: 'text' as const, text: 'deleted' }] };
  });
  const { service } = harness({ registry, approve: false });

  await service.sendMessage('s1', 'delete the install', providerConfig);

  expect(executed).toBe(false);
  expect(query(RATIONALE_RECORDED_TOPIC)[0].payload).toMatchObject({ decision: 'denied' });
  expect(query(ACTION_EXECUTED_TOPIC)).toHaveLength(0);
  expect(query(OUTCOME_RECORDED_TOPIC)).toHaveLength(0);
});

// ───────────────────────────────────────────────────────────────────────────
// Parity
// ───────────────────────────────────────────────────────────────────────────

test('with no assembler and no core, a chat tool call behaves exactly as before', async () => {
  setIntelligenceCore(undefined as never);
  mockAssemble.mockResolvedValue(null);
  mockProviderInstance = toolCallingProvider({
    id: 'tc-1',
    name: 'wp_plugin_update',
    arguments: { site: 'acme' },
  });
  const registry = registryWith('wp_plugin_update', async () => ({
    content: [{ type: 'text' as const, text: 'updated' }],
  }));
  const { service, events } = harness({ registry });

  await service.sendMessage('s1', 'update woocommerce', providerConfig);

  expect(events.some((e) => e.type === 'error')).toBe(false);
  expect(query(ACTION_EXECUTED_TOPIC)).toHaveLength(0);
});
