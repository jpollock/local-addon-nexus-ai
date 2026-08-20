/**
 * @jest-environment jsdom
 */
/**
 * WP-49 · ITEM 4, RENDERED — the panel opens on the queue beside it.
 *
 * `openingAsks.test.ts` pins the derivation; this pins that the panel actually
 * draws it, and that taking an ask does the one thing an offer should do.
 *
 * THE OFFER FILLS THE COMPOSER AND DOES NOT SEND. That is the assertion worth
 * having: a click that sent would turn three suggestions into three ways to
 * start a turn nobody typed, and an ask the reader wanted to edit first would be
 * gone before they could.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { serializeTree } from './helpers/serializeTree';
import { PANEL_INVITATION } from '../../../src/renderer/components/DockedPanel/openingCopy.generated';
import type { OpeningState } from '../../../src/renderer/components/DockedPanel/openingAsksModel';

const OPENING: OpeningState = {
  verdict: '2 things need you, and 2 of them have already written somewhere',
  invitation: PANEL_INVITATION,
  asks: [
    { classId: 'run.waiting.mid-procedure', situationId: 'sit-a', text: 'What does cp.backup need from me?' },
    { classId: 'incident.no-run', situationId: 'sit-b', text: 'Why is nothing fixing the open findings?' },
  ],
};

function chat(opening: OpeningState | null): any {
  return new (PanelChat as any)({
    electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
    sessionId: null,
    selectedSiteIds: [],
    siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
    opening,
    visible: true,
    onSessionCreated: jest.fn(),
    onSessionSaved: jest.fn(),
    onStreamingStatusChange: jest.fn(),
  });
}

function rawWalk(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) { for (const n of node) rawWalk(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  return rawWalk(node.props?.children, out);
}
function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  if (typeof node === 'object') textOf(node.children ?? node.props?.children, out);
  return out;
}
const attr = (n: any, name: string): unknown => n?.props?.[name];

describe('the docked panel opens on the queue, never on a blank', () => {
  test('the verdict, the invitation and one button per ask', () => {
    const nodes = rawWalk(chat(OPENING).render());
    const opening = nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined);
    expect(opening).toHaveLength(1);
    expect(attr(opening[0], 'data-panel-opening')).toBe('queue');

    const verdict = nodes.find((n) => attr(n, 'data-opening-verdict') !== undefined);
    expect(textOf(verdict).join('')).toBe(OPENING.verdict);
    expect(textOf(opening[0]).join(' ')).toContain(PANEL_INVITATION);

    const asks = nodes.filter((n) => attr(n, 'data-opening-ask') !== undefined);
    expect(asks.map((n) => attr(n, 'data-opening-ask'))).toEqual(OPENING.asks.map((a) => a.classId));
    expect(asks.map((n) => textOf(n).join(''))).toEqual(OPENING.asks.map((a) => a.text));
    // Each button names the ROW it came from, so the offer is traceable to the
    // thing on the list it is about.
    expect(asks.map((n) => attr(n, 'data-opening-ask-row'))).toEqual(OPENING.asks.map((a) => a.situationId));
  });

  test('taking an ask FILLS the composer and does not send', () => {
    const instance = chat(OPENING);
    const applied: any[] = [];
    instance.setState = (patch: any, cb?: any) => {
      applied.push(patch);
      Object.assign(instance.state, patch);
      if (typeof cb === 'function') cb();
    };
    const sendSpy = jest.spyOn(instance, 'handleSend');

    const ask = rawWalk(instance.render()).find((n) => attr(n, 'data-opening-ask') === 'incident.no-run');
    ask.props.onClick();

    expect(applied).toEqual([{ input: 'Why is nothing fixing the open findings?' }]);
    expect(instance.state.input).toBe('Why is nothing fixing the open findings?');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test('no queue means the panel\'s own invitation — a real state, and a labelled one', () => {
    const nodes = rawWalk(chat(null).render());
    const opening = nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined);
    expect(opening).toHaveLength(1);
    expect(attr(opening[0], 'data-panel-opening')).toBe('invitation');
    expect(nodes.filter((n) => attr(n, 'data-opening-ask') !== undefined)).toHaveLength(0);
  });

  test('an opening state with no asks still states the verdict', () => {
    // The verdict is about the whole list and does not depend on any row's class
    // being one the ask set covers. Withholding the asks must not withhold it.
    const nodes = rawWalk(chat({ ...OPENING, asks: [] }).render());
    expect(nodes.filter((n) => attr(n, 'data-opening-ask') !== undefined)).toHaveLength(0);
    const verdict = nodes.find((n) => attr(n, 'data-opening-verdict') !== undefined);
    expect(textOf(verdict).join('')).toBe(OPENING.verdict);
  });

  test('the opening state is replaced by the transcript, never stacked above it', () => {
    const instance = chat(OPENING);
    instance.state = { ...instance.state, messages: [{ id: 'm1', role: 'user', content: 'hello' }] };
    const nodes = rawWalk(instance.render());
    expect(nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined)).toHaveLength(0);
    expect(serializeTree(instance.render())).toBeDefined();
  });
});
