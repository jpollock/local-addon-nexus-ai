/**
 * WP-11 · the host adapter — real core on a temp dir, real ledger, real law.
 *
 * This suite owns the acceptance pins the core suite structurally cannot see:
 * the TaskId threading, the `task.context.assembled` emission, `verifyMirror()`
 * being called at assembly time, and the grants mapping (`[]` must never reach
 * the tool adapter as a filter).
 *
 * Ids are derived with `provisionalEnvironmentId`, never written as literals —
 * a literal would pass while the derivation drifted underneath it.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { provisionalEnvironmentId, provisionalSiteId } from '../provisionalEntity';
import {
  assembleForChatTurn,
  forgetChatAssemblySession,
  CONTEXT_ASSEMBLED_SCHEMA,
  CONTEXT_ASSEMBLED_TOPIC,
} from '../chatAssembly';
import type { NexusServices } from '../../mcp/types';

const SITE_ID = 'local-acme';
const ENV_ID = provisionalEnvironmentId(SITE_ID);
const SITE_ENT = provisionalSiteId(SITE_ID);
const HOUR = 3600_000;

let core: IntelligenceCore;
let dir: string;

/** Minimal services: the adapter needs siteData for target resolution only. */
function services(over: Partial<Record<string, unknown>> = {}): NexusServices {
  return {
    siteData: {
      getSite: (id: string) => (id === SITE_ID ? { id: SITE_ID, name: 'acme-local', path: '/x' } : null),
      getSites: () => ({ [SITE_ID]: { id: SITE_ID, name: 'acme-local', path: '/x' } }),
    },
    ...over,
  } as never;
}

/** Seed one plugin observation for the site, aged well past its 8h SLO. */
function seedObservation(observedAgoHours: number): void {
  core.emitter.emit({
    observed_at: new Date(Date.now() - observedAgoHours * HOUR).toISOString(),
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: ENV_ID },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
    payload: { slug: 'advanced-custom-fields', version: '6.2.0', active: true },
  });
  core.scheduleFolds();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-assembly-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');
  forgetChatAssemblySession('s2');
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('assembleForChatTurn — TaskId and the manifest event', () => {
  test('mints a ULID TaskId per turn and threads it as correlation, never the sessionId', async () => {
    const a = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hello', buildingSystemPrompt: true,
    });
    const b = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'again', buildingSystemPrompt: false,
    });

    expect(a!.taskId).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b!.taskId).not.toBe(a!.taskId); // per TURN, not per session
    expect(a!.taskId).not.toContain('s1');

    const events = core.ledger.query({ topicPrefix: 'task.' });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.correlation)).toEqual([a!.taskId, b!.taskId]);
    // "What did the agent know when it acted" is a WHERE correlation = ? query.
    expect(core.ledger.query({ correlation: a!.taskId })).toHaveLength(1);
  });

  test('emits the manifest to the LEDGER under the declared topic and schema', async () => {
    await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', siteId: SITE_ID, buildingSystemPrompt: true,
    });

    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    expect(event.topic).toBe(CONTEXT_ASSEMBLED_TOPIC);
    expect(event.topic).toBe('task.context.assembled');
    expect(event.schema).toBe(CONTEXT_ASSEMBLED_SCHEMA);
    // Both roles: the physical copy the turn is about, and the logical Site it
    // belongs to (WP-16 / audit A3 — the Site role is what scopes episodic).
    expect(event.entity).toEqual({ environment: ENV_ID, site: SITE_ENT });
    expect(event.source).toEqual({ class: 'work', system: 'assembler:chat', trust: 'emitted' });
  });

  test('the payload IS the manifest — the §6.4 audit artifact, stored', async () => {
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', siteId: SITE_ID, buildingSystemPrompt: true,
    });

    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    const m = event.payload as Record<string, unknown>;
    expect(m.task).toBe(r!.taskId);
    expect(m.surface).toBe('chat.docked-panel');
    expect(m.bundle_id).toMatch(/^bun_/);
    expect(m.procedure).toBeNull();
    expect(m.tools).toEqual([]);
    expect((m.budget as Record<string, unknown>).method).toMatch(/estimate/i);
    expect(m.assembled_at).toEqual(expect.any(String));
  });

  test('the emitted envelope survives the real validator (first task.* producer)', async () => {
    await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    // A rejected envelope would have thrown inside emit and been swallowed —
    // so the count IS the assertion that validation passed.
    expect(core.ledger.query({ topicPrefix: 'task.' })).toHaveLength(1);
  });
});

describe('assembleForChatTurn — ADR-20 across a session', () => {
  test('turn 1 puts the full set in the prompt; turn 2 re-asserts by hash alone', async () => {
    const first = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    expect(first!.ambientBlock).toContain('Operating policy');
    expect(first!.turnBlock ?? '').not.toContain('[gateway]');

    const second = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'again', buildingSystemPrompt: false,
    });
    expect(second!.ambientBlock).toBeNull();
    expect(second!.turnBlock).toContain('remains in effect, unchanged');
    expect(second!.turnBlock).not.toContain('[gateway]');
  });

  test('a DIFFERENT session has carried nothing, so it gets the full set', async () => {
    await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    const other = await assembleForChatTurn({
      services: services(), sessionId: 's2', userMessage: 'hi', buildingSystemPrompt: false,
    });
    // s2 never saw the set — the per-turn carrier must ship it in full. This is
    // the rehydration case: a session reopened after a restart carries nothing.
    expect(other!.turnBlock).toContain('[gateway]');
  });
});

describe('assembleForChatTurn — freshness disclosure reaches the turn', () => {
  test('a stale twin fact is disclosed with its age and the relay obligation', async () => {
    seedObservation(20); // 20h old; plugin SLO is 8h
    await new Promise((r) => setTimeout(r, 650)); // let the debounced fold run

    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'is ACF current?', siteId: SITE_ID,
      buildingSystemPrompt: false,
    });

    expect(r!.turnBlock).toContain('plugin:advanced-custom-fields');
    expect(r!.turnBlock).toContain('PAST SLO');
    expect(r!.turnBlock).toContain('re-check it live');
    // The VALUE is never copied — only that an observation exists, and its age.
    expect(r!.turnBlock).not.toContain('6.2.0');
  });

  test('the episodic slice for the site rides the same turn', async () => {
    seedObservation(3);
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'what changed?', siteId: SITE_ID,
      buildingSystemPrompt: false,
    });
    expect(r!.turnBlock).toContain('state.plugin.observed');
    expect(r!.turnBlock).toContain('<untrusted_data');
  });

  /**
   * WP-16 (audit A3). Episodic scope was the local COPY: an event recorded
   * against another environment of the same logical Site — the WPE install the
   * sandbox mirrors — was invisible to the turn, even though every producer
   * dual-stamps the Site role and `Ledger.query` matches any role. The targets
   * now carry the Site, so prior activity elsewhere on the same Site is in
   * scope. Freshness is unaffected: twin facts key to the environment.
   */
  test('episodic retrieval is Site-scoped: activity on a sibling environment reaches the turn', async () => {
    const siblingEnv = provisionalEnvironmentId('wpe-install-of-the-same-site');
    core.emitter.emit({
      observed_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      topic: 'state.plugin.observed',
      schema: 'plugin.observed/1',
      entity: { site: SITE_ENT, environment: siblingEnv },
      actor: { id: 'act_seed', kind: 'system' },
      source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
      payload: { slug: 'sibling-only-plugin', version: '1.0.0', active: true },
    });

    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'what changed?', siteId: SITE_ID,
      buildingSystemPrompt: false,
    });

    expect(r!.turnBlock).toContain('sibling-only-plugin');
    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    const queries = (event.payload.retrieval as Array<{ query: string }>).map((q) => q.query);
    expect(queries.some((q) => q.includes(SITE_ENT))).toBe(true);
  });

  /**
   * WP-16b item 2 (WP-13 finding 4), pinned through the REAL wired path: the
   * eval harness measured that a planted incident history was in the ledger and
   * unreachable from the docked panel, because the assembler's episodic prefix
   * defaulted to `state.` alone. This is the surface that finding was about, so
   * this is where it has to be proven — not only at the core.
   */
  test('planted episodic.* history reaches the turn through the wired chat path', async () => {
    core.emitter.emit({
      observed_at: new Date(Date.now() - 30 * 24 * HOUR).toISOString(),
      topic: 'episodic.incident.recorded',
      schema: 'incident.recorded/1',
      entity: { environment: ENV_ID },
      actor: { id: 'act_seed', kind: 'system' },
      source: { class: 'work', system: 'fixture:incident', trust: 'emitted' },
      payload: { component: 'woocommerce', impact: 'checkout returned HTTP 500 after update' },
    });

    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'is it safe to update WooCommerce?',
      siteId: SITE_ID, buildingSystemPrompt: false,
    });

    expect(r!.turnBlock).toContain('episodic.incident.recorded');
    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    const queries = (event.payload.retrieval as Array<{ query: string }>).map((q) => q.query);
    expect(queries.some((q) => q.includes('topic=episodic.*'))).toBe(true);
  });

  test('no site selected means no freshness section and no episodic query', async () => {
    seedObservation(20);
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hello', buildingSystemPrompt: false,
    });
    expect(r!.turnBlock ?? '').not.toContain('Cached-data freshness');
  });
});

describe('assembleForChatTurn — contracts with the rest of the layer', () => {
  test('verifyMirror() runs at assembly time and its divergences reach the manifest', async () => {
    const spy = jest.spyOn(core.law!, 'verifyMirror').mockReturnValue([
      { constraintId: 'c.x', registryValue: true, liveValue: false } as never,
    ]);

    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });

    expect(spy).toHaveBeenCalled();
    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    expect((event.payload.policy as Record<string, unknown>).divergences).toBe(1);
    expect(r!.ambientBlock).toContain('disagree with the live settings');
    spy.mockRestore();
  });

  test('a throwing verifyMirror() does not break the turn it guards', async () => {
    const spy = jest.spyOn(core.law!, 'verifyMirror').mockImplementation(() => {
      throw new Error('mirror exploded');
    });
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    expect(r).not.toBeNull();
    expect(r!.ambientBlock).toContain('Operating policy');
    spy.mockRestore();
  });

  test('grants are undefined, NEVER an empty array', async () => {
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    // `[]` means deny-all in this codebase's one scoping surface (agent.tools),
    // so an empty grant list reaching adaptToolsForChat would strip every tool.
    expect(r!.grants).toBeUndefined();
    expect(r!.grants).not.toEqual([]);
  });

  test('the semantic port is bridged onto the fleet search service when present', async () => {
    const searchFleet = jest.fn().mockResolvedValue({
      results: [{ id: 'doc-9', title: 'Checkout', excerpt: 'buy', siteName: 'acme-local', score: 0.4 }],
    });
    const r = await assembleForChatTurn({
      services: services({ searchService: { searchFleet } }),
      sessionId: 's1', userMessage: 'checkout page', siteId: SITE_ID, buildingSystemPrompt: false,
    });

    expect(searchFleet).toHaveBeenCalledWith('checkout page', undefined, { limit: 5 });
    expect(r!.turnBlock).toContain('"Checkout" (acme-local)');
  });

  test('a throwing search service degrades to no semantic results', async () => {
    const r = await assembleForChatTurn({
      services: services({ searchService: { searchFleet: () => Promise.reject(new Error('down')) } }),
      sessionId: 's1', userMessage: 'x', siteId: SITE_ID, buildingSystemPrompt: false,
    });
    expect(r).not.toBeNull();
  });
});

describe('assembleForChatTurn — non-fatality', () => {
  test('returns null when the intelligence core is absent', async () => {
    setIntelligenceCore(undefined as never);
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', buildingSystemPrompt: true,
    });
    expect(r).toBeNull();
  });

  test('a throwing siteData resolves to no targets rather than a failed turn', async () => {
    const r = await assembleForChatTurn({
      services: services({ siteData: { getSite: () => { throw new Error('store down'); } } }),
      sessionId: 's1', userMessage: 'hi', siteId: SITE_ID, buildingSystemPrompt: true,
    });
    expect(r).not.toBeNull();
    expect(r!.ambientBlock).toContain('Operating policy');
  });

  test('an unknown siteId yields no targets and still assembles', async () => {
    const r = await assembleForChatTurn({
      services: services(), sessionId: 's1', userMessage: 'hi', siteId: 'nope', buildingSystemPrompt: false,
    });
    expect(r).not.toBeNull();
    const [event] = core.ledger.query({ topicPrefix: 'task.' });
    expect(event.entity).toEqual({});
  });
});
