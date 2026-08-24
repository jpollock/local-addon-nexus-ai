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
import { NOW, hoursAgo } from './helpers/returnMorning';
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
  DEFERRED,
  DOORS,
  GROUP,
  RESERVED,
  SITUATION_TEMPLATES,
} from '../../../src/main/intelligence-host/situationCopy.generated';
import { fillSituationSentence } from '../../../src/main/intelligence-host/sessionRegistry';
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
    signatures: [{ producer: 'security-sentinel', fact: f.fact, target: 'theawfulpm-test' }],
    written: { done: 0, failed: 0, total: null },
  };
}

/**
 * WP-55 · THE SAME FOUR, FOLDED INTO ONE COALESCED ROW.
 *
 * One card, four member identities. Composed from the same `FINDINGS` table so
 * the Inbox items below are literally the other store's copies of these members.
 */
function coalesced(): Situation {
  return {
    ...incident(FINDINGS[0]),
    id: 'task_01SCAN',
    memberCount: 4,
    linkKind: 'correlation',
    // COMPOSED FROM THE RATIFIED TEMPLATE, never retyped — a fixture that types
    // the sentence is a second place the ratified wording lives, which is the
    // defect the generator exists to prevent.
    headline: fillSituationSentence(
      SITUATION_TEMPLATES.find((t) => t.id === 'incident.coalesced')!.headline,
      { target: 'theawfulpm-test', leadFinding: FINDINGS[1].symptom, restCount: 3 },
    ),
    headlineTemplate: 'incident.coalesced',
    parts: FINDINGS.map((f) => ({
      kind: 'incident' as const,
      eventId: f.id,
      topic: 'episodic.incident.recorded',
      observedAt: '2026-08-18T22:25:24.386Z',
      summary: `incident open: ${f.symptom}`,
    })),
    signatures: FINDINGS.map((f) => ({
      producer: 'security-sentinel', fact: f.fact, target: 'theawfulpm-test',
    })),
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
    reserved: { headline: RESERVED.quiet, dark: [], staleCount: 0, checkCount: 7, verdict: 'OK', degraded: false } as any,
    verdict: '',
    cursor: 'evt_d',
    // WP-56 · DERIVED FROM `waiting`, exactly as the host derives it, so a
    // fixture cannot hand the surface a count its own rows contradict — which
    // is the property the field exists to give the real contract.
    counts: {
      perSite: { byEntity: [], unattributed: 0, situations: 0 },
      needsYou: waiting.filter((s) => !s.deferral).length,
      deferred: waiting.filter((s) => s.deferral).length,
    },
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

  /**
   * WP-55 · THE SAME DEFECT, ONE FOLD LATER — and the reason `signature` became
   * a SET.
   *
   * When the four coalesce into ONE card, the Inbox still holds four copies. A
   * single signature identifies ONE thing, so the folded row matched none of
   * them and all four rendered as their own rows beside the card that had just
   * folded them: five rows for four findings, and each finding's words on the
   * screen twice. That is WP-54's "twelve rows under a badge of seven" returning
   * by a different door, and it became reachable the moment this class rendered.
   */
  test('a COALESCED row absorbs its four inbox copies — ONE row, not five', () => {
    const triage = triageOf([coalesced()]);
    const items = FINDINGS.map((f, i) => inboxItem({ id: i + 1, code: f.fact, title: f.symptom }));

    expect(nowRows(triage, fullInbox(items))).toHaveLength(1);

    const { instance, tree } = render(triage, fullInbox(items));
    expect(byAttr(walk(tree), 'data-situation')).toHaveLength(1);

    // CLOSED, the lead member's words appear ONCE — in the headline — and the
    // other three do not appear at all, because their lines are not open.
    const closed = textOf(tree).join(' ');
    expect(closed.split(FINDINGS[1].symptom)).toHaveLength(2);

    // OPEN, each of the three non-lead members appears exactly once, on its own
    // line. This is the half that catches the duplicate: an unabsorbed Inbox
    // copy would print the same words a second time in its own row.
    //
    // THE LEAD APPEARS TWICE, DELIBERATELY — once as the verdict and once as
    // one of the four lines the disclosure promised. Dropping its line would
    // deliver three findings under a control that says four, and the fixture's
    // own note ratifies both counts: *"the count is stated in the headline and
    // in the disclosure, so the row needs no parts chip."*
    instance.state = { ...instance.state, openParts: { task_01SCAN: true } };
    const opened = textOf(serializeTree(instance.render())).join(' ');
    for (const finding of [FINDINGS[0], FINDINGS[2], FINDINGS[3]]) {
      expect(opened.split(finding.symptom)).toHaveLength(2);
    }
    expect(opened.split(FINDINGS[1].symptom)).toHaveLength(3);
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

  /**
   * WP-56 AMENDED THIS PIN, and the amendment was owed the moment deferral
   * existed.
   *
   * WP-54 wrote it as `badge === rows drawn`, both directions, which was exactly
   * right in a world where nothing could be quieted. A deferred situation STAYS
   * IN THE LIST and LEAVES THE BADGE — that is the cycle-two ruling, and it makes
   * the original equality false. **A pin left standing against a later ruling is
   * a test asserting the opposite of the law**, so it is corrected here rather
   * than deleted: the badge equals the rows drawn MINUS the ones the user
   * quieted, and the quieted row is still drawn.
   */
  test('THE BADGE AND THE ROWS ARE ONE NUMBER, both directions — minus what the user quieted', () => {
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

  /**
   * THE EXHIBIT THE GATE OWED: BOTH TERMS NON-ZERO AT ONCE.
   *
   * `listVerdict` was edited by three packets through different doors — WP-54
   * added the unheld term, WP-56 subtracted the deferred rows, WP-54b required
   * the branch to be decided over the union. **Neither branch had a case where
   * both terms were non-zero, so every test on either side passed under a
   * resolution that silently dropped one of them.** This is that case: one
   * unheld row and one deferred situation in the same list.
   */
  test('BOTH TERMS NON-ZERO — an unheld row and a deferred situation in one list', () => {
    const deferred = {
      ...incident(FINDINGS[0]),
      deferral: {
        eventId: 'evt_def_1',
        reason: 'waiting on the vendor',
        deferredAt: '2026-08-21T04:00:00.000Z',
        wake: null,
      },
    };
    const triage = triageOf([deferred, incident(FINDINGS[1]), incident(FINDINGS[2])]);
    const withOrphan = fullInbox([AUTH_PROBE]);

    // FOUR rows are drawn: three situations (one of them quieted) + one unheld.
    const rows = nowRows(triage, withOrphan);
    expect(rows).toHaveLength(4);
    // THE QUIETED ROW IS STILL DRAWN. Leaving the list is the dismissal the
    // ruling refused, and this is the assertion that would catch it.
    expect(rows.some((r) => r.situation?.id === deferred.id)).toBe(true);

    // THREE are escalating: the badge is the drawn rows minus the quieted one,
    // and the unheld row is still counted.
    const counts = arrivalCounts(triage, withOrphan);
    expect(counts.needsYou).toBe(3);
    expect(counts.deferred).toBe(1);
    expect(counts.needsYou + counts.deferred).toBe(rows.length);

    // AND THE SENTENCE AGREES — this is the number that would be wrong under
    // either single-branch resolution: taking WP-56's body whole drops the
    // unheld row and says 2; taking the base's drops the deferral and says 4.
    expect(nowVerdict(triage, withOrphan)).toContain('3 things need you');
  });

  /**
   * THE BRIDGE between the host's count and the renderer's, pinned in both
   * directions so neither can drift.
   *
   * The host cannot see the unheld rows — they exist only in this process — so
   * `arrivalCounts` deliberately does NOT read `triage.counts.needsYou`.
   * Substituting it would drop every inbox orphan, which is item 1's defect
   * inverted. What ties them together is arithmetic, and it is asserted rather
   * than described.
   */
  test('renderer needsYou === host counts.needsYou + escalating unheld rows', () => {
    const deferred = {
      ...incident(FINDINGS[0]),
      deferral: { eventId: 'e', reason: 'r', deferredAt: '2026-08-21T04:00:00.000Z', wake: null },
    };
    const triage = triageOf([deferred, incident(FINDINGS[1])]);
    // `triageOf` derives `counts` from its own rows, the way the host does.
    expect(triage.counts).toMatchObject({ needsYou: 1, deferred: 1 });

    // With no inbox at all the two collapse to plain equality.
    expect(arrivalCounts(triage).needsYou).toBe(triage.counts.needsYou);

    // With one unheld row the identity holds with its second term.
    const withOrphan = fullInbox([AUTH_PROBE]);
    const unheld = nowRows(triage, withOrphan).filter((r) => r.situation === null).length;
    expect(unheld).toBe(1);
    expect(arrivalCounts(triage, withOrphan).needsYou).toBe(triage.counts.needsYou + unheld);
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
    expect(situation.signatures[0].producer).toBe('security-sentinel');
    expect(sameThing(situation, inboxItem({ source: 'security_sentinel' }))).toBe(true);

    // A row with NO identities matches nothing — which is every run row, since
    // nothing in the Inbox is a run. WP-55 made this an empty SET rather than a
    // null; the claim is unchanged.
    expect(sameThing({ ...situation, signatures: [] }, inboxItem())).toBe(false);
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
    signatures: [],
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

// ---------------------------------------------------------------------------
// WP-55 · the coalesced screen — parts as lines, grouping as caption, and the
// deferred row, all in the one list
// ---------------------------------------------------------------------------

describe('WP-55 item 3 · a part is a LINE inside the card', () => {
  /**
   * *"A part is a line inside the card: no stripe, no chip, no ask, no gate —
   * its own sentence, its own age, its own door. Closed by default, opening IN
   * PLACE rather than through the door, because someone checking whether a
   * verdict is true should not have to leave the list to do it."*
   */
  test('CLOSED BY DEFAULT · the members are not drawn, and the disclosure states the count', () => {
    const { tree, nodes } = render(triageOf([coalesced()]), fullInbox([]));
    const screen = textOf(tree).join(' ');

    // The disclosure is the class's own, filled with the count it folded.
    const template = SITUATION_TEMPLATES.find((t) => t.id === 'incident.coalesced')!;
    expect(screen).toContain(fillSituationSentence(template.disclosure, { memberCount: 4 }));
    // …and none of the three non-lead members is drawn.
    for (const f of FINDINGS.slice(2)) expect(screen).not.toContain(f.symptom);
    // The control is a control, and it is on the row.
    expect(byAttr(nodes, 'data-parts-toggle')).toHaveLength(1);
  });

  test('OPENS IN PLACE · every member is a line on the same card, with its own age', () => {
    const { instance } = render(triageOf([coalesced()]), fullInbox([]));
    instance.state = { ...instance.state, openParts: { 'task_01SCAN': true } };
    const tree = serializeTree(instance.render());
    const nodes = walk(tree);
    const screen = textOf(tree).join(' ');

    const lines = byAttr(nodes, 'data-part-line');
    expect(lines).toHaveLength(4);
    for (const f of FINDINGS) expect(screen).toContain(f.symptom);

    // NO STRIPE, NO CHIP, NO ASK, NO GATE on a part — the four things that make
    // a card a card. A part that grew any of them would read as a row.
    for (const line of lines) {
      expect(props(line)['data-stripe']).toBeUndefined();
      expect(props(line)['data-chip']).toBeUndefined();
      expect(props(line)['data-ask']).toBeUndefined();
      expect(props(line)['data-gate']).toBeUndefined();
    }
    // Its own age, and its own door.
    expect(byAttr(nodes, 'data-part-age')).toHaveLength(4);
    expect(byAttr(nodes, 'data-part-door')).toHaveLength(4);

    // It opened IN PLACE: the row is still one row, and the toggle now offers
    // the way back in the class's own words.
    expect(byAttr(nodes, 'data-situation')).toHaveLength(1);
    expect(screen).toContain(SITUATION_TEMPLATES.find((t) => t.id === 'incident.coalesced')!.disclosureOpen);
  });

  /**
   * THE COUNT IS STATED ONCE — and on this class the disclosure is where.
   *
   * `metaLine` appends "{n} parts · one situation" to any row with more than one
   * part, and on a coalesced row that is the THIRD statement of the same number:
   * the headline says "3 more findings", the disclosure says "4 findings", and
   * the meta line said "4 parts". The fixture's own note rules on it — *"the
   * count is stated in the headline and in the disclosure, so the row needs no
   * parts chip"* — and the two the designer ratified are the two that stay.
   */
  test('a row whose class DISCLOSES its parts carries no parts clause on the meta line', () => {
    const { tree } = render(triageOf([coalesced()]), fullInbox([]));
    const screen = textOf(tree).join(' ');
    expect(screen).not.toContain(RETURN_COPY.PARTS_CHIP);
    // …and the two ratified statements of the count are both still there.
    expect(screen).toContain('3 more findings');
    expect(screen).toContain(fillSituationSentence(
      SITUATION_TEMPLATES.find((t) => t.id === 'incident.coalesced')!.disclosure, { memberCount: 4 },
    ));
  });

  test('a DERIVED multi-part row keeps its parts clause — nothing else on it states the count', () => {
    // The clause is not deleted, it is deduplicated. A row with no disclosure
    // has nowhere else to say how many parts it folded.
    const derived = { ...coalesced(), headlineTemplate: null, headline: '4 open incidents from one scan' };
    const { tree } = render(triageOf([derived]), fullInbox([]));
    expect(textOf(tree).join(' ')).toContain(RETURN_COPY.PARTS_CHIP);
  });

  test('a row with ONE part discloses nothing — there is nothing to open', () => {
    const { nodes } = render(triageOf([incident(FINDINGS[0])]), fullInbox([]));
    expect(byAttr(nodes, 'data-parts-toggle')).toHaveLength(0);
  });
});

describe('WP-55 item 4 · grouping is a CAPTION, and coalescing is a CARD (XD-28)', () => {
  test('two rows sharing a target with NO link are listed separately, under a label', () => {
    // The owner's real four: one site, no correlation on any of them. This is
    // what the un-coalesced case renders as.
    const { tree, nodes } = render(triageOf(FINDINGS.map(incident)), fullInbox([]));
    const screen = textOf(tree).join(' ');

    const captions = byAttr(nodes, 'data-group-caption');
    expect(captions).toHaveLength(1);
    expect(screen).toContain(fillSituationSentence(GROUP.label, { memberCount: 4, target: 'theawfulpm-test' }));
    // The limit, stated. The record does not link these and the caption says so.
    expect(screen).toContain(GROUP.limit);

    // FOUR ROWS, still. A caption groups; it does not fold.
    expect(byAttr(nodes, 'data-situation')).toHaveLength(4);
  });

  test('THE LABEL IS NOT A CARD · no border, no fill, no stripe, no door', () => {
    const { nodes } = render(triageOf(FINDINGS.map(incident)), fullInbox([]));
    const [caption] = byAttr(nodes, 'data-group-caption');
    // NOT VACUOUS: every assertion below is about a node, so an absent caption
    // would pass all of them by reading `undefined` off nothing.
    expect(caption).toBeDefined();
    const style = props(caption).style ?? {};

    expect(style.border).toBeUndefined();
    expect(style.borderLeft).toBeUndefined();
    expect(style.background).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
    expect(props(caption)['data-stripe']).toBeUndefined();
    // …and it carries no door: a caption is not a destination.
    expect(walk(caption).filter((n: any) => props(n)['data-door'] !== undefined)).toHaveLength(0);
  });

  test('a LINKED set is a card and is never captioned — the visual difference, asserted', () => {
    const { nodes } = render(triageOf([coalesced()]), fullInbox([]));
    expect(byAttr(nodes, 'data-group-caption')).toHaveLength(0);
    // One bordered object, with a stripe and a door.
    const [row] = byAttr(nodes, 'data-situation');
    expect(props(row)['data-stripe']).toBeDefined();
  });

  test('rows on DIFFERENT targets are not grouped, however many there are', () => {
    const elsewhere = { ...incident(FINDINGS[1]), id: 'evt_far', door: { label: 'Open other', kind: 'site' as const, target: 'other' } };
    const { nodes } = render(triageOf([incident(FINDINGS[0]), elsewhere]), fullInbox([]));
    expect(byAttr(nodes, 'data-group-caption')).toHaveLength(0);
  });
});

describe('WP-55 item 5 · the deferred row', () => {
  const deferredRow = () => ({
    ...incident(FINDINGS[0]),
    deferral: {
      eventId: 'evt_defer',
      reason: 'client is rebuilding the site',
      deferredAt: hoursAgo(4),
      wake: null,
    },
  });

  test('IT STAYS IN THE LIST, at its tier and in its place', () => {
    const rows = [deferredRow(), incident(FINDINGS[1])];
    const { nodes } = render(triageOf(rows), fullInbox([]));
    const drawn = byAttr(nodes, 'data-situation');

    expect(drawn).toHaveLength(2);
    // Its place is unchanged — it is still first.
    expect(props(drawn[0])['data-situation']).toBe('evt_a');
    // Its tier is unchanged, and so is its stripe.
    expect(props(drawn[0])['data-tier']).toBe(1);
    expect(props(drawn[0])['data-stripe']).toBe(COLOURS.tier1);
  });

  test('IT IS DIMMED, and the dimming is the only thing that changed about it', () => {
    const { nodes } = render(triageOf([deferredRow()]), fullInbox([]));
    const [drawn] = byAttr(nodes, 'data-situation');
    expect(props(drawn)['data-deferred']).toBe('true');
    expect(props(drawn).style.opacity).toBeLessThan(1);
  });

  test('the REASON and the WAKE CONDITION are on the row, in the ratified words', () => {
    const { tree } = render(triageOf([deferredRow()]), fullInbox([]));
    const screen = textOf(tree).join(' ');

    expect(screen).toContain(fillSituationSentence(DEFERRED.recorded, {
      deferredAge: '4h', reason: 'client is rebuilding the site',
    }));
    // An UNCONDITIONED deferral never wakes, and the row says so rather than
    // offering a condition the platform cannot fire.
    expect(screen).toContain('never wakes');
    expect(screen).toContain(DEFERRED.endDoor);
  });

  test('the RULE LINE is the deferral\'s, with the tier the row was sorted by', () => {
    const { nodes } = render(triageOf([deferredRow()]), fullInbox([]));
    const [rule] = byAttr(nodes, 'data-rule');
    expect(textOf(rule).join('')).toBe(fillSituationSentence(DEFERRED.rule, { tier: 1 }));
  });

  test('AN UNDEFERRED ROW IS UNTOUCHED — no dim, no deferral lines, its own rule', () => {
    const { nodes, tree } = render(triageOf([incident(FINDINGS[0])]), fullInbox([]));
    const [drawn] = byAttr(nodes, 'data-situation');
    expect(props(drawn)['data-deferred']).toBeUndefined();
    expect(props(drawn).style.opacity).toBeUndefined();
    expect(textOf(tree).join(' ')).not.toContain(DEFERRED.endDoor);
  });
});
