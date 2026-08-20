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
import { execFileSync } from 'child_process';

import {
  fillSituationSentence,
  guardHolds,
  listVerdict,
  selectSituationTemplate,
  type SituationClassInput,
  type Situation,
} from '../sessionRegistry';
import {
  FRESHNESS,
  LIST_VERDICT,
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
};

/**
 * THE CASE TABLE. Every arm of every guard, and every near-miss beside it.
 *
 * The near-misses are the point: a guard that fired one case too wide would
 * still agree with a table of only its own positive cases.
 */
const CASES: Array<{ name: string; input: SituationClassInput }> = [
  // --- run.waiting.nothing-written, and its three near-misses --------------
  { name: 'run, nothing written, no targets', input: { kind: 'run', done: 0, failed: 0, total: 0, gate: null, runId: 's1' } },
  { name: 'run, nothing written, no targets, but gated', input: { kind: 'run', done: 0, failed: 0, total: 0, gate: gate(), runId: 's1' } },
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

  // --- agent.stuck: no producer emits one, so it is ONLY reachable here ----
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
  const row = { kind: input.kind, runId: input.runId };
  // eslint-disable-next-line no-new-func
  const fn = new Function('row', 'done', 'failed', 'total', 'gate', `return (${guard});`);
  return fn(row, input.done, input.failed, input.total, input.gate) === true;
}

describe('the guards — two copies of one rule, pinned together', () => {
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
    const overlaps: string[] = [];
    for (const kind of ['run', 'incident', 'agentFailure'] as const) {
      for (const done of [0, 1, 2]) for (const failed of [0, 1, 2]) for (const total of [0, 1, 2]) {
        for (const g of [null, gate()]) for (const runId of [null, 's1']) {
          const input: SituationClassInput = { kind, done, failed, total, gate: g, runId };
          const holding = SITUATION_TEMPLATES.filter((t) => guardHolds(t, input));
          if (holding.length > 1) {
            overlaps.push(`${JSON.stringify({ kind, done, failed, total, gated: g !== null, runId })} → ${holding.map((t) => t.id).join(' + ')}`);
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

  test('the ratified set is the five, in the fixture\'s order', () => {
    expect(SITUATION_TEMPLATES.map((t) => t.id)).toEqual([
      'run.waiting.nothing-written',
      'run.waiting.mid-procedure',
      'run.waiting.part-changed',
      'incident.no-run',
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

  test('agent.stuck is selectable, and nothing in this fold can produce its input', () => {
    // The class is carried and its selector works; what it lacks is a producer.
    // Pinning both halves means the day an agent-failure producer lands, the
    // sentence is already correct — and until then this is the ONLY thing that
    // reaches it, which is why the pin is here rather than in a render test.
    const stuck: SituationClassInput =
      { kind: 'agentFailure', done: 0, failed: 0, total: 0, gate: null, runId: null };
    expect(selectSituationTemplate(stuck, FULL_BAG)?.id).toBe('agent.stuck');
    // `Situation.kind` has exactly two members, and neither is `agentFailure`.
    const kinds: Array<Situation['kind']> = ['session', 'incident'];
    expect(kinds).not.toContain('agentFailure' as never);
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
});

describe('the copy discipline, asserted over the ratified set', () => {
  test('every chip is ONE WORD or empty — a badge never carries a sentence', () => {
    const offenders = SITUATION_TEMPLATES
      .filter((t) => t.chip !== '' && /\s/.test(t.chip))
      .map((t) => `${t.id}: ${JSON.stringify(t.chip)}`);
    expect(offenders).toEqual([]);
    // …and the three that have one are the three the route names.
    expect(SITUATION_TEMPLATES.map((t) => t.chip).filter(Boolean)).toEqual(['Waiting', 'Waiting', 'Mid-change', 'Stuck']);
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
      ...SITUATION_TEMPLATES.flatMap((t) => [t.id, t.guard, t.headline, t.ask, t.chip, t.state, t.meta, t.rule]),
      ...Object.values(RUN_NOUN),
      LIST_VERDICT.allUnwritten, LIST_VERDICT.someChanged,
      FRESHNESS.now, FRESHNESS.then,
    ];
    const misses = needles.filter((n) => n !== '' && !normalised.includes(n));
    expect(misses).toEqual([]);
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
    expect(line).toBe(`${FRESHNESS.now} ${FRESHNESS.then}`);
    expect(line.indexOf(FRESHNESS.then)).toBe(line.lastIndexOf(FRESHNESS.then));
    // …and a line that HAS a count still renders the count, not the sentence.
    expect(model.driftLine(41)).toContain('41');
    expect(model.driftLine(41)).not.toContain(FRESHNESS.now);
  });

  test('the freshness replacement is one sentence, and shorter than what it replaced', () => {
    const was = 'No producer reports how many facts are past their freshness window, so this line cannot state the count.';
    expect(FRESHNESS.now).toBe('Freshness is not being reported yet.');
    expect(FRESHNESS.now.length).toBeLessThan(was.length);
    // The designer's second sentence follows it unchanged — the same bytes the
    // return-copy generator already extracts as DRIFT_REST.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RETURN_COPY } = require('../../../renderer/components/return/returnCopy.generated');
    expect(FRESHNESS.then).toBe(RETURN_COPY.DRIFT_REST);
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
    expect(source.length).toBeGreaterThan(raw.length / 3);
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
    expect(SITUATION_COPY_SHAPE_VERSION).toBe(1);
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
    const r = refuses((s) => s.replace("      chip: 'Stuck',\n", ''));
    expect({ threw: r.threw, wrote: r.wroteOutput }).toEqual({ threw: true, wrote: false });
    expect(r.message).toContain('is missing "chip"');
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
});
