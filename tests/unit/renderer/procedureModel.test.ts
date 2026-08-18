/**
 * WP-27 · the renderer's half of the procedure seam — the rules, and the vocabulary.
 *
 * The one sentence everything here serves is the same one `procedureView.ts` serves:
 *
 *   > If the rail renders all eight checkpoints with the same green tick, the
 *   > product is lying.
 *
 * `procedureView.ts` (main) is the ONLY source of derivations, and this module is
 * its renderer-side consumer. Two things follow, and both are pinned below:
 *
 * 1. **The renderer may not import it as a VALUE.** Measured on this branch:
 *    requiring `procedureView` pulls `better-sqlite3`'s wrapper into the require
 *    graph (77 modules, 13 of them sqlite). In the renderer process that is a
 *    native module with the wrong ABI, thrown at import time, into a panel that
 *    predates the intelligence layer — the exact "must never break the legacy
 *    path" rule. So types come across as `import type` (elided) and the four
 *    values the surface needs are MIRRORED and pinned to the originals here.
 *    Same shape as `localDay` and `effectiveCadenceExpression`, for the same
 *    reason: two bundles that cannot share a runtime, one rule that must not drift.
 * 2. **Nothing is derived twice.** `verifiableCount` is read, never recomputed;
 *    the narrative count is its arithmetic complement, so the two can never
 *    disagree; the tick count and the ticks come from ONE predicate.
 */
import {
  ATTEST_WORDS,
  BADGE_LABEL,
  applyProcedureEvent,
  armedByPhrase,
  checkpointBadge,
  checkpointMark,
  denominatorLine,
  emptyProcedureState,
  hasProcedureSurface,
  isVerified,
  runIsFinished,
  showsTick,
  stepNoun,
} from '../../../src/renderer/components/DockedPanel/procedureModel';
import type {
  CheckpointState,
  DeclaredProcedure,
} from '../../../src/main/intelligence-host/procedureView';
import * as seam from '../../../src/main/intelligence-host/procedureView';
import { armedFixture, fakeProcedureStream, abortedFixture } from '../../../src/renderer/components/DockedPanel/procedureStream.fake';

function state(over: Partial<CheckpointState> = {}): CheckpointState {
  return {
    id: 'cp.backup',
    status: 'pending',
    attest: 'event',
    verified: false,
    reason: null,
    source: 'runbook',
    unrequested: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1 · The mirror is pinned to the seam (the localDay / effectiveCadence pattern)
// ---------------------------------------------------------------------------

describe('the renderer mirror cannot drift from procedureView', () => {
  it('carries the seam ATTEST_WORDS verbatim — the model and the human read one sentence', () => {
    expect(ATTEST_WORDS).toEqual(seam.ATTEST_WORDS);
  });

  it('carries the seam badge label verbatim', () => {
    expect(BADGE_LABEL).toBe(seam.BADGE_LABEL);
  });

  it('agrees with the seam on the badge, over every mark x reason combination', () => {
    // WP-28. The mirror's whole risk is that one copy learns a rule and the other
    // does not: if `checkpointBadge` here still returned a badge unconditionally,
    // the rail would badge all eight while the seam badged four, and only the
    // rail is what a human reads.
    const table = [
      state({ unrequested: true, reason: 'one low-risk site first' }),
      state({ unrequested: true, reason: null }),
      state({ unrequested: false, reason: 'before anything writes' }),
      state({ unrequested: false, reason: null }),
    ];
    for (const s of table) {
      expect(checkpointBadge(s)).toEqual(seam.checkpointBadge(s));
    }
    // Not vacuous: the table must contain both answers.
    expect(table.filter((s) => checkpointBadge(s) !== null)).toHaveLength(2);
    expect(table.filter((s) => checkpointBadge(s) === null)).toHaveLength(2);
  });

  it('agrees with the seam predicate on every status x attest combination', () => {
    const statuses: CheckpointState['status'][] = ['pending', 'active', 'attested', 'skipped', 'aborted'];
    const attests: CheckpointState['attest'][] = ['event', 'manifest', 'narrative'];
    const table = statuses.flatMap((status) => attests.map((attest) => state({ status, attest })));
    expect(table).toHaveLength(15);
    for (const s of table) {
      expect(isVerified(s)).toBe(seam.isVerified(s));
    }
    // Not vacuous: the table must contain both answers.
    expect(table.some((s) => isVerified(s))).toBe(true);
    expect(table.some((s) => !isVerified(s))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 · The tick
// ---------------------------------------------------------------------------

describe('a tick is rendered from the platform proof and nothing else', () => {
  it('ticks an attested, provable checkpoint', () => {
    expect(showsTick(state({ status: 'attested', attest: 'event', verified: true }))).toBe(true);
    expect(checkpointMark(state({ status: 'attested', attest: 'event', verified: true }))).toBe('✓');
  });

  it('refuses the tick for a narrative checkpoint even when the event claims verified', () => {
    // A hostile or buggy emitter is outside `procedureView`'s guarantee: the fold
    // cannot produce this, but a stream event is data from elsewhere. This is
    // where the lie stops on the renderer side too.
    const hostile = state({ id: 'cp.canary', status: 'attested', attest: 'narrative', verified: true });
    expect(showsTick(hostile)).toBe(false);
    expect(checkpointMark(hostile)).not.toBe('✓');
  });

  it('refuses the tick when the declaration allows it but the platform did not prove it', () => {
    const unproved = state({ status: 'attested', attest: 'event', verified: false });
    expect(showsTick(unproved)).toBe(false);
    expect(checkpointMark(unproved)).not.toBe('✓');
  });

  it('gives every non-ticked status its own mark, so a rail is never uniform', () => {
    const marks = new Set([
      checkpointMark(state({ status: 'pending' })),
      checkpointMark(state({ status: 'active' })),
      checkpointMark(state({ status: 'aborted' })),
      checkpointMark(state({ status: 'attested', attest: 'narrative' })),
      checkpointMark(state({ status: 'attested', attest: 'event', verified: true })),
    ]);
    expect(marks.size).toBeGreaterThanOrEqual(4);
    expect(marks.has('✓')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 · The denominator line
// ---------------------------------------------------------------------------

function procedure(over: Partial<DeclaredProcedure> = {}): DeclaredProcedure {
  return {
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    version: '1.0.0',
    strictness: 'strict',
    hash: 'sha256:abc',
    armedBy: 'predicate',
    checkpoints: [],
    verifiableCount: 0,
    communication: [],
    ...over,
  };
}

describe('the denominator line', () => {
  const eight = () => [
    state({ id: 'cp.consult-history', attest: 'manifest', status: 'attested', verified: true }),
    state({ id: 'cp.dry-run', attest: 'narrative' }),
    state({ id: 'cp.approval', attest: 'event', status: 'attested', verified: true }),
    state({ id: 'cp.backup', attest: 'event', status: 'active' }),
    state({ id: 'cp.canary', attest: 'narrative' }),
    state({ id: 'cp.verify-canary', attest: 'narrative' }),
    state({ id: 'cp.roll-fleet', attest: 'event' }),
    state({ id: 'cp.report', attest: 'narrative' }),
  ];

  it('counts proof against the provable denominator and names what can never be proved', () => {
    const line = denominatorLine(procedure({ checkpoints: eight(), verifiableCount: 4 }));
    expect(line).toBe('2 of 4 provable checkpoints attested · 4 on the agent’s account only');
  });

  it('never says "verified" of a checkpoint — Controlled Vocabulary v1.1', () => {
    const line = denominatorLine(procedure({ checkpoints: eight(), verifiableCount: 4 }));
    expect(line).not.toMatch(/verif/i);
  });

  it('reads the armed denominator rather than recomputing it', () => {
    // v6 Q3: `verifiableCount` does not move under a run. A renderer that counted
    // non-narrative checkpoints itself would silently disagree with the archived
    // denominator the moment a diff arrived carrying anything unexpected.
    const line = denominatorLine(procedure({ checkpoints: eight(), verifiableCount: 3 }));
    expect(line).toBe('2 of 3 provable checkpoints attested · 5 on the agent’s account only');
  });

  it('drops the narrative clause when every checkpoint is provable', () => {
    const cps = [
      state({ id: 'a', attest: 'event', status: 'attested', verified: true }),
      state({ id: 'b', attest: 'event' }),
    ];
    expect(denominatorLine(procedure({ checkpoints: cps, verifiableCount: 2 })))
      .toBe('1 of 2 provable checkpoints attested');
  });

  it('says checkpoints for a strict runbook and steps for a guided one (ADR-17 am. 2)', () => {
    const cps = [state({ id: 'a', attest: 'event' })];
    expect(denominatorLine(procedure({ checkpoints: cps, verifiableCount: 1, strictness: 'strict' })))
      .toContain('provable checkpoint attested');
    expect(denominatorLine(procedure({ checkpoints: cps, verifiableCount: 1, strictness: 'guided' })))
      .toContain('provable step attested');
    expect(stepNoun('strict')).toBe('checkpoint');
    expect(stepNoun('guided')).toBe('step');
  });

  it('says nothing at all when there is nothing to count', () => {
    expect(denominatorLine(procedure())).toBeNull();
  });

  it('agrees with the ticks it claims to count', () => {
    const p = procedure({ checkpoints: eight(), verifiableCount: 4 });
    const ticks = p.checkpoints.filter(showsTick).length;
    expect(denominatorLine(p)!.startsWith(`${ticks} of `)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4 · The reducer — the seam the fake and the real emitter both feed
// ---------------------------------------------------------------------------

describe('applyProcedureEvent', () => {
  it('renders nothing at all until something arms', () => {
    const empty = emptyProcedureState();
    expect(empty.procedure).toBeNull();
    expect(empty.abort).toBeNull();
    expect(hasProcedureSurface(empty)).toBe(false);
  });

  it('takes the whole declaration from the armed event', () => {
    const next = applyProcedureEvent(emptyProcedureState(), armedFixture());
    expect(next.procedure!.runbookId).toBe('rb.bulk-plugin-update');
    expect(next.procedure!.checkpoints).toHaveLength(8);
    expect(next.procedure!.verifiableCount).toBe(4);
    expect(hasProcedureSurface(next)).toBe(true);
  });

  it('applies a diff in place, preserving declared order', () => {
    const armed = applyProcedureEvent(emptyProcedureState(), armedFixture());
    const before = armed.procedure!.checkpoints.map((c) => c.id);
    const next = applyProcedureEvent(armed, {
      type: 'checkpoint_changed',
      changed: [
        { ...armed.procedure!.checkpoints[3], status: 'attested', verified: true },
        { ...armed.procedure!.checkpoints[0], status: 'attested', verified: true },
      ],
    });
    expect(next.procedure!.checkpoints.map((c) => c.id)).toEqual(before);
    expect(next.procedure!.checkpoints[3].status).toBe('attested');
    expect(next.procedure!.checkpoints[0].status).toBe('attested');
  });

  it('never lets a diff move the armed denominator', () => {
    const armed = applyProcedureEvent(emptyProcedureState(), armedFixture());
    const next = applyProcedureEvent(armed, {
      type: 'checkpoint_changed',
      changed: [{ ...armed.procedure!.checkpoints[1], attest: 'event', status: 'attested', verified: true }],
    });
    expect(next.procedure!.verifiableCount).toBe(4);
  });

  it('never lets a diff introduce a checkpoint the declaration did not list', () => {
    // The declaration is the document a human reviewed. A step that appears
    // mid-run without being declared is the half-adherence lie arriving by the
    // back door — the surface must not be the place it gets in.
    const armed = applyProcedureEvent(emptyProcedureState(), armedFixture());
    const next = applyProcedureEvent(armed, {
      type: 'checkpoint_changed',
      changed: [state({ id: 'cp.smuggled', status: 'attested', verified: true })],
    });
    expect(next.procedure!.checkpoints.map((c) => c.id)).not.toContain('cp.smuggled');
    expect(next.procedure!.checkpoints).toHaveLength(8);
  });

  it('ignores a diff that arrives with nothing armed rather than inventing a rail', () => {
    const empty = emptyProcedureState();
    const next = applyProcedureEvent(empty, { type: 'checkpoint_changed', changed: [state({ id: 'cp.backup' })] });
    expect(next.procedure).toBeNull();
    expect(hasProcedureSurface(next)).toBe(false);
  });

  it('keeps the abort notice beside the declaration it halted', () => {
    const armed = applyProcedureEvent(emptyProcedureState(), armedFixture());
    const next = applyProcedureEvent(armed, abortedFixture());
    expect(next.abort!.abortId).toBe(abortedFixture().abortId);
    expect(next.procedure).not.toBeNull();
  });

  it('clears a previous run’s abort when a new procedure arms', () => {
    const aborted = applyProcedureEvent(
      applyProcedureEvent(emptyProcedureState(), armedFixture()),
      abortedFixture(),
    );
    expect(applyProcedureEvent(aborted, armedFixture()).abort).toBeNull();
  });

  it('passes every other chat stream event through untouched', () => {
    // The three events ride the stream the panel already consumes. A reducer that
    // reacted to `token` would corrupt the rail on every keystroke of output.
    const armed = applyProcedureEvent(emptyProcedureState(), armedFixture());
    for (const other of [{ type: 'token', text: 'hi' }, { type: 'done' }, { type: 'tool_call_start' }, {}, null]) {
      expect(applyProcedureEvent(armed, other as never)).toBe(armed);
    }
  });
});

// ---------------------------------------------------------------------------
// 5 · Collapsing (RB-A2) and the arming phrase
// ---------------------------------------------------------------------------

describe('a finished run folds', () => {
  it('is unfinished while any checkpoint is still ahead', () => {
    expect(runIsFinished(procedure({ checkpoints: [state({ status: 'attested', verified: true }), state({ status: 'active' })] }))).toBe(false);
  });

  it('is finished when every checkpoint reached a terminal status', () => {
    expect(runIsFinished(procedure({
      checkpoints: [
        state({ id: 'a', status: 'attested', verified: true }),
        state({ id: 'b', status: 'aborted' }),
        state({ id: 'c', status: 'skipped' }),
      ],
    }))).toBe(true);
  });

  it('is not "finished" when there are no checkpoints at all', () => {
    // A refusal declares no rail. Calling that a finished run would report a
    // completed procedure where none ran.
    expect(runIsFinished(procedure({ checkpoints: [] }))).toBe(false);
  });
});

describe('why the ceremony appeared', () => {
  it('gives each arming reason its own sentence', () => {
    const phrases = (['predicate', 'model-request', 'late-gate'] as const).map(armedByPhrase);
    expect(new Set(phrases).size).toBe(3);
    for (const p of phrases) expect((p ?? '').length).toBeGreaterThan(0);
  });

  it('says nothing when the platform did not record a reason', () => {
    expect(armedByPhrase(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6 · The fake emitter is a source, not a shape
// ---------------------------------------------------------------------------

describe('the fake emitter', () => {
  it('emits the three shapes in run order', async () => {
    const seen: string[] = [];
    const stream = fakeProcedureStream();
    stream.subscribe((e) => seen.push(e.type));
    await stream.play();
    expect(seen[0]).toBe('procedure_armed');
    expect(seen).toContain('checkpoint_changed');
    expect(seen[seen.length - 1]).toBe('procedure_aborted');
  });

  it('drives the same reducer state as the identical events applied by hand', () => {
    // The point of the seam: WP-26 swaps the source and nothing downstream moves.
    const stream = fakeProcedureStream();
    const byHand = stream.events().reduce(applyProcedureEvent, emptyProcedureState());
    let bySubscription = emptyProcedureState();
    stream.subscribe((e) => { bySubscription = applyProcedureEvent(bySubscription, e); });
    return stream.play().then(() => {
      expect(bySubscription).toEqual(byHand);
    });
  });

  it('is shaped like what the seam actually derives, key for key', () => {
    // A fixture that drifts from `deriveDeclaredProcedure`'s output would let the
    // surface be built against a procedure the platform never emits.
    const derived = seam.deriveDeclaredProcedure({
      outcome: {
        status: 'armed',
        capability: 'cap.bulk_plugin_update',
        runbookId: 'rb.bulk-plugin-update',
        version: '1.0.0',
        strictness: 'strict',
        hash: 'sha256:abc',
        armedBy: 'predicate',
      } as never,
    })!;
    expect(Object.keys(armedFixture().procedure).sort()).toEqual(Object.keys(derived).sort());
  });
});
