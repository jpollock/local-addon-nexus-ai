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

describe('suggestions are pills below the field, and only ever the derived ones', () => {
  const opening = { verdict: null, invitation: 'x', asks: [
    { classId: 'c1', situationId: 's1', text: 'Why is checkout failing on Charlie?' },
  ] };

  it('renders as a content-sized pill, never a full-width bar', () => {
    const tree = chat({ opening, density: 'stage' }).render();
    const ask = byData(tree, 'data-opening-ask')[0];
    expect(ask).toBeTruthy();
    expect(ask.props.style.width).toBe('auto');       // not '100%'
    expect(ask.props.style.borderRadius).toBe(9999);  // a pill
  });

  it('sits BELOW the composer, not above it', () => {
    const tree = chat({ opening, density: 'stage' }).render();
    const flat = all(tree);
    const field = flat.findIndex((n) => n.props?.['aria-label'] === 'Chat input');
    const ask = flat.findIndex((n) => n.props?.['data-opening-ask'] !== undefined);
    expect(field).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(field);
  });

  it('invents none when nothing is derived', () => {
    const tree = chat({ opening: null }).render();
    expect(byData(tree, 'data-opening-ask')).toHaveLength(0);
    expect(JSON.stringify(tree)).not.toMatch(/open incident/i);
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
