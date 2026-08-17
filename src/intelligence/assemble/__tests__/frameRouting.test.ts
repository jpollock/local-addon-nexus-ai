/**
 * WP-21 · the task frame and per-type routing (ADR-22), core side.
 *
 * ADR-22 makes the §4 routing table normative and puts it in exactly ONE place:
 * `assemble()`. These tests pin the two halves of that claim.
 *
 *   1. **Absent frame ⇒ nothing changes.** The parity pin runs in BOTH
 *      directions: with no frame, every collector sees `req.targets` and the
 *      manifest carries no routing record at all; with a frame, it does. A
 *      frame that quietly altered the no-frame path would break every shipped
 *      caller, and "the collectors behave identically" is only checkable by
 *      fingerprinting the queries they actually made.
 *
 *   2. **Each plane resolves to its own home, and says which.** Routing that
 *      is invisible is indistinguishable from no routing — the manifest is the
 *      audit artifact (§6.4), so the routed ids land there, and the turn block
 *      states the provenance the model is obliged to relay (S2).
 *
 * The audience plane is the honest-absence case: instruments are M4, so it
 * resolves and then reports that nothing is connected, rather than routing to
 * production and returning silence that reads as "no visitors".
 */
import { assemble, ROUTING_TABLE, NO_INSTRUMENT_SOURCE } from '../assembler';
import { AssembleDeps, AssembleRequest, RoutingRecord, TaskFrame } from '../types';

const NOW = new Date('2026-08-17T12:00:00.000Z');
const HOUR = 3600_000;

const COPY = 'ent_env_0123456789ABCDEFGHJKMNPQRS';
const SITE = 'ent_site_0123456789ABCDEFGHJKMNPQ';
const PROD = 'ent_env_9876543210ZYXWVTSRQPNMKJ';

/** What every shipped caller sends today: the copy AND its logical Site. */
const DUAL_TARGETS = [
  { role: 'environment', id: COPY, label: 'acme-local' },
  { role: 'site', id: SITE, label: 'acme-local' },
];

const FRAME: TaskFrame = {
  workingCopy: { role: 'working_copy', id: COPY, label: 'acme-local' },
  site: { role: 'site', id: SITE, label: 'Alpine Outfitters' },
  production: { role: 'environment', id: PROD, label: 'alpine-prod' },
};

interface Captured {
  ledger: Array<{ entityId?: string; topicPrefix?: string }>;
  twins: string[];
  semantic: string[][];
}

function captured(): Captured {
  return { ledger: [], twins: [], semantic: [] };
}

/** One fact per entity, named after its entity, so a disclosure names its source. */
function twinsPort(cap: Captured) {
  return {
    forEntity: (entityId: string) => {
      cap.twins.push(entityId);
      return [
        {
          entityId,
          fact: `plugin:only-on-${entityId === COPY ? 'copy' : entityId === PROD ? 'prod' : 'site'}`,
          value: { version: '1.0.0' },
          observedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
          sourceTrust: 'observed' as const,
          eventId: 'evt_1',
        },
      ];
    },
    freshness: () => ({ ageSeconds: 7200, sloSeconds: 28800, fresh: true }),
  };
}

/**
 * An event stamped with the COPY only — no `site` role. This is not a synthetic
 * edge case: `bootstrap.ts`'s drift emission stamps `{ environment }` alone, and
 * events already on disk can never be re-stamped, so Site-scoped episodic
 * retrieval that queried the Site id alone would go dark on that producer.
 */
function ledgerPort(cap: Captured) {
  return {
    query: (opts: { entityId?: string; topicPrefix?: string }) => {
      cap.ledger.push({ entityId: opts.entityId, topicPrefix: opts.topicPrefix });
      if (opts.entityId !== COPY || opts.topicPrefix !== 'state.') return [] as never[];
      return [
        {
          id: 'evt_01J5AAAAAAAAAAAAAAAAAAAAAA',
          recorded_at: NOW.toISOString(),
          observed_at: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
          topic: 'state.drift.detected',
          schema: 'drift.detected/1',
          entity: { environment: COPY },
          actor: { id: 'act_x', kind: 'system' },
          source: { class: 'platform', system: 'fold:state-twin', trust: 'derived' },
          access: { tenant: 'local' },
          payload: { fact: 'plugin:acf' },
        },
      ] as never[];
    },
  };
}

function semanticPort(cap: Captured) {
  return {
    search: async (_q: string, entityIds: string[]) => {
      cap.semantic.push(entityIds);
      return [{ id: 'doc-1', title: 'Checkout', label: 'alpine-prod' }];
    },
  };
}

function deps(cap: Captured, over: Partial<AssembleDeps> = {}): AssembleDeps {
  return {
    ledger: ledgerPort(cap),
    twins: twinsPort(cap),
    semantic: semanticPort(cap),
    now: () => NOW,
    wrapUntrusted: (c: string) => `<untrusted_data>\n${c}\n</untrusted_data>`,
    ...over,
  };
}

function request(over: Partial<AssembleRequest> = {}): AssembleRequest {
  return {
    actor: { id: 'act_test', kind: 'system', autonomy: 'interactive' },
    task: { id: 'task_01J5BBBBBBBBBBBBBBBBBBBBBB', intent: 'what changed here?' },
    targets: DUAL_TARGETS,
    surface: 'chat.docked-panel',
    ...over,
  };
}

function recordFor(routing: RoutingRecord[] | undefined, plane: string): RoutingRecord {
  const found = (routing ?? []).find((r) => r.plane === plane);
  if (!found) throw new Error(`no routing record for ${plane}`);
  return found;
}

// ---------------------------------------------------------------------------
// 1 · Parity — both directions
// ---------------------------------------------------------------------------

describe('the frame is optional, and its absence changes nothing', () => {
  test('with no frame every collector sees req.targets, exactly as it did before', async () => {
    const cap = captured();
    await assemble(request(), deps(cap));

    // The fingerprint of today's behaviour: one query per target per prefix,
    // both targets' twins, and the semantic search scoped to both target ids.
    expect(cap.ledger).toEqual([
      { entityId: COPY, topicPrefix: 'state.' },
      { entityId: COPY, topicPrefix: 'episodic.' },
      { entityId: SITE, topicPrefix: 'state.' },
      { entityId: SITE, topicPrefix: 'episodic.' },
    ]);
    expect(cap.twins).toEqual([COPY, SITE]);
    expect(cap.semantic).toEqual([[COPY, SITE]]);
  });

  test('with no frame the manifest carries no routing record and the block no routing text', async () => {
    const cap = captured();
    const bundle = await assemble(request(), deps(cap));

    expect('routing' in bundle.manifest).toBe(false);
    expect(bundle.blocks.turn ?? '').not.toContain('Where this turn');
    expect(bundle.blocks.turn ?? '').not.toContain(NO_INSTRUMENT_SOURCE);
  });

  test('with a frame the manifest DOES carry the routing record — the other direction', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));

    expect('routing' in bundle.manifest).toBe(true);
    expect((bundle.manifest.routing ?? []).map((r) => r.plane).sort()).toEqual([
      'audience',
      'episodic',
      'semantic',
      'state',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2 · The table, per plane
// ---------------------------------------------------------------------------

describe('ADR-22 · each type resolves to its own home', () => {
  test('the shipped table is the §4 table', () => {
    expect(ROUTING_TABLE).toEqual({
      state: 'workingCopy',
      episodic: 'site',
      semantic: 'production',
      audience: 'production',
    });
  });

  test('state routes to the copy alone — a copy\'s state is its own', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));

    expect(cap.twins).toEqual([COPY]);
    expect(bundle.manifest.freshness_report.map((f) => f.entityId)).toEqual([COPY]);
    expect(recordFor(bundle.manifest.routing, 'state')).toMatchObject({
      slot: 'workingCopy',
      entityIds: [COPY],
    });
  });

  test('episodic routes to the Site — and keeps the copy in scope, because not every producer stamps the Site role', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));

    const episodicIds = cap.ledger.map((q) => q.entityId);
    expect(episodicIds).toContain(SITE);
    // The witness: the fixture's only event is stamped `{ environment: COPY }`,
    // the shape `bootstrap.ts` emits. Querying the Site id alone would lose it.
    expect(episodicIds).toContain(COPY);
    expect(bundle.retrieved.map((i) => i.title)).toContain('state.drift.detected');
    // Production is NOT an episodic scope: another environment's history reaches
    // the turn through the Site, not by querying that environment directly.
    expect(episodicIds).not.toContain(PROD);
    expect(recordFor(bundle.manifest.routing, 'episodic')).toMatchObject({ slot: 'site' });
  });

  test('semantic routes to the live site — content is canonical where it is authored', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));

    expect(cap.semantic).toEqual([[PROD]]);
    expect(recordFor(bundle.manifest.routing, 'semantic')).toMatchObject({
      slot: 'production',
      entityIds: [PROD],
    });
  });

  test('with no live site on record, semantic falls back to the copy AND says it fell back', async () => {
    const cap = captured();
    const bundle = await assemble(
      request({ frame: { workingCopy: FRAME.workingCopy, site: FRAME.site } }),
      deps(cap)
    );

    expect(cap.semantic).toEqual([[COPY]]);
    expect(recordFor(bundle.manifest.routing, 'semantic')).toMatchObject({
      slot: 'production',
      servedBy: 'workingCopy',
      entityIds: [COPY],
    });
  });

  test('audience is reserved: it resolves, retrieves nothing, and reports why', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));

    const audience = recordFor(bundle.manifest.routing, 'audience');
    expect(audience.slot).toBe('production');
    expect(audience.entityIds).toEqual([PROD]);
    expect(audience.unavailable).toBe(NO_INSTRUMENT_SOURCE);
    // Nothing was retrieved for it, and the block says so rather than leaving
    // the model to read silence as "this site has no visitors".
    expect(bundle.blocks.turn).toContain(NO_INSTRUMENT_SOURCE);
  });

  test('a caller may override one plane; the rest keep the table', async () => {
    const cap = captured();
    const bundle = await assemble(
      request({ frame: { ...FRAME, routing: { semantic: 'site' } } }),
      deps(cap)
    );

    expect(cap.semantic).toEqual([[SITE]]);
    expect(recordFor(bundle.manifest.routing, 'semantic').slot).toBe('site');
    expect(recordFor(bundle.manifest.routing, 'state').slot).toBe('workingCopy');
  });

  test('an empty frame routes every plane to the request targets, and records that', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: {} }), deps(cap));

    expect(cap.twins).toEqual([COPY, SITE]);
    expect(recordFor(bundle.manifest.routing, 'state')).toMatchObject({
      servedBy: 'targets',
      entityIds: [COPY, SITE],
    });
  });
});

// ---------------------------------------------------------------------------
// 3 · The rendered provenance (S2 — the answer names its source)
// ---------------------------------------------------------------------------

describe('the routing disclosure the model relays', () => {
  test('every plane names its source by label, never by id', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));
    const turn = bundle.blocks.turn ?? '';

    expect(turn).toContain('Where this turn');
    expect(turn).toContain('your copy — acme-local');
    expect(turn).toContain('Alpine Outfitters');
    expect(turn).toContain('the live site — alpine-prod');
    // Ids are unreadable and unrelayable: a label is what a reply can quote.
    for (const line of turn.split('\n').filter((l) => l.startsWith('- Where') || l.includes('routed'))) {
      expect(line).not.toContain('ent_');
    }
  });

  test('the disclosure never uses a word the user vocabulary forbids', async () => {
    const cap = captured();
    const bundle = await assemble(request({ frame: FRAME }), deps(cap));
    const section = (bundle.blocks.turn ?? '')
      .split('\n\n')
      .find((s) => s.includes('Where this turn')) ?? '';

    expect(section).not.toBe('');
    for (const forbidden of ['entity', 'lineage', 'divergence', 'frame', 'upstream', 'working copy']) {
      expect(section.toLowerCase()).not.toContain(forbidden);
    }
  });

  test('a frame with only a copy still renders honestly and never invents a live site', async () => {
    const cap = captured();
    const bundle = await assemble(
      request({ frame: { workingCopy: FRAME.workingCopy } }),
      deps(cap)
    );
    const turn = bundle.blocks.turn ?? '';

    expect(turn).toContain('your copy — acme-local');
    expect(turn).not.toContain('the live site —');
    expect(turn).toContain(NO_INSTRUMENT_SOURCE);
    // The fallback STATES itself: content served from the copy, presented without
    // that clause, would read as the canonical source — right words, wrong place.
    expect(turn).toContain('nothing on record names a live site for this one');
  });
});

// ---------------------------------------------------------------------------
// 4 · Non-fatality
// ---------------------------------------------------------------------------

describe('routing degrades, never throws', () => {
  test('a frame whose slots are all absent leaves the bundle intact', async () => {
    const cap = captured();
    const bundle = await assemble(request({ targets: [], frame: {} }), deps(cap));
    expect(bundle.failClosed).toBe(false);
    expect(bundle.manifest.freshness_report).toEqual([]);
  });

  test('a throwing twins port under routing costs the plane, not the turn', async () => {
    const cap = captured();
    const bundle = await assemble(
      request({ frame: FRAME }),
      deps(cap, {
        twins: {
          forEntity: () => {
            throw new Error('twins down');
          },
          freshness: () => ({ ageSeconds: 0, sloSeconds: 1, fresh: true }),
        },
      })
    );
    expect(bundle.manifest.freshness_report).toEqual([]);
    expect(bundle.manifest.routing).toBeDefined();
  });
});
