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
import { arrivalCounts } from '../../../src/renderer/components/return/arrivalModel';
import type { TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

/** A triage with `n` waiting situations. Only the length is read here. */
function triageWith(n: number): TriageView {
  return {
    waiting: Array.from({ length: n }, (_, i) => ({ id: `sit_${i}` })) as any,
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
    const invoke = jest.fn().mockResolvedValue(triage);
    const inst = container({ electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    inst.setState = (patch: any) => { inst.state = { ...inst.state, ...patch }; };

    inst.refreshNeedsYou();
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RETURN_TRIAGE);
    // The SAME function the arrival's header calls — a badge served by its own
    // arithmetic is a second answer, free to disagree with the column beneath it.
    expect(inst.state.needsYou).toBe(arrivalCounts(triage).needsYou);
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
