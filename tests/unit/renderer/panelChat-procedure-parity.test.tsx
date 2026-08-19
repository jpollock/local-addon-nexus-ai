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

describe('parity — the panel a user without a procedure sees', () => {
  it('renders byte-identical to the pre-WP-27 tree', () => {
    expect(serializeTree(chat().render())).toEqual(baseTree);
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
    expect(JSON.stringify(baseTree)).toContain('Ask anything about your WordPress sites');
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
