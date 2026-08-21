/**
 * WP-54 · THE NOW LIST — one list, one count, one tier, and a door on every row.
 *
 * The owner reviewed the shipped Now screen against the requirements and the
 * architect and designer read the same screenshots. What they found is one
 * family of defect wearing several coats: **two derivations of one fact, free to
 * disagree.** The list and the badge counted different populations; the rule
 * line and the comparator named different tiers; the headline said the record
 * could not name a target while the card six inches below printed its name.
 *
 * These pins are written against the DEFECT rather than against the fix: each
 * one can be made to fail by restoring the shape that shipped, and several
 * construct that shape explicitly so the assertion has something to catch.
 */
import * as React from 'react';

import { serializeTree } from './helpers/serializeTree';
import { NOW } from './helpers/returnMorning';
import { Arrival } from '../../../src/renderer/components/return/Arrival';
import { SessionReEntry } from '../../../src/renderer/components/return/SessionReEntry';
import { Button, hasDesignSystem } from '../../../src/renderer/components/designSystem';
import {
  arrivalCounts,
  nowRows,
  nowVerdict,
  sameThing,
  stripeColour,
} from '../../../src/renderer/components/return/arrivalModel';
import {
  COLOURS,
  DOORS,
  RESERVED,
} from '../../../src/main/intelligence-host/situationCopy.generated';
import { RETURN_COPY } from '../../../src/renderer/components/return/returnCopy.generated';
import type { Situation, TriageView } from '../../../src/main/intelligence-host/sessionRegistry';
import type { InboxItem } from '../../../src/main/inbox/types';

// ---------------------------------------------------------------------------
// The owner's real screen, in miniature
// ---------------------------------------------------------------------------

/**
 * THE FOUR FINDINGS, as the fold composed them on the owner's ledger — same
 * producer, same site, four different facts. Measured 2026-08-21 against a copy
 * of the live ledger: `act_security_sentinel`, `ent_env_2TH5EJB…` resolving to
 * `theawfulpm-test` through the `site.core` twin, facts ABS-04/05/07 and FS-01.
 */
const FINDINGS: Array<{ id: string; fact: string; symptom: string }> = [
  { id: 'evt_a', fact: 'ABS-04', symptom: 'File manager plugin(s) active: fileorganizer, filester' },
  { id: 'evt_b', fact: 'ABS-05', symptom: 'Known backdoor plugin detected: wp-compat' },
  { id: 'evt_c', fact: 'ABS-07', symptom: 'Low-entropy plugin name(s) — likely attacker-created: noted, index' },
  { id: 'evt_d', fact: 'FS-01', symptom: 'PHP file(s) in mu-plugins/: index.php' },
];

function incident(f: { id: string; fact: string; symptom: string }): Situation {
  return {
    id: f.id,
    kind: 'incident',
    column: 'waiting',
    tier: 1,
    tierReason: 'an open incident with no run linked to it',
    places: { tokens: [], highest: null, atHighest: 0, total: 1, unresolved: 1, summary: '' },
    since: '2026-08-18T22:25:24.386Z',
    lastEventId: f.id,
    parts: [],
    headline: `${f.symptom} on theawfulpm-test, and nothing is fixing it`,
    ask: 'Contain it now, or say why not. Nothing has been written under a procedure.',
    chip: '',
    state: 'No run attached',
    meta: 'act_security_sentinel',
    rule: 'Tier 1 · nothing is holding it back but you',
    headlineTemplate: 'incident.no-run',
    door: { label: 'Open theawfulpm-test', kind: 'site', target: 'theawfulpm-test' },
    signature: { producer: 'security-sentinel', fact: f.fact, target: 'theawfulpm-test' },
    written: { done: 0, failed: 0, total: null },
  };
}

/** The Inbox's copy of the same four, plus the one it holds alone. */
function inboxItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 1,
    source: 'security-sentinel',
    code: 'ABS-04',
    scope: 'name:theawfulpm-test',
    scopeLabel: 'theawfulpm-test',
    kind: 'decide',
    title: 'File manager plugin(s) active: fileorganizer, filester',
    status: 'open',
    firstSeenAt: 1,
    lastSeenAt: 1,
    seenCount: 1,
    ...over,
  };
}

const AUTH_PROBE = inboxItem({
  id: 9,
  source: 'auth-probe',
  code: 'fail:9da26a69397e',
  scope: '*',
  scopeLabel: 'This agent',
  kind: 'problem',
  title: 'auth-probe could not finish a run',
});

function triageOf(waiting: Situation[]): TriageView {
  return {
    waiting,
    changed: [],
    working: [],
    reserved: { headline: RESERVED.quiet, dark: [], staleCount: 0, verdict: 'OK', degraded: false } as any,
    verdict: '',
    cursor: 'evt_d',
  };
}

const walk = (node: any, out: any[] = []): any[] => {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  return walk(node.children, out);
};
const props = (n: any): any => n?.props ?? {};
const byAttr = (nodes: any[], name: string): any[] => nodes.filter((n) => props(n)[name] !== undefined);
function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  if (typeof node !== 'object') return out;
  return textOf(node.children, out);
}

function render(triage: TriageView, inbox?: any, extra: any = {}) {
  const electron = { ipcRenderer: { invoke: jest.fn().mockResolvedValue(triage) } };
  const store = { getItem: () => null, setItem: () => undefined };
  const instance = new (Arrival as any)({ electron, now: NOW, store, inbox, ...extra });
  instance.state = { triage, loading: false, error: null, awayMs: 12 * 3_600_000 };
  const tree = serializeTree(instance.render());
  return { instance, tree, nodes: walk(tree) };
}

const fullInbox = (items: InboxItem[]) => ({
  loaded: true,
  failed: false,
  items,
  total: items.length,
  pausedSources: [],
  recentlyDecided: [],
});

// ---------------------------------------------------------------------------
// Item 1 · the dedup
// ---------------------------------------------------------------------------

describe('item 1 · the list renders each thing once', () => {
  /**
   * THE DEFECT, REPRODUCED AND MEASURED. `Arrival.tsx` concatenated
   * `triage.waiting.map(...)` with `renderInboxRows()` and deduplicated nothing,
   * so on the owner's real fleet FOUR security findings rendered as situations
   * and again as inbox cards: twelve cards under a badge of seven.
   */
  test('four findings and their four inbox copies are FOUR rows, not eight', () => {
    const triage = triageOf(FINDINGS.map(incident));
    const items = FINDINGS.map((f, i) => inboxItem({ id: i + 1, code: f.fact, title: f.symptom }));

    expect(nowRows(triage, fullInbox(items))).toHaveLength(4);

    const { tree, nodes } = render(triage, fullInbox(items));
    const rows = byAttr(nodes, 'data-situation');
    expect(rows).toHaveLength(4);

    // …and each finding's own words appear ONCE on the whole screen. Counted
    // over the rendered TEXT rather than over rows, because a duplicate that
    // moved into the section below would satisfy a per-list row count and still
    // be the same finding said twice — which is what shipped.
    const screen = textOf(tree).join(' ');
    for (const finding of FINDINGS) {
      expect(screen.split(finding.symptom)).toHaveLength(2);
    }
  });

  test('an inbox item with NO matching situation is its own row, and keeps its door', () => {
    const triage = triageOf(FINDINGS.map(incident));
    const rows = nowRows(triage, fullInbox([...FINDINGS.map((f, i) => inboxItem({ id: i + 1, code: f.fact })), AUTH_PROBE]));

    expect(rows).toHaveLength(5);
    const own = rows[rows.length - 1];
    expect(own.situation).toBeNull();
    expect(own.item!.id).toBe(AUTH_PROBE.id);
    // WP-54a has not landed, so this row is the ONLY way `auth-probe` reaches
    // the person. A dedup that dropped unmatched items would remove it silently.
    expect(own.door).toEqual({ label: 'Open auth-probe', kind: 'agent', target: 'auth-probe' });
  });

  test('THE BADGE AND THE ROWS ARE ONE NUMBER, both directions', () => {
    const triage = triageOf(FINDINGS.map(incident));

    // Duplicates do not inflate it…
    const withDupes = fullInbox(FINDINGS.map((f, i) => inboxItem({ id: i + 1, code: f.fact })));
    expect(arrivalCounts(triage, withDupes).needsYou).toBe(4);
    expect(arrivalCounts(triage, withDupes).needsYou).toBe(nowRows(triage, withDupes).length);

    // …and a row the fold does not hold is not omitted from it.
    const withOrphan = fullInbox([AUTH_PROBE]);
    expect(arrivalCounts(triage, withOrphan).needsYou).toBe(5);
    expect(arrivalCounts(triage, withOrphan).needsYou).toBe(nowRows(triage, withOrphan).length);

    // And the sentence heading the list counts the same rows it heads.
    expect(nowVerdict(triage, withOrphan)).toContain('5 things need you');
  });

  test('the match needs ALL THREE facts — any one of them alone collides in the real data', () => {
    const situation = incident(FINDINGS[0]);
    expect(sameThing(situation, inboxItem())).toBe(true);

    // Same fact and site, DIFFERENT producer: two agents can raise the same code.
    expect(sameThing(situation, inboxItem({ source: 'auth-probe' }))).toBe(false);
    // Same producer and site, DIFFERENT fact: four findings sit on one site.
    expect(sameThing(situation, inboxItem({ code: 'ABS-05' }))).toBe(false);
    // Same producer and fact, DIFFERENT site: every site can carry FS-01.
    expect(sameThing(situation, inboxItem({ scope: 'name:other', scopeLabel: 'other' }))).toBe(false);

    // The two stores spell the producer differently and neither is rewritten:
    // the ledger stamps an actor, the Inbox stores an agent.
    expect(situation.signature!.producer).toBe('security-sentinel');
    expect(sameThing(situation, inboxItem({ source: 'security_sentinel' }))).toBe(true);

    // A run has no signature, so nothing in the Inbox is ever the same thing.
    expect(sameThing({ ...situation, signature: null }, inboxItem())).toBe(false);
  });

  /**
   * BATTERY SURVIVOR M09 — the two spellings of the target, each pinned alone.
   *
   * The Inbox keys on a NAMESPACED scope (`name:theawfulpm-test`) and displays a
   * LABEL, and the match accepts either. Both branches were live and neither was
   * pinned on its own, so a mutation removing one survived behind the other —
   * the vacuous-guard shape where an `||` hides a dead half.
   *
   * They are not redundant. `scopeLabel` is a DISPLAY field: "12 sites" and
   * "This agent" are both real values of it, so a match resting on it alone
   * would be resting on prose. `scope` is what the store keys on and is the
   * fact; the label is the courtesy.
   */
  test('the target matches on the SCOPE alone, and on the LABEL alone', () => {
    const situation = incident(FINDINGS[0]);

    // Label says something else entirely — the scope still carries the fact.
    expect(sameThing(situation, inboxItem({ scopeLabel: 'This site' }))).toBe(true);
    // Scope is unnamespaced — the label still carries it.
    expect(sameThing(situation, inboxItem({ scope: 'somethingelse' }))).toBe(true);
    // Neither: no match, and no falling back to producer-and-fact.
    expect(sameThing(situation, inboxItem({ scope: 'name:other', scopeLabel: 'other' }))).toBe(false);
  });

  test('a FAILED inbox read contributes no rows — and is not read as an empty inbox', () => {
    const triage = triageOf(FINDINGS.map(incident));
    const failed = { loaded: false, failed: true, items: [AUTH_PROBE], total: 1, pausedSources: [], recentlyDecided: [] };
    expect(nowRows(triage, failed)).toHaveLength(4);

    // …and the surface says so with a row of its own rather than with silence.
    const { nodes } = render(triage, failed, { onRetryInbox: () => undefined });
    expect(byAttr(nodes, 'data-inbox-failed')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Item 2 · the tier, rendered
// ---------------------------------------------------------------------------

describe('item 2 · the tier a card displays is the tier it was sorted by', () => {
  test('every drawn row prints the tier it carries, and the four findings print Tier 1', () => {
    const triage = triageOf(FINDINGS.map(incident));
    const { nodes } = render(triage);
    const rows = byAttr(nodes, 'data-situation');

    for (const row of rows) {
      const text = textOf(row).join(' ');
      const printed = text.match(/Tier (\d)/);
      expect(printed).not.toBeNull();
      expect(Number(printed![1])).toBe(props(row)['data-tier']);
      expect(Number(printed![1])).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Item 3 · the severity stripe
// ---------------------------------------------------------------------------

describe('item 3 · the stripe encodes TIER, and only tier', () => {
  /**
   * Driven DIRECTLY across the whole domain, tier 3 included — no producer can
   * currently reach that arm (WP-54a), and a guard nothing can reach is a guard
   * nothing can check (WP-46).
   */
  test('red at 1, orange at 2, grey at 3, and NO STRIPE at 4', () => {
    expect(stripeColour(1)).toBe(COLOURS.tier1);
    expect(stripeColour(2)).toBe(COLOURS.tier2);
    expect(stripeColour(3)).toBe(COLOURS.tier3);
    expect(stripeColour(4)).toBeNull();
    expect(stripeColour(null)).toBeNull();
  });

  test('THE GUARD · two rows of the same tier and different SEVERITY stripe identically', () => {
    // `severity` is present in the incident payload (measured, WP-50), so the
    // drift this guards against is reachable rather than theoretical: a
    // coalesced headline may name its highest-SEVERITY member while the stripe
    // encodes the highest-TIER one, and those are different facts on purpose.
    const critical = incident(FINDINGS[1]); // "Known backdoor" — critical
    const high = incident(FINDINGS[0]); // "File manager plugin(s)" — high
    const { nodes } = render(triageOf([critical, high]));
    const stripes = byAttr(nodes, 'data-stripe').map((n) => props(n)['data-stripe']);

    expect(stripes).toEqual([COLOURS.tier1, COLOURS.tier1]);
    // The function's only argument is the tier — the strongest form the guard
    // can take, because there is no severity in scope for it to reach for.
    expect(stripeColour.length).toBe(1);
  });

  test('the stripe is drawn on the row itself, three pixels on the left edge', () => {
    const { nodes } = render(triageOf([incident(FINDINGS[0])]));
    const row = byAttr(nodes, 'data-situation')[0];
    expect(props(row).style.borderLeft).toBe(`3px solid ${COLOURS.tier1}`);
  });
});

// ---------------------------------------------------------------------------
// Items 6 and 7 · the doors
// ---------------------------------------------------------------------------

describe('items 6 and 7 · a door names where it goes, in link blue, and comes back', () => {
  test('the row door is the row\'s own composed label, and it is a link colour', () => {
    const { nodes } = render(triageOf([incident(FINDINGS[0])]));
    const door = byAttr(nodes, 'data-door')[0];
    expect(textOf(door).join('')).toBe('Open theawfulpm-test');
    expect(props(door).style.color).toBe(COLOURS.link);
    // Not the brand mark. A door is a link and reads as one.
    expect(props(door).style.color).not.toBe('#51bb7b');
  });

  test('EVERY generated control label is free of a terminal full stop', () => {
    // Item 7 as a CLASS: the period the row door shipped with was appended by
    // the extraction, so this reads every control the generators emit rather
    // than the one it was noticed on.
    const controls = [
      ...Object.values(DOORS),
      RETURN_COPY.ROW_DOOR,
      RETURN_COPY.UNKNOWN_ARM_DOOR,
      RETURN_COPY.UNKNOWN_ARM_OFFER,
    ];
    for (const label of controls) expect(label).not.toMatch(/\.$/);
    // And the one that shipped with it, named, so a regression is legible.
    expect(RETURN_COPY.ROW_DOOR).toBe('Open where you are needed');
  });

  test('the re-entry has a way back to Now, on an ESTABLISHED arm', () => {
    const session: any = {
      id: 'sess_1',
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      runbookHash: 'h',
      startedAt: '2026-08-18T05:06:58.238Z',
      status: 'waiting',
      approvals: [],
      checkpoints: [],
      gate: null,
      documentUnavailable: false,
    };
    const backs: number[] = [];
    const element = React.createElement(SessionReEntry as any, {
      session,
      onBackToNow: () => backs.push(1),
    });
    const tree = serializeTree((new (SessionReEntry as any)({ session, onBackToNow: () => backs.push(1) })).render());
    const back = byAttr(walk(tree), 'data-door').filter((n) => props(n)['data-door'] === 'back-to-now');

    expect(element).toBeDefined();
    expect(back).toHaveLength(1);
    expect(textOf(back[0]).join('')).toBe(DOORS.backToNow);
  });

  test('…and no way back is drawn when there is nowhere to go back TO', () => {
    const session: any = {
      id: 'sess_1', capability: 'c', runbookId: 'rb.x', runbookHash: 'h',
      startedAt: '2026-08-18T05:06:58.238Z', status: 'waiting',
      approvals: [], checkpoints: [], gate: null, documentUnavailable: false,
    };
    const tree = serializeTree((new (SessionReEntry as any)({ session })).render());
    expect(byAttr(walk(tree), 'data-door').filter((n) => props(n)['data-door'] === 'back-to-now')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Item 8 · the design system's Button
// ---------------------------------------------------------------------------

describe('item 8 · actions render as the design system\'s Button', () => {
  test('the Button is the design system\'s where it exists, and the platform\'s where it does not', () => {
    // `@getflywheel/local-components` is an OPTIONAL peer dependency: Local
    // supplies it and this repo does not install it, so under jest the fallback
    // is what resolves. Asserting WHICH is what stops this passing vacuously —
    // a test that could not tell the paths apart would pass against a hand-styled
    // control too.
    expect(hasDesignSystem).toBe(false);
    expect(Button).toBe('button');
  });

  test('the fallback is UNSTYLED — a hand-drawn lookalike is the thing being removed', () => {
    const decided = inboxItem({ id: 3, status: 'dismissed' });
    const triage = triageOf([]);
    const inbox = { ...fullInbox([]), recentlyDecided: [decided] };
    const { nodes } = render(triage, inbox, { onReopen: () => undefined });
    const reopen = byAttr(nodes, 'data-answer').filter((n) => props(n)['data-answer'] === 'reopen');

    expect(reopen).toHaveLength(1);
    expect(props(reopen[0]).style).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 11 · the reserved row
// ---------------------------------------------------------------------------

describe('item 11 · the reserved row, renamed and quieted', () => {
  test('the heading is in the user\'s words, and the good news is one quiet line', () => {
    const { nodes } = render(triageOf([]));
    const reserved = byAttr(nodes, 'data-reserved')[0];
    const text = textOf(reserved).join(' ');

    expect(text).toContain(RESERVED.head);
    expect(text).toContain(RESERVED.quiet);
    // The noun that failed: a person does not have a "record" whose "health"
    // they track.
    expect(text).not.toContain('Reserved');
    expect(text).not.toContain("record's own health");
  });

  test('XD-23\'s guarantee survives the rename — ONE row, and it cannot be scrolled away', () => {
    const dark = [
      { system: 'a', label: 'A', detail: 'x' },
      { system: 'b', label: 'B', detail: 'y' },
      { system: 'c', label: 'C', detail: 'z' },
    ];
    const triage = triageOf([]);
    triage.reserved = { ...triage.reserved, headline: 'three dark', dark } as any;
    const { nodes } = render(triage);

    // Three dark producers are ONE row saying three, not three rows.
    expect(byAttr(nodes, 'data-reserved')).toHaveLength(1);
    expect(props(byAttr(nodes, 'data-reserved')[0]).style.position).toBe('sticky');
  });
});

// ---------------------------------------------------------------------------
// Item 14 · two rows on one runbook
// ---------------------------------------------------------------------------

describe('item 14 · the identifier is printed once, and two rows on one runbook stay apart', () => {
  const run = (id: string, headline: string, meta: string): Situation => ({
    id,
    kind: 'session',
    column: 'waiting',
    sessionId: id,
    tier: 2,
    tierReason: 'waiting, and nothing has been written in scope',
    places: { tokens: [], highest: null, atHighest: 0, total: 0, unresolved: 0, summary: '' },
    since: '2026-08-18T05:06:58.238Z',
    lastEventId: id,
    parts: [],
    headline,
    ask: '',
    chip: '',
    state: '',
    meta,
    rule: 'waiting, and nothing has been written in scope',
    headlineTemplate: null,
    door: { label: 'Open the run', kind: 'session', target: id },
    signature: null,
    written: { done: 0, failed: 0, total: null },
  });

  test('a card names its runbook once — the derived headline already carries it', () => {
    const row = run('sess_1', 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed', '');
    const { nodes } = render(triageOf([row]));
    const text = textOf(byAttr(nodes, 'data-situation')[0]).join(' ');
    expect(text.split('rb.bulk-plugin-update')).toHaveLength(2);
  });

  test('two rows on the same runbook render distinguishable text', () => {
    // The shape the fix must not create: dropping the id from the HEADLINE would
    // leave two derived rows reading identically, which is the other half of the
    // same finding. They are told apart by the fact that differs — the runbook
    // each is under — and by their ages on the meta line.
    const a = run('sess_1', 'running under rb.bulk-plugin-update — 0 done and standing, 0 failed', '');
    const b = run('sess_2', 'running under rb.incident-containment — 0 done and standing, 0 failed', '');
    const { nodes } = render(triageOf([a, b]));
    const rows = byAttr(nodes, 'data-situation');

    expect(rows).toHaveLength(2);
    expect(textOf(rows[0]).join(' ')).not.toBe(textOf(rows[1]).join(' '));
  });
});
