/**
 * WP-18 · Unit pins for the real-ledger replay's invariants.
 *
 * The replay itself runs against the developer's own ledger — the messiest
 * fixture this project will ever have (TESTING_STRATEGY.md layer 6) — and is
 * therefore un-runnable in CI and unpinnable by a fixture. What CAN be pinned
 * is every judgement it makes: each check is a pure function over data the
 * driver hands it, and each is pinned here BOTH ways — it fires on the broken
 * shape and stays quiet on the healthy one.
 *
 * The both-ways discipline is the point. A checker that returns `[]`
 * unconditionally passes every "healthy" pin, and a replay built on one would
 * certify a broken ledger — the precise shape of this project's vacuous-test
 * findings.
 */
import {
  checkDriftEvent,
  checkMonotonicIds,
  checkTwinCounts,
  checkTwinRow,
  diffTwinSets,
  TwinRow,
} from './invariants';

// ---------------------------------------------------------------------------
// Monotonic ids
// ---------------------------------------------------------------------------

describe('checkMonotonicIds', () => {
  it('accepts strictly increasing ULIDs', () => {
    expect(checkMonotonicIds(['01AAA', '01AAB', '01AAC'])).toEqual([]);
  });

  it('flags a decreasing pair and names both ids', () => {
    const violations = checkMonotonicIds(['01AAC', '01AAB']);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('01AAC');
    expect(violations[0]).toContain('01AAB');
  });

  it('flags a duplicate — equal is not increasing', () => {
    // The ledger's primary key makes this unreachable through `append`, but
    // the replay reads rows, not appends: if it ever sees one, the ULID
    // ordering that every cursor depends on is broken.
    expect(checkMonotonicIds(['01AAA', '01AAA'])).toHaveLength(1);
  });

  it('accepts an empty or single-element ledger', () => {
    expect(checkMonotonicIds([])).toEqual([]);
    expect(checkMonotonicIds(['01AAA'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Drift events
// ---------------------------------------------------------------------------

function driftEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01DRIFT',
    topic: 'state.drift.detected',
    schema: 'drift.detected/2',
    observed_at: '2026-08-16T10:00:00.000Z',
    entity: { environment: 'env_abc' },
    actor: { id: 'act_fold_state_twin', kind: 'system' },
    source: { class: 'platform', system: 'fold:state-twin', trust: 'derived' },
    causation: '01CAUSE',
    payload: {
      fact: 'plugin:akismet',
      previous: { version: '5.3', active: true },
      observed: { version: '5.3.1', active: true },
      previous_observed_at: '2026-08-14T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('checkDriftEvent', () => {
  it('accepts a well-formed v2 drift event', () => {
    expect(checkDriftEvent(driftEvent())).toEqual([]);
  });

  it('accepts a v1 drift event without previous_observed_at', () => {
    // v1 predates WP-03's field. Demanding it would report every historical
    // drift event in a real ledger as malformed — a false red on real data.
    const v1 = driftEvent({
      schema: 'drift.detected/1',
      payload: {
        fact: 'plugin:akismet',
        previous: { version: '5.3' },
        observed: { version: '5.3.1' },
      },
    });
    expect(checkDriftEvent(v1)).toEqual([]);
  });

  it('accepts the historical actor id the earlier fold stamped', () => {
    // MEASURED, not guessed. The first real-ledger replay (2026-08-17, 9,332
    // events) found 328 of 365 drift events carrying actor.id
    // `act_fold_plugin_twin` at schema drift.detected/1, and 37 carrying
    // `act_fold_state_twin` at /2 — the actor id was renamed alongside the
    // schema bump. All 365 already carried source.system `fold:state-twin`.
    // A checker that knows only today's actor id reports a developer's whole
    // drift history as malformed: a false red on real data, which is the one
    // failure mode a layer-6 check must not have.
    const historical = driftEvent({
      schema: 'drift.detected/1',
      actor: { id: 'act_fold_plugin_twin', kind: 'system' },
      payload: {
        fact: 'site.core',
        previous: { wp_version: '7.0.3' },
        observed: { wp_version: '7.0.4' },
      },
    });
    expect(checkDriftEvent(historical)).toEqual([]);
  });

  it('still flags an actor id belonging to no known fold', () => {
    // The point of accepting two is that it is a SET, not "anything goes".
    const impostor = driftEvent({ actor: { id: 'act_somebody_else', kind: 'system' } });
    expect(checkDriftEvent(impostor).join(' ')).toContain('act_somebody_else');
  });

  it('requires previous_observed_at at v2 — the field WP-03 added', () => {
    const missing = driftEvent({
      payload: { fact: 'plugin:akismet', previous: {}, observed: {} },
    });
    expect(checkDriftEvent(missing).join(' ')).toContain('previous_observed_at');
  });

  it('accepts a null previous or observed — a first or vanished fact', () => {
    expect(
      checkDriftEvent(
        driftEvent({
          payload: {
            fact: 'plugin:akismet',
            previous: null,
            observed: { version: '1.0' },
            previous_observed_at: '2026-08-14T10:00:00.000Z',
          },
        })
      )
    ).toEqual([]);
  });

  it('flags a missing fact — a drift notice that names no fact says nothing', () => {
    const noFact = driftEvent({
      payload: { previous: {}, observed: {}, previous_observed_at: '2026-08-14T10:00:00.000Z' },
    });
    expect(checkDriftEvent(noFact).join(' ')).toContain('fact');
  });

  it('flags a missing entity — an unattributed drift notice cannot be acted on', () => {
    expect(checkDriftEvent(driftEvent({ entity: {} })).join(' ')).toContain('entity');
  });

  it('flags a missing causation — provenance back to the observation is the point', () => {
    expect(checkDriftEvent(driftEvent({ causation: undefined })).join(' ')).toContain('causation');
  });

  it('flags the wrong producer system', () => {
    const impostor = driftEvent({ source: { class: 'platform', system: 'graph-sync', trust: 'derived' } });
    expect(checkDriftEvent(impostor).join(' ')).toContain('fold:state-twin');
  });

  it('flags an unparseable observed_at', () => {
    expect(checkDriftEvent(driftEvent({ observed_at: 'yesterday' })).join(' ')).toContain('observed_at');
  });

  it('collects every reason, not just the first', () => {
    const wrecked = driftEvent({ entity: {}, causation: undefined, payload: {} });
    expect(checkDriftEvent(wrecked).length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Twin rows
// ---------------------------------------------------------------------------

function twin(overrides: Partial<TwinRow> = {}): TwinRow {
  return {
    entity_id: 'env_abc',
    fact: 'plugin:akismet',
    value: '{"version":"5.3.1","active":true}',
    observed_at: '2026-08-16T10:00:00.000Z',
    source_trust: 'observed',
    event_id: '01EVENT',
    ...overrides,
  };
}

describe('checkTwinRow', () => {
  it('accepts a well-formed fact', () => {
    expect(checkTwinRow(twin())).toEqual([]);
  });

  it('flags an empty entity id', () => {
    expect(checkTwinRow(twin({ entity_id: '' })).join(' ')).toContain('entity_id');
  });

  it('flags an unparseable observed_at — freshness computes from it', () => {
    expect(checkTwinRow(twin({ observed_at: 'soon' })).join(' ')).toContain('observed_at');
  });

  it('flags a trust class outside the vocabulary', () => {
    expect(checkTwinRow(twin({ source_trust: 'vibes' })).join(' ')).toContain('source_trust');
  });

  it('flags a value that is not JSON', () => {
    expect(checkTwinRow(twin({ value: 'not json' })).join(' ')).toContain('value');
  });

  it('flags a missing provenance pointer', () => {
    expect(checkTwinRow(twin({ event_id: '' })).join(' ')).toContain('event_id');
  });
});

// ---------------------------------------------------------------------------
// Sanity bounds
// ---------------------------------------------------------------------------

describe('checkTwinCounts — the stated sanity bounds', () => {
  it('accepts a plausible fold result', () => {
    expect(
      checkTwinCounts({ twins: 400, stateObservations: 9000, entities: 60 })
    ).toEqual([]);
  });

  it('flags zero twins folded from a non-empty stream of observations', () => {
    // The M1 shape, one layer in: events arriving, nothing materialising.
    expect(
      checkTwinCounts({ twins: 0, stateObservations: 9000, entities: 0 }).join(' ')
    ).toContain('no twin facts');
  });

  it('accepts zero twins from zero observations — an empty ledger is not a fault', () => {
    expect(checkTwinCounts({ twins: 0, stateObservations: 0, entities: 0 })).toEqual([]);
  });

  it('flags more twins than observations — every fact needs an observation behind it', () => {
    // twin_facts is an upsert keyed by (entity, fact), so it can never exceed
    // the number of observations that wrote it. More means rows arrived from
    // somewhere other than the fold — the direct-write invariant, broken.
    expect(
      checkTwinCounts({ twins: 10, stateObservations: 9, entities: 3 }).join(' ')
    ).toContain('more twin facts (10) than state observations (9)');
  });

  it('flags twins spread over zero entities', () => {
    expect(
      checkTwinCounts({ twins: 5, stateObservations: 100, entities: 0 }).join(' ')
    ).toContain('entities');
  });
});

// ---------------------------------------------------------------------------
// The determinism claim
// ---------------------------------------------------------------------------

describe('diffTwinSets — replayed vs live', () => {
  it('reports no difference for identical sets', () => {
    const set = [twin(), twin({ fact: 'theme:twentytwentyfour' })];
    const diff = diffTwinSets(set, [...set]);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
    expect(diff.differing).toEqual([]);
    expect(diff.identical).toBe(true);
  });

  it('is order-independent — the fold order is not the comparison', () => {
    const a = [twin(), twin({ fact: 'theme:x' })];
    expect(diffTwinSets(a, [a[1], a[0]]).identical).toBe(true);
  });

  it('reports a fact the replay failed to produce', () => {
    const diff = diffTwinSets([twin(), twin({ fact: 'theme:x' })], [twin()]);
    expect(diff.missing).toEqual(['env_abc / theme:x']);
    expect(diff.identical).toBe(false);
  });

  it('reports a fact the replay produced that live does not have', () => {
    const diff = diffTwinSets([twin()], [twin(), twin({ entity_id: 'env_zzz' })]);
    expect(diff.extra).toEqual(['env_zzz / plugin:akismet']);
  });

  it('reports a value that differs, naming the field', () => {
    const diff = diffTwinSets([twin()], [twin({ value: '{"version":"9.9.9"}' })]);
    expect(diff.differing).toHaveLength(1);
    expect(diff.differing[0]).toContain('value');
    expect(diff.identical).toBe(false);
  });

  it('reports a differing provenance pointer — same value, wrong event', () => {
    // The value can match while the fact points at a different event; that is
    // still a fold that did not reproduce, and provenance is the whole claim.
    const diff = diffTwinSets([twin()], [twin({ event_id: '01OTHER' })]);
    expect(diff.differing[0]).toContain('event_id');
  });

  it('reports a differing observed_at', () => {
    const diff = diffTwinSets([twin()], [twin({ observed_at: '2020-01-01T00:00:00.000Z' })]);
    expect(diff.differing[0]).toContain('observed_at');
  });
});
