/**
 * WP-43 · the turn's one exit, and what rides out of it.
 *
 * `citationDelivery.test.ts` pins the payload's CONTENT against a real core.
 * This suite pins the thing content cannot show: that the payload is actually
 * emitted, from every exit a turn has, in the right order, and never when the
 * layer contributed nothing.
 *
 * The failure mode being guarded is specific and has a live precedent. Before
 * this packet, `done` was emitted from FOUR places in `ChatService` and the
 * citation supply from none; the render existed and was correct and had nothing
 * to draw. A delivery hand-instrumented at three of the four exits would be the
 * same bug with a smaller blast radius — a turn that errored, or that hit the
 * iteration cap, would keep its raw `[[cite:…]]` markers while every other turn
 * drew chips, and nothing would say why.
 *
 * The harness is `chat-assembly-wiring.test.ts`'s, for the reason that suite
 * gives about WP-12's: same seam, same failure mode.
 */
import Database from 'better-sqlite3';
import { ChatService, ChatServiceDeps } from '../../../src/main/chat/ChatService';
import { ToolRegistry } from '../../../src/main/mcp/tool-registry';
import { createSessionTables } from '../../../src/main/ipc/chat-sessions';
import { IPC_CHANNELS } from '../../../src/common/constants';
import { CHAT_CITATION_MOMENT } from '../../../src/main/intelligence-host/citationDelivery';
import type { NexusServices } from '../../../src/main/mcp/types';

const mockAssemble = jest.fn();
jest.mock('../../../src/main/intelligence-host/chatAssembly', () => ({
  assembleForChatTurn: (...args: unknown[]) => mockAssemble(...args),
}));

jest.mock('../../../src/main/chat/tool-adapter', () => ({
  adaptToolsForChat: () => [],
}));

let mockProviderInstance: any = null;
jest.mock('../../../src/main/chat/providers/index', () => ({
  getProvider: () => mockProviderInstance,
  initializeProviders: () => {},
  listProviders: () => [],
}));

const providerConfig = { providerId: 'mock', model: 'mock-model' };

/** What a real assembly hands back, minus the parts this seam does not read. */
const SUPPLY = {
  events: [{ id: 'evt_9c41', topic: 'incident.opened', trust: 'emitted' }],
  toolCalls: [] as Array<{ name: string; index: number }>,
  carrierLines: [{ key: 'retrieved' }],
};

function assembly(over: Record<string, unknown> = {}) {
  return {
    taskId: 'task_01J5',
    ambientBlock: null,
    turnBlock: null,
    grants: undefined,
    procedure: null,
    citationSupply: SUPPLY,
    citationManifest: { convention: 'cnv_6c2b11952046', asserted: 'full' },
    ...over,
  };
}

function provider(script: (yielded: any[]) => void) {
  const events: any[] = [];
  script(events);
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat() {
      for (const e of events) yield e;
    },
    async listModels() { return ['mock-model']; },
    async validateKey() { return null; },
  };
}

/** Every event the service pushed at the renderer, in order. */
let sent: any[] = [];

function service(): ChatService {
  const db = new Database(':memory:');
  createSessionTables(db);
  const deps: ChatServiceDeps = {
    registry: new ToolRegistry(),
    services: {
      siteData: { getSite: () => null, getSites: () => ({}) },
      indexRegistry: { get: () => null, listAll: () => [] },
      fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
      graphService: { getDb: () => db },
    } as never as NexusServices,
    sendToRenderer: (channel: string, _sessionId: unknown, event: unknown) => {
      if (channel === IPC_CHANNELS.CHAT_STREAM) sent.push(event);
    },
  };
  return new ChatService(deps);
}

const typesOf = () => sent.map((e) => e.type);
const citation = () => sent.find((e) => e.type === 'citation_supply');

beforeEach(() => {
  sent = [];
  mockAssemble.mockReset().mockResolvedValue(assembly());
  mockProviderInstance = provider((out) => {
    out.push({ type: 'token', text: 'A claim. [[cite:evt_9c41]]' });
    out.push({ type: 'done', stopReason: 'end_turn' });
  });
});

// ---------------------------------------------------------------------------

describe('the ordinary turn', () => {
  test('emits the citation supply IMMEDIATELY BEFORE done', async () => {
    await service().sendMessage('s1', 'why is checkout failing?', providerConfig);

    const types = typesOf();
    const doneAt = types.lastIndexOf('done');
    expect(doneAt).toBeGreaterThan(-1);
    // Adjacency, not merely order. The panel's `done` handler ends the stream
    // and persists the session; anything between the two is a chance for the
    // supply to reach a message the panel has already finished with.
    expect(types[doneAt - 1]).toBe('citation_supply');
    expect(types.filter((t) => t === 'citation_supply')).toHaveLength(1);
  });

  test('carries the supply, the manifest key, and the surface’s moment', async () => {
    await service().sendMessage('s1', 'why is checkout failing?', providerConfig);

    const event = citation();
    expect(event.supply.events).toEqual(SUPPLY.events);
    expect(event.supply.carrierLines).toEqual(SUPPLY.carrierLines);
    expect(event.moment).toBe(CHAT_CITATION_MOMENT);
    expect(Object.prototype.hasOwnProperty.call(event.manifest, 'citation')).toBe(true);
    expect(event.manifest.citation).toEqual({ convention: 'cnv_6c2b11952046', asserted: 'full' });
  });

  test('does not carry a second copy of the reply', async () => {
    // The panel already holds the streamed text. Two strings for one reply is
    // the sheet's own objection to copying a record into the chat, turned on
    // the chat itself — and the render overwrites `reply` from `content`
    // precisely so they cannot disagree.
    await service().sendMessage('s1', 'why is checkout failing?', providerConfig);
    expect(citation()).not.toHaveProperty('reply');
  });
});

describe('a turn the layer did not touch', () => {
  test('emits NO citation event, and `done` is unchanged', async () => {
    mockAssemble.mockResolvedValue(null);

    await service().sendMessage('s1', 'hello', providerConfig);

    expect(citation()).toBeUndefined();
    expect(typesOf()).toEqual(['token', 'done']);
  });

  test('the same when assembly THROWS', async () => {
    mockAssemble.mockRejectedValue(new Error('core is down'));

    await service().sendMessage('s1', 'hello', providerConfig);

    expect(citation()).toBeUndefined();
    expect(typesOf()).toEqual(['token', 'done']);
  });
});

describe('every exit the turn has', () => {
  test('the provider’s error branch still delivers, and still ends the turn', async () => {
    mockProviderInstance = provider((out) => {
      out.push({ type: 'token', text: 'Partial. [[cite:evt_9c41]]' });
      out.push({ type: 'error', message: 'upstream exploded' });
    });

    await service().sendMessage('s1', 'why?', providerConfig);

    const types = typesOf();
    expect(types).toEqual(['token', 'error', 'citation_supply', 'done']);
    // The reason this exit is not skippable: the model wrote markers before it
    // failed, and a partial bubble with raw syntax in it is the same defect
    // this packet exists to close.
    expect(citation()).toBeDefined();
  });

  test('a stream that throws mid-turn still delivers', async () => {
    mockProviderInstance = {
      id: 'mock',
      displayName: 'Mock',
      requiresApiKey: false,
      defaultModels: ['mock-model'],
      // eslint-disable-next-line require-yield
      async *streamChat() { throw new Error('socket died'); },
      async listModels() { return ['mock-model']; },
      async validateKey() { return null; },
    };

    await service().sendMessage('s1', 'why?', providerConfig);

    const types = typesOf();
    expect(types[types.lastIndexOf('done') - 1]).toBe('citation_supply');
  });

  test('THE CHOKEPOINT: no `done` is emitted anywhere without a delivery beside it', async () => {
    // The generalisation of the three cases above, and the one that survives a
    // fifth exit being added. `endTurn` is the only writer of `done`; if a
    // future edit reintroduces a bare `this.emit(..., {type:'done'})`, this goes
    // red without anybody having to think of the new exit.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/main/chat/ChatService.ts'),
      'utf8'
    ) as string;
    const bareDone = source
      .split('\n')
      .filter((l) => /this\.emit\(.*\{\s*type:\s*'done'/.test(l));
    // Exactly one, and it is the one inside `endTurn`.
    expect(bareDone).toHaveLength(1);
    expect(source.indexOf(bareDone[0])).toBeGreaterThan(source.indexOf('private endTurn('));
  });
});

// ---------------------------------------------------------------------------
// The turn's tool trace — the half of the supply the assembler cannot know
// ---------------------------------------------------------------------------

/**
 * BATTERY FINDING (M15, M16). The first run of this suite exercised no tool
 * call at all, so deleting `turnToolCalls.push(tc.name)` outright SURVIVED, and
 * so did moving it behind a success check. Both would ship a real defect —
 * the first makes every `[[cite:tool:…]]` unresolvable, the second renumbers
 * every later call of a tool that once failed, so a citation the model wrote
 * against call #2 resolves to call #3's record. A WRONG record is worse than
 * an unresolvable one, and quieter: it draws the neutral chip.
 *
 * These tests are the hole closed. They run tool calls through the REAL loop —
 * a registry with a tool that answers, and one that errors.
 */
function toolProvider(names: string[]) {
  let turn = 0;
  return {
    id: 'mock',
    displayName: 'Mock',
    requiresApiKey: false,
    defaultModels: ['mock-model'],
    async *streamChat() {
      if (turn++ === 0) {
        for (const [i, name] of names.entries()) {
          yield { type: 'tool_call_start', id: `t${i}`, name };
          yield { type: 'tool_call_end', id: `t${i}`, name, arguments: {} };
        }
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'token', text: 'Done. [[cite:tool:wp_plugin_list#2]]' };
        yield { type: 'done', stopReason: 'end_turn' };
      }
    },
    async listModels() { return ['mock-model']; },
    async validateKey() { return null; },
  };
}

/**
 * A registry whose tools answer — or come back REFUSED, when the name says so.
 *
 * `isError`, not a throw, and the distinction is the one the test needs: a
 * throw unwinds the whole agent loop and ends the turn, so the second call
 * never happens and there is nothing to renumber. A refusal — which is what the
 * sequence guard and the permission gate actually produce — leaves the loop
 * running and the next call of the same tool right behind it. That is the state
 * where skipping failures would silently hand a citation the wrong record.
 */
function registryWith(failing: string[] = []): ToolRegistry {
  const r = new ToolRegistry();
  (r as any).call = async (name: string) =>
    failing.includes(name)
      ? { content: [{ type: 'text', text: `${name} was refused` }], isError: true }
      : { content: [{ type: 'text', text: 'ok' }] };
  (r as any).get = (name: string) => ({ name, description: '', inputSchema: {} });
  return r;
}

function serviceWithRegistry(registry: ToolRegistry): ChatService {
  const db = new Database(':memory:');
  createSessionTables(db);
  return new ChatService({
    registry,
    services: {
      siteData: { getSite: () => null, getSites: () => ({}) },
      indexRegistry: { get: () => null, listAll: () => [] },
      fileScanner: { scan: async () => ({ wpVersion: '', phpVersion: '', themes: [], plugins: [] }) },
      graphService: { getDb: () => db },
    } as never as NexusServices,
    sendToRenderer: (channel: string, _s: unknown, event: unknown) => {
      if (channel === IPC_CHANNELS.CHAT_STREAM) sent.push(event);
    },
  });
}

describe('the turn’s tool calls', () => {
  test('reach the delivered supply, numbered per tool in call order', async () => {
    mockProviderInstance = toolProvider(['wp_plugin_list', 'wpe_backup_and_verify', 'wp_plugin_list']);

    await serviceWithRegistry(registryWith()).sendMessage('s1', 'update plugins', providerConfig);

    expect(citation().supply.toolCalls).toEqual([
      { name: 'wp_plugin_list', index: 1 },
      { name: 'wpe_backup_and_verify', index: 1 },
      { name: 'wp_plugin_list', index: 2 },
    ]);
  });

  test('a call that was REFUSED still holds its place in the numbering', async () => {
    // The refused call is `wp_plugin_list#1`. If failures were skipped, the
    // second call would be numbered #1, and the model's `[[cite:tool:
    // wp_plugin_list#2]]` — written while looking at a transcript where it was
    // the second call — would resolve to nothing, or worse, to the wrong one.
    mockProviderInstance = toolProvider(['wp_plugin_list', 'wp_plugin_list']);

    await serviceWithRegistry(registryWith(['wp_plugin_list'])).sendMessage('s1', 'update plugins', providerConfig);

    expect(citation().supply.toolCalls).toEqual([
      { name: 'wp_plugin_list', index: 1 },
      { name: 'wp_plugin_list', index: 2 },
    ]);
  });

  test('the supply is delivered ONCE for the whole turn, not once per iteration', async () => {
    // The panel shows one assistant bubble per turn — tokens from every
    // iteration append to the same streaming message — so the turn, not the
    // iteration, is the unit a supply describes. Two deliveries would have the
    // second overwrite the first, and only the last iteration's trace survive.
    mockProviderInstance = toolProvider(['wp_plugin_list']);

    await serviceWithRegistry(registryWith()).sendMessage('s1', 'update plugins', providerConfig);

    expect(sent.filter((e) => e.type === 'citation_supply')).toHaveLength(1);
  });
});
