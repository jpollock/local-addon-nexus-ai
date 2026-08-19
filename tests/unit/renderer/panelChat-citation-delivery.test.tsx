/**
 * @jest-environment jsdom
 */
/**
 * WP-43 · the acceptance, drawn.
 *
 * `chat-citation-delivery.test.ts` pins that the host emits the payload;
 * `citationDelivery.test.ts` pins what is in it. This file pins the only thing
 * a user can see: that the payload, arriving on the stream the way the host
 * actually sends it, turns the owner's own reply from bracket soup into chips.
 *
 * The reply below is the shape of the ask that produced the finding — "Update
 * plugins on goldenecomm", answered with cited claims. Before this packet that
 * reply rendered `[[cite:evt_…]]` as literal text in the bubble, in production,
 * on every citing turn. The first test is that sentence inverted into an
 * assertion.
 *
 * `setState` is stubbed to apply its updater synchronously — the established
 * technique here (`procedure-approval-card.test.tsx`). What is under test is
 * the reducer inside `onStreamEvent`; that the reducer is WIRED to
 * `CHAT_STREAM` is pinned by the listener registration in `componentDidMount`,
 * which the panel's own suites already cover.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { serializeTree } from './helpers/serializeTree';
import {
  PREDATES_CONVENTION_NOTICE,
  peekTime,
  recordPeek,
} from '../../../src/renderer/components/DockedPanel/citationModel';
import { CitationSpans } from '../../../src/renderer/components/DockedPanel/CitationSpans';

const STREAMING_ID = 'assistant-now';
const EARLIER_ID = 'assistant-earlier';

/**
 * The owner's ask, answered. Three claims, three markers, all resolvable
 * against the supply below — the "quiet, neutral, resolving" acceptance.
 */
const REPLY = [
  'goldenecomm is running WooCommerce 9.2.1 and three plugins have updates waiting. [[cite:tool:wp_plugin_list#1]]',
  '',
  'The last update on this site was six days ago and it completed cleanly. [[cite:evt_9c41]]',
  '',
  'A verified backup was taken before that run. [[cite:tool:wpe_backup_and_verify#1]]',
].join('\n');

const SUPPLY = {
  events: [
    {
      id: 'evt_9c41',
      topic: 'episodic.plugin.updated',
      trust: 'emitted',
      observedAt: '2026-08-13T09:41:00.000Z',
      summary: 'woocommerce 9.1.4 → 9.2.1; resolved',
    },
  ],
  toolCalls: [
    { name: 'wp_plugin_list', index: 1 },
    { name: 'wpe_backup_and_verify', index: 1 },
  ],
  carrierLines: [{ key: 'retrieved' }],
};

/** Exactly what `citationDeliveryFor` builds, as the host puts it on the wire. */
function deliveryEvent(over: Record<string, unknown> = {}) {
  return {
    type: 'citation_supply',
    supply: SUPPLY,
    manifest: { citation: { convention: 'cnv_6c2b11952046', asserted: 'full' } },
    moment: 'investigate',
    ...over,
  };
}

function chat(messages: any[]): any {
  const c = new (PanelChat as any)({
    electron: {
      ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() },
    },
    sessionId: 'sess',
    selectedSiteIds: [],
    siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
    visible: true,
    onSessionCreated: jest.fn(),
    onSessionSaved: jest.fn(),
    onStreamingStatusChange: jest.fn(),
  });
  c.state = { ...c.state, messages, streamingId: STREAMING_ID, streaming: true };
  c.setState = function (updater: any, cb?: () => void) {
    const patch = typeof updater === 'function' ? updater(this.state) : updater;
    if (patch) this.state = { ...this.state, ...patch };
    if (cb) cb();
  };
  c.scrollToBottom = () => {};
  c.persistSession = () => {};
  return c;
}

function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = node.children ?? node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

/** Every string the bubble puts on screen — chip labels and rendered markdown. */
function visibleText(tree: any): string {
  const all = walk(tree);
  const strings = all.flatMap((n) => {
    const kids = n.children ?? [];
    return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
  });
  const html = all.map((n) => (n.props?.dangerouslySetInnerHTML?.__html ?? '') as string);
  return [...strings, ...html].join(' ');
}

/**
 * A node's own text. `serializeTree` leaves a single string child AS the
 * string rather than wrapping it, so `children[0]` on a one-string node is its
 * first CHARACTER — an assertion written that way passes against `'n'` and
 * reads as though it checked a label.
 */
function textOf(node: any): string {
  const kids = node?.children;
  if (typeof kids === 'string') return kids;
  return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string').join('');
}

/** The bubble as the panel draws it, after the delivery has been applied. */
function drawTurn(c: any, id: string): any {
  const message = c.state.messages.find((m: any) => m.id === id);
  return serializeTree(c.renderMessage(message));
}

/**
 * The `CitationSpans` element the panel built, with its REAL props.
 *
 * Read off the unserialized tree on purpose: `serializeTree` replaces every
 * function with the string `'[fn]'`, and `renderMarkdown` is injected as a
 * function. Instantiating from serialized props would hand the surface a
 * string where its markdown renderer belongs.
 */
function spansElement(c: any, id: string): any {
  const message = c.state.messages.find((m: any) => m.id === id);
  return walk(c.renderMessage(message)).find((n: any) => n.type === CitationSpans) ?? null;
}

/** The rendered `CitationSpans` for a message, instantiated and drawn. */
function spansTree(c: any, id: string): any {
  const node = spansElement(c, id);
  if (!node) return null;
  const instance = new (CitationSpans as any)(node.props);
  return serializeTree(instance.render());
}

const streamingMessage = () => ({ id: STREAMING_ID, role: 'assistant', content: REPLY, streaming: true });

// ---------------------------------------------------------------------------
// ACCEPTANCE 1 — the defect, inverted
// ---------------------------------------------------------------------------

describe('the owner’s ask, delivered', () => {
  test('renders its citations as trailing chips with ZERO raw markers visible', () => {
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent());

    const tree = spansTree(c, STREAMING_ID);
    expect(tree).not.toBeNull();

    // The defect, named: not one `[[cite:` reaches the screen.
    expect(visibleText(tree)).not.toContain('[[cite:');
    expect(visibleText(tree)).not.toContain(']]');

    // And what replaced them: one chip per marker, each carrying its record's
    // own id, each in the QUIET face. "Quiet, neutral, resolving."
    const chips = walk(tree).filter((n: any) => n.props?.['data-citation-state']);
    expect(chips).toHaveLength(3);
    expect(chips.map((n: any) => n.props['data-citation-state'])).toEqual([
      'cited-and-resolves',
      'cited-and-resolves',
      'cited-and-resolves',
    ]);
    expect(chips.map((n: any) => n.props['data-citation-face'])).toEqual([
      'neutral-subtle',
      'neutral-subtle',
      'neutral-subtle',
    ]);
    expect(chips.map(textOf)).toEqual([
      'wp_plugin_list#1',
      'evt_9c41',
      'wpe_backup_and_verify#1',
    ]);
  });

  test('the prose survives the cut intact', () => {
    // The markers go; the sentences that carried them do not. A render that
    // dropped a claim along with its marker would be worse than the leak.
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent());
    const text = visibleText(spansTree(c, STREAMING_ID));
    expect(text).toContain('goldenecomm is running WooCommerce 9.2.1');
    expect(text).toContain('A verified backup was taken before that run.');
  });

  test('the tally counts the spans it drew, and nothing else', () => {
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent());
    expect(visibleText(spansTree(c, STREAMING_ID))).toContain(
      '3 claims linked · 0 citations that do not resolve · 0 facts with nothing offered'
    );
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 2 — a record outside the supply is the loudest thing on screen
// ---------------------------------------------------------------------------

describe('a marker citing a record this task never supplied', () => {
  test('renders the LOUDEST state, and is the only one that does', () => {
    const c = chat([
      { ...streamingMessage(), content: `${REPLY}\n\nAnd an older incident says the same. [[cite:evt_8e90]]` },
    ]);
    c.onStreamEvent(deliveryEvent());

    const chips = walk(spansTree(c, STREAMING_ID)).filter((n: any) => n.props?.['data-citation-state']);
    expect(chips).toHaveLength(4);
    const loud = chips.filter((n: any) => n.props['data-citation-face'] === 'error-strong');
    expect(loud).toHaveLength(1);
    expect(loud[0].props['data-citation-state']).toBe('cited-but-unresolvable');
    // It prints the id it could not find, so the person can go looking.
    expect(textOf(loud[0])).toBe('evt_8e90');
  });

  test('a claim pointing at nothing at all stays the quieter warning, not the error', () => {
    // `[[cite:none]]` is the model saying so itself. Collapsing the two would
    // make an honest declaration look like a broken link.
    const c = chat([{ ...streamingMessage(), content: 'I have not proved this. [[cite:none]]' }]);
    c.onStreamEvent(deliveryEvent());

    const chips = walk(spansTree(c, STREAMING_ID)).filter((n: any) => n.props?.['data-citation-state']);
    expect(chips).toHaveLength(1);
    expect(chips[0].props['data-citation-face']).toBe('warning-subtle');
    expect(textOf(chips[0])).toBe('no record');
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE 3 — a pre-convention transcript still says so
// ---------------------------------------------------------------------------

describe('a transcript from before the convention', () => {
  test('says so, in the designer’s words, and links nothing', () => {
    const manifest: { citation?: never } = {};
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent({ manifest }));

    const tree = spansTree(c, STREAMING_ID);
    const card = walk(tree).find((n: any) => n.props?.['data-citation-render'] === 'predates-convention');
    expect(card).toBeDefined();
    expect(visibleText(tree)).toContain(PREDATES_CONVENTION_NOTICE);
    // Nothing is linked, and no marker leaks either.
    expect(walk(tree).filter((n: any) => n.props?.['data-citation-state'])).toEqual([]);
    expect(visibleText(tree)).not.toContain('[[cite:');
  });

  test('a turn under no convention is NOT the legacy card — it is ordinary prose', () => {
    // WP-38's G1 split, measured through the delivery seam rather than the
    // model alone: `citation: null` means a bare carrier, an ordinary turn from
    // today. Printing "this session predates the convention" over it would be a
    // container for an empty run in sentence form.
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent({ manifest: { citation: null } }));

    const tree = spansTree(c, STREAMING_ID);
    const plain = walk(tree).find((n: any) => n.props?.['data-citation-render'] === 'convention-did-not-ride');
    expect(plain).toBeDefined();
    expect(visibleText(tree)).not.toContain(PREDATES_CONVENTION_NOTICE);
    expect(visibleText(tree)).not.toContain('[[cite:');
  });
});

// ---------------------------------------------------------------------------
// Retroactive citation — the one thing that would make every link untrustworthy
// ---------------------------------------------------------------------------

describe('where the delivery lands', () => {
  test('on the streaming message, and on no other', () => {
    const earlier = { id: EARLIER_ID, role: 'assistant', content: 'An earlier reply. [[cite:evt_9c41]]' };
    const c = chat([earlier, streamingMessage()]);
    c.onStreamEvent(deliveryEvent());

    const [before, now] = c.state.messages;
    expect(now.citation).toBeDefined();
    // Presence is the assertion, so it is asserted as presence: `toEqual`
    // treats an absent key and an `undefined` one as the same (WP-26).
    expect(before).not.toHaveProperty('citation');
    // Drawn: the earlier reply is untouched, markers and all — the honest
    // pre-delivery rendering, not this turn's supply applied backwards.
    expect(walk(drawTurn(c, EARLIER_ID)).filter((n: any) => n.type === 'CitationSpans')).toEqual([]);
  });

  test('a turn with no delivery renders exactly as it did before this packet', () => {
    const c = chat([streamingMessage()]);
    // No `citation_supply` event at all — the degraded-layer case.
    c.onStreamEvent({ type: 'done', stopReason: 'end_turn' });

    const tree = drawTurn(c, STREAMING_ID);
    expect(walk(tree).filter((n: any) => n.type === 'CitationSpans')).toEqual([]);
    expect(visibleText(tree)).toContain('[[cite:evt_9c41]]');
  });
});

// ---------------------------------------------------------------------------
// The peek's two owed fields, on the surface
// ---------------------------------------------------------------------------

describe('the record peek, now complete', () => {
  function openPeek(): any {
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent());
    const node = spansElement(c, STREAMING_ID);
    const instance = new (CitationSpans as any)(node.props);
    // The event chip is the second span; open it.
    const segments = walk(serializeTree(instance.render())).filter(
      (n: any) => n.props?.['data-citation-state']
    );
    expect(segments).toHaveLength(3);
    instance.state = { openIndex: 3 }; // segment index of the evt_9c41 citation
    return serializeTree(instance.render());
  }

  test('draws the record’s TIME and its one-line machine summary', () => {
    const tree = openPeek();
    const panel = walk(tree).find((n: any) => n.props?.['data-citation-panel'] === 'record-peek');
    expect(panel).toBeDefined();

    const time = walk(tree).find((n: any) => n.props?.['data-peek-field'] === 'time');
    const summary = walk(tree).find((n: any) => n.props?.['data-peek-field'] === 'summary');
    expect(time).toBeDefined();
    expect(summary).toBeDefined();
    expect(textOf(summary)).toBe('woocommerce 9.1.4 → 9.2.1; resolved');
    // The formatted value, not a re-derivation of it — one formatter, so the
    // pin cannot pass against a surface that formats differently from the model.
    expect(textOf(time)).toBe(
      peekTime(recordPeek({ kind: 'event', id: 'evt_9c41', observedAt: '2026-08-13T09:41:00.000Z' }))
    );
  });

  test('draws NEITHER row when the supply carried neither', () => {
    // The honest-absence rule, and the reason it is asserted rather than
    // assumed: a placeholder is a word standing in for a fact, on the one
    // surface whose whole subject is the difference between the two.
    const bare = { ...SUPPLY, events: [{ id: 'evt_9c41' }] };
    const c = chat([{ ...streamingMessage(), content: 'A claim. [[cite:evt_9c41]]' }]);
    c.onStreamEvent(deliveryEvent({ supply: bare }));
    const node = spansElement(c, STREAMING_ID);
    const instance = new (CitationSpans as any)(node.props);
    instance.state = { openIndex: 1 };
    const tree = serializeTree(instance.render());

    expect(walk(tree).find((n: any) => n.props?.['data-citation-panel'] === 'record-peek')).toBeDefined();
    expect(walk(tree).filter((n: any) => n.props?.['data-peek-field'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two doors — measured, not assumed
// ---------------------------------------------------------------------------

describe('the two doors', () => {
  /**
   * WP-38 shipped both doors gated on a handler and pinned them in both
   * directions: "a door that opens nothing is worse than no door". WP-43 was
   * asked to wire them IF the delivery made their targets resolvable. It does
   * not, and the measurement is in the packet's report rather than in a guess:
   *
   *  - *Open in the record, against its runbook* wants the RECORD RANK, which
   *    `moments-model.md` names and nothing builds. Zero renderer components
   *    render a ledger event by id; zero IPC channels reach the ledger;
   *    `Ledger.get(id)` has zero callers anywhere outside its own class.
   *  - *Search the ledger for this id* wants a ledger search surface. There is
   *    no IPC channel, no GraphQL field and no component for one.
   *
   * So both stay unrendered. This test is the guard on that: the panel must
   * keep supplying neither handler, and a future edit that invents one — a
   * `console.log`, a no-op, an alert — turns a door that opens nothing back on.
   */
  test('the panel supplies NEITHER handler, so neither door renders', () => {
    const c = chat([streamingMessage()]);
    c.onStreamEvent(deliveryEvent());

    const node = spansElement(c, STREAMING_ID);
    expect(node).not.toBeNull();
    expect(node.props).not.toHaveProperty('onOpenRecord');
    expect(node.props).not.toHaveProperty('onSearchLedger');

    // Drawn: the peek opens and carries its label as DATA, and draws no button.
    const instance = new (CitationSpans as any)(node.props);
    instance.state = { openIndex: 3 };
    const tree = serializeTree(instance.render());
    expect(walk(tree).find((n: any) => n.props?.['data-citation-panel'] === 'record-peek')).toBeDefined();
    expect(walk(tree).filter((n: any) => n.type === 'button')).toEqual([]);
  });
});
