/**
 * @jest-environment jsdom
 */

/**
 * fixes-082526 · issues 1-3 — the panel's three reported defects.
 *
 * 1. "+" did not create a new chat. The container only set `activeSessionId:
 *    null`, and PanelChat reset ONLY on a prop CHANGE — so null->null was a
 *    no-op and the transcript stayed on screen. The fix is imperative
 *    (`startNewChat()` through the existing ref), so it cannot depend on
 *    whether the id happened to differ.
 * 2. A cold boot reopened the last transcript, because `activeSessionId` was
 *    persisted and restored. Opening Local should start a NEW chat.
 * 3. Three widths shipped (380 / 620 / full). The middle one goes.
 */
import { DockedPanel, PANEL_WIDTH, type PanelState } from '../../../src/renderer/components/DockedPanel/DockedPanel';

const noop = () => {};

function renderPanel(panelState: PanelState, extra: Record<string, unknown> = {}) {
  return new DockedPanel({ panelState, onOpen: noop, onClose: noop, onSetPanelState: noop, ...extra } as any).render();
}

/** Walk a React element tree collecting every node that satisfies `pred`. */
function collect(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, pred, out)); return out; }
  if (pred(node)) out.push(node);
  const kids = node.props && node.props.children;
  if (kids) collect(kids, pred, out);
  return out;
}

describe('issue 3 — only three sizes: closed, docked, full', () => {
  it('docked expands straight to full (no intermediate stop)', () => {
    const seen: PanelState[] = [];
    const tree = renderPanel('docked', { onSetPanelState: (s: PanelState) => seen.push(s) });
    const expand = collect(tree, (n) => n.props?.['aria-label'] === 'Expand to full screen')[0];
    expect(expand).toBeTruthy();
    expand.props.onClick();
    expect(seen).toEqual(['full']);
  });

  it('full contracts back to docked', () => {
    const seen: PanelState[] = [];
    const tree = renderPanel('full', { onSetPanelState: (s: PanelState) => seen.push(s) });
    const contract = collect(tree, (n) => /back to docked/i.test(String(n.props?.['aria-label'] ?? '')))[0];
    expect(contract).toBeTruthy();
    contract.props.onClick();
    expect(seen).toEqual(['docked']);
  });

  it('no control anywhere offers the retired middle size', () => {
    (['closed', 'docked', 'full'] as PanelState[]).forEach((state) => {
      const calls: string[] = [];
      const tree = renderPanel(state, { onSetPanelState: (s: string) => calls.push(s) });
      collect(tree, (n) => typeof n.props?.onClick === 'function').forEach((btn) => {
        try { btn.props.onClick(); } catch { /* handlers that need an event are not size controls */ }
      });
      expect(calls).not.toContain('wide');
    });
  });

  it('docked is still the 380px panel', () => {
    expect((renderPanel('docked') as any).props.style.width).toBe(PANEL_WIDTH);
  });
});

describe('issue 1 — "+" resets the transcript imperatively', () => {
  it('the new-chat control is wired and fires even when the session id will not change', () => {
    let fired = 0;
    const tree = renderPanel('docked', { onNewChat: () => { fired += 1; } });
    const plus = collect(tree, (n) => n.props?.['aria-label'] === 'New chat')[0];
    expect(plus).toBeTruthy();
    plus.props.onClick();
    plus.props.onClick();
    // Two presses, two resets: nothing here may depend on a value having changed.
    expect(fired).toBe(2);
  });
});

describe('issue 2 — a cold boot starts a new chat', () => {
  beforeEach(() => { localStorage.clear(); jest.resetModules(); });

  it('does not restore the previous session id', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ panelState: 'docked', activeTab: 'chat', activeSessionId: 'abc' }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(inst.state.activeSessionId).toBeNull();
  });

  it('a persisted wide panel lands on full, never on a state the product no longer has', () => {
    localStorage.setItem('nexus-panel-state', JSON.stringify({ panelState: 'wide', activeTab: 'chat', activeSessionId: null }));
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    expect(['closed', 'docked', 'full']).toContain(inst.state.panelState);
  });
});

describe('issue 1 — the reset does not depend on the id having changed', () => {
  beforeEach(() => { localStorage.clear(); jest.resetModules(); });

  it('newChat() reaches the child directly, even when activeSessionId is already null', () => {
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const inst = new DockedPanelContainer({});
    let called = 0;
    (inst as any).chatRef = { current: { startNewChat: () => { called += 1; return Promise.resolve(); } } };
    inst.setState = (patch: any) => Object.assign(inst.state, patch);

    inst.state.activeSessionId = null;   // the state the old prop-diff path could not see
    inst.newChat();
    expect(called).toBe(1);              // MUTATION GUARD: a prop-diff-only reset scores 0 here

    inst.state.activeSessionId = 'abc';  // and it still works on the ordinary path
    inst.newChat();
    expect(called).toBe(2);
    expect(inst.state.activeSessionId).toBeNull();
    expect(inst.state.showSessions).toBe(false);
    expect(inst.state.activeTab).toBe('chat');
  });

  it('startNewChat clears the transcript and the draft', async () => {
    const { PanelChat } = require('../../../src/renderer/components/DockedPanel/PanelChat');
    const chat = new PanelChat({
      electron: { ipcRenderer: { on: jest.fn(), invoke: jest.fn().mockResolvedValue({}), send: jest.fn(), removeListener: jest.fn() } },
      sessionId: null,
      onSessionCreated: () => {},
      onSessionSaved: () => {},
      onStreamingStatusChange: () => {},
    } as any);
    chat.setState = (patch: any) => Object.assign(chat.state, patch);
    Object.assign(chat.state, {
      messages: [{ id: '1', role: 'user', content: 'hello' }],
      input: 'half-typed',
      streaming: true,
      activeSessionId: 'abc',
      actionCount: 3,
    });

    await chat.startNewChat();

    expect(chat.state.messages).toEqual([]);
    expect(chat.state.input).toBe('');
    expect(chat.state.streaming).toBe(false);
    expect(chat.state.activeSessionId).toBeNull();
    expect(chat.state.actionCount).toBe(0);
  });
});

describe('issue 6 — a Now door lands where the work is', () => {
  beforeEach(() => { localStorage.clear(); jest.resetModules(); });

  it('opens a blank chat scoped to the site, never the sessions list', () => {
    const { DockedPanelContainer } = require('../../../src/renderer/components/DockedPanel/DockedPanelContainer');
    const { nexusStore } = require('../../../src/renderer/store/NexusStateManager');
    const inst = new DockedPanelContainer({});
    inst.setState = (patch: any) => Object.assign(inst.state, patch);
    let started = 0;
    (inst as any).chatRef = { current: { startNewChat: () => { started += 1; return Promise.resolve(); } } };
    let picked: string | null = null;
    (inst as any).pickSite = (id: string) => { picked = id; };

    // The state a returning user is actually in: the panel last showed old chats.
    Object.assign(inst.state, {
      showSessions: true,
      activeTab: 'chat',
      activeSessionId: 'old-session',
      siteChoices: [{ id: 'site-7', name: 'theawfulpm-test' }],
    });
    nexusStore.update({ nowDoorRequest: { kind: 'site', target: 'theawfulpm-test' } });

    (inst as any).honourNowDoor();

    expect(picked).toBe('site-7');            // scoped to the site the finding is about
    expect(inst.state.showSessions).toBe(false); // NOT the list of old chats
    expect(inst.state.activeSessionId).toBeNull();
    expect(inst.state.activeTab).toBe('chat');
    expect(inst.state.panelState).toBe('docked');
    expect(started).toBe(1);
    expect(nexusStore.get().nowDoorRequest).toBeNull(); // cleared whether or not it resolved
  });
});
