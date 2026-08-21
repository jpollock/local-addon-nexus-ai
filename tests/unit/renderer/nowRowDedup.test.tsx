/**
 * WP-50 · TWO RENDERER CHANGES, EACH ONE COMPARISON WIDE.
 *
 * **FIELD FINDING 2 — the headline repeats as the first meta line.** The owner,
 * on the live Now screen: every run card said its own sentence twice. The cause
 * is one derivation reaching two slots — a row whose class no ratified guard
 * selected falls back to `runSummary(row)` for its headline, and
 * `parts[0].summary` IS `runSummary(row)`. The fix is one comparison in the
 * render, and it is pinned BOTH DIRECTIONS: an identical part suppressed, a
 * distinct part shown. A one-direction pin would pass against
 * `parts.filter(() => false)`, which deletes the expansion tear 2 exists for.
 *
 * **XD-27 RIDER 1 — the in-flight run's one line with its door.** Consumption
 * only: the line is composed in the host from the ratified run noun and the
 * fold's own status, and this asserts it lands in Nothing-needed-of-you rather
 * than in the needs-you list.
 *
 * The morning is the REAL fold — real emitters, real ledger, real registry — for
 * `nowScreen.test.tsx`'s reason: a hand-written triage is a second transcription
 * of the consequence order.
 */
import { serializeTree } from './helpers/serializeTree';
import { assertGoldenShape, buildMorning, NOW, type Morning } from './helpers/returnMorning';
import { Arrival } from '../../../src/renderer/components/return/Arrival';
import type { Situation, TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

let morning: Morning;
let triage: TriageView;

beforeEach(() => {
  morning = buildMorning();
  triage = assertGoldenShape(morning);
});
afterEach(() => morning.close());

function walk(node: any, out: any[] = []): any[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  return walk(node.children, out);
}
const props = (n: any): any => n?.props ?? {};
function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  if (typeof node === 'object') textOf(node.children ?? node.props?.children, out);
  return out;
}

function render(view: TriageView): any {
  const store = { getItem: () => null, setItem: () => undefined };
  const instance: any = new (Arrival as any)({
    electron: { ipcRenderer: { invoke: () => Promise.resolve(view) } },
    store, now: NOW,
  });
  instance.state = { triage: view, loading: false, error: null, awayMs: 12 * 3_600_000 };
  return serializeTree(instance.render());
}

/** Every rendered part line of one situation, by its `data-part` marker. */
function partsOf(tree: any, situationId: string): string[] {
  const row = walk(tree).find((n) => props(n)['data-situation'] === situationId);
  expect(row).toBeDefined();
  return walk(row)
    .filter((n) => props(n)['data-part'] !== undefined)
    .map((n) => textOf(n).join(' '));
}

/** One waiting row of the real morning, rewritten head-and-parts for the case. */
function withRow(over: Partial<Situation>): { view: TriageView; id: string } {
  const [first, ...rest] = triage.waiting;
  expect(first).toBeDefined();                       // shape #15's cousin
  const row = { ...first, ...over } as Situation;
  return { view: { ...triage, waiting: [row, ...rest] }, id: row.id };
}

describe('field finding 2 — a part summary identical to the headline is not a meta line', () => {
  test('SUPPRESSED · the derived row no longer says its own sentence twice', () => {
    const derived = 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed';
    const { view, id } = withRow({
      headline: derived,
      headlineTemplate: null,
      parts: [{ kind: 'run', summary: derived }],
    });

    const lines = partsOf(render(view), id);
    expect(lines).toEqual([]);

    // …and the sentence is still SAID — once, as the headline. Suppressing the
    // duplicate must not cost the row its verdict.
    const row = walk(render(view)).find((n) => props(n)['data-situation'] === id);
    expect(textOf(row).join(' ')).toContain(derived);
  });

  test('SHOWN · a part that differs from the headline still renders', () => {
    const { view, id } = withRow({
      headline: 'A plugin update run has waited 60h and changed nothing',
      headlineTemplate: 'run.waiting.nothing-written',
      parts: [{ kind: 'run', summary: 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed' }],
    });

    expect(partsOf(render(view), id)).toEqual([
      'running under rb.bulk-plugin-update — 0 done and standing, 0 failed',
    ]);
  });

  test('IT IS A COMPARISON, NOT AN INDEX RULE · a duplicate in second position is the one dropped', () => {
    // `parts[0]` positional suppression would pass both tests above and be wrong
    // the moment a headline matches a later part — which is what happens once a
    // ratified class fires above a list that still carries the run summary.
    const shared = 'incident open: Known backdoor plugin detected: wp-compat';
    const { view, id } = withRow({
      headline: shared,
      headlineTemplate: null,
      parts: [
        { kind: 'run', summary: 'running under rb.remediate — 0 done and standing, 0 failed' },
        { kind: 'incident', summary: shared },
      ],
    });

    expect(partsOf(render(view), id)).toEqual([
      'running under rb.remediate — 0 done and standing, 0 failed',
    ]);
  });
});

describe('XD-27 rider 1 — an in-flight run renders as one line with its door', () => {
  const working = [{
    sessionId: 'sess_task_working',
    capability: 'cap.diagnose_site',
    line: 'A diagnosis is running',
    since: '2026-08-19T02:00:00.000Z',
    lastEventId: 'evt_working',
  }];

  test('the line lands in Nothing-needed-of-you, with a door, and NOT in the needs-you list', () => {
    const tree = render({ ...triage, working });

    const quiet = walk(tree).find((n) => props(n)['data-now-list'] === 'nothing-needed');
    const needsYou = walk(tree).find((n) => props(n)['data-now-list'] === 'needs-you');
    expect(quiet).toBeDefined();
    expect(needsYou).toBeDefined();

    const row = walk(quiet).find((n) => props(n)['data-working'] === 'sess_task_working');
    expect(row).toBeDefined();
    expect(textOf(row).join(' ')).toContain('A diagnosis is running');
    // "…as ONE LINE with its door."
    expect(walk(row).some((n) => props(n)['data-door'] === 'sess_task_working')).toBe(true);
    // A run needing nobody is not among the things needing you.
    expect(walk(needsYou).some((n) => props(n)['data-working'] !== undefined)).toBe(false);
  });

  test('an EMPTY working list renders nothing — the section is unchanged, not furnished with a blank', () => {
    const tree = render({ ...triage, working: [] });
    expect(walk(tree).some((n) => props(n)['data-working'] !== undefined)).toBe(false);
    // The section itself is still there, with the changed rows it always had.
    expect(walk(tree).some((n) => props(n)['data-now-list'] === 'nothing-needed')).toBe(true);
  });
});
