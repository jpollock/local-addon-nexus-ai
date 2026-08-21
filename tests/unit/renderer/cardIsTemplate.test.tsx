/**
 * WP-52 · THE CARD IS THE TEMPLATE — the designer's finding 1, pinned as a COUNT.
 *
 * The composer used to PREPEND the ratified sentence and leave the previous
 * render standing beneath it. On the owner's live build card 2 stated its gate
 * THREE TIMES — the template ask, the mono gate line, and "Needs your evidence"
 * — with the pre-template headline sitting between them as a part; both incident
 * cards said "and nothing is fixing it" and then "incident open: …" saying it
 * again.
 *
 * The ratified rule: **a template is the card's headline, ask and meta — three
 * lines, REPLACING what the row rendered before.**
 *
 * WHY A COUNT AND NOT AN IMPRESSION. "The card looks right" is satisfied by a
 * card that says its ask twice in two different places, which is exactly the
 * defect. So the assertions are: the ask appears EXACTLY ONCE in the card's
 * text, and NO line from the pre-template render survives — no part, no gate
 * line, no needs line. Counted, per class, over the whole ratified set.
 *
 * AND PINNED BOTH DIRECTIONS. A derived card has no ask at all, so it must KEEP
 * the parts, the gate and what the gate needs — or J-Return's "a needs-you row
 * that knows THAT but not WHERE" must-not fires on the one card that has no
 * other way to say where. A one-direction pin would pass against a renderer that
 * deleted those lines unconditionally.
 *
 * EVERY RATIFIED CLASS IS DRIVEN, including `agent.stuck`, which no producer can
 * currently construct (`openingAsksModel.UNREACHABLE_CLASSES`). WP-46's rule:
 * pins on a guarded builder drive it across its full input domain, including the
 * states the current callers cannot supply, or the guard is decoration.
 */
import { serializeTree } from './helpers/serializeTree';
import { Arrival } from '../../../src/renderer/components/return/Arrival';
import { SITUATION_TEMPLATES } from '../../../src/main/intelligence-host/situationCopy.generated';
import type { Situation, TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

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

const NOW = new Date('2026-08-21T08:00:00.000Z');

const GATE = {
  checkpointId: 'cp.backup',
  index: 4,
  of: 8,
  awaits: 'evidence' as const,
  runbookId: 'rb.bulk-plugin-update',
  capability: 'cap.bulk_plugin_update',
};

/** A situation carrying whatever the case needs. Every field the card reads. */
function situation(over: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1', kind: 'session', column: 'waiting', tier: 2,
    tierReason: 'waiting, and nothing has been written in scope',
    capability: 'cap.bulk_plugin_update',
    sessionId: 'sess_1',
    places: { tokens: [], highest: null, atHighest: 0, total: 0, unresolved: 0, summary: '' },
    since: '2026-08-19T08:00:00.000Z', lastEventId: 'evt_1',
    parts: [{ kind: 'run', summary: 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed' }],
    headline: 'h', ask: '', chip: '', state: '', meta: 'rb.bulk-plugin-update',
    rule: 'waiting, and nothing has been written in scope',
    headlineTemplate: null,
    written: { done: 0, failed: 0, total: null },
    ...over,
  } as Situation;
}

function triageOf(rows: Situation[]): TriageView {
  return {
    waiting: rows, changed: [], working: [],
    reserved: { headline: 'the record is reporting', dark: [], staleCount: 0, verdict: 'ok', degraded: false } as any,
    verdict: '', cursor: 'evt_1',
    // WP-56 · `TriageView.counts` — the host now owns the escalating count, so
    // a fixture must supply it. DERIVED FROM `rows` rather than written as a
    // literal, for the contract's own reason: a hand-written count is free to
    // disagree with the list it describes, which is exactly the defect the
    // field exists to remove. Nothing in this suite reads it.
    counts: {
      needsYou: rows.filter((r) => !r.deferral).length,
      deferred: rows.filter((r) => r.deferral).length,
    },
  };
}

/** The one card, as the surface renders it. */
function card(row: Situation): { node: any; text: string; nodes: any[] } {
  const store = { getItem: () => null, setItem: () => undefined };
  const instance: any = new (Arrival as any)({
    electron: { ipcRenderer: { invoke: () => Promise.resolve(triageOf([row])) } },
    store, now: NOW,
  });
  instance.state = { triage: triageOf([row]), loading: false, error: null, awayMs: 3_600_000 };
  const tree = serializeTree(instance.render());
  const node = walk(tree).find((n) => props(n)['data-situation'] === row.id);
  expect(node).toBeDefined();
  return { node, text: textOf(node).join('\n'), nodes: walk(node) };
}

/** How many times a string occurs in the card's rendered text. */
function occurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = text.indexOf(needle);
  while (i >= 0) { n += 1; i = text.indexOf(needle, i + needle.length); }
  return n;
}

// ---------------------------------------------------------------------------
// 1 · the count, over every ratified class
// ---------------------------------------------------------------------------

describe('a ratified card says its ask exactly once, and nothing from the old render survives', () => {
  // The ratified set is the authority — not a list retyped here, so a class the
  // designer adds is driven the day it lands rather than the day someone
  // remembers to add it.
  test('the set under test IS the ratified set, and it is not empty', () => {
    expect(SITUATION_TEMPLATES.length).toBeGreaterThan(0);
    expect(SITUATION_TEMPLATES.map((t) => t.id)).toContain('run.waiting.mid-procedure');
  });

  for (const template of SITUATION_TEMPLATES) {
    test(`${template.id} · the ask appears EXACTLY ONCE`, () => {
      // The specimen ask, filled the way the composer fills it — the slots are
      // irrelevant to the count, and leaving them braced keeps the string
      // distinctive enough that a partial re-statement elsewhere would show.
      const ask = template.ask;
      const { text } = card(situation({
        headlineTemplate: template.id,
        headline: template.headline,
        ask,
        chip: template.chip,
        state: template.state,
        rule: template.rule,
        gate: GATE,
      }));

      expect(occurrences(text, ask)).toBe(1);
    });

    test(`${template.id} · no line from the pre-template render survives`, () => {
      const { nodes, text } = card(situation({
        headlineTemplate: template.id,
        headline: template.headline,
        ask: template.ask,
        chip: template.chip,
        state: template.state,
        rule: template.rule,
        gate: GATE,
        parts: [
          { kind: 'run', summary: 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed' },
          { kind: 'incident', summary: 'incident open: Known backdoor plugin detected' },
        ],
      }));

      // The three lines the defect left standing, by their own markers.
      expect(nodes.filter((n) => props(n)['data-part'] !== undefined)).toHaveLength(0);
      expect(nodes.filter((n) => props(n)['data-gate'] !== undefined)).toHaveLength(0);
      expect(text).not.toContain('Needs your');
      // …and by their text, so a marker rename cannot pass this.
      expect(text).not.toContain('0 done and standing, 0 failed');
      expect(text).not.toContain('incident open:');
      expect(text).not.toContain(' — 4 of 8 in ');
    });

    test(`${template.id} · the three lines the template DOES own are all present`, () => {
      // The other half of "replacing": a card that dropped everything would pass
      // the two assertions above and be a blank.
      const { text } = card(situation({
        headlineTemplate: template.id,
        headline: template.headline,
        ask: template.ask,
        chip: template.chip,
        state: template.state,
        rule: template.rule,
        meta: 'rb.bulk-plugin-update',
        gate: GATE,
      }));

      expect(text).toContain(template.headline);
      expect(text).toContain(template.ask);
      expect(text).toContain(template.rule);
      expect(text).toContain('rb.bulk-plugin-update');   // the meta line's identifier
    });
  }
});

// ---------------------------------------------------------------------------
// 2 · the other direction — a derived card KEEPS what it needs
// ---------------------------------------------------------------------------

describe('a DERIVED card keeps the parts, the gate and what the gate needs', () => {
  test('J-Return\'s WHERE survives on the one card that has no ask to carry it', () => {
    const { nodes, text } = card(situation({
      headlineTemplate: null,
      headline: 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed',
      ask: '',
      gate: GATE,
      parts: [{ kind: 'incident', summary: 'incident open: something happened' }],
    }));

    // A derived card has NO ask, so the gate lines are the only WHERE it has.
    expect(nodes.filter((n) => props(n)['data-gate'] !== undefined)).toHaveLength(1);
    expect(text).toContain('cp.backup');
    expect(text).toContain('Needs your evidence');
    expect(nodes.filter((n) => props(n)['data-part'] !== undefined)).toHaveLength(1);
    expect(text).toContain('incident open: something happened');
  });

  test('WP-50\'s dedup still holds on a derived card — the headline is not repeated as a part', () => {
    const derived = 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed';
    const { nodes } = card(situation({
      headlineTemplate: null,
      headline: derived,
      parts: [{ kind: 'run', summary: derived }],
    }));
    expect(nodes.filter((n) => props(n)['data-part'] !== undefined)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3 · item 3 — the rule line
// ---------------------------------------------------------------------------

describe('the rule line renders the template\'s own rule, upright', () => {
  test('a ratified card shows the ratified rule — tier named, not a lowercase fragment', () => {
    const { nodes, text } = card(situation({
      headlineTemplate: 'run.waiting.mid-procedure',
      rule: 'Tier 2 · the world is untouched',
      ask: 'a',
    }));
    const rule = nodes.find((n) => props(n)['data-rule'] !== undefined);
    expect(rule).toBeDefined();
    expect(props(rule)['data-rule']).toBe('template');
    expect(text).toContain('Tier 2 · the world is untouched');
    // The lowercase fragment the designer objected to is NOT what the row shows.
    expect(text).not.toContain('waiting, and nothing has been written in scope');
  });

  test('a DERIVED card shows the derived reason — XD-23\'s evidence, where no ratified rule exists', () => {
    const { nodes, text } = card(situation({
      headlineTemplate: null,
      rule: 'a write has landed in scope — 2 target(s) with a recorded act',
    }));
    expect(props(nodes.find((n) => props(n)['data-rule'] !== undefined))['data-rule']).toBe('derived');
    expect(text).toContain('a write has landed in scope — 2 target(s) with a recorded act');
  });

  test('UPRIGHT · the rule line carries no italic treatment', () => {
    const { nodes } = card(situation({ headlineTemplate: 'incident.no-run', rule: 'Tier 1 · x', ask: 'a' }));
    const rule = nodes.find((n) => props(n)['data-rule'] !== undefined);
    // "Italics is a treatment nothing ratified." Asserted on the style itself,
    // because this is the whole of the finding — the text would read the same.
    expect(props(rule).style?.fontStyle).toBeUndefined();
  });
});
