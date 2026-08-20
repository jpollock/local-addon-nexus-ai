/**
 * WP-46 · THE ARRIVAL, RENDERED (M6 · XD-26 §6a, XD-23).
 *
 * The registry's own suite pins the FOLD. This one pins the things a correct
 * fold can still be drawn wrongly, and it draws them against the real fold: the
 * designer's "one morning, both ways" is built through the real emitters into a
 * real ledger and folded by the real `createSessionRegistry`, and the component
 * renders THAT `TriageView`. A hand-written triage fixture would be a second
 * transcription of the consequence order, and the one property this surface must
 * have is that it says what the fold says.
 *
 * The J-Return pins this file drives:
 *
 *  1. Two columns of one verdict, each ordered within itself by the rank the
 *     registry supplied — asserted ROW FOR ROW against the fold, in order.
 *  2. Every waiting row names its gate BY CHECKPOINT ID, from `PendingGate`.
 *  3. The headline is about the user's absence, with the accounting line in one
 *     breath, generated from the same three counts the columns render.
 *  4. The reserved health row is one row, from `ReservedRow`, and cannot scroll
 *     away.
 *  5. No badge on the changed column; the badge is the waiting count.
 *  6. No drift rows — the count and where the facts live, in one line.
 *  7. No interaction and no question asked.
 */
import * as React from 'react';

import { serializeTree } from './helpers/serializeTree';
import { assertGoldenShape, buildMorning, NOW, type Morning } from './helpers/returnMorning';
import { Arrival, ageLabel, LAST_ARRIVAL_KEY } from '../../../src/renderer/components/return/Arrival';
import { AUTHORED, accountingLine, arrivalCounts, promotableSessionId } from '../../../src/renderer/components/return/arrivalModel';
import { RETURN_COPY } from '../../../src/renderer/components/return/returnCopy.generated';
import type { TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

let morning: Morning;
let triage: TriageView;

beforeEach(() => {
  morning = buildMorning();
  triage = assertGoldenShape(morning);
});

afterEach(() => {
  morning.close();
});

/**
 * Every ELEMENT in a serialized tree, flattened DEEPLY.
 *
 * `serializeTree` emits `{type, key, props, children}` and `children` is itself
 * a serialized node OR an array of them — a component that spreads an array of
 * children produces exactly that, and a one-level walk silently skips every node
 * inside it. That trap is `governMatrix.test.tsx`'s finding and this file
 * inherits it: the first draft of these helpers read attributes off the node
 * rather than off `props`, and reported "no door rendered" against two doors.
 */
function walk(node: any, out: any[] = []): any[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  walk(node.children, out);
  return out;
}

/** Every text node beneath an element, in document order. */
function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out; }
  if (typeof node === 'object') textOf(node.children, out);
  return out;
}

/** One serialized element's props — where every `data-*` attribute lives. */
const props = (node: any): Record<string, any> => (node && node.props) || {};

const store = () => {
  const kv = new Map<string, string>();
  return {
    kv,
    getItem: (k: string) => kv.get(k) ?? null,
    setItem: (k: string, v: string) => { kv.set(k, v); },
  };
};

/** Render the arrival over the real fold, with the IPC round trip stubbed. */
function arrival(overrides: any = {}): { instance: any; tree: any; nodes: any[] } {
  const electron = { ipcRenderer: { invoke: jest.fn().mockResolvedValue(triage) } };
  const instance = new (Arrival as any)({ electron, now: NOW, store: store(), ...overrides });
  instance.state = { triage, loading: false, error: null, awayMs: 12 * 3_600_000, ...(overrides.state ?? {}) };
  const tree = serializeTree(instance.render());
  return { instance, tree, nodes: walk(tree) };
}

const byAttr = (nodes: any[], attr: string) => nodes.filter((n) => props(n)[attr] !== undefined);

describe('WP-48 · the verdict is READ, and the badge holds one word', () => {
  /**
   * The composer is pinned in the host. What these pin is the SEAM: that the
   * component renders those fields verbatim and composes nothing of its own —
   * the property the ratified placement argument is worth having.
   */

  test('every row renders the host\'s headline verbatim, and none is composed here', () => {
    const { tree } = arrival();
    const rows = byAttr(walk(tree), 'data-situation');
    const all = [...triage.waiting, ...triage.changed];
    expect(rows).toHaveLength(all.length);

    for (const situation of all) {
      const row = rows.find((n) => props(n)['data-situation'] === situation.id);
      const text = textOf(row).join(' ');
      expect({ id: situation.id, rendered: text.includes(situation.headline) })
        .toEqual({ id: situation.id, rendered: true });
    }
  });

  test('the headline node reports WHICH class composed it, or that it was derived', () => {
    const { tree } = arrival();
    const marks = byAttr(walk(tree), 'data-headline').map((n) => props(n)['data-headline']);
    const expected = [...triage.waiting, ...triage.changed].map((s) => s.headlineTemplate ?? 'derived');
    expect(marks).toEqual(expected);
  });

  test('the ask follows the headline, and a row without one renders no empty line', () => {
    const { tree } = arrival();
    const asks = byAttr(walk(tree), 'data-ask');
    const withAsk = [...triage.waiting, ...triage.changed].filter((s) => s.ask !== '');
    expect(asks).toHaveLength(withAsk.length);
    expect(asks.map((n) => textOf(n).join(''))).toEqual(withAsk.map((s) => s.ask));
  });

  test('the chip is ONE WORD, and a class with no chip renders NO badge', () => {
    const { tree } = arrival();
    const chips = byAttr(walk(tree), 'data-chip');
    const withChip = [...triage.waiting, ...triage.changed].filter((s) => s.chip !== '');
    expect(chips).toHaveLength(withChip.length);
    for (const chip of chips) {
      const word = props(chip)['data-chip'];
      // The rule, asserted at the render rather than only at the copy: whatever
      // the set says, what reaches a badge here carries no whitespace.
      expect({ word, isOneWord: !/\s/.test(word) }).toEqual({ word, isOneWord: true });
      expect(textOf(chip).join('')).toBe(word);
    }
  });

  test('the status phrase is on the META line, as text — never in the badge', () => {
    const { tree } = arrival();
    const rows = byAttr(walk(tree), 'data-situation');
    for (const situation of [...triage.waiting, ...triage.changed]) {
      if (situation.state === '') continue;
      const row = rows.find((n) => props(n)['data-situation'] === situation.id);
      // Present somewhere in the row…
      expect(textOf(row).join(' ')).toContain(situation.state);
      // …and NOT as the badge, which is the whole point of moving it.
      const chip = walk(row).find((n) => props(n)['data-chip'] !== undefined);
      expect(chip === undefined || props(chip)['data-chip'] !== situation.state).toBe(true);
    }
  });

  test('the rule line stays the DERIVED tierReason, not the template\'s tier label', () => {
    // XD-23's line names the evidence that placed the row. The ratified `rule`
    // field restates the tier, and trading evidence for a label would be the
    // regression that line exists to prevent — so it is carried and not drawn.
    const { tree } = arrival();
    const rows = byAttr(walk(tree), 'data-situation');
    for (const situation of triage.waiting) {
      const row = rows.find((n) => props(n)['data-situation'] === situation.id);
      const text = textOf(row).join(' ');
      expect(text).toContain(situation.tierReason);
      expect(text).not.toContain('Tier 1 · mid-change');
      expect(text).not.toContain('Tier 2 · the world is untouched');
    }
  });

  test('the list verdict is rendered from the TriageView, and an empty one draws nothing', () => {
    const { tree } = arrival();
    const verdict = walk(tree).find((n) => props(n)['data-verdict'] !== undefined);
    expect(verdict).toBeDefined();
    expect(textOf(verdict).join('')).toBe(triage.verdict);
    expect(triage.verdict).not.toBe('');

    const empty = arrival({ state: { triage: { ...triage, verdict: '' } } });
    expect(walk(empty.tree).find((n) => props(n)['data-verdict'] !== undefined)).toBeUndefined();
  });

  test('the parts still render beneath the verdict — a verdict does not replace the record', () => {
    // Tear 2: a correct list of parts is not a verdict about the whole. The row
    // now says both, and this is what would fail if the parts were dropped in
    // favour of the sentence.
    const { tree } = arrival();
    const rows = byAttr(walk(tree), 'data-situation');
    const charlie = triage.waiting[0];
    const row = rows.find((n) => props(n)['data-situation'] === charlie.id);
    const parts = walk(row).filter((n) => props(n)['data-part'] !== undefined);
    expect(parts).toHaveLength(charlie.parts.length);
    expect(parts.map((n) => textOf(n).join(''))).toEqual(charlie.parts.map((p) => p.summary));
  });
});

describe('the arrival renders the fold — row for row', () => {
  test('two columns of ONE VERDICT, each in the order the registry supplied', () => {
    const { tree } = arrival();

    const waitingColumn = walk(tree).find((n) => props(n)['data-column'] === 'waiting');
    const changedColumn = walk(tree).find((n) => props(n)['data-column'] === 'changed');
    expect(waitingColumn).toBeDefined();
    expect(changedColumn).toBeDefined();

    const idsIn = (column: any) => byAttr(walk(column), 'data-situation').map((n) => props(n)['data-situation']);

    // ROW FOR ROW, IN ORDER. Not a set comparison: the consequence order IS the
    // ordering, so a render that draws the right rows in the wrong order has
    // lost the only thing the fold ranked.
    expect(idsIn(waitingColumn)).toEqual(triage.waiting.map((s) => s.id));
    expect(idsIn(changedColumn)).toEqual(triage.changed.map((s) => s.id));

    // And the morning is the designer's: Charlie before Bravo, one changed row.
    expect(idsIn(waitingColumn)).toHaveLength(2);
    expect(idsIn(changedColumn)).toHaveLength(1);
  });

  test('every waiting row names its gate BY CHECKPOINT ID, from PendingGate', () => {
    const { nodes } = arrival();
    const gated = byAttr(nodes, 'data-gate');

    // The fold puts a gate on exactly one of this morning's waiting situations
    // (Bravo's); the assertion is over what the FOLD says, never over a number
    // typed here.
    const expected = triage.waiting.filter((s) => s.gate).map((s) => s.gate!.checkpointId);
    expect(expected.length).toBeGreaterThan(0);
    expect(gated.map((n) => props(n)['data-gate'])).toEqual(expected);

    // The checkpoint id is rendered AS AN ID, and the position beside it is the
    // document's own — every value read off the fold's `PendingGate`, never
    // typed here. BOTH of this morning's waiting rows carry a gate: Charlie
    // stopped at `cp.verify` 7 of 8, Bravo waits at `cp.approval` 3 of 8, which
    // is the designer's own "approval gate 3 of 8 in remediate".
    const gates = triage.waiting.filter((s) => s.gate).map((s) => s.gate!);
    for (const [i, gate] of gates.entries()) {
      const line = textOf(gated[i]).join('');
      expect(line).toContain(gate.checkpointId);
      expect(line).toContain(`${gate.index} of ${gate.of}`);
      expect(line).toContain(gate.runbookId as string);
    }

    // …and the morning is the designer's, so the gate line reads as drawn.
    const lines = gated.map((n) => textOf(n).join(''));
    expect(lines).toContain('Waiting at cp.approval — 3 of 8 in rb.remediate');
  });

  test('the headline is about the ABSENCE, and the accounting line is one breath of the same counts', () => {
    const { nodes } = arrival();
    const away = byAttr(nodes, 'data-away')[0];
    const accounting = byAttr(nodes, 'data-accounting')[0];

    expect(textOf(away).join('')).toBe('You were away 12 hours');

    // Generated from the counts the columns render, never typed. The equality
    // below would hold for any morning, which is the point.
    const counts = arrivalCounts(triage);
    expect(textOf(accounting).join('')).toBe(accountingLine(counts));
    expect(textOf(accounting).join('')).toBe('2 need you · 1 changed overnight · 3 checks dark');
  });

  test('the first ever open states the platform\'s limit rather than an absence of zero', () => {
    const { nodes } = arrival({ state: { awayMs: null } });
    expect(textOf(byAttr(nodes, 'data-away')[0]).join('')).toBe(AUTHORED.AWAY_UNKNOWN);
    expect(textOf(byAttr(nodes, 'data-away')[0]).join('')).not.toContain('0 hours');
  });

  test('the absence is read BEFORE it is stamped — otherwise every arrival reports zero', () => {
    const s = store();
    s.kv.set(LAST_ARRIVAL_KEY, new Date(NOW.getTime() - 12 * 3_600_000).toISOString());
    const electron = { ipcRenderer: { invoke: jest.fn().mockResolvedValue(triage) } };
    const instance = new (Arrival as any)({ electron, now: NOW, store: s });
    const captured: any[] = [];
    instance.setState = (patch: any) => captured.push(patch);

    (instance as any).readAbsence();

    expect(captured[0].awayMs).toBe(12 * 3_600_000);
    // …and the stamp moved forward, so the NEXT arrival measures from now.
    expect(s.kv.get(LAST_ARRIVAL_KEY)).toBe(NOW.toISOString());
  });
});

describe('the reserved slot, the badge, and the drift line', () => {
  test('the reserved health row is ONE row, sticky, however many producers are dark', () => {
    const { nodes } = arrival();
    const reserved = byAttr(nodes, 'data-reserved');

    expect(reserved).toHaveLength(1);
    expect(triage.reserved.dark).toHaveLength(3);

    // Three dark producers, ONE row saying three — never three rows.
    const text = textOf(reserved[0]).join(' ');
    expect(text).toContain(triage.reserved.headline);
    expect(text).toContain('plugin inventory');
    expect(text).toContain('content age');
    expect(props(reserved[0]).style.position).toBe('sticky');
  });

  test('the badge is the WAITING count, and the changed column has none', () => {
    const { tree } = arrival();
    const waitingColumn = walk(tree).find((n) => props(n)['data-column'] === 'waiting');
    const changedColumn = walk(tree).find((n) => props(n)['data-column'] === 'changed');

    const badgesIn = (column: any) => walk(column).filter((n) => props(n)['data-badge'] === 'needsYou');

    expect(badgesIn(waitingColumn)).toHaveLength(1);
    expect(textOf(badgesIn(waitingColumn)[0]).join('')).toBe(String(triage.waiting.length));

    // XD-26's absence, with teeth: nothing in `changed` needs anyone, so nothing
    // in it escalates.
    expect(badgesIn(changedColumn)).toHaveLength(0);
    expect(walk(changedColumn).filter((n) => props(n)['data-badge'] !== undefined)).toHaveLength(0);
  });

  test('drift renders as ONE line and NO rows — T5 leaves the list', () => {
    const { nodes } = arrival();
    const drift = byAttr(nodes, 'data-drift');

    expect(drift).toHaveLength(1);
    const line = textOf(drift[0]).join('');
    // Where the facts live — the designer's own second sentence, verbatim.
    expect(line).toContain(RETURN_COPY.DRIFT_REST);
    // The count has no channel into WP-30's contract, so the line says so
    // rather than borrowing the producer-liveness number sitting next to it.
    expect(line).toContain(AUTHORED.DRIFT_NO_COUNT);
    expect(line).not.toMatch(/\d+ facts are past/);

    // And no drift ROW anywhere: every situation drawn is one the fold ranked.
    const drawn = byAttr(nodes, 'data-situation');
    expect(drawn).toHaveLength(triage.waiting.length + triage.changed.length);
    expect(drawn.map((n) => props(n)['data-tier'])).not.toContain(3);
  });

  test('the changed column carries its provenance line — nothing composed on demand', () => {
    const { tree } = arrival();
    const changedColumn = walk(tree).find((n) => props(n)['data-column'] === 'changed');
    const filed = walk(changedColumn).filter((n) => props(n)['data-filed'] !== undefined);

    expect(filed).toHaveLength(1);
    expect(textOf(filed[0]).join('')).toBe(RETURN_COPY.FILED_BEFORE_YOU_ARRIVED);
  });
});

describe('the absences — pins, not omissions', () => {
  test('no interaction and no question asked: the only controls are the waiting doors', () => {
    const { nodes } = arrival();

    // No question of any kind. A ceremony on the arrival is J-Glance's must-not
    // and XD-26's "no confirm-you-are-back" in the same breath.
    for (const tag of ['input', 'select', 'textarea', 'form']) {
      expect(nodes.filter((n) => n.type === tag)).toHaveLength(0);
    }

    const buttons = nodes.filter((n) => n.type === 'button');
    const doors = byAttr(nodes, 'data-door');
    expect(buttons).toHaveLength(doors.length);

    // One door per waiting row, and it carries the session it promotes.
    expect(doors.map((n) => props(n)['data-door'])).toEqual(
      triage.waiting.map((s) => s.sessionId).filter(Boolean),
    );
    for (const door of doors) {
      expect(textOf(door).join('')).toBe(RETURN_COPY.ROW_DOOR);
    }
  });

  test('the door promotes the session the ROW belongs to — the id travels unchanged', () => {
    const promoted: string[] = [];
    const { instance } = arrival({ onPromote: (id: string) => promoted.push(id) });

    const sessionId = triage.waiting[0].sessionId!;
    instance.promote(sessionId)();

    expect(promoted).toEqual([sessionId]);
  });

  /**
   * A SITUATION OF ONE IS STILL A SITUATION — and it is not a session.
   *
   * Battery finding (M13 survived the first drive): both waiting rows in the
   * designer's morning are sessions, so a `promotableSessionId` that fell back
   * to the situation's own id changed nothing observable. The golden fixture
   * cannot pin this on its own; the eval fixture's ledger has incident-only
   * rows and this one now does too.
   */
  describe('an incident of its own — a waiting row with no session behind it', () => {
    const incident = (): any => ({
      id: 'evt_incident_1',
      kind: 'incident',
      column: 'waiting',
      tier: 2,
      tierReason: 'an open incident with no run linked to it — nothing has been written under a procedure',
      places: { tokens: [], highest: null, atHighest: 0, total: 0, unresolved: 0, summary: 'no targets on record' },
      since: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
      lastEventId: 'evt_incident_1',
      parts: [{ kind: 'incident', eventId: 'evt_incident_1', summary: 'checkout returned 500' }],
    });

    test('promotableSessionId returns null for it — an event id is not a session id', () => {
      expect(promotableSessionId(incident())).toBeNull();
      expect(promotableSessionId(triage.waiting[0])).toBe(triage.waiting[0].sessionId);
    });

    test('it renders as a row, and it gets NO door — there is no session to promote', () => {
      const withIncident = { ...triage, waiting: [...triage.waiting, incident()] };
      const { nodes } = arrival({ state: { triage: withIncident } });

      // The row is drawn: an incident of one is still a situation, and dropping
      // it would be worse than giving it a door it cannot honour.
      expect(byAttr(nodes, 'data-situation').map((n) => props(n)['data-situation'])).toContain('evt_incident_1');
      // …and the doors are exactly the sessions', never the incident's event id.
      const doors = byAttr(nodes, 'data-door').map((n) => props(n)['data-door']);
      expect(doors).toEqual(triage.waiting.map((s) => s.sessionId));
      expect(doors).not.toContain('evt_incident_1');
    });
  });

  test('every row shows the RULE that placed it, and the rule is the fold\'s own', () => {
    const { nodes } = arrival();
    const rows = byAttr(nodes, 'data-situation');
    const all = [...triage.waiting, ...triage.changed];

    for (const [i, row] of rows.entries()) {
      expect(textOf(row).join(' ')).toContain(all[i].tierReason);
    }
  });

  test('no re-entry surface, and no transcript, on the arrival', () => {
    const { nodes } = arrival();
    expect(nodes.filter((n) => props(n)['data-surface'] === 'return-reentry')).toHaveLength(0);
    // Every text node on the arrival traces to a fold field or a ratified string;
    // a turn's prose would arrive as a `data-turn`/role, and there is none.
    expect(byAttr(nodes, 'data-turn')).toHaveLength(0);
    expect(nodes.filter((n) => props(n).role === 'log')).toHaveLength(0);
  });
});

describe('the age label', () => {
  test('whole hours from the situation\'s own `since`', () => {
    expect(ageLabel(new Date(NOW.getTime() - 14 * 3_600_000).toISOString(), NOW)).toBe('14h');
    expect(ageLabel(new Date(NOW.getTime() - 5 * 3_600_000).toISOString(), NOW)).toBe('5h');
  });

  test('an unparseable instant renders nothing rather than NaN', () => {
    expect(ageLabel('not-a-date', NOW)).toBe('');
  });
});
