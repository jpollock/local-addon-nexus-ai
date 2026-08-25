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
    expect(t).toContain(NEW_CHAT_PROMISE);
    expect(t).toContain(NEW_CHAT_FOOTNOTE);
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
