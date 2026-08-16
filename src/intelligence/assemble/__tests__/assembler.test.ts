/**
 * WP-11 · the context assembler, core side.
 *
 * Seed-once-assert-many: one fixture set of ports, driven through the request
 * variations that matter. The load-bearing assertions are the ones a future
 * change is most likely to break silently:
 *
 *   - ADR-20's hash re-assert (full set only on change or absence)
 *   - "state is never copied" — a twin VALUE must never reach the rendered text
 *   - the freshness prose contract, asserted verbatim
 *   - the token number is the estimator's output over the real blocks
 *   - the empty case produces NO text at all (the additive-parity precondition)
 */
import {
  assemble,
  estimateTokens,
  policyVersionHash,
  FRESHNESS_DISCLOSURE_CONTRACT,
} from '../assembler';
import { AssembleDeps, AssembleRequest, PolicyConstraintView } from '../types';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const HOUR = 3600_000;

const ENV = 'ent_env_0123456789ABCDEFGHJKMNPQRS';

function constraint(over: Partial<PolicyConstraintView> = {}) {
  return {
    id: 'c.production-writes-off',
    rule: 'Production writes are off by default;\n          enabling is a settings change.',
    enforcement: 'gateway' as const,
    origin: 'expertise' as const,
    docId: 'pol.ops-default',
    docVersion: '1.0.0',
    ...over,
  };
}

function lawPort(rows = [constraint(), constraint({ id: 'c.halted-stay-halted', enforcement: 'ambient' })]) {
  return {
    constraints: () => rows as never[],
    documents: () => [{ id: 'pol.ops-default', version: '1.0.0' }],
  };
}

/** ACF observed 20h ago (SLO 8h → stale); wp.version 2h ago (SLO 24h → fresh). */
function twinsPort() {
  const facts = [
    {
      entityId: ENV,
      fact: 'plugin:advanced-custom-fields',
      value: { version: '6.2.0' },
      observedAt: new Date(NOW.getTime() - 20 * HOUR).toISOString(),
      sourceTrust: 'observed' as const,
      eventId: 'evt_1',
    },
    {
      entityId: ENV,
      fact: 'wp.version',
      value: { version: '6.7.1' },
      observedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
      sourceTrust: 'observed' as const,
      eventId: 'evt_2',
    },
  ];
  return {
    forEntity: () => facts,
    freshness: (f: (typeof facts)[number]) => {
      const ageSeconds = Math.floor((NOW.getTime() - Date.parse(f.observedAt)) / 1000);
      const sloSeconds = f.fact.startsWith('plugin:') ? 8 * 3600 : 24 * 3600;
      return { ageSeconds, sloSeconds, fresh: ageSeconds <= sloSeconds };
    },
  };
}

function ledgerPort(captured: Record<string, unknown>[] = []) {
  return {
    query: (opts: Record<string, unknown>) => {
      captured.push(opts);
      return [
        {
          id: 'evt_01J5AAAAAAAAAAAAAAAAAAAAAA',
          recorded_at: NOW.toISOString(),
          observed_at: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
          topic: 'state.plugin.observed',
          schema: 'plugin.observed/1',
          entity: { environment: ENV },
          actor: { id: 'act_x', kind: 'system', via: 'sat_x' },
          source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
          access: { tenant: 'local' },
          payload: { slug: 'advanced-custom-fields', version: '6.2.0' },
        },
      ] as never[];
    },
  };
}

const wrapUntrusted = (c: string) => `<untrusted_data>\n${c}\n</untrusted_data>`;

function deps(over: Partial<AssembleDeps> = {}): AssembleDeps {
  return {
    law: lawPort(),
    ledger: ledgerPort(),
    twins: twinsPort(),
    now: () => NOW,
    wrapUntrusted,
    ...over,
  };
}

function request(over: Partial<AssembleRequest> = {}): AssembleRequest {
  return {
    actor: { id: 'act_test', kind: 'system', autonomy: 'interactive' },
    task: { id: 'task_01J5BBBBBBBBBBBBBBBBBBBBBB', intent: 'which plugins are outdated?' },
    targets: [{ role: 'environment', id: ENV, label: 'acme-local' }],
    surface: 'chat.docked-panel',
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('assemble — ambient policy (ADR-20)', () => {
  test('the full set rides the durable context when the caller is rebuilding it', async () => {
    const b = await assemble(
      request({ context: { rebuildingDurableContext: true } }),
      deps()
    );

    expect(b.blocks.ambient).toContain('c.production-writes-off');
    expect(b.blocks.ambient).toContain('c.halted-stay-halted');
    expect(b.manifest.policy?.asserted).toBe('full');
    // ...and the per-turn carrier does NOT repeat it.
    expect(b.blocks.turn).not.toContain('c.production-writes-off');
    expect(b.blocks.turn).toContain('remains in effect, unchanged');
  });

  test('a session already carrying the current hash gets the hash line only', async () => {
    // Read the hash off a real assembly rather than recomputing it here — a
    // test that re-derives the value it checks pins its own copy, not the code
    // (the WP-04b/WP-12b vacuous-copy pattern).
    const first = await assemble(request({ context: { rebuildingDurableContext: true } }), deps());
    const hash = first.ambient!.versionHash;

    const b = await assemble(request({ context: { policyVersionHash: hash } }), deps());

    expect(b.blocks.ambient).toBeNull();
    expect(b.blocks.turn).toContain(hash);
    expect(b.blocks.turn).toContain('remains in effect, unchanged');
    expect(b.blocks.turn).not.toContain('c.production-writes-off');
    expect(b.manifest.policy?.asserted).toBe('hash');
  });

  test('a stale carried hash re-ships the full set on the turn carrier', async () => {
    const b = await assemble(request({ context: { policyVersionHash: 'psv_stale000000' } }), deps());

    expect(b.blocks.turn).toContain('c.production-writes-off');
    expect(b.manifest.policy?.asserted).toBe('full');
  });

  test('the version hash is stable across calls and moves when rule text changes', async () => {
    const base = [constraint()];
    expect(policyVersionHash(base)).toBe(policyVersionHash([constraint()]));
    expect(policyVersionHash(base)).not.toBe(
      policyVersionHash([constraint({ rule: 'Production writes are allowed.' })])
    );
    // Registry ordering must not read as a policy change.
    const a = [constraint(), constraint({ id: 'c.b' })];
    expect(policyVersionHash(a)).toBe(policyVersionHash([...a].reverse()));
  });

  test('enforcement class is rendered, because ambient constraints bind the model itself', async () => {
    const b = await assemble(request({ context: { rebuildingDurableContext: true } }), deps());
    expect(b.blocks.ambient).toContain('[gateway] c.production-writes-off');
    expect(b.blocks.ambient).toContain('[ambient] c.halted-stay-halted');
  });

  test('a mirror divergence is disclosed rather than presented as certain policy', async () => {
    const b = await assemble(
      request({ context: { rebuildingDurableContext: true }, policyDivergences: 2 }),
      deps()
    );
    expect(b.blocks.ambient).toContain('2 constraint(s) above disagree with the live settings');
    expect(b.manifest.policy?.divergences).toBe(2);
  });
});

describe('assemble — state plane: disclosure, never copy', () => {
  test('stale facts are marked PAST SLO and fresh ones are not', async () => {
    const b = await assemble(request(), deps());

    expect(b.blocks.turn).toContain('plugin:advanced-custom-fields — last observed 20h ago (SLO 8h) — PAST SLO');
    expect(b.blocks.turn).toContain('wp.version — last observed 2h ago (SLO 1d)');
    expect(b.blocks.turn).not.toContain('wp.version — last observed 2h ago (SLO 1d) — PAST SLO');
  });

  test('a twin VALUE never reaches the rendered text', async () => {
    const b = await assemble(request(), deps());
    // The twin holds 6.7.1 / 6.2.0. Neither may be copied into context: §6.2
    // step 4 says state enters at execution time, stamped — not here.
    expect(b.blocks.turn).not.toContain('6.7.1');
    expect(b.blocks.ambient ?? '').not.toContain('6.7.1');
  });

  test('the freshness disclosure contract rides verbatim whenever facts are disclosed', async () => {
    const b = await assemble(request(), deps());
    expect(b.blocks.turn).toContain(FRESHNESS_DISCLOSURE_CONTRACT);
    expect(FRESHNESS_DISCLOSURE_CONTRACT).toMatch(/re-check it live/);
    expect(FRESHNESS_DISCLOSURE_CONTRACT).toMatch(/state how old the observation is/);
  });

  test('the manifest reports every disclosure, stale-first', async () => {
    const b = await assemble(request(), deps());
    expect(b.manifest.freshness_report).toHaveLength(2);
    expect(b.manifest.freshness_report[0].fresh).toBe(false);
    expect(b.manifest.freshness_report[0].served).toBe('twin');
    expect(b.manifest.freshness_report.every((r) => !('value' in r))).toBe(true);
  });

  test('the rendered list is capped and the remainder is counted, not dropped silently', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      entityId: ENV,
      fact: `plugin:p${i}`,
      value: {},
      observedAt: new Date(NOW.getTime() - 20 * HOUR).toISOString(),
      sourceTrust: 'observed' as const,
      eventId: `evt_${i}`,
    }));
    const b = await assemble(
      request({ retrieval: { freshnessLimit: 3 } }),
      deps({ twins: { forEntity: () => many, freshness: () => ({ ageSeconds: 72000, sloSeconds: 28800, fresh: false }) } })
    );
    expect(b.blocks.turn).toContain('(+17 further cached fact(s) not listed, 17 of them PAST SLO)');
  });
});

describe('assemble — retrieval', () => {
  test('the episodic slice queries newest-first and records the query in the manifest', async () => {
    const captured: Record<string, unknown>[] = [];
    const b = await assemble(request(), deps({ ledger: ledgerPort(captured) }));

    expect(captured[0]).toMatchObject({ entityId: ENV, topicPrefix: 'state.', order: 'desc' });
    const record = b.manifest.retrieval.find((r) => r.store === 'ledger');
    expect(record?.returned).toBe(1);
    expect(record?.ids).toEqual(['evt_01J5AAAAAAAAAAAAAAAAAAAAAA']);
  });

  test('episodic items carry provenance and the fact key, never the observed value', async () => {
    const b = await assemble(request(), deps());
    expect(b.blocks.turn).toContain('3h ago — state.plugin.observed — advanced-custom-fields');
    expect(b.blocks.turn).toContain('via wp-cli, trust: observed');
    expect(b.blocks.turn).not.toContain('6.2.0');
  });

  test('retrieved content is wrapped as untrusted data (R7)', async () => {
    const b = await assemble(request(), deps());
    expect(b.blocks.turn).toContain('<untrusted_data>');
    expect(b.blocks.turn).toContain('</untrusted_data>');
    // The policy and freshness prose stay OUTSIDE the wrapper — they are
    // platform-authored and the model must obey them.
    // lastIndexOf: the ambient prose mentions "<untrusted_data> regions" too,
    // so the FIRST occurrence is not the wrapper.
    const wrapped = b.blocks.turn!.slice(b.blocks.turn!.lastIndexOf('<untrusted_data>'));
    expect(wrapped).not.toContain(FRESHNESS_DISCLOSURE_CONTRACT);
  });

  test('with no untrusted-data wrapper, retrieved content is withheld and said to be withheld', async () => {
    const b = await assemble(request(), deps({ wrapUntrusted: undefined }));
    expect(b.blocks.turn).toContain('Retrieved context was omitted this turn');
    expect(b.blocks.turn).not.toContain('state.plugin.observed');
  });

  test('semantic hits are searched on the task intent and carry their site label', async () => {
    const search = jest.fn().mockResolvedValue([
      { id: 'doc-1', title: 'Checkout page', excerpt: 'buy now', label: 'acme-local', score: 0.8 },
    ]);
    const b = await assemble(request(), deps({ semantic: { search } }));

    expect(search).toHaveBeenCalledWith('which plugins are outdated?', [ENV], 5);
    expect(b.blocks.turn).toContain('"Checkout page" (acme-local) — buy now');
    expect(b.manifest.retrieval.find((r) => r.store === 'semantic')?.ids).toEqual(['doc-1']);
  });

  test('a throwing semantic store degrades to no semantic results, not to a failed turn', async () => {
    const b = await assemble(
      request(),
      deps({ semantic: { search: jest.fn().mockRejectedValue(new Error('index down')) } })
    );
    expect(b.retrieved.some((i) => i.store === 'ledger')).toBe(true);
    expect(b.retrieved.some((i) => i.store === 'semantic')).toBe(false);
  });
});

describe('assemble — manifest and budget', () => {
  test('the token number is the estimator applied to the blocks actually produced', async () => {
    const b = await assemble(
      request({ context: { rebuildingDurableContext: true }, budget: { tokens: 12000 } }),
      deps()
    );
    const expected = estimateTokens(b.blocks.ambient ?? '') + estimateTokens(b.blocks.turn ?? '');

    expect(b.manifest.budget.tokens_used).toBe(expected);
    expect(b.manifest.budget.tokens_used).toBeGreaterThan(0);
    expect(b.manifest.budget.of).toBe(12000);
    // The number must never read as a measurement or as a whole-prompt figure.
    expect(b.manifest.budget.method).toMatch(/estimate/i);
    expect(b.manifest.budget.scope).toMatch(/tool schemas/);
  });

  test('estimateTokens is proportional to length and never zero for non-empty text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });

  test('policy age is null, not a fabricated number', async () => {
    const b = await assemble(request(), deps());
    expect(b.manifest.policy?.age_s).toBeNull();
  });

  test('v0 grants nothing and pushes no procedure', async () => {
    const b = await assemble(request(), deps());
    expect(b.tools).toEqual([]);
    expect(b.procedure).toBeNull();
    expect(b.manifest.tools).toEqual([]);
    expect(b.manifest.procedure).toBeNull();
  });

  test('the manifest identifies the turn, the actor and the surface', async () => {
    const b = await assemble(request(), deps());
    expect(b.manifest.task).toBe('task_01J5BBBBBBBBBBBBBBBBBBBBBB');
    expect(b.manifest.bundle_id).toMatch(/^bun_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b.manifest.surface).toBe('chat.docked-panel');
    expect(b.manifest.actor_autonomy).toBe('interactive');
    expect(b.manifest.capability).toBeNull();
  });
});

describe('assemble — degraded and empty inputs', () => {
  test('with no law, no ledger and no twins the bundle renders NOTHING', async () => {
    // The precondition for the additive-parity pin: an empty bundle must
    // contribute no text at all, not an empty header.
    const b = await assemble(request({ context: { rebuildingDurableContext: true } }), {
      now: () => NOW,
    });

    expect(b.blocks.ambient).toBeNull();
    expect(b.blocks.turn).toBeNull();
    expect(b.manifest.policy).toBeNull();
    expect(b.manifest.budget.tokens_used).toBe(0);
    expect(b.failClosed).toBe(false);
  });

  test('a throwing law port degrades to no policy instead of taking the turn down', async () => {
    const b = await assemble(
      request(),
      deps({
        law: {
          constraints: () => {
            throw new Error('registry exploded');
          },
          documents: () => [],
        },
      })
    );
    expect(b.manifest.policy).toBeNull();
    expect(b.blocks.turn).not.toBeNull(); // freshness + retrieval still ride
  });

  test('no targets means no freshness and no episodic query', async () => {
    const captured: Record<string, unknown>[] = [];
    const b = await assemble(request({ targets: [] }), deps({ ledger: ledgerPort(captured) }));
    expect(captured).toHaveLength(0);
    expect(b.manifest.freshness_report).toEqual([]);
  });
});

describe('assemble — ADR-7 fail-closed', () => {
  test('an AUTONOMOUS actor with no policy set gets a refusal bundle, not a degraded one', async () => {
    const b = await assemble(
      request({ actor: { id: 'act_agent', kind: 'agent', autonomy: 'autonomous' } }),
      { now: () => NOW }
    );

    expect(b.failClosed).toBe(true);
    expect(b.manifest.fail_closed).toBe(true);
    expect(b.blocks.turn).toContain('REFUSAL');
    expect(b.blocks.turn).toContain('read-only');
    expect(b.tools).toEqual([]);
    expect(b.retrieved).toEqual([]);
  });

  test('an INTERACTIVE actor with no policy set proceeds — a human is present to judge', async () => {
    const b = await assemble(request(), deps({ law: undefined }));
    expect(b.failClosed).toBe(false);
    expect(b.manifest.fail_closed).toBeUndefined();
    expect(b.blocks.turn).toContain('Cached-data freshness');
  });

  test('an autonomous actor WITH a policy set is not failed closed', async () => {
    const b = await assemble(
      request({ actor: { id: 'act_agent', kind: 'agent', autonomy: 'autonomous' } }),
      deps()
    );
    expect(b.failClosed).toBe(false);
  });
});
