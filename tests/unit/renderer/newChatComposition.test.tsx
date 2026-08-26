/**
 * @jest-environment jsdom
 */
/**
 * The new-chat sheet's COMPOSITION, not just its mechanism.
 *
 * The first build moved the composer and stopped. The designer's measured gap
 * against board A: no column (a strip adrift in 1800px of nothing), no display
 * type (the invitation read as a status line), suggestions still full-width
 * grey bars above the field, a full-bleed brand-teal user message where an 8%
 * tint belongs, and no thinking state at all. None of those are strings, so
 * the copy fixture did not unblock them. These pin them.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';

function chat(over: Record<string, any> = {}, msgs: any[] = []) {
  const c = new (PanelChat as any)({
    electron: { ipcRenderer: { on: jest.fn(), invoke: jest.fn().mockResolvedValue({}), send: jest.fn(), removeListener: jest.fn() } },
    sessionId: null, onSessionCreated: () => {}, onSessionSaved: () => {}, onStreamingStatusChange: () => {},
    siteContext: {}, opening: null, ...over,
  });
  Object.assign(c.state, { messages: msgs, input: '', streaming: false, offline: false, providerId: 'anthropic', model: 'm' });
  return c;
}
const all = (n: any, out: any[] = []): any[] => {
  if (!n || typeof n !== 'object') return out;
  if (Array.isArray(n)) { n.forEach((x) => all(x, out)); return out; }
  out.push(n); all(n.props?.children, out); return out;
};
const byData = (tree: any, key: string) => all(tree).filter((n) => n.props?.[key] !== undefined);

describe('the column — what makes the composer the centre of anything', () => {
  it('the stage constrains content to 560px', () => {
    const tree = chat({ density: 'stage' }).render();
    const inner = all(tree).filter((n) => n.props?.style?.width === 560);
    expect(inner.length).toBeGreaterThan(0);
  });

  it('the companion does not centre a 380px column — it left-aligns', () => {
    const tree = chat({ density: 'companion' }).render();
    const inv = byData(tree, 'data-panel-opening')[0];
    expect(inv.props.style.alignItems).toBe('flex-start');
    expect(inv.props.style.textAlign).toBe('left');
  });
});

describe('display type — the hierarchy IS the contrast', () => {
  it('the stage headline is 30px semibold, not body size', () => {
    const inv = byData(chat({ density: 'stage' }).render(), 'data-panel-opening')[0];
    const headline = all(inv).filter((n) => n.props?.style?.fontSize === 30)[0];
    expect(headline).toBeTruthy();
    expect(headline.props.style.fontWeight).toBe(600);
    expect(headline.props.style.letterSpacing).toBe('-0.6px');
  });

  it('the promise stays at 13.5 grey beneath it', () => {
    const inv = byData(chat({ density: 'stage' }).render(), 'data-panel-opening')[0];
    expect(all(inv).filter((n) => n.props?.style?.fontSize === 13.5).length).toBeGreaterThan(0);
  });
});

describe('the empty session offers NOTHING beside the field (owner ruling, 2026-08-25 16:09)', () => {
  const opening = { verdict: '2 things need you', invitation: 'x', asks: [
    { classId: 'c1', situationId: 's1', text: 'Why is checkout failing on Charlie?' },
  ] };

  it('renders no ask buttons, whatever the queue holds', () => {
    // Suggestions were removed from this surface entirely — the empty session
    // is headline, promise, composer, scope, disclosure. The queue's remaining
    // home is the header door (board A), not this column.
    expect(byData(chat({ opening, density: 'stage' }).render(), 'data-opening-ask')).toHaveLength(0);
  });

  it('renders no verdict as a column element', () => {
    expect(byData(chat({ opening, density: 'stage' }).render(), 'data-opening-verdict')).toHaveLength(0);
  });

  it('renders no footnote', () => {
    expect(JSON.stringify(chat({ density: 'stage' }).render())).not.toMatch(/filed against the runbook/);
  });

  it('still invents nothing', () => {
    expect(JSON.stringify(chat({ opening: null }).render())).not.toMatch(/open incident/i);
  });
});

describe('a message you sent is quiet', () => {
  it('is an 8% tint with a hairline, right-aligned and capped — not a brand fill', () => {
    const tree = chat({}, [{ id: '1', role: 'user', content: 'hi' }]).render();
    const bubble = all(tree).filter((n) => n.props?.style?.borderRadius === '14px 14px 4px 14px')[0];
    expect(bubble).toBeTruthy();
    expect(bubble.props.style.background).toBe('rgba(14,202,212,0.08)');
    expect(bubble.props.style.boxShadow).toMatch(/rgba\(14,202,212,0\.2\)/);
    expect(bubble.props.style.alignSelf).toBe('flex-end');
    expect(bubble.props.style.maxWidth).toBe('80%');
  });
});

describe('the panel says when it is thinking', () => {
  it('a streaming turn with nothing in it yet renders the thinking line', () => {
    const tree = chat({}, [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: '', streaming: true },
    ]).render();
    const thinking = byData(tree, 'data-chat-thinking')[0];
    expect(thinking).toBeTruthy();
    expect(JSON.stringify(thinking)).toMatch(/Thinking, stand by/);
  });

  it('says nothing once content arrives', () => {
    const tree = chat({}, [{ id: '2', role: 'assistant', content: 'here', streaming: true }]).render();
    expect(byData(tree, 'data-chat-thinking')).toHaveLength(0);
  });
});

describe('the placeholder is written to the mount width', () => {
  it('the companion takes the short form, which does not wrap and clip', () => {
    const tree = chat({ density: 'companion' }).render();
    const field = all(tree).filter((n) => n.props?.['aria-label'] === 'Chat input')[0];
    expect(field.props.placeholder).toBe('Ask about a site');
  });

  it('the stage takes the full invitation', () => {
    const tree = chat({ density: 'stage' }).render();
    const field = all(tree).filter((n) => n.props?.['aria-label'] === 'Chat input')[0];
    expect(field.props.placeholder).toMatch(/describe what you want done/);
  });
});

describe('presence lives in the conversation (board C)', () => {
  const streamingMsgs = [
    { id: '1', role: 'user', content: 'hi' },
    { id: '2', role: 'assistant', content: '', streaming: true },
  ];

  it('the thinking row carries the avatar and a grey line — never brand teal text', () => {
    const c = chat({}, streamingMsgs as any);
    Object.assign(c.state, { streaming: true, thinkingTick: 0 });
    const row = byData(c.render(), 'data-chat-thinking')[0];
    expect(row).toBeTruthy();
    const flat = all(row);
    const avatar = flat.filter((n) => String(n.props?.style?.background ?? '').includes('radial-gradient'))[0];
    expect(avatar).toBeTruthy();               // presence is the agent's mark…
    const line = flat.filter((n) => n.props?.style?.color === 'var(--nxai-card-sub)')[0];
    expect(line).toBeTruthy();                 // …and the words are secondary grey
    expect(line.props.style.fontSize).toBe(12);
  });

  it('cycles the design system\'s stand-by lines, unhurried punctuation intact', () => {
    const texts = [0, 1, 2].map((tick) => {
      const c = chat({}, streamingMsgs as any);
      Object.assign(c.state, { streaming: true, thinkingTick: tick });
      return JSON.stringify(c.render());
    });
    expect(texts[0]).toMatch(/Thinking, stand by…/);
    expect(texts[1]).toMatch(/Pondering, stand by…/);
    expect(texts[2]).toMatch(/Contemplating, stand by…/);
  });

  it('no busy line in the header chrome — the DockedPanel renders none', () => {
    const { DockedPanel } = require('../../../src/renderer/components/DockedPanel/DockedPanel');
    const tree = new DockedPanel({
      panelState: 'docked', onOpen: () => {}, onClose: () => {}, onSetPanelState: () => {},
      streamingStatus: 'Working…',
    } as any).render();
    expect(JSON.stringify(tree)).not.toMatch(/Working…/);
  });
});
