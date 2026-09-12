/**
 * @jest-environment jsdom
 */
/**
 * The new-chat sheet (docs/handoff/new-chat/) — pin 1.
 *
 * "On an empty session the composer is the centre of gravity, vertically
 * centred with the invitation directly above it. It moves to the bottom on
 * the first turn, because only then is there a transcript for it to sit
 * under."
 *
 * The shipped screen pinned the composer to the bottom of an empty column and
 * floated the invitation in the top third: the one thing you came to do was
 * the furthest thing from what you were reading. These pin the placement, not
 * the copy — the copy is fixture-bound and flows through the generator.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';

function makeChat(messages: any[]) {
  const chat = new PanelChat({
    electron: { ipcRenderer: { on: jest.fn(), invoke: jest.fn().mockResolvedValue({}), send: jest.fn(), removeListener: jest.fn() } },
    sessionId: null,
    onSessionCreated: () => {},
    onSessionSaved: () => {},
    onStreamingStatusChange: () => {},
    siteContext: {},
  } as any);
  Object.assign(chat.state, { messages, input: '', streaming: false, offline: false });
  return chat;
}

/** Every node in the tree, depth-first. */
function nodes(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => nodes(n, out)); return out; }
  out.push(node);
  const kids = node.props && node.props.children;
  if (kids) nodes(kids, out);
  return out;
}

const findTextarea = (tree: any) =>
  nodes(tree).filter((n) => n.props?.['aria-label'] === 'Chat input')[0];

/** The scrolling log element — the one carrying data-nexus-chat. */
const findLog = (tree: any) =>
  nodes(tree).filter((n) => n.props?.['data-nexus-chat'])[0];

describe('the empty session centres the composer', () => {
  it('renders the composer INSIDE the centred column, not after it', () => {
    const tree = makeChat([]).render();
    const log = findLog(tree);
    expect(log).toBeTruthy();
    // MUTATION GUARD: with the composer left at the bottom it is not a
    // descendant of the log, and this finds nothing.
    expect(findTextarea(log)).toBeTruthy();
  });

  it('the empty column centres its content vertically', () => {
    const log = findLog(makeChat([]).render());
    expect(log.props.style.justifyContent).toBe('center');
  });

  it('exactly one composer exists — never two', () => {
    const tree = makeChat([]).render();
    expect(nodes(tree).filter((n) => n.props?.['aria-label'] === 'Chat input')).toHaveLength(1);
  });
});

describe('the first turn moves the composer to the bottom', () => {
  const withTranscript = () => makeChat([{ id: '1', role: 'user', content: 'Why is checkout failing?' }]).render();

  it('the composer is no longer inside the log once there is a transcript', () => {
    const tree = withTranscript();
    expect(findTextarea(findLog(tree))).toBeUndefined();
    expect(findTextarea(tree)).toBeTruthy();   // still on screen, just not in the column
  });

  it('the log scrolls from the top rather than centring', () => {
    expect(findLog(withTranscript()).props.style.justifyContent).toBeUndefined();
  });

  it('still exactly one composer', () => {
    expect(nodes(withTranscript()).filter((n) => n.props?.['aria-label'] === 'Chat input')).toHaveLength(1);
  });
});

describe('the invitation carries the ratified copy, and no invented situations', () => {
  const texts = (tree: any) => {
    const out: string[] = [];
    const walk = (n: any) => {
      if (n == null) return;
      if (typeof n === 'string') { out.push(n); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n === 'object') walk(n.props?.children);
    };
    walk(tree); return out;
  };

  it('shows the sheet-ratified invitation, not a hand-typed line', () => {
    const { NEW_CHAT_HEADLINE, NEW_CHAT_PROMISE, NEW_CHAT_FOOTNOTE } =
      require('../../../src/renderer/components/DockedPanel/newChatCopy.generated');
    const t = texts(makeChat([]).render());
    expect(t).toContain(NEW_CHAT_HEADLINE);
    // makeChat passes no density, so this is the COMPANION mount, which takes
    // the promise's first clause only — the second is what a 380px column can
    // afford to drop, because a refusal states its own reason when it happens.
    expect(t).toContain(NEW_CHAT_PROMISE.split('. Where it cannot')[0] + '.');
    // The footnote was removed from this surface by owner ruling (16:09) —
    // the empty session is headline, promise, composer, scope, disclosure.
    expect(t).not.toContain(NEW_CHAT_FOOTNOTE);
    expect(t).not.toContain('Ask anything about your WordPress sites.');
  });

  it('invents NO suggestions when there is nothing derived to suggest', () => {
    // The fixture's three are specimens of a derivation, not copy. On a quiet
    // fleet there is no open incident, and saying there is would be fabrication.
    const joined = texts(makeChat([]).render()).join(' ');
    expect(joined).not.toMatch(/open incident/i);
    expect(joined).not.toMatch(/cells behind/i);
  });

  it('the disclosure keeps provider and payload visible, and moves the version to the tooltip', () => {
    const tree = makeChat([]).render();
    const joined = texts(tree).join(' ');
    expect(joined).toMatch(/sends site data/);          // P0-5's substance survives
    expect(joined).not.toMatch(/claude-sonnet-5/);      // the version is not visible
    const nodesWithTitle: any[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.props?.title) nodesWithTitle.push(n.props.title);
      walk(n.props?.children);
    };
    walk(tree);
    expect(nodesWithTitle.join(' ')).toMatch(/sonnet|claude|\//); // ...but is still disclosed
  });
});

describe('the scope row and the disclosure travel WITH the composer', () => {
  const depthOf = (tree: any, pred: (n: any) => boolean): number => {
    let found = -1;
    const walk = (n: any, d: number) => {
      if (!n || typeof n !== 'object' || found >= 0) return;
      if (Array.isArray(n)) return n.forEach((x) => walk(x, d));
      if (pred(n)) { found = d; return; }
      walk(n.props?.children, d + 1);
    };
    walk(tree, 0);
    return found;
  };
  const isScope = (n: any) => n.type?.name === 'SiteContextStrip' || n.type === 'SiteContextStrip'
    || (typeof n.type === 'function' && /SiteContext/.test(n.type.name ?? ''));
  const isDisclosure = (n: any) =>
    typeof n.props?.children?.props?.title === 'string' && /sends site data/.test(
      String(n.props?.children?.props?.children ?? ''),
    );

  it('on an empty session all three sit inside the centred column', () => {
    const tree = makeChat([]).render();
    const log = findLog(tree);
    // The disclosure is not adjacent to what it discloses unless it is in the
    // same block — that was the defect the composer move created.
    expect(depthOf(log, isScope)).toBeGreaterThan(-1);
    expect(depthOf(log, isDisclosure)).toBeGreaterThan(-1);
  });

  it('with a transcript all three sit at the bottom, together', () => {
    const tree = makeChat([{ id: '1', role: 'user', content: 'hi' }]).render();
    const log = findLog(tree);
    expect(depthOf(log, isScope)).toBe(-1);        // not in the scroll area
    expect(depthOf(tree, isScope)).toBeGreaterThan(-1);   // but on screen
    expect(depthOf(tree, isDisclosure)).toBeGreaterThan(-1);
  });

  it('exactly one scope row and one disclosure in either state', () => {
    const count = (tree: any, pred: (n: any) => boolean) => {
      let n = 0;
      const walk = (x: any) => {
        if (!x || typeof x !== 'object') return;
        if (Array.isArray(x)) return x.forEach(walk);
        if (pred(x)) n += 1;
        walk(x.props?.children);
      };
      walk(tree); return n;
    };
    for (const msgs of [[], [{ id: '1', role: 'user', content: 'hi' }]]) {
      const tree = makeChat(msgs as any).render();
      expect(count(tree, isScope)).toBe(1);
      expect(count(tree, isDisclosure)).toBe(1);
    }
  });
});

describe('the disclosure never renders a raw config key', () => {
  it('names the provider, not its config key', () => {
    // Was "names WP Engine Power, not 'power'". v0.6.0 removed that provider;
    // the property under test is unchanged, so it is re-pinned on a retained one.
    const chat = makeChat([]);
    Object.assign(chat.state, { providerId: 'anthropic', model: 'x' });
    const joined = JSON.stringify(chat.render());
    expect(joined).toMatch(/Claude · sends site data/);
    expect(joined).not.toMatch(/"anthropic · sends site data"/);
  });

  it('does not render a raw key for a provider removed in v0.6.0', () => {
    // An upgrading user can still have providerId 'power' in state. It is now
    // outside the union, so it must take the friendly fallback below rather
    // than surfacing the config key on the one line whose job is disclosure.
    const chat = makeChat([]);
    Object.assign(chat.state, { providerId: 'power', model: 'x' });
    const joined = JSON.stringify(chat.render());
    expect(joined).not.toMatch(/"power · sends site data"/);
    expect(joined).toMatch(/your configured AI provider · sends site data/);
  });

  it('falls back to a phrase a person recognises for an id outside the union', () => {
    const chat = makeChat([]);
    Object.assign(chat.state, { providerId: 'some-stale-key', model: 'x' });
    const joined = JSON.stringify(chat.render());
    expect(joined).not.toMatch(/some-stale-key · sends/);
    expect(joined).toMatch(/sends site data/);   // the disclosure itself survives
  });
});
