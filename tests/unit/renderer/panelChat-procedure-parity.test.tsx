/**
 * @jest-environment jsdom
 */
/**
 * WP-27 · the parity pin, and the swap point.
 *
 * PARITY. The packet's hard requirement is that with no armed capability the
 * Docked Panel renders exactly as it did before the procedure surfaces existed.
 * `__fixtures__/panelChat-parity-base.json` is `PanelChat.render()`'s serialized
 * tree captured from the BASE commit (9699d752) BEFORE a line of this packet was
 * written — which is the only order in which that artifact means anything. A
 * snapshot generated after the change would pin the change to itself.
 *
 * The trap this closes is concrete and was one refactor away: React children are
 * positional, and `React.createElement('div', props, a, null, b)` does NOT
 * produce the same tree as `React.createElement('div', props, a, b)`. Rendering
 * the band as a conditional child would have changed the panel for every user who
 * has never run a procedure. It is spread from an array instead, empty when
 * nothing is armed.
 *
 * If you changed the panel's chrome deliberately, this test will fail — that is
 * the pin doing its job. Regenerate the fixture from the base of YOUR change, and
 * say in the packet note what moved and why.
 *
 * WP-49 REGENERATED IT, AND SAYS WHAT MOVED. Item 4 changes this panel's chrome
 * on purpose, so the fixture is re-captured — and because "regenerate and move
 * on" is how a pin quietly stops pinning, the two moves are ASSERTED below
 * rather than absorbed into the artifact. The structural delta was measured
 * before the recapture and is exactly two nodes, nothing else:
 *
 *   1. the empty state gained `data-panel-opening` — it is the opening state
 *      now, drawn from the queue instead of from a blank;
 *   2. `SiteContextStrip` moved from ABOVE the composer to BELOW it, which is
 *      where §5 puts the scope line.
 *
 * Every other node, in every other position, is byte-identical to the tree the
 * base commit produced.
 *
 * THE SWAP POINT. The other half: the same three shapes, delivered by the fake
 * emitter through the panel's real stream listener, put the rail on screen. When
 * WP-26's emitter lands it puts those shapes on the same channel and this test
 * keeps passing unchanged — that is what "one seam, one swap point" has to mean
 * to be worth claiming.
 */
import * as React from 'react';
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { serializeTree } from './helpers/serializeTree';
import { armedFixture, fakeProcedureStream } from '../../../src/renderer/components/DockedPanel/procedureStream.fake';
import baseTree from './__fixtures__/panelChat-parity-base.json';

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

/** setState, applied synchronously, so a stream event can be read straight back. */
function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any, cb?: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    if (update) Object.assign(this.state, update);
    if (typeof cb === 'function') cb();
  });
}

function text(node: any): string {
  const bits: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') { bits.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n === 'object') visit(n.children ?? n.props?.children);
  };
  visit(node);
  return bits.join(' ');
}

/** Every element in a serialized tree, flattened deeply, with its depth. */
function elements(node: any, depth = 0, out: Array<{ type: any; depth: number; props: any }> = []): Array<{ type: any; depth: number; props: any }> {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { node.forEach((n) => elements(n, depth, out)); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push({ type: node.type, depth, props: node.props ?? {} });
  elements(node.children, depth + 1, out);
  return out;
}

describe('parity — the panel a user without a procedure sees', () => {
  it('renders byte-identical to the recorded tree', () => {
    expect(serializeTree(chat().render())).toEqual(baseTree);
  });

  // WP-49 · THE TWO MOVES THE RECAPTURE ABSORBED, ASSERTED. A regenerated
  // fixture pins the new tree to itself and says nothing about what changed;
  // these say it. If a later packet moves the strip back above the composer, or
  // drops the opening state for a blank, the fixture would happily be
  // regenerated again — and these two would not.
  it('WP-49 · the scope line sits BELOW the composer, not above it', () => {
    const flat = elements(serializeTree(chat().render()));
    const strip = flat.findIndex((e) => e.type === 'SiteContextStrip');
    const composer = flat.findIndex((e) => e.type === 'textarea');
    expect(strip).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(composer);
  });

  it('WP-49 · the transcript opens on an opening state, never on an unlabelled blank', () => {
    const flat = elements(serializeTree(chat().render()));
    const opening = flat.filter((e) => e.props['data-panel-opening'] !== undefined);
    expect(opening).toHaveLength(1);
    // With no `opening` prop there is no queue to draw from, so it is the
    // panel's own invitation — a real state, and a labelled one.
    expect(opening[0].props['data-panel-opening']).toBe('invitation');
  });

  // fixes-082526 · THE MOVE THIS RECAPTURE ABSORBED, ASSERTED. The new-chat
  // sheet puts the composer in the vertical middle of an EMPTY session,
  // directly under the invitation, and moves it to the bottom on the first
  // turn. A regenerated fixture pins the new tree to itself and says nothing
  // about that; this says it, and would fail if a later packet quietly pinned
  // the composer back to the bottom of a blank column.
  it('fixes-082526 · on an empty session the composer sits INSIDE the centred column', () => {
    const tree = serializeTree(chat().render()) as any;
    const flat = elements(tree);
    const log = flat.filter((e) => e.props['data-nexus-chat'] !== undefined)[0];
    expect(log).toBeTruthy();
    // Centred, not top-anchored: this is the half that closes the 700px gap.
    expect(log.props.style.justifyContent).toBe('center');
    // And the composer is a DESCENDANT of it — deeper than the log itself.
    const composer = flat.filter((e) => e.type === 'textarea')[0];
    expect(composer).toBeTruthy();
    expect(composer.depth).toBeGreaterThan(log.depth);
  });

  it('WP-41 · grows NO comparator chrome for a user with nothing to compare', () => {
    // The comparator is spread from an array, not rendered as a conditional
    // child, for exactly the reason the header gives about the band: React
    // children are positional and a `null` is not the same tree as no child.
    // This is why the fixture above did not need regenerating for WP-41 — the
    // panel a user without comparable facts sees is byte-identical still.
    const tree = JSON.stringify(serializeTree(chat().render()));
    expect(tree).not.toContain('ComparatorPanel');
    expect(tree).not.toContain('comparator-toggle');
    expect(tree).not.toContain('Compare across places');
  });

  it('WP-41 · offers the comparator once the records can actually serve one', () => {
    // The other side, so the pin above cannot pass by the feature being dead.
    const instance = chat();
    instance.state.comparatorFacts = [{ fact: 'plugin:woocommerce', label: 'woocommerce', places: 3 }];
    const tree = JSON.stringify(serializeTree(instance.render()));
    expect(tree).toContain('Compare across places');
    // Offered, not opened: the shape appears when she asks for it.
    expect(tree).not.toContain('ComparatorPanel');
  });

  it('WP-41 · mounts even when the host returns nothing thenable for the comparator', () => {
    // The seam's one prohibition, as a pin: an intelligence-layer read must
    // never break a surface that predates the intelligence layer. A double (or
    // an older host) whose `invoke` returns `undefined` for an unknown channel
    // used to throw out of componentDidMount and take the whole panel with it.
    const instance = new (PanelChat as any)({
      electron: { ipcRenderer: { invoke: () => undefined, on: jest.fn(), removeListener: jest.fn() } },
      sessionId: null,
      selectedSiteIds: [],
      siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
      onStreamingStatusChange: jest.fn(),
    });
    expect(() => instance.loadComparatorFacts()).not.toThrow();
    expect(instance.state.comparatorFacts).toEqual([]);
    // …and a host that throws outright is the same non-event.
    instance.props.electron.ipcRenderer.invoke = () => { throw new Error('no such channel'); };
    expect(() => instance.loadComparatorFacts()).not.toThrow();
  });

  it('puts no procedure node in the tree', () => {
    expect(JSON.stringify(serializeTree(chat().render()))).not.toContain('ProcedureSurfaces');
  });

  it('is not a vacuous comparison — the captured tree is the real panel', () => {
    // The anchor moved with the copy: the invitation is now the sheet's
    // ratified headline (newChatCopy.generated.ts) rather than a hand-typed
    // line. Still a real string from the real panel, which is all this guard
    // is for.
    expect(JSON.stringify(baseTree)).toContain('What do you need?');
    expect(JSON.stringify(baseTree)).toContain('SiteContextStrip');
  });
});

describe('the swap point — the panel folds the three shapes off its own stream', () => {
  it('renders the rail when the events arrive, whatever produced them', async () => {
    const instance = chat();
    spySetState(instance);

    const stream = fakeProcedureStream();
    // Exactly what `componentDidMount`'s listener does with a CHAT_STREAM payload.
    stream.subscribe((event) => instance.onStreamEvent(event));
    await stream.play();

    const tree = serializeTree(instance.render());
    expect(JSON.stringify(tree)).toContain('ProcedureSurfaces');

    const band = (tree as any).children.find((c: any) => c?.type === 'ProcedureSurfaces');
    expect(band.props.procedure.runbookId).toBe('rb.bulk-plugin-update');
    expect(band.props.abort.abortId).toBe('ab_01hq7m3k9x');
  });

  it('leaves the rail alone for every other event on the stream', () => {
    const instance = chat();
    spySetState(instance);
    instance.onStreamEvent(armedFixture());
    const armed = instance.state.procedure;

    for (const other of [{ type: 'token', text: 'x' }, { type: 'tool_call_start', id: 't', name: 'n' }]) {
      instance.onStreamEvent(other);
    }
    expect(instance.state.procedure).toBe(armed);
  });

  it('starts with nothing armed, so the band only ever appears because an event said so', () => {
    expect(text(serializeTree(chat().render()))).not.toContain('marked strict');
  });
});
