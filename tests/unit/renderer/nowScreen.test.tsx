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
 * argument mandatory: the addon OPENS on Now. (WP-50: the second half of that
 * sentence — "and Now is ABSENT from the strip" — was WITHDRAWN BY ITS AUTHOR at
 * the XD-27 amendment; Now is the first tab, selected on arrival, with a
 * divider after it.)
 * The absence pin did its job to the last: the packet that added a Now tab had
 * to come with the author's own withdrawal, in the record, before the assertion
 * could be replaced. That is what writing a ruling down as a test buys.
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

  /**
   * WP-54 · ITEM 5 REVERSED THIS PIN AND THE ONE THAT FOLLOWED IT, and both
   * reversals are recorded here rather than the tests being deleted.
   *
   * They pinned position 11 §3's distinction — *rows answerable here get
   * buttons; rows needing the session get one door and no buttons, so deciding
   * and going somewhere look different before you click* — and they pinned it
   * strictly, as a distinction rather than as two separate facts. The rule was
   * ratified, built exactly as written, and wrong in the field.
   *
   * THE RULING, and the designer's own statement of it is stronger than the
   * owner's: **a gate without its declaration is consent without context**,
   * which is the failure XD-8 exists to prevent. Approving a security finding
   * from a list row is a decision made with none of the material the decision
   * needs; the owner's reading of the same row — *"one would not do them
   * piecemeal without full context"* — is the same finding from the user's side.
   * So NO row is answered in place. The row's door leads to the gate, and the
   * gate is where the decision is made with the declaration in front of it.
   *
   * What survives, and is asserted below: every row has ONE door and no answer
   * control, in both directions — which is the same shape of assertion the old
   * pin used, applied to the rule that replaced it.
   */
  test('THE RULING · no row is answered in place — one door, no consent controls, on every row', () => {
    const { tree, nodes } = now({ inbox: inbox() });

    // SCOPED TO THE NEEDS-YOU LIST, because that is the list the ruling is
    // about. The section below it holds rows that need nobody: a completed run
    // is read with no interaction and no question asked (XD-26's absence list),
    // so it has no door and asserting one there would be asserting the opposite
    // of what that section is for.
    const list = walk(tree).find((n) => props(n)['data-now-list'] === 'needs-you');
    const situationRows = byAttr(walk(list), 'data-situation');
    const inboxRows = byAttr(walk(list), 'data-inbox-row');
    expect(situationRows.length).toBeGreaterThan(0);
    expect(inboxRows.length).toBeGreaterThan(0);

    for (const row of [...situationRows, ...inboxRows]) {
      expect(byAttr(walk(row), 'data-answer')).toHaveLength(0);
      expect(byAttr(walk(row), 'data-door')).toHaveLength(1);
    }

    // The two words are gone from the surface entirely, not merely from these
    // rows — a control that moved somewhere else on the same screen would pass
    // a per-row assertion and fail the ruling.
    const everything = nodes.map((n) => textOf(n).join('')).join(' ');
    expect(everything).not.toContain(NOW_COPY.APPROVE);
    expect(everything).not.toContain(NOW_COPY.NOT_NOW);
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

describe('XD-27 AMENDED · the addon opens on Now, and Now is the FIRST TAB', () => {
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

  /**
   * WP-50 · THE NOW-ABSENT-FROM-THE-STRIP PIN IS REPLACED, NOT DELETED.
   *
   * XD-27's not-a-tab clause was WITHDRAWN BY ITS AUTHOR on the owner's live
   * evidence (field finding 5). The pin that enforced it is replaced by pins on
   * the three properties the amendment ruled — FIRST POSITION, SELECTED ON
   * ARRIVAL, and the DIVIDER — because a withdrawn ruling with its guard left
   * standing is a test asserting the opposite of the law.
   *
   * The two surfaces Now ABSORBED are still absent, and that half of XD-27 was
   * never withdrawn: `home` and `inbox` collapsed INTO Now and must not
   * reappear as peers beside it.
   */
  function stripKeys(): string[] {
    const bar = serializeTree(shell().renderTabBar());
    return walk(bar)
      .map((n) => props(n)['data-testid'])
      .filter((id: unknown): id is string => typeof id === 'string' && id.startsWith('tab-'))
      .map((id: string) => id.slice(4));
  }

  test('FIRST POSITION · Now heads the strip, and the collapsed surfaces are not beside it', () => {
    const keys = stripKeys();

    // The amendment's first property: home, then destinations.
    expect(keys[0]).toBe('now');
    // The collapse's own law, untouched by the amendment: `home` and `inbox`
    // went INTO Now and never come back as peers.
    expect(keys).not.toContain('home');
    expect(keys).not.toContain('inbox');
    // Record is in the strip and it is XD-27's own word for the surface.
    expect(keys).toContain('record');
    expect(keys).toContain('sites');
    expect(keys).toContain('settings');
    // The interim strip, pending item 6's Fleet/Agents fold.
    expect(keys).toEqual(['now', 'sites', 'fleet', 'record', 'agents', 'settings']);
  });

  test('SELECTED ON ARRIVAL · the Now entry carries the active underline before anything is clicked', () => {
    const bar = serializeTree(shell().renderTabBar());
    const entries = walk(bar).filter((n) => {
      const id = props(n)['data-testid'];
      return typeof id === 'string' && id.startsWith('tab-');
    });
    const now = entries.find((n) => props(n)['data-testid'] === 'tab-now');
    const sites = entries.find((n) => props(n)['data-testid'] === 'tab-sites');
    expect(now).toBeDefined();

    // "A strip with nothing underlined reads as nothing-selected rather than as
    // you-are-home" — the finding the amendment was made on. So the underline
    // must be REAL, and it must be Now's alone.
    const nowBorder = String((props(now)['style'] as any)?.borderBottom ?? '');
    const sitesBorder = String((props(sites)['style'] as any)?.borderBottom ?? '');
    expect(nowBorder).not.toContain('transparent');
    expect(nowBorder).toMatch(/3px solid/);
    expect(sitesBorder).toContain('transparent');
  });

  test('THE DIVIDER · a hairline follows Now, and it is not itself a tab', () => {
    const bar = serializeTree(shell().renderTabBar());
    const ids = walk(bar)
      .map((n) => props(n)['data-testid'])
      .filter((id: unknown): id is string => typeof id === 'string');

    // It exists…
    expect(ids).toContain('strip-divider-now');
    // …it sits immediately after Now and before the first destination…
    expect(ids.indexOf('strip-divider-now')).toBe(ids.indexOf('tab-now') + 1);
    expect(ids.indexOf('strip-divider-now')).toBeLessThan(ids.indexOf('tab-sites'));
    // …and it is a rule, not a destination: a `tab-*` scan must not count it,
    // or "the strip is six entries" becomes seven and nobody notices.
    expect(stripKeys()).not.toContain('divider-now');
    expect(stripKeys()).toHaveLength(6);
  });

  test('THE MARK · the title still returns to Now the way a logo does (unamended)', () => {
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
