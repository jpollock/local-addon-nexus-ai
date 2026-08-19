/**
 * @jest-environment jsdom
 */
/**
 * WP-38 · the panel's citation wiring — additive, and pinned to be.
 *
 * The packet's hard precondition, the same one WP-27 had: a turn that carries no
 * citation data must render EXACTLY as it did before this packet. The intelligence
 * layer's own invariant says it more strongly — an intelligence-layer change that
 * alters a surface predating the intelligence layer is a defect even when the
 * tests pass.
 *
 * The trap here is React's positional children, the one
 * `panelChat-procedure-parity.test.tsx` names: a bubble rendered as a conditional
 * would not produce the same tree for the user who has never seen a citation. So
 * the assertion is on the serialized TREE of the bubble, not on its text.
 *
 * The second half is the swap point. `citation` on a message is the whole
 * contract: whatever eventually delivers a turn's supply and manifest to the
 * renderer — that is host work, on the intelligence-host lock, and is not this
 * packet — puts them on that field and this test keeps passing unchanged.
 */
import * as React from 'react';
import { PanelChat, renderMarkdown } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { serializeTree } from './helpers/serializeTree';
import { fixtureCitationTurn } from '../../../src/renderer/components/DockedPanel/citationTurn.fake';

function chat(): any {
  return new (PanelChat as any)({
    electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
    sessionId: null,
    selectedSiteIds: [],
    siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
    visible: true,
    onSessionCreated: jest.fn(),
    onSessionSaved: jest.fn(),
    onStreamingStatusChange: jest.fn(),
  });
}

const REPLY = 'A claim. [[cite:evt_9c41]]';

function renderMessage(message: any): any {
  const c = chat();
  return serializeTree(c.renderMessage(message));
}

function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = node.children ?? node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

describe('a turn with no citation data', () => {
  it('renders the bubble EXACTLY as it did before this packet', () => {
    const tree = renderMessage({ id: 'm1', role: 'assistant', content: REPLY });
    // The pre-packet shape, spelled out rather than snapshotted, so a reader of
    // this test can see what parity means: one markdown div, the reply passed
    // through `renderMarkdown` whole, markers and all.
    const bubble = walk(tree).find((n: any) => n.props?.className === 'nexus-md');
    expect(bubble).toBeDefined();
    expect(bubble.props.dangerouslySetInnerHTML).toEqual({ __html: renderMarkdown(REPLY) });
    expect(bubble.props.style.alignSelf).toBe('flex-start');
    // and nothing citation-shaped anywhere in the tree
    expect(walk(tree).filter((n: any) => n.props?.['data-citation-render'])).toEqual([]);
    expect(walk(tree).filter((n: any) => n.type === 'CitationSpans')).toEqual([]);
  });

  it('leaves an unrecognised marker on screen rather than eating it', () => {
    // The honest consequence of parity: before delivery is wired, a model that
    // cites writes visible syntax. That is better than a renderer that strips
    // markers it was never told how to resolve — stripping would hide a real
    // fact about the reply from the one person who could report it.
    const tree = renderMessage({ id: 'm1', role: 'assistant', content: REPLY });
    const bubble = walk(tree).find((n: any) => n.props?.className === 'nexus-md');
    expect(bubble.props.dangerouslySetInnerHTML.__html).toContain('[[cite:evt_9c41]]');
  });
});

describe('a turn that carries citation data', () => {
  const withCitation = () => {
    const turn = fixtureCitationTurn();
    return renderMessage({
      id: 'm2',
      role: 'assistant',
      content: turn.reply,
      citation: { supply: turn.supply, manifest: turn.manifest, moment: turn.moment },
    });
  };

  it('hands the reply to the corroboration render', () => {
    const spans = walk(withCitation()).find((n: any) => n.type === 'CitationSpans');
    expect(spans).toBeDefined();
    expect(spans.props.turn.moment).toBe('investigate');
    expect(spans.props.renderMarkdown).toBe('[fn]');
  });

  it('renders the STREAMED text, never a copy of it', () => {
    // `content` is the message the panel streamed and stored; `reply` on the
    // citation payload is overwritten from it at render time. Two strings for
    // one reply is a second place a fact can be wrong — the sheet's own
    // objection to copying a record into the chat, applied to the reply itself.
    const streamed = 'Edited afterwards. [[cite:evt_9c41]]';
    const turn = fixtureCitationTurn();
    const tree = renderMessage({
      id: 'm3',
      role: 'assistant',
      content: streamed,
      citation: { reply: turn.reply, supply: turn.supply, manifest: turn.manifest, moment: turn.moment },
    });
    const spans = walk(tree).find((n: any) => n.type === 'CitationSpans');
    expect(spans.props.turn.reply).toBe(streamed);
  });

  it('keeps the bubble’s own chrome — the citation render sits INSIDE it', () => {
    const tree = withCitation();
    const spans = walk(tree).find((n: any) => n.type === 'CitationSpans');
    const bubble = walk(tree).find(
      (n: any) => n.props?.style?.alignSelf === 'flex-start' && walk(n).includes(spans)
    );
    expect(bubble).toBeDefined();
    expect(bubble.props.style.borderRadius).toBe('2px 12px 12px 12px');
  });
});
