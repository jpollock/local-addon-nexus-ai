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
