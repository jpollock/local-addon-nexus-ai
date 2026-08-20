/**
 * WP-49 · THE FRONT DOOR — the collapse (item 5) and XD-27's chrome.
 *
 * Two things are pinned here and they are different kinds of claim.
 *
 * **The collapse.** Home, Inbox and Runs are one screen. The Inbox's cards are
 * rows on it, carrying their own *Approve* and *Not now* in place, and the
 * structural distinction position 11 §3 asks for is asserted as a distinction
 * rather than as two separate facts: a row answerable HERE has buttons and no
 * door; a row that needs the session has one door and no buttons. "Deciding and
 * going somewhere look different before you click" is only true if no row is
 * ever both, so that is what the test says.
 *
 * **The chrome (XD-27).** "A tab is a peer, and a front door that is tab one of
 * four becomes a choice among five the day the next feature claims a tab — a
 * future destination must argue for being a destination." Two pins make that
 * argument mandatory: the addon OPENS on Now, and Now is ABSENT from the strip.
 * The second is the load-bearing one. A packet that adds a Now tab has to delete
 * a test whose name says why it must not, which is the point of writing the
 * absence down as an assertion instead of as a comment.
 *
 * The rows are the REAL fold — `buildMorning` through the real emitters into a
 * real ledger, folded by the real registry — for `returnArrival.test.tsx`'s
 * reason: a hand-written triage would be a second transcription of the
 * consequence order.
 */
import * as React from 'react';

import { serializeTree } from './helpers/serializeTree';
import { assertGoldenShape, buildMorning, NOW, type Morning } from './helpers/returnMorning';
import { Arrival, type NowInbox } from '../../../src/renderer/components/return/Arrival';
import { NOW_COPY } from '../../../src/renderer/components/DockedPanel/openingCopy.generated';
import type { TriageView } from '../../../src/main/intelligence-host/sessionRegistry';
import type { InboxItem } from '../../../src/main/inbox/types';

let morning: Morning;
let triage: TriageView;

beforeEach(() => {
  morning = buildMorning();
  triage = assertGoldenShape(morning);
});
afterEach(() => morning.close());

/**
 * Every element in a RAW `React.createElement` tree.
 *
 * `serializeTree` renders functions as the string `'[fn]'`, which is right for
 * a structural comparison and useless for pressing a button. The handler tests
 * below walk the raw tree instead; everything else keeps the serialized one, so
 * a structural assertion cannot accidentally depend on identity.
 */
function rawWalk(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) { for (const n of node) rawWalk(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  return rawWalk(node.props?.children, out);
}

function walk(node: any, out: any[] = []): any[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  return walk(node.children, out);
}
const props = (n: any): any => n?.props ?? {};
const byAttr = (nodes: any[], name: string): any[] => nodes.filter((n) => props(n)[name] !== undefined);
function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  if (typeof node === 'object') textOf(node.children ?? node.props?.children, out);
  return out;
}

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 1, source: 'security-sentinel', code: 'FS-01', scope: 'name:Site A',
  scopeLabel: 'Site A', kind: 'decide', title: 'File permissions are too open',
  detail: 'wp-config.php is world-readable.', status: 'open',
  firstSeenAt: 1000, lastSeenAt: 1000, seenCount: 1, ...over,
} as InboxItem);

const inbox = (over: Partial<NowInbox> = {}): NowInbox => ({
  loaded: true, failed: false, items: [item()], total: 1,
  pausedSources: [], recentlyDecided: [], ...over,
});

function now(extra: Record<string, unknown> = {}): { tree: any; nodes: any[]; raw: any[] } {
  const store = { getItem: () => null, setItem: () => undefined };
  const instance: any = new (Arrival as any)({
    electron: { ipcRenderer: { invoke: () => Promise.resolve(triage) } },
    store, now: NOW, ...extra,
  });
  instance.state = { triage, loading: false, error: null, awayMs: 12 * 3_600_000 };
  const element = instance.render();
  const tree = serializeTree(element);
  return { tree, nodes: walk(tree), raw: rawWalk(element) };
}

// ---------------------------------------------------------------------------
// Item 5 · the collapse
// ---------------------------------------------------------------------------

describe('the collapse — one screen, and two kinds of row on it', () => {
  test('the Inbox\'s cards are rows in the needs-you list, not a second screen', () => {
    const { tree } = now({ inbox: inbox(), onDecide: () => undefined });
    const list = walk(tree).find((n) => props(n)['data-now-list'] === 'needs-you');
    const rows = byAttr(walk(list), 'data-inbox-row');

    expect(rows).toHaveLength(1);
    // The card's own content came with it — nothing became unreachable.
    const text = textOf(rows[0]).join(' ');
    expect(text).toContain('File permissions are too open');
    expect(text).toContain('wp-config.php is world-readable.');
    expect(text).toContain('Site A');
    expect(text).toContain('security-sentinel');
  });

  test('THE DISTINCTION · an answerable row has buttons and no door; a row needing the session has a door and no buttons', () => {
    const { tree, nodes } = now({ inbox: inbox(), onDecide: () => undefined });

    const situationRows = byAttr(nodes, 'data-situation');
    const inboxRows = byAttr(nodes, 'data-inbox-row');
    expect(situationRows.length).toBeGreaterThan(0);
    expect(inboxRows.length).toBeGreaterThan(0);

    // Asserted AS A DISTINCTION: no row is ever both, in either direction. Two
    // separate "this row has buttons" / "that row has a door" assertions would
    // both still pass on a surface that gave every row both, which is exactly
    // the state position 11 §3 forbids.
    for (const row of situationRows) {
      expect(byAttr(walk(row), 'data-answer')).toHaveLength(0);
      expect(byAttr(walk(row), 'data-door').length).toBeLessThanOrEqual(1);
    }
    for (const row of inboxRows) {
      expect(byAttr(walk(row), 'data-door')).toHaveLength(0);
      expect(byAttr(walk(row), 'data-answer').length).toBeGreaterThan(0);
    }

    // And the two answers are the Inbox's own words, extracted from §3 rather
    // than retyped here — a literal in this file would be a second place the
    // vocabulary lives, which is the drift the generator exists to stop.
    const answers = byAttr(inboxRows.flatMap((r) => walk(r)), 'data-answer')
      .map((n) => textOf(n).join(''));
    expect(answers).toEqual([NOW_COPY.APPROVE, NOW_COPY.NOT_NOW]);
    expect(answers).toEqual(['Approve', 'Not now']);
  });

  test('Approve and Not now carry the item and the decision the retired tab sent', () => {
    const calls: unknown[][] = [];
    const { raw } = now({ inbox: inbox(), onDecide: (...args: unknown[]) => calls.push(args) });
    const buttons = byAttr(raw, 'data-answer');

    buttons.find((n) => props(n)['data-answer'] === 'approve').props.onClick();
    buttons.find((n) => props(n)['data-answer'] === 'not-now').props.onClick();

    // BEHAVIOUR INTACT is the packet's word, so the arguments are asserted, not
    // just that something was called: the decision string and the status are
    // what the store writes, and a collapse that changed them would be a
    // migration wearing a rename.
    expect(calls).toEqual([
      [1, 'Approve', 'done'],
      [1, 'Not now', 'dismissed'],
    ]);
  });

  test('a failed inbox read is a row that says so — never silence, and never an all-clear', () => {
    const { tree } = now({ inbox: inbox({ failed: true, items: [], total: 0 }), onRetryInbox: () => undefined });
    const list = walk(tree).find((n) => props(n)['data-now-list'] === 'needs-you');
    const failed = byAttr(walk(list), 'data-inbox-failed');

    expect(failed).toHaveLength(1);
    expect(textOf(failed[0]).join(' ').toLowerCase()).toContain("couldn't read");
    // The order that matters: a failed read must never fall through to the
    // empty state. Inherited verbatim from the tab this replaces.
    expect(byAttr(walk(list), 'data-inbox-row')).toHaveLength(0);
  });

  test('a paused agent gets its banner from pausedSources, not from the rows on screen', () => {
    // An agent pauses precisely when it keeps failing, and the user may well
    // have dismissed its failure item — leaving it with zero open items and no
    // other way to clear `_autoPausedAt`.
    const { nodes } = now({
      inbox: inbox({ items: [], total: 0, pausedSources: ['seo-insights'] }),
      onResumeAgent: () => undefined,
    });
    const banners = byAttr(nodes, 'data-paused');
    expect(banners).toHaveLength(1);
    expect(props(banners[0])['data-paused']).toBe('seo-insights');
  });

  test('a truncated list reports the TRUE total, not the page size', () => {
    const many = Array.from({ length: 25 }, (_, i) => item({ id: i + 1, code: `C-${i}` }));
    const { nodes } = now({ inbox: inbox({ items: many, total: 250 }), onDecide: () => undefined });
    expect(textOf(nodes).join(' ')).toContain('Showing 25 of 250');
  });

  test('decided items sit under Nothing needed of you — they need nobody', () => {
    const decided = item({ id: 9, status: 'done', title: 'An old finding' });
    const { tree } = now({ inbox: inbox({ recentlyDecided: [decided] }), onReopen: () => undefined });

    const section = walk(tree).find((n) => props(n)['data-now-list'] === 'nothing-needed');
    const rows = byAttr(walk(section), 'data-inbox-row');
    expect(rows.map((n) => props(n)['data-inbox-row'])).toEqual(['9']);
    // Reopen reverses the DECISION, never a live change — and it is the only
    // control on a decided row.
    expect(byAttr(walk(rows[0]), 'data-answer').map((n) => props(n)['data-answer'])).toEqual(['reopen']);
  });

  test('the section is named, and it is the designer\'s name for it', () => {
    const { tree } = now();
    const section = walk(tree).find((n) => props(n)['data-now-list'] === 'nothing-needed');
    expect(textOf(section).join(' ')).toContain(NOW_COPY.NOTHING_NEEDED_HEAD);
    expect(NOW_COPY.NOTHING_NEEDED_HEAD).toBe('Nothing needed of you');
  });

  test('a finished run appears ONCE, under Nothing needed of you — Record is not duplicated here', () => {
    const { tree, nodes } = now();
    const finished = triage.changed.map((s) => s.id);
    expect(finished.length).toBeGreaterThan(0);

    const section = walk(tree).find((n) => props(n)['data-now-list'] === 'nothing-needed');
    expect(byAttr(walk(section), 'data-situation').map((n) => props(n)['data-situation'])).toEqual(finished);

    // ONCE on the whole surface. XD-27's second rider is that the record already
    // exists and Now does not reproduce it; a row drawn in both lists would be
    // the two-homes defect the collapse removed, re-created inside one screen.
    for (const id of finished) {
      expect(byAttr(nodes, 'data-situation').filter((n) => props(n)['data-situation'] === id)).toHaveLength(1);
    }
  });

  test('the surface renders with NO inbox at all — absent is not empty', () => {
    // The eval harness and most suites drive this component with a triage and
    // nothing else. A collapse that made the inbox props load-bearing would
    // break every one of them, and would mean an inbox read failure could take
    // the whole front door down with it.
    const { tree, nodes } = now();
    expect(byAttr(nodes, 'data-inbox-row')).toHaveLength(0);
    expect(byAttr(nodes, 'data-inbox-failed')).toHaveLength(0);
    const list = walk(tree).find((n) => props(n)['data-now-list'] === 'needs-you');
    expect(byAttr(walk(list), 'data-situation')).toHaveLength(triage.waiting.length);
  });
});

// ---------------------------------------------------------------------------
// XD-27 · the chrome. Now is not a tab.
// ---------------------------------------------------------------------------

describe('XD-27 · the addon opens on Now, and Now is not in the strip', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { NexusOverview } = require('../../../src/renderer/components/NexusOverview');
  /* eslint-enable @typescript-eslint/no-var-requires */

  function shell(): any {
    return new (NexusOverview as any)({
      NavLink: () => null,
      electron: { ipcRenderer: { invoke: () => Promise.resolve(null), on: () => undefined, removeListener: () => undefined } },
    });
  }

  test('THE OPENING ROUTE · the addon opens on Now, before anything is clicked', () => {
    expect(shell().state.activeTab).toBe('now');
  });

  test('THE ABSENCE · Now is not in the strip, and the strip is the three destinations', () => {
    const bar = serializeTree(shell().renderTabBar());
    const keys = walk(bar)
      .map((n) => props(n)['data-testid'])
      .filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('tab-'))
      .map((id: string) => id.slice(4));

    // THE LAW: a tab is a peer. Now is the front door, so it is not one.
    expect(keys).not.toContain('now');
    // …and neither are the two surfaces it absorbed.
    expect(keys).not.toContain('home');
    expect(keys).not.toContain('inbox');
    // Record is in the strip and it is XD-27's own word for the surface.
    expect(keys).toContain('record');
    expect(keys).toContain('sites');
    expect(keys).toContain('settings');
  });

  test('THE MARK · the title returns to Now the way a logo does, and never renders as active', () => {
    const instance = shell();
    instance.state = { ...instance.state, activeTab: 'sites', loading: false, error: null, stats: null };
    const patches: any[] = [];
    instance.setState = (patch: any) => { patches.push(patch); instance.state = { ...instance.state, ...patch }; };

    const mark = rawWalk(instance.render()).find((n) => props(n)['data-testid'] === 'nexus-mark-home');
    expect(mark).toBeDefined();
    mark.props.onClick();
    expect(patches).toEqual([{ activeTab: 'now' }]);

    // It is a control, not a tab: it carries no `data-testid="tab-*"`, so the
    // strip assertion above cannot be satisfied by the mark, and the mark can
    // never pick up the strip's active underline.
    expect(String(props(mark)['data-testid'])).not.toMatch(/^tab-/);
  });

  test('an unknown activeTab still lands on a surface rather than on nothing', () => {
    // The union grew a member that is not in `TABS`; the switch's default arm is
    // what keeps a stale persisted value from rendering a blank screen.
    const instance = shell();
    instance.state = { ...instance.state, activeTab: 'a-tab-that-was-retired' };
    expect(instance.renderActiveTab()).not.toBeNull();
  });
});
