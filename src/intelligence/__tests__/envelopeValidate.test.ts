/**
 * fixes-082526 · Tier A 4a — the envelope validator gets its own suite.
 *
 * `validateEnvelope` is the structural gate at the ledger boundary — nothing
 * enters without provenance, freshness, and access — and until now it was
 * tested only INCIDENTALLY, through whichever emitter and producer suites
 * happened to route valid drafts past it. Nothing pinned what it REFUSES,
 * which is the half that is the gate.
 *
 * Every rejection case below mutates ONE field of a known-good envelope, so
 * a failure names the exact gate that loosened.
 */
import { validateEnvelope } from '../envelope/validate';
import { EventEnvelope } from '../envelope/types';

const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function good(): EventEnvelope {
  return {
    id: `evt_${ULID}`,
    recorded_at: '2026-08-20T10:00:00.000Z',
    observed_at: '2026-08-20T09:59:58.000Z',
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: `ent_env_${ULID}` },
    actor: { id: 'act_wp_webhook', kind: 'system', via: 'sat_test_machine' },
    source: { class: 'platform', system: 'wp-webhook', trust: 'observed' },
    access: { tenant: 'local' },
    payload: { slug: 'akismet', version: '5.3' },
  };
}

describe('validateEnvelope — what passes', () => {
  it('accepts a complete envelope and returns it structurally intact', () => {
    expect(validateEnvelope(good())).toEqual(good());
  });

  it('accepts optional correlation/causation in their pinned shapes, and sensitivity', () => {
    const e = {
      ...good(),
      correlation: `task_${ULID}`,
      causation: `evt_${ULID}`,
      access: { tenant: 'local', client: 'acme', sensitivity: 'security' as const },
    };
    expect(validateEnvelope(e)).toEqual(e);
  });

  it('accepts every declared topic family — the closed vocabulary, all seven', () => {
    for (const family of ['state', 'semantic', 'procedure', 'policy', 'episodic', 'task', 'control']) {
      expect(() => validateEnvelope({ ...good(), topic: `${family}.thing.observed` })).not.toThrow();
    }
  });
});

describe('validateEnvelope — what it refuses (the half that is the gate)', () => {
  const refusals: Array<[string, (e: EventEnvelope) => unknown]> = [
    ['an id without the evt_ prefix', (e) => ({ ...e, id: ULID })],
    ['an id with a non-ULID body', (e) => ({ ...e, id: 'evt_hello' })],
    ['a recorded_at that is not a datetime', (e) => ({ ...e, recorded_at: 'yesterday' })],
    ['an observed_at that is not a datetime', (e) => ({ ...e, observed_at: '2026-08-20' })],
    ['a topic outside the closed families', (e) => ({ ...e, topic: 'gossip.plugin.observed' })],
    ['a two-segment topic', (e) => ({ ...e, topic: 'state.plugin' })],
    ['a schema with no version', (e) => ({ ...e, schema: 'plugin.observed' })],
    ['an entity value that is not an ent_ id', (e) => ({ ...e, entity: { environment: 'site-42' } })],
    ['an actor kind outside the enum', (e) => ({ ...e, actor: { ...e.actor, kind: 'robot' } })],
    ['an actor with no via', (e) => ({ ...e, actor: { id: 'act_x', kind: 'system' } })],
    ['a source class outside the model', (e) => ({ ...e, source: { ...e.source, class: 'rumor' } })],
    ['a trust word outside the model', (e) => ({ ...e, source: { ...e.source, trust: 'vibes' } })],
    ['a missing access block', (e) => ({ ...e, access: undefined })],
    ['a correlation that is not task_<ULID>', (e) => ({ ...e, correlation: `corr_${ULID}` })],
    ['a causation that is not evt_<ULID>', (e) => ({ ...e, causation: `task_${ULID}` })],
    ['an unknown extra key — .strict() is load-bearing', (e) => ({ ...e, vibe: 'good' })],
    ['a non-object payload', (e) => ({ ...e, payload: 'stuff happened' })],
    ['a non-object entirely', () => 'not an envelope'],
  ];

  it.each(refusals)('refuses %s', (_name, mutate) => {
    expect(() => validateEnvelope(mutate(good()))).toThrow();
  });
});
