/**
 * PanelChat transcript layout — the order things appear in, and what appears at all.
 *
 * All three of these were visible defects in the shipped panel: tool rows rendered
 * below the answer they produced, an empty grey bubble sat above them while tools ran,
 * and the "Working…" dot was static so a live run and a stalled one looked identical.
 */
import * as React from 'react';
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { DockedPanel } from '../../../src/renderer/components/DockedPanel/DockedPanel';
import { serializeTree } from './helpers/serializeTree';

function chat(): any {
  return new (PanelChat as any)({
    electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
    sessionId: null,
    selectedSiteIds: [],
    visible: true,
    onSessionCreated: jest.fn(),
    onSessionSaved: jest.fn(),
    onStreamingStatusChange: jest.fn(),
  });
}

/** Flatten a serialized tree to the ordered list of nodes matching a predicate. */
function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  // Arrays are containers, not nodes — descend, don't collect. Spread blocks
  // (the composer block, the procedure surfaces) nest arrays inside children
  // arrays, and treating one as a node used to stop the walk at its edge.
  if (Array.isArray(node)) { for (const k of node) walk(k, out); return out; }
  out.push(node);
  const children = node.children ?? node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

const DONE_CALL = { id: 't1', name: 'list_sites', status: 'done', result: 'ok' };

describe('tool rows come before the answer', () => {
  it('renders the tool list above the assistant bubble, not below it', () => {
    // The tools ran first and the answer is the conclusion drawn from them. Rendering
    // them after put the working-out underneath the result.
    //
    // Compared as positions in the TOP-LEVEL children array, not by searching the whole
    // tree: an earlier version of this test stringified each node's subtree, so the root
    // node matched "List Sites" and scored index 0 in either ordering. It passed against
    // the bug it was written for.
    const tree: any = serializeTree(chat().renderMessage({
      id: 'm1', role: 'assistant', content: 'Here is what I found.',
      streaming: false, toolCalls: [DONE_CALL],
    }) as any);

    const top: any[] = (tree.children ?? tree.props?.children ?? []).filter(Boolean);
    const bubbleAt = top.findIndex((n) => walk(n).some(
      (d) => typeof d?.props?.dangerouslySetInnerHTML?.__html === 'string'
        && d.props.dangerouslySetInnerHTML.__html.includes('Here is what I found')));
    const toolAt = top.findIndex((n) => JSON.stringify(n).includes('List Sites'));

    expect(toolAt).toBeGreaterThan(-1);
    expect(bubbleAt).toBeGreaterThan(-1);
    expect(toolAt).toBeLessThan(bubbleAt);
  });
});

describe('no empty bubble while tools are running', () => {
  it('renders no assistant bubble when streaming has produced no text yet', () => {
    // This was the grey slab: a container for text that did not exist.
    const tree = serializeTree(chat().renderMessage({
      id: 'm1', role: 'assistant', content: '',
      streaming: true, toolCalls: [{ id: 't1', name: 'list_sites', status: 'running' }],
    }) as any);

    const html = walk(tree).filter((n) => n.props?.dangerouslySetInnerHTML !== undefined);
    expect(html).toHaveLength(0);
  });

  it('still shows the tool rows in that state — they are the progress', () => {
    const tree = serializeTree(chat().renderMessage({
      id: 'm1', role: 'assistant', content: '',
      streaming: true, toolCalls: [{ id: 't1', name: 'list_sites', status: 'running' }],
    }) as any);

    expect(JSON.stringify(tree)).toContain('List Sites');
  });

  it('renders the bubble again as soon as there is text', () => {
    const tree = serializeTree(chat().renderMessage({
      id: 'm1', role: 'assistant', content: 'Partial answer',
      streaming: true, toolCalls: [DONE_CALL],
    }) as any);

    const html = walk(tree).filter((n) => n.props?.dangerouslySetInnerHTML !== undefined);
    expect(html).toHaveLength(1);
  });

  it('keeps the typing dots for a reply with no tools and no text yet', () => {
    // Distinct from the case above: nothing is running, so dots are the only signal.
    const tree = serializeTree(chat().renderMessage({
      id: 'm1', role: 'assistant', content: '', streaming: true, toolCalls: [],
    }) as any);

    // fixes-082526: the typing dots are replaced by the sheet's thinking LINE.
    // The dots did render (agent-console.css defines --ag-text-muted on :root
    // and index.tsx loads it) — they are simply three 6px circles, which in a
    // tall empty panel say that something exists without saying that anything
    // is happening. Board C specifies words: "Thinking, stand by…".
    expect(JSON.stringify(tree)).toContain('Thinking, stand by');
  });
});

describe('presence is alive IN THE TRANSCRIPT — the chrome carries none (board C)', () => {
  it('the thinking row pulses beside the forming answer', () => {
    const chat: any = new (PanelChat as any)({
      electron: { ipcRenderer: { on: jest.fn(), invoke: jest.fn().mockResolvedValue({}), send: jest.fn(), removeListener: jest.fn() } },
      sessionId: null, onSessionCreated: jest.fn(), onSessionSaved: jest.fn(), onStreamingStatusChange: jest.fn(),
      siteContext: {}, opening: null,
    });
    Object.assign(chat.state, {
      messages: [
        { id: '1', role: 'user', content: 'hi' },
        { id: '2', role: 'assistant', content: '', streaming: true },
      ],
      streaming: true, thinkingTick: 0, input: '', offline: false, providerId: 'anthropic', model: 'm',
    });
    const flat = walk(serializeTree(chat.render()));
    const pulsing = flat.filter((n) => n.props?.className === 'nexus-pulse');
    expect(pulsing).toHaveLength(1);   // the avatar, animated — a live run is distinguishable from a stalled one
  });

  it('the header renders no busy line even when told one exists', () => {
    // The busy state used to live under the wordmark — teal, 11px, ~1250px
    // from where the answer appears. Removed 2026-08-25: presence belongs to
    // the conversation.
    const panel: any = new (DockedPanel as any)({
      panelState: 'docked',
      onOpen: jest.fn(), onClose: jest.fn(), onSetPanelState: jest.fn(),
      streamingStatus: 'Working…',
      children: null, sessionsSidebar: null,
    });
    const flat = walk(serializeTree(panel.render()));
    expect(flat.filter((n) => n.props?.className === 'nexus-pulse')).toHaveLength(0);
    expect(JSON.stringify(serializeTree(panel.render()))).not.toMatch(/Working…/);
  });
});

