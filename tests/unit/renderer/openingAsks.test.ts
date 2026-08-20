/**
 * WP-49 · ITEM 4 — the panel's opening state, and the copy route that supplies it.
 *
 * Three claims, and each is tested where it can actually be falsified:
 *
 *  1. **The opening line is the fold's own verdict.** Not "a sentence with the
 *     same words" — the identical string off `TriageView`, composed once in
 *     `sessionRegistry`. Asserted against a REAL fold, so a renderer that
 *     recomposed it would have to reproduce the host's composer byte for byte
 *     to pass, and would fail the moment either changed.
 *  2. **The asks come from the visible rows, by class, and withhold rather than
 *     guess.** Driven DIRECTLY over the builder's full input domain — including
 *     classes the golden morning does not contain — because a render test cannot
 *     pin a guard the render never reaches (WP-46).
 *  3. **The copy route refuses rather than emits a hole.** Each refusal is
 *     driven by handing the generator a sheet with that anchor removed, via
 *     `--sheet`; a guard nothing can reach is a guard nothing can check. The
 *     generator writes to a TEMP path in every one of these, per WP-32's
 *     poisoned-fixture rule — a battery over this script must never be able to
 *     leave its output on the tracked artifact.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { assertGoldenShape, buildMorning, type Morning } from './helpers/returnMorning';
import {
  AUTHORED,
  MAX_OPENING_ASKS,
  UNREACHABLE_CLASSES,
  askBag,
  askTemplateFor,
  openingAsks,
  openingState,
} from '../../../src/renderer/components/DockedPanel/openingAsksModel';
import { NOW_COPY, OPENING_ASKS, PANEL_INVITATION, SCOPE_LINE } from '../../../src/renderer/components/DockedPanel/openingCopy.generated';
import { SITUATION_TEMPLATES } from '../../../src/main/intelligence-host/situationCopy.generated';
import type { Situation, TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'generate-opening-copy.ts');
const SHEET = path.join(REPO_ROOT, 'docs', 'intelligence', 'from-designer', 'from-designer-11-now-screen.md');

/** A situation with only the fields the ask builder reads. */
function row(over: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1', kind: 'session', column: 'waiting', tier: 2,
    tierReason: 'r', places: { tokens: [], highest: null, atHighest: 0, total: 0, unresolved: 0, summary: '' },
    since: '2026-08-19T00:00:00.000Z', lastEventId: 'evt', parts: [],
    headline: 'h', ask: 'a', chip: '', state: '', meta: 'rb.bulk-plugin-update',
    headlineTemplate: null, written: { done: 0, failed: 0, total: null },
    ...over,
  } as Situation;
}

const gate = { checkpointId: 'cp.backup', index: 4, of: 8, awaits: 'approval' as const, runbookId: 'rb.bulk-plugin-update', capability: 'cap.bulk_plugin_update' };

// ---------------------------------------------------------------------------
// 1 · the opening line
// ---------------------------------------------------------------------------

describe('the opening line is the fold\'s own list verdict, read and not recomposed', () => {
  let morning: Morning;
  let triage: TriageView;
  beforeEach(() => { morning = buildMorning(); triage = assertGoldenShape(morning); });
  afterEach(() => morning.close());

  test('it is the IDENTICAL string off TriageView', () => {
    const opening = openingState(triage);
    expect(opening).not.toBeNull();
    expect(opening!.verdict).toBe(triage.verdict);
    // Shape #15's cousin: an empty verdict would satisfy the equality above
    // while proving nothing about the panel, so the morning's own verdict is
    // asserted non-empty first.
    expect(triage.verdict).not.toBe('');
  });

  test('and the invitation that follows it is the designer\'s, not a second verdict', () => {
    const opening = openingState(triage)!;
    expect(opening.invitation).toBe(PANEL_INVITATION);
    expect(PANEL_INVITATION).toBe('Ask about any of them, or about the fleet.');
    // §5's blockquote opens with a PARAPHRASE of the verdict ("has written
    // anything yet" where §1 says "has changed anything yet"). Extracting the
    // whole blockquote would have shipped that paraphrase as a second sentence
    // about the same list — which is the drift channel the packet named.
    expect(PANEL_INVITATION).not.toContain('need you');
  });

  test('a fleet with nothing waiting opens on no state at all, rather than on a furnished blank', () => {
    const quiet: TriageView = { ...triage, waiting: [], verdict: '' };
    expect(openingState(quiet)).toBeNull();
    expect(openingState(null)).toBeNull();
    expect(openingState(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2 · the asks
// ---------------------------------------------------------------------------

describe('the asks are drawn from the visible rows, by situation class', () => {
  test('one per class, in row order, capped at three', () => {
    const rows = [
      row({ id: 'a', headlineTemplate: 'run.waiting.mid-procedure', gate, written: { done: 0, failed: 0, total: 5 } }),
      // A SECOND row of the SAME class contributes nothing — the panel offers
      // three different questions, not one question about three rows.
      row({ id: 'b', headlineTemplate: 'run.waiting.mid-procedure', gate: { ...gate, checkpointId: 'cp.verify' }, written: { done: 0, failed: 0, total: 5 } }),
      row({ id: 'c', headlineTemplate: 'incident.no-run', kind: 'incident' }),
      row({ id: 'd', headlineTemplate: 'run.waiting.nothing-written' }),
      row({ id: 'e', headlineTemplate: 'run.waiting.part-changed', gate, written: { done: 1, failed: 0, total: 5 } }),
    ];
    const asks = openingAsks(rows);

    expect(asks.map((a) => a.classId)).toEqual([
      'run.waiting.mid-procedure', 'incident.no-run', 'run.waiting.nothing-written',
    ]);
    expect(asks).toHaveLength(MAX_OPENING_ASKS);
    // Each ask names the row it came from, so a consumer can say which one it
    // is about rather than guessing from the sentence.
    expect(asks.map((a) => a.situationId)).toEqual(['a', 'c', 'd']);
  });

  test('the extracted ask is filled from the row\'s own gate — the designer\'s sentence, the record\'s value', () => {
    const [ask] = openingAsks([row({ headlineTemplate: 'run.waiting.mid-procedure', gate, written: { done: 0, failed: 0, total: 5 } })]);
    expect(ask.text).toBe('What does cp.backup need from me?');
    // …and it IS the extracted template, not a coincidence of wording.
    expect(OPENING_ASKS['run.waiting.mid-procedure']).toBe('What does {checkpoint} need from me?');
  });

  test('WITHHELD, NOT SHORTENED · a slot the record cannot fill drops the ask', () => {
    // The mid-procedure class with no gate: `fillSituationSentence` would render
    // "What does  need from me?" — a different sentence, and a shorter one is
    // not a safer one.
    expect(openingAsks([row({ headlineTemplate: 'run.waiting.mid-procedure', gate: undefined })])).toEqual([]);
    // The runbook slot on an INCIDENT row, whose `meta` is the producer rather
    // than a runbook id: the name collision that cost WP-48 a gate round, and
    // the bag declines it rather than filling one fact from another's field.
    expect(askBag(row({ kind: 'incident', meta: 'security-sentinel' })).runbookId).toBeUndefined();
  });

  test('a row with no ratified class gets no ask — the fallback is honest, not a prompt to dress it up', () => {
    expect(openingAsks([row({ headlineTemplate: null })])).toEqual([]);
    expect(askTemplateFor('a.class.nobody.ratified')).toBeNull();
  });

  test('every REACHABLE ratified class has an ask, and the unreachable one deliberately does not', () => {
    const unreachable = new Set<string>(UNREACHABLE_CLASSES);
    for (const template of SITUATION_TEMPLATES) {
      const has = askTemplateFor(template.id) !== null;
      expect({ id: template.id, has }).toEqual({ id: template.id, has: !unreachable.has(template.id) });
    }
    // `agent.stuck`'s guard reads `kind === 'agentFailure'`, and the fold builds
    // situations only from sessions and incidents — so no row can ever report
    // that class, and an ask for it would be copy with no reader.
    expect([...unreachable]).toEqual(['agent.stuck']);
  });

  test('a designer-supplied ask always wins over an authored one for the same class', () => {
    // The order is the point: if §5 ever grows an ask for a class authored here,
    // the generated entry takes effect on the next `fixtures:opening-copy` run
    // without anyone remembering to delete the authored one.
    for (const classId of Object.keys(OPENING_ASKS)) {
      expect(askTemplateFor(classId)).toBe(OPENING_ASKS[classId]);
    }
    for (const classId of Object.keys(AUTHORED)) {
      expect(Object.prototype.hasOwnProperty.call(OPENING_ASKS, classId)).toBe(false);
    }
  });

  test('THE AUTHORED SET IS EXTRACTABLE, and it is exactly three sentences', () => {
    // `AUTHORED` is the one gate-extractable home for this surface's copy, so a
    // gate report pulls every sentence out mechanically instead of a human
    // reading the tree for stray prose. A fourth authored sentence appearing
    // without a ruling fails here.
    expect(Object.values(AUTHORED)).toEqual([
      'Why has {runbookId} changed nothing?',
      'Why is nothing fixing the open findings?',
      'What has {runbookId} already changed?',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3 · the scope line, and the two in-place answers
// ---------------------------------------------------------------------------

describe('the ratified strings the sheet supplies', () => {
  test('the scope line, verbatim, in the three spans the designer marked', () => {
    expect(`${SCOPE_LINE.LEAD} ${SCOPE_LINE.FLEET}${SCOPE_LINE.SEP}${SCOPE_LINE.ACTION}`)
      .toBe('Asking about the whole fleet · Choose a site');
  });

  test('the Inbox\'s two answers and the section head come from the sheet', () => {
    expect(NOW_COPY.APPROVE).toBe('Approve');
    expect(NOW_COPY.NOT_NOW).toBe('Not now');
    expect(NOW_COPY.NOTHING_NEEDED_HEAD).toBe('Nothing needed of you');
  });
});

// ---------------------------------------------------------------------------
// 4 · the generator — fails closed, and refuses rather than emits a hole
// ---------------------------------------------------------------------------

describe('the copy route fails closed', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp49-opening-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const run = (args: string[]): { code: number; stderr: string } => {
    try {
      execFileSync('npx', ['ts-node', GENERATOR, ...args], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      return { code: e.status ?? 1, stderr: String(e.stderr ?? '') };
    }
  };

  /** The sheet with one anchor removed, written where a battery cannot poison anything. */
  const mutilate = (replace: (md: string) => string): string => {
    const at = path.join(tmp, 'sheet.md');
    fs.writeFileSync(at, replace(fs.readFileSync(SHEET, 'utf8')), 'utf8');
    return at;
  };

  test(':check is GREEN on the tracked artifact — so a stale copy fails the build', () => {
    expect(run(['--check']).code).toBe(0);
  });

  test('the generator is deterministic — twice on an unchanged tree is byte-identical', () => {
    const a = path.join(tmp, 'a.ts');
    const b = path.join(tmp, 'b.ts');
    expect(run(['--out', a]).code).toBe(0);
    expect(run(['--out', b]).code).toBe(0);
    expect(fs.readFileSync(a, 'utf8')).toBe(fs.readFileSync(b, 'utf8'));
    // …and it is what the tracked file holds, which is what makes `:check` mean
    // something rather than merely pass.
    expect(fs.readFileSync(a, 'utf8')).toBe(
      fs.readFileSync(path.join(REPO_ROOT, 'src', 'renderer', 'components', 'DockedPanel', 'openingCopy.generated.ts'), 'utf8'),
    );
  });

  test.each([
    ['the three opening asks', (md: string) => md.replace('Three opening asks, each answerable from the queue on screen:', 'Some asks:'), '§5\'s three opening asks no longer parse'],
    ['a fourth bullet', (md: string) => md.replace('- What does cp.backup need from me?', '- What does cp.backup need from me?\n- A fourth ask nobody ratified?'), 'carries 4 opening ask(s), expected 3'],
    ['the templatable value', (md: string) => md.replace('- What does cp.backup need from me?', '- What does the backup step need from me?'), 'no §5 opening ask carries "cp.backup"'],
    ['the scope line', (md: string) => md.replace('Below the composer, the scope line:', 'Somewhere, the scope line:'), '§5\'s scope line no longer parses'],
    ['the nothing-needed head', (md: string) => md.replace('**Nothing needed of you** sits below', 'Nothing needed of you sits below'), 'anchor for "the nothing-needed head"'],
    ['the two in-place answers', (md: string) => md.replace("the Inbox's *Approve* and *Not now*, in place", 'the Inbox buttons, in place'), '§3\'s two in-place answers no longer parse'],
    ['the invitation', (md: string) => md.replace('> Six things need you and none of them has written anything yet. Ask about any of them, or about the fleet.', '> Six things need you and none of them has written anything yet.'), 'anchor for "the panel invitation"'],
  ])('refuses loudly when %s is gone', (_what, mutate, expected) => {
    const result = run(['--sheet', mutilate(mutate), '--out', path.join(tmp, 'out.ts')]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(expected);
    // AND IT WROTE NOTHING. A generator that refused after emitting would have
    // left the hole on disk, which is the failure mode the refusal exists for.
    expect(fs.existsSync(path.join(tmp, 'out.ts'))).toBe(false);
  });
});
