/**
 * @jest-environment jsdom
 */
/**
 * WP-46 · THE RAIL BADGE IS THE WAITING COUNT (XD-23, XD-26).
 *
 * XD-23: the ambient badge counts SITUATIONS CURRENTLY ESCALATING — "an
 * instrument, not an inventory". That is the arrival's waiting column and
 * nothing else. Before this packet the rail badge carried the unread-CHAT count,
 * which answers a different question: a chat awaiting a reply is a conversation,
 * while a waiting situation is a gate or a halt that cannot move without this
 * person. Both numbers are real; only one of them is what the ambient rank is
 * for.
 *
 * The three pins here are the ones a wrong wiring would satisfy anyway if they
 * were written loosely:
 *
 *  1. The badge SOURCE is `needsYou`, not `unreadChats` — asserted by moving
 *     them independently and reading which one the badge follows.
 *  2. The count is the SAME derivation the arrival's own header uses, over the
 *     same channel — not a second query that could disagree with the column.
 *  3. It starts ABSENT, never zero. A badge reading 0 and a badge that has not
 *     loaded look identical to the eye and mean opposite things.
 */
import { IPC_CHANNELS } from '../../../src/common/constants';
import { arrivalCounts, nowRows } from '../../../src/renderer/components/return/arrivalModel';

/**
 * Drain the microtask queue.
 *
 * `refreshNeedsYou` now reads TWO channels through `Promise.all`, with a
 * `.catch` on the inbox read, so the settle takes more hops than a fixed number
 * of `await Promise.resolve()` calls — and a test that awaits too few reads the
 * INITIAL state and reports it as the answer, which is a false null rather than
 * a failure. `setImmediate` runs after the microtask queue has drained
 * completely, so the count of hops stops being something this file has to know.
 * `setTimeout(0)` rather than `setImmediate`, which jsdom does not define.
 */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
import type { TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

/** A triage with `n` waiting situations. Only the length is read here. */
function triageWith(n: number): TriageView {
  return {
    // WP-54: the rows carry `written` because the badge path now composes the
    // list verdict too (one sentence, one count, one list — see `nowVerdict`),
    // and `written` is what that sentence is derived from. It is a REQUIRED
    // field of `Situation`; a fixture without it was a row the contract does not
    // permit, and the omission stopped being invisible the moment a second
    // consumer read it.
    waiting: Array.from({ length: n }, (_, i) => ({
      id: `sit_${i}`,
      written: { done: 0, failed: 0, total: null },
    })) as any,
    changed: [{ id: 'sit_changed' }] as any,
    reserved: { headline: 'x', dark: [], staleCount: 0, verdict: 'OK', degraded: false } as any,
    // WP-48's list verdict. The badge reads `waiting.length` and nothing else,
    // which is the point of this suite, so the sentence is inert here.
    verdict: '',
    // WP-49a · rider 1's rows. Empty here deliberately: the badge counts what
    // NEEDS the user, and a working run needs nobody — the fold has already
    // excluded it from `waiting`, so there is nothing for this suite to read.
    working: [],
    cursor: 'evt_1',
  };
}

function container(overrides: any = {}): any {
  jest.resetModules();
  localStorage.clear();
  const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
  return new DockedPanelContainer(overrides);
}

describe('the rail badge', () => {
  test('follows `needsYou`, and does NOT follow the unread chat count', () => {
    const inst = container({});

    inst.state = { ...inst.state, needsYou: 2, unreadChats: 97 };
    expect(inst.tabSignals().badgeCount).toBe(2);

    // Move the chat count alone: the badge must not budge.
    inst.state = { ...inst.state, unreadChats: 0 };
    expect(inst.tabSignals().badgeCount).toBe(2);

    // Move the waiting count alone: the badge must follow it.
    inst.state = { ...inst.state, needsYou: 5 };
    expect(inst.tabSignals().badgeCount).toBe(5);
  });

  test('starts ABSENT, not zero — and a failed read returns it to absent', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('core down'));
    const inst = container({ electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });

    expect(inst.state.needsYou).toBeNull();
    expect(inst.tabSignals().badgeCount).toBeNull();

    inst.setState = (patch: any) => { inst.state = { ...inst.state, ...patch }; };
    inst.refreshNeedsYou();
    await Promise.resolve();
    await Promise.resolve();

    expect(inst.state.needsYou).toBeNull();
  });

  test('the count comes from RETURN_TRIAGE, through the arrival\'s own derivation', async () => {
    const triage = triageWith(3);
    const invoke = jest.fn().mockImplementation((channel: string) =>
      Promise.resolve(channel === IPC_CHANNELS.GET_INBOX ? { success: true, items: [] } : triage));
    const inst = container({ electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    inst.setState = (patch: any) => { inst.state = { ...inst.state, ...patch }; };

    inst.refreshNeedsYou();
    await settle();

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RETURN_TRIAGE);
    // The SAME function the arrival's header calls — a badge served by its own
    // arithmetic is a second answer, free to disagree with the column beneath it.
    expect(inst.state.needsYou).toBe(arrivalCounts(triage, { loaded: true, failed: false, items: [] }).needsYou);
    expect(inst.state.needsYou).toBe(3);
  });

  /**
   * WP-54 · ITEM 1 — THE BADGE COUNTS THE ROWS THE SCREEN DRAWS, BOTH
   * DIRECTIONS.
   *
   * The measured defect: the badge read seven while twelve cards rendered,
   * because the surface concatenated the fold's situations with the Inbox's
   * items and deduplicated nothing, while the badge counted the situations
   * alone. Two populations, one list, no reconciliation.
   *
   * BOTH DIRECTIONS is what makes this a pin rather than a coincidence:
   *
   *  - an Inbox item that IS one of the situations adds NO row and NO count —
   *    a dedup that missed would show here as 4 where 3 is drawn;
   *  - an Inbox item that is nothing the fold holds adds ONE row and ONE count —
   *    a badge that ignored the Inbox would show 3 where 4 is drawn.
   *
   * The second case is the one on the owner's real fleet today: `auth-probe
   * could not finish a run` is the ratified `agent.stuck` class and no producer
   * emits it (WP-54a), so it reaches the person only as an Inbox row.
   */
  test('the badge equals the rows drawn — a matched item adds nothing, an unmatched one adds one', async () => {
    const triage = triageWith(3);
    (triage.waiting as any)[0].signature = { producer: 'security-sentinel', fact: 'FS-01', target: 'alpha' };

    const items = [
      // The same finding, from the other store. It rides on row 0.
      { id: 1, source: 'security-sentinel', code: 'FS-01', scope: 'name:alpha', scopeLabel: 'alpha' },
      // Nothing the fold holds. Its own row.
      { id: 2, source: 'auth-probe', code: 'fail:9da26a69397e', scope: '*', scopeLabel: 'This agent' },
    ];
    const invoke = jest.fn().mockImplementation((channel: string) =>
      Promise.resolve(channel === IPC_CHANNELS.GET_INBOX ? { success: true, items } : triage));
    const inst = container({ electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    inst.setState = (patch: any) => { inst.state = { ...inst.state, ...patch }; };

    inst.refreshNeedsYou();
    await settle();

    const inbox = { loaded: true, failed: false, items: items as any };
    expect(nowRows(triage, inbox)).toHaveLength(4);
    expect(inst.state.needsYou).toBe(4);
    expect(inst.state.needsYou).toBe(nowRows(triage, inbox).length);
  });

  /**
   * A FAILED INBOX READ IS NOT AN EMPTY ONE, and it does not take the badge with
   * it. The triage answered, so the badge can say what the fold holds; what it
   * must not do is turn a failed read into "nothing else needs you".
   */
  test('a failed inbox read still leaves the badge counting the situations', async () => {
    const triage = triageWith(3);
    const invoke = jest.fn().mockImplementation((channel: string) =>
      channel === IPC_CHANNELS.GET_INBOX ? Promise.reject(new Error('inbox down')) : Promise.resolve(triage));
    const inst = container({ electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    inst.setState = (patch: any) => { inst.state = { ...inst.state, ...patch }; };

    inst.refreshNeedsYou();
    await settle();

    expect(inst.state.needsYou).toBe(3);
  });

  test('the collapsed tab renders the badge only when the count is real and non-zero', () => {
    // The presentational half is `DockedPanel`'s and already pinned; what this
    // asserts is that the container hands it the right shape.
    const inst = container({});
    inst.state = { ...inst.state, needsYou: 0 };
    expect(inst.tabSignals().badgeCount).toBe(0);
    inst.state = { ...inst.state, needsYou: null };
    expect(inst.tabSignals().badgeCount).toBeNull();
  });
});
