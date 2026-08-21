/**
 * WP-48 · THE RATIFIED SENTENCE SET, AND THE TWO COPIES OF ITS SELECTION RULE.
 *
 * The designer's fixture carries each class's guard as a STRING, in their own
 * words. `sessionRegistry`'s `guardHolds` carries the same rule as TypeScript.
 * Production never evaluates the string — running a string from a file inside
 * the main process is a code-execution surface, not a design choice — so the
 * two copies could drift in silence, exactly the way `resolveAgentCron` and
 * `effectiveCadenceExpression` could before a shared case table pinned them.
 *
 * THIS FILE IS THAT TABLE. Every ratified guard is evaluated here, in the test
 * sandbox, over a case set that reaches every arm of every guard — including
 * the arms no shipped row can produce — and the TypeScript selector is asserted
 * to agree on every case. A divergence is a red test, not a wrong sentence in
 * front of a customer.
 *
 * IT ALSO DRIVES THE SELECTOR DIRECTLY, which WP-46 made non-optional: a render
 * test cannot pin a guard the render never reaches, and four of these five
 * classes have corners the current fleet cannot supply. The emitter-driven
 * cases — the ones that prove the fold produces these classes from real events
 * — live in `sessionRegistry.test.ts` beside the emitters they need.
 *
 * The generator's own refusals are driven here too, against copies of the
 * designer's file with one thing broken in each. A guard nothing can reach is a
 * guard nothing can check.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';

// WP-55 · the generator's own guard, imported so it can be driven in BOTH
// directions. `DEFERRED_IDS` lives in the generator, so `--fixture` — which
// replaces the INPUT — cannot reach it; the function is the only surface that
// can be exercised, and a guard nothing can reach is a guard nothing checks.
import { assertDeferralsStillHold, KNOWN_SLOTS } from '../../../../scripts/generate-situation-copy';

import {
  contradictedByTheRecord,
  fillSituationSentence,
  guardHolds,
  listVerdict,
  type UnheldRow,
  selectSituationTemplate,
  type SituationClassInput,
  type Situation,
} from '../sessionRegistry';
import {
  ACCOUNTING,
  COLOURS,
  DOORS,
  FRESHNESS,
  LIST_VERDICT,
  RESERVED,
  RUN_NOUN,
  SITUATION_COPY_SHAPE_VERSION,
  SITUATION_TEMPLATES,
} from '../situationCopy.generated';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-situation-copy.ts');
const GENERATED = path.join(REPO_ROOT, 'src', 'main', 'intelligence-host', 'situationCopy.generated.ts');
const FIXTURE_JS = path.join(
  REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'fixtures', 'situation-headlines.js',
);

const gate = (checkpointId = 'cp.approval') => ({
  checkpointId, index: 3, of: 8, awaits: 'approval' as const, runbookId: 'rb.x', capability: 'cap.x',
});

/**
 * A bag every headline can be filled from, so `selectSituationTemplate`'s
 * fillability check never masks a guard result in the agreement table. The
 * unfillable cases get their own tests below.
 */
const FULL_BAG = {
  runNoun: 'A plugin update run', done: 1, failed: 0, total: 2, age: '4h',
  checkpoint: 'cp.approval', position: '3 of 8', awaits: 'approval',
  target: 'ent_env_X', finding: 'checkout returned 500', agentId: 'security-sentinel',
  timeout: '90s', runbookId: 'rb.x', producer: 'act_security_sentinel',
  // WP-55 · `incident.coalesced`'s four. Present here for the same reason every
  // other slot is: the agreement table pins GUARDS, and an unfillable headline
  // would mask a guard result behind a fillability check. The unfillable cases
  // get their own tests.
  leadFinding: 'Known backdoor plugin detected: wp-compat', restCount: 3,
  memberCount: 4, linkKind: 'one scan',
};

/**
 * THE CASE TABLE. Every arm of every guard, and every near-miss beside it.
 *
 * The near-misses are the point: a guard that fired one case too wide would
 * still agree with a table of only its own positive cases.
 */
const CASES: Array<{ name: string; input: SituationClassInput }> = [
  // --- run.waiting.nothing-written, and its near-misses --------------------
  { name: 'run, nothing written, empty selection, ungated', input: { kind: 'run', done: 0, failed: 0, total: 0, gate: null, runId: 's1' } },
  // The WP-48 ruling's belt-and-suspenders clause: same counts, but GATED.
  { name: 'run, nothing written, empty selection, GATED', input: { kind: 'run', done: 0, failed: 0, total: 0, gate: gate(), runId: 's1' } },
  // NULL is the third state and it is neither of the other two: "nothing
  // selected anything" is not "a selection chose nothing". 36 of 36 manifests
  // on the developer's live ledger are in this state.
  { name: 'run, nothing written, NO scope recorded, ungated', input: { kind: 'run', done: 0, failed: 0, total: null, gate: null, runId: 's1' } },
  { name: 'run, nothing written, NO scope recorded, gated', input: { kind: 'run', done: 0, failed: 0, total: null, gate: gate(), runId: 's1' } },
  { name: 'run, part done, NO scope recorded, gated', input: { kind: 'run', done: 1, failed: 0, total: null, gate: gate(), runId: 's1' } },
  { name: 'run, one done, no targets', input: { kind: 'run', done: 1, failed: 0, total: 0, gate: null, runId: 's1' } },
  { name: 'run, one failed, no targets', input: { kind: 'run', done: 0, failed: 1, total: 0, gate: null, runId: 's1' } },

  // --- run.waiting.mid-procedure, and the ungated near-miss ----------------
  { name: 'run, nothing written, targets, gated', input: { kind: 'run', done: 0, failed: 0, total: 3, gate: gate(), runId: 's1' } },
  { name: 'run, nothing written, targets, UNgated', input: { kind: 'run', done: 0, failed: 0, total: 3, gate: null, runId: 's1' } },

  // --- run.waiting.part-changed: the class no shipped fleet row produces ---
  { name: 'run, part done, gated', input: { kind: 'run', done: 1, failed: 0, total: 3, gate: gate(), runId: 's1' } },
  { name: 'run, part failed, gated', input: { kind: 'run', done: 0, failed: 2, total: 3, gate: gate(), runId: 's1' } },
  { name: 'run, both, gated', input: { kind: 'run', done: 2, failed: 1, total: 3, gate: gate(), runId: 's1' } },
  { name: 'run, part done, UNgated', input: { kind: 'run', done: 1, failed: 0, total: 3, gate: null, runId: 's1' } },

  // --- incident.no-run, and the linked incident that is not a row ----------
  { name: 'incident, no run', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null } },
  { name: 'incident, linked to a run', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: 's1' } },

  // --- incident.coalesced (WP-55), and the two near-misses that separate its
  // --- two clauses. The pair matters: `memberCount > 1` and
  // --- `linkKind !== null` are not redundant, and a table exercising only
  // --- their conjunction would agree with a guard that dropped either one.
  { name: 'incident, four members, linked', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null, memberCount: 4, linkKind: 'correlation' } },
  { name: 'incident, four members, NO link — a fold nothing justified', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null, memberCount: 4, linkKind: null } },
  { name: 'incident, ONE member, linked — a group of one is not a group', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null, memberCount: 1, linkKind: 'correlation' } },
  { name: 'incident, two members, linked, and joined to a run', input: { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: 's1', memberCount: 2, linkKind: 'correlation' } },

  // --- agent.stuck: WP-54a gave it a producer; these are still its ONLY
  // --- exercise of the corners the producer cannot supply ------------------
  { name: 'agent failure', input: { kind: 'agentFailure', done: 0, failed: 0, total: 0, gate: null, runId: null } },
  { name: 'agent failure with writes', input: { kind: 'agentFailure', done: 4, failed: 1, total: 5, gate: gate(), runId: 's1' } },
];

/**
 * Evaluate a ratified guard string exactly as written.
 *
 * `new Function` is confined to this file on purpose: the whole reason the
 * production selector is TypeScript is that the string must never be executed
 * in the main process. Here it is the reference implementation, and the
 * sandbox is the only place it is allowed to run.
 */
function evaluateGuard(guard: string, input: SituationClassInput): boolean {
  // WP-54's merge · `memberCount` joined the harness because the designer's
  // cycle-seven sheet split the incident classes on it. It is supplied to BOTH
  // sides — the string here and the selector below — and a row that folded
  // nothing is a situation of one, which is why an absent count reads as 1 on
  // both sides rather than only on the TypeScript one.
  // WP-55 · `linkKind` joined `row` because `incident.coalesced`'s ratified
  // guard reads `row.linkKind !== null`. Supplied to BOTH sides — the string
  // here and the selector below — and absent reads as null on both, because a
  // row that folded nothing was made one thing by nothing.
  const row = { kind: input.kind, runId: input.runId, linkKind: input.linkKind ?? null };
  const memberCount = input.memberCount ?? 1;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'row', 'done', 'failed', 'total', 'gate', 'memberCount',
    `return (${guard});`,
  );
  return fn(row, input.done, input.failed, input.total, input.gate, memberCount) === true;
}

describe('the guards — two copies of one rule, pinned together', () => {
  test('null total is a THIRD state — neither guard reads it as a count', () => {
    // JavaScript agrees with the intent by coercion (`null === 0` and
    // `null > 0` are both false), which is why the ratified guard strings need
    // no amendment for it — but "the language happens to do the right thing" is
    // exactly the kind of claim that should be pinned rather than trusted.
    const noScope: SituationClassInput =
      { kind: 'run', done: 0, failed: 0, total: null, gate: null, runId: 's1' };
    expect(SITUATION_TEMPLATES.filter((t) => guardHolds(t, noScope))).toEqual([]);
    expect(selectSituationTemplate(noScope, FULL_BAG)).toBeNull();
    // …and the fixture's own strings say the same thing.
    for (const t of SITUATION_TEMPLATES) expect(evaluateGuard(t.guard, noScope)).toBe(false);
  });

  test('the ratified guard STRING and the TypeScript selector agree on every case', () => {
    const disagreements: string[] = [];
    for (const template of SITUATION_TEMPLATES) {
      for (const c of CASES) {
        const fromString = evaluateGuard(template.guard, c.input);
        const fromCode = guardHolds(template, c.input);
        if (fromString !== fromCode) {
          disagreements.push(`${template.id} × "${c.name}": fixture says ${fromString}, code says ${fromCode}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  test('the table is not vacuous — every guard is reached BOTH ways by it', () => {
    // Without this, a table of all-false cases would "agree" perfectly and pin
    // nothing at all. Each guard must be satisfied by at least one case and
    // refused by at least one.
    for (const template of SITUATION_TEMPLATES) {
      const results = CASES.map((c) => evaluateGuard(template.guard, c.input));
      expect({ id: template.id, holds: results.includes(true), refuses: results.includes(false) })
        .toEqual({ id: template.id, holds: true, refuses: true });
    }
  });

  test('the five guards are MUTUALLY EXCLUSIVE — brute-forced, not inspected', () => {
    // THE CLAIM THIS REPLACES WAS WRONG, and a mutation battery is what caught
    // it. The first version of this file said the order was load-bearing
    // because `nothing-written` and `mid-procedure` overlap on
    // `done === 0 && failed === 0`. They cannot: one needs `total === 0`, the
    // other `total > 0`. Reversing the selection order therefore changes
    // nothing, and the battery's reordering mutation SURVIVED — correctly.
    //
    // So the real property is exclusivity, and it is proven over the whole
    // input domain rather than over a hand-picked table. If a sixth class ever
    // does overlap a fifth, this fails and says which two — instead of leaving
    // the order silently load-bearing, which is what the wrong comment would
    // have done.
    //
    // WP-55 · THE SWEEP GAINED TWO DIMENSIONS, and it had to. `incident.no-run`
    // and `incident.coalesced` are separated ONLY by `memberCount` and
    // `linkKind`; a sweep blind to both would have found them overlapping on
    // every incident input, or — worse, and this is the real risk — would have
    // gone on reporting no overlap while never varying the one field that
    // decides between them.
    const overlaps: string[] = [];
    for (const kind of ['run', 'incident', 'agentFailure'] as const) {
      for (const done of [0, 1, 2]) for (const failed of [0, 1, 2]) for (const total of [0, 1, 2, null]) {
        for (const g of [null, gate()]) for (const runId of [null, 's1']) {
          for (const memberCount of [undefined, 1, 2, 4]) for (const linkKind of [null, 'correlation'] as const) {
            const input: SituationClassInput = { kind, done, failed, total, gate: g, runId, memberCount, linkKind };
            const holding = SITUATION_TEMPLATES.filter((t) => guardHolds(t, input));
            if (holding.length > 1) {
              overlaps.push(`${JSON.stringify({ kind, done, failed, total, gated: g !== null, runId, memberCount, linkKind })} → ${holding.map((t) => t.id).join(' + ')}`);
            }
          }
        }
      }
    }
    expect(overlaps).toEqual([]);
    // Not vacuous: the same sweep must actually select something, often.
    let selected = 0;
    for (const c of CASES) if (SITUATION_TEMPLATES.some((t) => guardHolds(t, c.input))) selected += 1;
    expect(selected).toBeGreaterThan(5);
  });

  test('the ratified set is the SIX, in the fixture\'s order', () => {
    // WP-55 · `incident.coalesced` joined it. It was DECLARED in the fixture and
    // deferred by the generator until its four host fields existed; they exist
    // now, and `assertDeferralsStillHold` is what would have failed the build
    // had the entry been left behind.
    expect(SITUATION_TEMPLATES.map((t) => t.id)).toEqual([
      'run.waiting.nothing-written',
      'run.waiting.mid-procedure',
      'run.waiting.part-changed',
      'incident.no-run',
      'incident.coalesced',
      'agent.stuck',
    ]);
    const midProcedure: SituationClassInput =
      { kind: 'run', done: 0, failed: 0, total: 3, gate: gate(), runId: 's1' };
    expect(selectSituationTemplate(midProcedure, FULL_BAG)?.id).toBe('run.waiting.mid-procedure');
  });

  test('every case selects at most one class, and the classes it selects are the ones that held', () => {
    for (const c of CASES) {
      const selected = selectSituationTemplate(c.input, FULL_BAG);
      const holding = SITUATION_TEMPLATES.filter((t) => guardHolds(t, c.input));
      expect({ case: c.name, selected: selected?.id ?? null })
        .toEqual({ case: c.name, selected: holding[0]?.id ?? null });
    }
  });

  test('agent.stuck is selectable, AND the fold can now produce its input', () => {
    // WP-54a AMENDED THIS PIN, and the amendment is the finding it closes.
    //
    // It used to read "…and nothing in this fold can produce its input", with
    // the note that this file was the ONLY thing reaching the class. That was
    // true when it was written and it is the shape the architect's finding 4
    // named: "a class the designer specified, the fold cannot emit, and the
    // only reason it is on screen at all is the duplication defect that WP-54
    // is about to remove." A pin that states an absence must be amended the day
    // the absence is filled, or it becomes a test asserting the opposite of the
    // code.
    //
    // The selector half is unchanged and still belongs here (WP-46: drive the
    // builder directly). The producer half now lives in
    // `agentStuckSituation.test.ts`, ledger-driven end to end.
    const stuck: SituationClassInput =
      { kind: 'agentFailure', done: 0, failed: 0, total: 0, gate: null, runId: null };
    expect(selectSituationTemplate(stuck, FULL_BAG)?.id).toBe('agent.stuck');
    // `Situation.kind` carries `agentFailure` now — the one-word change that
    // made the class reachable.
    const kinds: Array<Situation['kind']> = ['session', 'incident', 'agentFailure'];
    expect(kinds).toContain('agentFailure');
  });

  test('the ratified ask is REFUSED when the record holds no timeout, not shortened', () => {
    // `contradictedByTheRecord`'s second arm, driven directly across the two
    // states no other test in this file can reach: the guard holds either way
    // and the HEADLINE is fillable either way, so `selectSituationTemplate`
    // returns the class in both — the refusal is the only thing standing
    // between a real row and "It timed out after ." on a run that errored.
    const stuck: SituationClassInput =
      { kind: 'agentFailure', done: 0, failed: 0, total: null, gate: null, runId: null };
    const selected = selectSituationTemplate(stuck, { agentId: 'auth-probe' });
    expect(selected?.id).toBe('agent.stuck');
    expect(contradictedByTheRecord(selected, null, { agentId: 'auth-probe' })).toBe(true);
    expect(contradictedByTheRecord(selected, null, { agentId: 'auth-probe', timeout: '300s' })).toBe(false);
    // …and the first arm is untouched by the widening: a class-1 template with
    // a gate is still contradicted, with or without a bag.
    expect(contradictedByTheRecord(SITUATION_TEMPLATES[0], gate())).toBe(true);
    expect(contradictedByTheRecord(SITUATION_TEMPLATES[0], null)).toBe(false);
  });
});

describe('an unfillable headline falls back rather than rendering a hole', () => {
  test('a capability with no ratified run noun selects NOTHING, not a headline with a gap', () => {
    const input: SituationClassInput =
      { kind: 'run', done: 0, failed: 0, total: 0, gate: null, runId: 's1' };
    // The guard holds…
    expect(guardHolds(SITUATION_TEMPLATES[0], input)).toBe(true);
    // …and the class is still declined, because `{runNoun}` cannot be filled.
    expect(selectSituationTemplate(input, { ...FULL_BAG, runNoun: undefined })).toBeNull();
  });

  test('an incident with no symptom and no fact selects nothing', () => {
    const input: SituationClassInput =
      { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null };
    expect(guardHolds(SITUATION_TEMPLATES[3], input)).toBe(true);
    expect(selectSituationTemplate(input, { ...FULL_BAG, finding: undefined })).toBeNull();
  });

  test('an absent slot renders EMPTY, never the six characters "undefined"', () => {
    // The battery's tell: `String(undefined)` is a word a customer can read,
    // and nothing pinned that it never reaches one. The ask is where an absent
    // slot can still land, because only the headline gates selection.
    expect(fillSituationSentence('{producer}', { producer: undefined })).toBe('');
    expect(fillSituationSentence('{finding} on {target}, and nothing is fixing it',
      { finding: 'a backdoor', target: undefined })).not.toContain('undefined');
    // Zero is a VALUE, not an absence — "0 failed" must survive the same path.
    expect(fillSituationSentence('{failed} failed', { failed: 0 })).toBe('0 failed');
  });

  test('an absent slot leaves NO double space where its value was', () => {
    // "Waiting at cp.x,  . 1 failed" — the gap an absent slot opens mid-sentence.
    // Collapsing it is the difference between a shortened sentence and a broken
    // one, and the battery found nothing pinning the collapse.
    // The slot must be surrounded by spaces on BOTH sides for its removal to
    // open a gap — the first draft of this test dropped `{position}`, which sits
    // between a comma and a full stop and leaves no double space at all. It
    // passed against an implementation with no collapse, and the battery said
    // so. `{failed}` is the one that actually gaps: ". {failed} failed" becomes
    // ".  failed".
    const gapped = fillSituationSentence('Waiting at {checkpoint}, {position}. {failed} failed.', {
      checkpoint: 'cp.approval', position: '3 of 8', failed: undefined,
    });
    expect(gapped).not.toMatch(/\s{2,}/);
    expect(gapped).toBe('Waiting at cp.approval, 3 of 8. failed.');
  });

  test('a slot missing from the ASK does not decline the class — only the headline gates', () => {
    // The headline is the verdict; an ask that loses a clause is degraded, not
    // dishonest. Declining the class over it would throw away the ratified
    // verdict to protect a subordinate sentence.
    const input: SituationClassInput =
      { kind: 'incident', done: 0, failed: 0, total: 1, gate: null, runId: null };
    expect(selectSituationTemplate(input, { ...FULL_BAG, producer: undefined })?.id)
      .toBe('incident.no-run');
  });
});

describe('the list verdict — generated from the rows it is about', () => {
  const row = (done: number, failed: number): Situation =>
    ({ written: { done, failed, total: 3 } } as Situation);

  test('an empty list makes no claim at all', () => {
    expect(listVerdict([])).toBe('');
  });

  test('every waiting row unwritten takes the allUnwritten arm, with the count substituted', () => {
    expect(listVerdict([row(0, 0), row(0, 0)]))
      .toBe('2 things need you, and none of them has changed anything yet');
  });

  test('one row with a write takes the someChanged arm, and counts the written ones', () => {
    expect(listVerdict([row(0, 0), row(1, 0), row(0, 2)]))
      .toBe('3 things need you, and 2 of them have already written somewhere');
  });

  test('a FAILED write counts as having written somewhere', () => {
    // A failed target is a target the run touched. Counting only successes
    // would tell a reader "nothing has changed anything yet" about a fleet with
    // a half-applied update on it — the one sentence this verdict exists to
    // prevent being wrong.
    expect(listVerdict([row(0, 1)]))
      .toBe('1 things need you, and 1 of them have already written somewhere');
  });

  test('both arms come from the generated module, not from this file', () => {
    expect(LIST_VERDICT.allUnwritten).toContain('{needsYou}');
    expect(LIST_VERDICT.someChanged).toContain('{changedRuns}');
  });

  // -------------------------------------------------------------------------
  // WP-56 · THE MERGED EXPRESSION — driven DIRECTLY, because its two new terms
  // cannot be reached through any caller that exists.
  // -------------------------------------------------------------------------
  //
  // Three packets edited this sum through different doors (WP-54's unheld term,
  // WP-56's deferral filter, WP-54b's denominator) and the ruled resolution
  // needs cases none of them could produce:
  //
  //   * NO CALLER CAN DEFER AN UNHELD ROW today — `rowIsDeferred` answers false
  //     for a row with no situation, because a deferral names a SITUATION id
  //     and the fold holds no unheld rows.
  //   * NO CALLER CAN GIVE AN UNHELD ROW A WRITE today — `InboxItem` records no
  //     outcomes at all, being a finding rather than a run.
  //
  // Both are ruled inputs with no producer, which is exactly WP-46's rule: pins
  // on a guarded builder must drive it across its FULL input domain, including
  // the states current callers cannot supply, or the guard is decoration. The
  // battery proved it — both terms SURVIVED mutation until these landed.
  describe('the unheld term (WP-54) and the deferral filter (WP-56), in one sum', () => {
    // WP-55 · `deferred` IS REQUIRED NOW, so the helper's default is EXPLICIT.
    // It was optional and `listVerdict` reads `!row.deferred`, which meant an
    // omitted field silently meant "escalating" — safe, and still the wrong
    // mechanism. The compiler is what says so now, and this line is what it
    // said it about.
    const unheld = (over: Partial<UnheldRow> = {}): UnheldRow =>
      ({ written: { done: 0, failed: 0 }, deferred: false, ...over });
    const deferred = (): Situation =>
      ({
        written: { done: 0, failed: 0, total: 3 },
        deferral: { eventId: 'e', reason: 'r', deferredAt: '2026-08-21T00:00:00.000Z', wake: null },
      } as Situation);

    test('an unheld row is counted — a verdict about only what the fold holds heads eight rows with "7"', () => {
      expect(listVerdict([row(0, 0)], [unheld()])).toBe(
        '2 things need you, and none of them has changed anything yet'
      );
    });

    test('A DEFERRED UNHELD ROW IS NOT COUNTED — the deferral must quiet this term too', () => {
      // The whole list is two rows; one of them is an unheld row the user
      // quieted. A count that still included it would be the deferral
      // deferring nothing, on the term WP-56 could not see while WP-54 held
      // the file.
      expect(listVerdict([row(0, 0)], [unheld({ deferred: true })])).toBe(
        '1 things need you, and none of them has changed anything yet'
      );
      // And with nothing left escalating at all, the sentence says nothing —
      // it does not say "0 things need you".
      expect(listVerdict([deferred()], [unheld({ deferred: true })])).toBe('');
    });

    test('changedRuns IS MEASURED OVER THE UNION — WP-54b, and an unheld write flips the arm', () => {
      // The defect: the branch was chosen from `waiting` alone while the count
      // covered `waiting + alsoWaiting`, so the fixture's ratified guard
      // ("allUnwritten when EVERY waiting row has done === 0 && failed === 0")
      // was evaluated over a subset of the rows the sentence counts. An unheld
      // row that HAS written is the case that tells the two apart.
      expect(listVerdict([row(0, 0)], [unheld({ written: { done: 2, failed: 0 } })])).toBe(
        '2 things need you, and 1 of them have already written somewhere'
      );
      // A failed write on an unheld row counts the same way it does on a held
      // one — a target the run touched.
      expect(listVerdict([row(0, 0)], [unheld({ written: { done: 0, failed: 1 } })])).toBe(
        '2 things need you, and 1 of them have already written somewhere'
      );
    });

    test('a DEFERRED unheld row is excluded from changedRuns as well as from the count', () => {
      // Both terms of both numbers read the same set. A row quieted out of the
      // count that still fed the branch would decide the sentence's arm from a
      // row the sentence does not count.
      expect(
        listVerdict([row(0, 0)], [unheld({ written: { done: 5, failed: 0 }, deferred: true })])
      ).toBe('1 things need you, and none of them has changed anything yet');
    });

    test('BOTH TERMS NON-ZERO AT ONCE — the case neither branch could produce', () => {
      // One deferred situation, two escalating ones, one unheld row that wrote.
      // Under WP-56's body alone this says 2; under the base's it says 4 and
      // takes the wrong arm. The merged expression says 3, and says it wrote.
      expect(
        listVerdict(
          [deferred(), row(0, 0), row(0, 0)],
          [unheld({ written: { done: 1, failed: 0 } })]
        )
      ).toBe('3 things need you, and 1 of them have already written somewhere');
    });
  });
});

describe('the copy discipline, asserted over the ratified set', () => {
  test('every chip is ONE WORD or empty — a badge never carries a sentence', () => {
    const offenders = SITUATION_TEMPLATES
      .filter((t) => t.chip !== '' && /\s/.test(t.chip))
      .map((t) => `${t.id}: ${JSON.stringify(t.chip)}`);
    expect(offenders).toEqual([]);
    // WP-54 · ITEM 12 CUT `Waiting`, AND THE DESIGNER'S CYCLE-SEVEN SHEET CUT
    // THE REST. The packet removed the chip from the two classes that rendered
    // beside a derived twin — chip-presence told the user which of OUR code
    // paths ran — and the designer then carried the cut to every class, so no
    // ratified template declares a badge at all.
    //
    // The field survives as `''` so every consumer is unchanged, and the
    // one-word rule above still stands over whatever a future class declares.
    // Asserted as an EMPTY SET rather than deleted: a chip reappearing is a
    // ratified-copy change and must reach a human.
    expect(SITUATION_TEMPLATES.map((t) => t.chip).filter(Boolean)).toEqual([]);
  });

  test('the runbook id is on the META line and never in a headline', () => {
    // The route's own instruction: "runbookId moves off the headline to the
    // meta line. It identifies the procedure and never said what happened."
    for (const t of SITUATION_TEMPLATES) {
      expect({ id: t.id, inHeadline: t.headline.includes('{runbookId}') })
        .toEqual({ id: t.id, inHeadline: false });
    }
    expect(SITUATION_TEMPLATES.filter((t) => t.meta === '{runbookId}')).toHaveLength(3);
  });

  test('every ratified string is a VERBATIM substring of the designer\'s file', () => {
    // Whatever the generator did, each shipped string must still be the
    // designer's bytes. The fixture escapes SOME of its punctuation as `\uXXXX`
    // — the curly apostrophe in one place, the em dash in another — so the
    // haystack is decoded the way the interpreter reads it. Normalising only
    // the apostrophe (what the return-copy suite does, because its own fixture
    // only escapes that one) made a true substring read as absent: caught by
    // this test on the freshness line's em dash.
    const normalised = fs.readFileSync(FIXTURE_JS, 'utf-8')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const needles = [
      ...SITUATION_TEMPLATES.flatMap((t) => [t.id, t.guard, t.headline, t.ask, t.state, t.meta, t.door]),
      ...Object.values(RUN_NOUN),
      LIST_VERDICT.allUnwritten, LIST_VERDICT.someChanged,
      FRESHNESS.now, FRESHNESS.then,
    ];
    const misses = needles.filter((n) => n !== '' && !normalised.includes(n));
    expect(misses).toEqual([]);
  });

  /**
   * WP-54's merge · THE ONE STRING THE GENERATOR TRANSFORMS, and the pin is
   * STRONGER than the substring rule it is exempted from.
   *
   * The designer's sheet writes the tier twice — as prose at the head of the
   * rule line and as a numeric field beside it — which is the two-sources shape
   * this packet exists to remove, arriving as data. Editing the designer's
   * sentence would be a packet rewriting ratified copy, so the generator
   * NORMALISES instead: it asserts the two agree and emits the line with the
   * numeral replaced by the slot that fills it.
   *
   * `rule` is therefore not a verbatim substring of the fixture, and this is
   * what replaces that guarantee: substituting the DECLARED tier back must
   * reproduce the designer's line byte for byte. A transformation that changed
   * a word rather than a numeral fails here.
   */
  test('the rule line is the designer\'s own sentence with its tier turned into a slot', () => {
    const normalised = fs.readFileSync(FIXTURE_JS, 'utf-8')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));

    for (const t of SITUATION_TEMPLATES) {
      expect({ id: t.id, opens: t.rule.startsWith('Tier {tier} · ') })
        .toEqual({ id: t.id, opens: true });
      // Put the number back; the designer's line must reappear exactly.
      //
      // WP-55 · A CLASS WHOSE TIER THE FIXTURE STATES IN PROSE declares no
      // number to restore (`incident.coalesced`: "the highest tier among the
      // members" → `tier: null`), and `String(null)` would look for the line
      // "Tier null · …", which is in no file. Its rule line still carries a
      // literal tier in the fixture, so the check restores ANY digit for it —
      // weaker by exactly the amount the fixture is weaker, and stated rather
      // than skipped.
      if (t.tier === null) {
        const anyTier = [1, 2, 3, 4].some((n) => normalised.includes(t.rule.replace('{tier}', String(n))));
        expect({ id: t.id, verbatim: anyTier }).toEqual({ id: t.id, verbatim: true });
        continue;
      }
      const restored = t.rule.replace('{tier}', String(t.tier));
      expect({ id: t.id, verbatim: normalised.includes(restored) })
        .toEqual({ id: t.id, verbatim: true });
    }
  });

  test('the run-noun column is Controlled Vocabulary v1.4, whole', () => {
    expect(Object.keys(RUN_NOUN).sort()).toEqual([
      'cap.bulk_plugin_update', 'cap.diagnose_site', 'cap.incident_containment',
      'cap.incident_remediation', 'cap.promote_environment', 'cap.promotion_preflight',
      'cap.wpe_pull',
    ]);
    // Subject form, not the v1.3 act label: every noun is a noun phrase.
    for (const [capability, noun] of Object.entries(RUN_NOUN)) {
      expect({ capability, startsWithArticle: /^A /.test(noun) })
        .toEqual({ capability, startsWithArticle: true });
    }
  });

  test('the surface\'s drift line READS the ratified sentence — not the other half of it', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const model = require('../../../renderer/components/return/arrivalModel');
    /* eslint-enable @typescript-eslint/no-var-requires */
    // The battery found nothing pinning WHICH half of FRESHNESS the surface
    // reads: swapping `now` for `then` left every test green while the drift
    // line said its second sentence twice and never said the first.
    expect(model.AUTHORED.DRIFT_NO_COUNT).toBe(FRESHNESS.now);
    const line = model.driftLine(null);
    // WP-54's merge · THE SECOND HALF MOVED HOUSE, and the pin follows it.
    //
    // `FRESHNESS.then` was this sentence's anchor in the SITUATION fixture, and
    // the designer's cycle-seven sheet dropped it. Nothing rendered changes:
    // `driftLine` has always composed its second sentence from
    // `RETURN_COPY.DRIFT_REST`, which the RETURN generator extracts from the
    // sheet that still carries it. What `then` was for was the CROSS-GENERATOR
    // agreement — two extractors, one sentence — so the anchor is now that
    // sentence directly, and the half-swap the battery found is still caught.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { RETURN_COPY: returnCopy } = require('../../../renderer/components/return/returnCopy.generated');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const second = returnCopy.DRIFT_REST;
    expect(line).toBe(`${FRESHNESS.now} ${second}`);
    expect(line.indexOf(second)).toBe(line.lastIndexOf(second));
    // …and a line that HAS a count still renders the count, not the sentence.
    expect(model.driftLine(41)).toContain('41');
    expect(model.driftLine(41)).not.toContain(FRESHNESS.now);
  });

  test('the freshness replacement is one sentence, and shorter than what it replaced', () => {
    const was = 'No producer reports how many facts are past their freshness window, so this line cannot state the count.';
    expect(FRESHNESS.now).toBe('Freshness is not being reported yet.');
    expect(FRESHNESS.now.length).toBeLessThan(was.length);
    // WP-54's merge: the sheet dropped `then`. The surface never read it (see
    // the drift-line test above), so an empty value is the honest emission —
    // and emitting it as `''` rather than defaulting it from the other
    // generator is what keeps this file from becoming the second source.
    expect(FRESHNESS.then).toBe('');
    // The designer's second sentence used to be carried by BOTH fixtures, and
    // this asserted the two extractors agreed on it. The cycle-seven sheet
    // dropped it here; the RETURN fixture still carries it, and the drift line
    // still renders it from there — pinned in the drift-line test above, which
    // is now the only place the sentence is anchored.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RETURN_COPY } = require('../../../renderer/components/return/returnCopy.generated');
    expect(RETURN_COPY.DRIFT_REST).not.toBe('');
  });

  test('no template string is hand-typed in the composer — it reads them from the module', () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, 'src', 'main', 'intelligence-host', 'sessionRegistry.ts'), 'utf-8',
    );
    // COMMENTS ARE STRIPPED FIRST, and that is the claim being made precise
    // rather than weakened: what must not exist is a ratified string in the
    // composer's EXECUTABLE text, where it would be a second source the surface
    // could render from. Documentation that quotes the product is not a second
    // source — nothing renders a comment — and the first draft of this test hit
    // exactly that, on a doc comment quoting a real row to explain a refusal.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const typed = SITUATION_TEMPLATES
      .flatMap((t) => [t.headline, t.ask, t.chip, t.state])
      .filter((s) => s !== '' && source.includes(s));
    expect(typed).toEqual([]);
    // The strip must not have eaten the file: an over-greedy regex would empty
    // `source` and make the assertion above vacuous — shape #7's own trap.
    //
    // **THE THRESHOLD WAS A FRACTION OF `raw` AND THAT WAS THE WRONG
    // INSTRUMENT** (WP-55). `raw.length / 3` does not measure regex greediness;
    // it measures COMMENT DENSITY, and it fails as a file gets better
    // documented rather than as the strip gets worse. Measured on this file
    // 2026-08-21: 181,966 raw characters, 60,355 of executable text — **66.8%
    // comment**, which is what this subsystem's doc discipline produces and is
    // the reason it tripped. An absolute floor measures the thing the check is
    // actually about: a strip that ate the file leaves nothing, not 60kB.
    expect(source.length).toBeGreaterThan(20_000);
    expect(source).toContain('function guardHolds');
    expect(source).toContain("from './situationCopy.generated'");
  });
});

describe('the generator — the tracked module is what the designer\'s file produces', () => {
  test('`fixtures:situation-copy:check` passes against the tracked file', () => {
    const out = execFileSync('npx', ['ts-node', GENERATOR, '--check'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(out).toContain('is up to date');
  });

  test('deterministic — twice on an unchanged tree, byte-identical, and equal to the tracked file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp48-copy-'));
    try {
      // `--out`, never the tracked path: a generator run under test must not be
      // able to leave output on the working tree (WP-32's poisoned-fixture rule).
      const a = path.join(dir, 'a.ts');
      const b = path.join(dir, 'b.ts');
      execFileSync('npx', ['ts-node', GENERATOR, '--out', a], { cwd: REPO_ROOT });
      execFileSync('npx', ['ts-node', GENERATOR, '--out', b], { cwd: REPO_ROOT });
      expect(fs.readFileSync(a, 'utf-8')).toBe(fs.readFileSync(b, 'utf-8'));
      expect(fs.readFileSync(a, 'utf-8')).toBe(fs.readFileSync(GENERATED, 'utf-8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the generated module carries its DO-NOT-EDIT header and its shape version', () => {
    const source = fs.readFileSync(GENERATED, 'utf-8');
    expect(source).toContain('GENERATED — DO NOT EDIT');
    expect(source).toContain('npm run fixtures:situation-copy');
    // WP-54 bumped the SHAPE: templates now declare a `tier`, and the module
    // carries four new blocks (`DOORS`, `COLOURS`, `RESERVED`, `ACCOUNTING`).
    // The version is what lets a consumer tell a shape change from a content
    // change, which is the whole reason it is emitted.
    // WP-54's merge bumped it again: the designer's cycle-seven sheet added a
    // per-template `door`, removed every `chip`, and declares one class's tier
    // in prose — three shape changes in one artifact, and the version is what
    // lets a consumer tell that from a content change.
    // WP-55 bumped it again: templates gained `headlineFallback`, `disclosure`
    // and `disclosureOpen`, and the set gained a sixth class. Three shape
    // changes, and the version is what lets a consumer tell that from a content
    // change.
    expect(SITUATION_COPY_SHAPE_VERSION).toBe(4);
  });

  /** Run the generator against a broken copy of the fixture; expect a loud death. */
  function refuses(mutate: (source: string) => string): { threw: boolean; message: string; wroteOutput: boolean } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp48-refuse-'));
    try {
      const broken = path.join(dir, 'fixture.js');
      const out = path.join(dir, 'out.ts');
      fs.writeFileSync(broken, mutate(fs.readFileSync(FIXTURE_JS, 'utf-8')), 'utf-8');
      let threw = false;
      let message = '';
      try {
        execFileSync('npx', ['ts-node', GENERATOR, '--fixture', broken, '--out', out],
          { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        threw = true;
        message = String((err as { stderr?: string }).stderr ?? '');
      }
      return { threw, message, wroteOutput: fs.existsSync(out) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('a template the designer RENAMED fails loudly, and writes nothing', () => {
    const r = refuses((s) => s.replace("id: 'agent.stuck'", "id: 'agent.jammed'"));
    expect({ threw: r.threw, wrote: r.wroteOutput }).toEqual({ threw: true, wrote: false });
    expect(r.message).toContain('the ratified template set changed');
  });

  test('a REORDERED set fails loudly — the ratified artifact changed, whatever it selects', () => {
    const source = fs.readFileSync(FIXTURE_JS, 'utf-8');
    const r = refuses(() => source
      .replace("id: 'run.waiting.nothing-written'", "id: '__A__'")
      .replace("id: 'run.waiting.mid-procedure'", "id: 'run.waiting.nothing-written'")
      .replace("id: '__A__'", "id: 'run.waiting.mid-procedure'"));
    expect(r.threw).toBe(true);
    expect(r.message).toContain('the ratified template set changed');
  });

  test('a template missing a field fails loudly rather than defaulting it', () => {
    // Re-aimed at a field that still EXISTS. It used to remove `chip: 'Stuck'`,
    // and the designer's cycle-seven sheet removed every chip, so the mutation
    // had nothing to delete — a refusal test whose subject is gone passes
    // vacuously in the worst way: by never running the code it checks.
    const r = refuses((s) => s.replace("      door: 'Open {agentId}',\n", ''));
    expect({ threw: r.threw, wrote: r.wroteOutput }).toEqual({ threw: true, wrote: false });
    expect(r.message).toContain('is missing "door"');
  });

  /**
   * WP-54's merge · THE RULED-CONTENT ASSERTION, driven against the exact
   * regression that produced it.
   *
   * Two ruled guard amendments were silently REVERTED when the cycle-seven
   * sheet replaced this fixture wholesale: WP-48's `&& gate === null` on class
   * 1 and WP-50's removal of `total` from class 2. Nothing caught it — the
   * generator checked ids, fields and slots and had no opinion about a guard's
   * CONTENT — so a ruling adjudicated at two gates was undone by a file copy.
   *
   * A ruling that lives only in the record survives as long as the next
   * person's memory. Both directions are driven here, because the two
   * amendments fail in opposite directions and a check that only tested one
   * would be half an instrument.
   */
  test('a REVERTED RULING fails the build — both amendments, both directions', () => {
    const lost = refuses((s) => s.replace(" && total === 0 && gate === null'", " && total === 0'"));
    expect(lost.threw).toBe(true);
    expect(lost.message).toContain('RULED AMENDMENT REVERTED');
    expect(lost.message).toContain('gate === null');
    expect(lost.message).toContain('WP-48');

    const returned = refuses((s) => s.replace(
      "      guard: 'row.kind === \"run\" && done === 0 && failed === 0 && gate !== null',",
      "      guard: 'row.kind === \"run\" && done === 0 && failed === 0 && total > 0 && gate !== null',",
    ));
    expect(returned.threw).toBe(true);
    expect(returned.message).toContain('RULED AMENDMENT REVERTED');
    expect(returned.message).toContain('WP-50');
  });

  test('a slot the composer cannot fill fails the BUILD, not the customer\'s row', () => {
    // The substitution form of the blank-where-a-sentence-belongs defect: an
    // unknown slot would otherwise reach a person as literal braces.
    const r = refuses((s) => s.replace('{agentId} could not finish a run', '{operatorName} could not finish a run'));
    expect(r.threw).toBe(true);
    expect(r.message).toContain('unknown slot "{operatorName}"');
  });

  test('an unknown slot in the LIST VERDICT is refused too, on its own slot set', () => {
    const r = refuses((s) => s.replace('{needsYou} things need you, and none', '{pendingCount} things need you, and none'));
    expect(r.threw).toBe(true);
    expect(r.message).toContain('unknown slot "{pendingCount}"');
  });

  test('a fixture that assigns nothing fails loudly', () => {
    const r = refuses(() => '(function () { /* assigns no NEXUS_HEADLINES */ })();');
    expect(r.threw).toBe(true);
    expect(r.message).toContain('did not assign window.NEXUS_HEADLINES');
  });

  /**
   * WP-55 · VACUOUS SHAPE #17, DRIVEN IN BOTH DIRECTIONS.
   *
   * *"A guard that subtracts its own exception before reading."* `RATIFIED_IDS`
   * is compared against `ids.filter(id => !(id in DEFERRED_IDS))`, so the guard
   * cannot see the class it defers. The exit condition — *"host fields nothing
   * derives yet — WP-55 adds them"* — lived in a string, was announced by one
   * `process.stdout.write`, and was tested by nothing: the day the fields
   * arrived, forgetting to delete the entry would have left the build green with
   * the class missing from the screen it was drawn for.
   *
   * **A deferral states a condition under which it ends; the check that reads it
   * probes that condition, or the deferral is permanent by construction.**
   * Skipping loudly is not failing closed.
   *
   * DRIVEN AS THE FUNCTION rather than through a broken fixture, because
   * `DEFERRED_IDS` lives in the GENERATOR and `--fixture` can only replace the
   * INPUT. Both directions are here and neither is hypothetical: direction 2 is
   * the tracked fixture and the tracked slot list, with the entry this packet
   * deleted put back — which is exactly the mistake the guard exists to catch.
   */
  describe('shape #17 — the deferral is probed, not merely announced', () => {
    const templatesOf = () => {
      const sandbox: Record<string, unknown> = { window: {} };
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(FIXTURE_JS, 'utf-8'), sandbox, { filename: FIXTURE_JS });
      return ((sandbox.window as Record<string, unknown>).NEXUS_HEADLINES as { templates: Array<Record<string, unknown>> }).templates;
    };

    test('DIRECTION 1 · a deferral whose condition STILL HOLDS is allowed to stand', () => {
      // A class carrying a slot the product cannot fill. This is what a
      // legitimate deferral looks like, and the guard must not fire on it — a
      // guard that refused every deferral would stop a designer drawing ahead
      // of the build, which is what a design sheet is FOR.
      expect(() => assertDeferralsStillHold(
        { 'incident.coalesced': 'its slots do not exist yet' },
        templatesOf(),
        ['target', 'restCount', 'memberCount', 'linkKind', 'tier', 'producer'], // no `leadFinding`
      )).not.toThrow();
    });

    test('DIRECTION 2 · a deferral whose condition HAS ENDED fails the build, by name', () => {
      // The tracked fixture and the tracked slot list, with this packet's own
      // deleted entry put back. Every slot `incident.coalesced` carries is now a
      // host field, so the deferral has expired and the build must refuse.
      expect(() => assertDeferralsStillHold(
        { 'incident.coalesced': 'its headline slots are host fields nothing derives yet' },
        templatesOf(),
        KNOWN_SLOTS,
      )).toThrow(/THE DEFERRAL OF "incident.coalesced" HAS EXPIRED/);
    });

    test('the LIVE generator carries no deferral at all, and the class is emitted', () => {
      // The two directions above pin the instrument. This pins the outcome: the
      // entry is gone from the tracked generator, and the class it deferred is
      // in the tracked module.
      expect(fs.readFileSync(GENERATOR, 'utf-8')).not.toContain("'incident.coalesced':\n");
      expect(SITUATION_TEMPLATES.map((t) => t.id)).toContain('incident.coalesced');
    });

    test('a deferral naming a class the fixture no longer carries is not probed', () => {
      // Declared and absent: the skip announcement covers it, and there is
      // nothing to check the condition against. Refusing here would fail the
      // build on a stale comment.
      expect(() => assertDeferralsStillHold(
        { 'a.class.that.never.existed': 'gone' }, templatesOf(), KNOWN_SLOTS,
      )).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// WP-54 · the four blocks the ratified fixture grew, and the class rule on them
// ---------------------------------------------------------------------------

describe('WP-54 · the doors, the stripe, the reserved row and the accounting clauses', () => {
  /**
   * ITEM 7 — THE PUNCTUATION APPENDER, DRIVEN DIRECTLY.
   *
   * The row door shipped as "Open where you are needed." while every ratified
   * drawing of it carries no full stop, so the render was APPENDING one — which
   * meant it was appending one to every door string. The appender turned out to
   * be an EXTRACTION: `generate-return-copy.ts` captures the door out of a
   * markdown sentence (`Door: *Open where you are needed.*`) and the sentence's
   * own terminator came with it.
   *
   * `controlLabel` is the class fix, and it is pinned over its whole input
   * domain rather than through the one string that exposed it — including the
   * inputs it must LEAVE ALONE, which is where a fix of this shape usually
   * overreaches.
   */
  test('controlLabel strips ONE terminal period, and nothing else', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { controlLabel } = require('../../../../scripts/control-label');

    expect(controlLabel('Open where you are needed.')).toBe('Open where you are needed');
    expect(controlLabel('Open where you are needed')).toBe('Open where you are needed');

    // An ellipsis is a control's own punctuation and survives, in both spellings.
    expect(controlLabel('Choose a site…')).toBe('Choose a site…');
    expect(controlLabel('Choose a site...')).toBe('Choose a site...');
    // Nothing else is trimmed: a control asking something is a different
    // decision, and one that is a whole sentence is a defect this must surface
    // rather than tidy away.
    expect(controlLabel('Retry?')).toBe('Retry?');
    expect(controlLabel('Contain it now, or say why not.')).toBe('Contain it now, or say why not');
    expect(controlLabel('')).toBe('');
  });

  test('no control the generators emit carries a terminal period', () => {
    for (const label of Object.values(DOORS)) expect(label).not.toMatch(/\.$/);
  });

  /**
   * ITEM 3's guard, at the fixture: the stripe encodes TIER, and there is no
   * tier-4 colour because tier 4 takes no stripe. A `tier4` key appearing here
   * would be the drift the guard names, arriving as data rather than as code.
   */
  test('the stripe has exactly three tier colours, and a link colour beside them', () => {
    expect(Object.keys(COLOURS).sort()).toEqual(['link', 'tier1', 'tier2', 'tier3']);
    for (const value of Object.values(COLOURS)) expect(value).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
  });

  /**
   * ITEM 10 — "checks dark" in plain words, and the clause states the count and
   * STOPS.
   *
   * The review asked for "3 checks haven't reported in 9 hours". The duration is
   * not derivable and is therefore not written: a DARK producer is one that has
   * never reported at all (`producerLine` in `health.ts` returns DARK only for
   * `!row.lastRecordedAt`, and a producer that HAS reported is OK or STALE), so
   * there is no last-seen moment to subtract from. Inventing one would be the
   * fabrication this layer forbids; the honest clause is the count.
   */
  test('the accounting clauses take a count and nothing the record cannot supply', () => {
    expect(ACCOUNTING.dark).toBe('{count} checks haven’t reported');
    expect(ACCOUNTING.changed).toBe('{count} changed overnight');
    for (const clause of Object.values(ACCOUNTING)) {
      expect([...clause.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['count']);
    }
    // The jargon is gone from the ratified set entirely, not merely unrendered.
    expect(Object.values(ACCOUNTING).join(' ')).not.toContain('checks dark');
  });

  /** ITEM 11 — the reserved row's two strings, in the user's words. */
  test('the reserved row names the thing the user recognises, not the structure that stores it', () => {
    expect(RESERVED.head).toBe('Watching your sites');
    expect(RESERVED.quiet).toBe('Everything is reporting.');
    expect(`${RESERVED.head} ${RESERVED.quiet}`).not.toMatch(/record|reserved/i);
  });
});
