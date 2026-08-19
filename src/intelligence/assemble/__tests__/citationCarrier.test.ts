/**
 * WP-34 · the citation convention on the carrier (ADR-24 P2, ADR-20's cadence).
 *
 * Four things are pinned here, and each one is a rule that would be invisible
 * if it broke:
 *
 *   - the convention rides as versioned policy: full text once, one line after
 *   - it sits AFTER the law that outranks it and BEFORE the evidence it is
 *     about, because an instruction that trails its own subject gets read after
 *     the answer is written
 *   - it never turns an empty carrier into a non-empty one (additive parity —
 *     `blocks.turn === null` is what every pre-WP-34 caller's tests assert)
 *   - what rode and what is citable are ONE list, so `[[cite:carrier:x]]`
 *     cannot resolve against a section that never rendered
 */
import { assemble } from '../assembler';
import { AssembleDeps, AssembleRequest, PolicyConstraintView } from '../types';
import {
  CITATION_CONVENTION_VERSION,
  CITATION_CONVENTION_BODY,
} from '../../citation/convention';
import { supplyFromBundle, resolveCitations } from '../../citation/resolve';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const HOUR = 3600_000;
const ENV = 'ent_env_0123456789ABCDEFGHJKMNPQRS';
const EVT = 'evt_01J5AAAAAAAAAAAAAAAAAAAAAA';

function constraint(over: Partial<PolicyConstraintView> = {}) {
  return {
    id: 'c.production-writes-off',
    rule: 'Production writes are off by default.',
    enforcement: 'gateway' as const,
    origin: 'expertise' as const,
    docId: 'pol.ops-default',
    docVersion: '1.0.0',
    ...over,
  };
}

const lawPort = () => ({
  constraints: () => [constraint()] as never[],
  documents: () => [{ id: 'pol.ops-default', version: '1.0.0' }],
});

const ledgerPort = () => ({
  query: () =>
    [
      {
        id: EVT,
        recorded_at: NOW.toISOString(),
        observed_at: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
        topic: 'episodic.incident.recorded',
        schema: 'incident.recorded/1',
        entity: { environment: ENV },
        actor: { id: 'act_x', kind: 'system', via: 'sat_x' },
        source: { class: 'platform', system: 'sentinel', trust: 'emitted' },
        access: { tenant: 'local' },
        payload: { finding: 'checkout returned 500' },
      },
    ] as never[],
});

const wrapUntrusted = (c: string) => `<untrusted_data>\n${c}\n</untrusted_data>`;

function deps(over: Partial<AssembleDeps> = {}): AssembleDeps {
  return { law: lawPort(), ledger: ledgerPort(), now: () => NOW, wrapUntrusted, ...over };
}

function request(over: Partial<AssembleRequest> = {}): AssembleRequest {
  return {
    actor: { id: 'act_test', kind: 'system', autonomy: 'interactive' },
    task: { id: 'task_01J5BBBBBBBBBBBBBBBBBBBBBB', intent: 'any issues with this site?' },
    targets: [{ role: 'environment', id: ENV, label: 'acme-local' }],
    surface: 'chat.docked-panel',
    ...over,
  };
}

describe('the convention rides as versioned policy (ADR-20)', () => {
  test('the full instruction block rides when the actor is not carrying this version', async () => {
    const b = await assemble(request(), deps());
    expect(b.blocks.turn).toContain(CITATION_CONVENTION_BODY);
    expect(b.blocks.turn).toContain(CITATION_CONVENTION_VERSION);
  });

  test('a carried version re-asserts in ONE line instead of re-shipping the block', async () => {
    const b = await assemble(
      request({ context: { citationConventionHash: CITATION_CONVENTION_VERSION } }),
      deps()
    );
    expect(b.blocks.turn).not.toContain(CITATION_CONVENTION_BODY);
    expect(b.blocks.turn).toContain(
      `Citation convention ${CITATION_CONVENTION_VERSION} remains in effect, unchanged.`
    );
  });

  test('a STALE carried version re-ships the block in full', async () => {
    const b = await assemble(
      request({ context: { citationConventionHash: 'cnv_000000000000' } }),
      deps()
    );
    expect(b.blocks.turn).toContain(CITATION_CONVENTION_BODY);
  });

  test('rebuilding the durable context does NOT suppress it, unlike policy', async () => {
    // The convention never rides the system prompt, so there is no other copy
    // for the carrier to defer to. Same reasoning as `procedureHash`.
    const b = await assemble(request({ context: { rebuildingDurableContext: true } }), deps());
    expect(b.blocks.turn).toContain(CITATION_CONVENTION_BODY);
  });
});

describe('placement', () => {
  test('after the law that outranks it, before the evidence it is about', async () => {
    const turn = (await assemble(request(), deps())).blocks.turn ?? '';
    const policyAt = turn.indexOf('c.production-writes-off');
    const conventionAt = turn.indexOf('How to cite what you say');
    const evidenceAt = turn.indexOf('Prior activity for the current target');
    expect(policyAt).toBeGreaterThanOrEqual(0);
    expect(conventionAt).toBeGreaterThan(policyAt);
    expect(evidenceAt).toBeGreaterThan(conventionAt);
  });
});

describe('additive parity — an empty carrier stays empty', () => {
  test('with nothing else to say, no carrier rides and no convention is taught', async () => {
    const b = await assemble(request(), { now: () => NOW });
    expect(b.blocks.turn).toBeNull();
    expect(b.blocks.turnSections).toEqual([]);
  });

  test('a fail-closed refusal offers no citable carrier line', async () => {
    const b = await assemble(
      request({ actor: { id: 'act_a', kind: 'agent', autonomy: 'autonomous' } }),
      { now: () => NOW }
    );
    expect(b.failClosed).toBe(true);
    expect(b.blocks.turnSections).toEqual([]);
  });
});

describe('what rode and what is citable are one list', () => {
  test('turnSections names every section that rendered, in order', async () => {
    const b = await assemble(request(), deps());
    expect(b.blocks.turnSections).toEqual(['policy', 'citation-convention', 'retrieved']);
  });

  test('the convention block itself is not citable — it is instruction, not evidence', async () => {
    const b = await assemble(request(), deps());
    const supply = supplyFromBundle(b);
    expect(supply.carrierLines.map((c) => c.key)).toEqual(['policy', 'retrieved']);
    expect(
      resolveCitations('x [[cite:carrier:citation-convention]]', supply)[0].state
    ).toBe('cited-but-unresolvable');
  });

  test('the supply carries the retrieved events by id, with topic and trust verbatim', async () => {
    const b = await assemble(request(), deps());
    const supply = supplyFromBundle(b);
    expect(supply.events).toEqual([
      { id: EVT, topic: 'episodic.incident.recorded', trust: 'emitted' },
    ]);

    const [r] = resolveCitations(`Checkout returned 500s. [[cite:${EVT}]]`, supply);
    expect(r.state).toBe('cited-and-resolves');
    if (r.state !== 'cited-and-resolves') throw new Error('unreachable');
    expect(r.record.trust).toBe('emitted');
  });

  test('a section that did not render this turn does not resolve', async () => {
    const supply = supplyFromBundle(await assemble(request(), deps()));
    // No procedure was armed, so there is no procedure section to cite.
    expect(resolveCitations('x [[cite:carrier:procedure]]', supply)[0].state).toBe(
      'cited-but-unresolvable'
    );
  });
});

describe('the manifest records which convention governed the reply (owner-ratified)', () => {
  test('full assertion is recorded as full', async () => {
    const b = await assemble(request(), deps());
    expect(b.manifest.citation).toEqual({
      convention: CITATION_CONVENTION_VERSION,
      asserted: 'full',
    });
  });

  test('a hash re-assert is recorded as hash — the ADR-20 claim, stated not implied', async () => {
    const b = await assemble(
      request({ context: { citationConventionHash: CITATION_CONVENTION_VERSION } }),
      deps()
    );
    expect(b.manifest.citation).toEqual({
      convention: CITATION_CONVENTION_VERSION,
      asserted: 'hash',
    });
  });

  test('null when no convention rode — never a version the actor never saw', async () => {
    // The audit claim is "convention vX was IN EFFECT for this reply". A turn
    // that taught nothing and re-asserted nothing put no convention in effect,
    // and recording one would be the manifest asserting a fact about the reply
    // that the reply's own carrier contradicts.
    const empty = await assemble(request(), { now: () => NOW });
    expect(empty.blocks.turn).toBeNull();
    expect(empty.manifest.citation).toBeNull();

    const refused = await assemble(
      request({ actor: { id: 'act_a', kind: 'agent', autonomy: 'autonomous' } }),
      { now: () => NOW }
    );
    expect(refused.failClosed).toBe(true);
    expect(refused.manifest.citation).toBeNull();
  });

  test('the manifest cannot disagree with the carrier — one decision, read back', async () => {
    // Not a recomputation of "was it full or hash": the field is read off the
    // SAME section array the carrier joined. A second evaluation of the
    // condition is how a manifest starts claiming one thing while the text
    // says another.
    for (const carried of [undefined, CITATION_CONVENTION_VERSION]) {
      const b = await assemble(request({ context: { citationConventionHash: carried } }), deps());
      const rodeFull = (b.blocks.turn ?? '').includes(CITATION_CONVENTION_BODY);
      expect(b.manifest.citation?.asserted).toBe(rodeFull ? 'full' : 'hash');
    }
  });
});
