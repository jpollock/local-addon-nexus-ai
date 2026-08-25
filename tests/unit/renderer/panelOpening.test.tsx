/**
 * @jest-environment jsdom
 */
/**
 * WP-49 · ITEM 4 — RE-RULED at the new-chat sheet (owner, 2026-08-25 16:09).
 *
 * The original pins put the queue ON this surface: verdict, invitation line,
 * one button per ask. The ruling removed all three from the empty session —
 * it opens on the invitation and nothing else, whatever the queue holds; the
 * count's remaining home is the header door (board A). `openingAsks.test.ts`
 * still pins the DERIVATION untouched: the queue data survives, this surface
 * just no longer renders it.
 *
 * What this suite now pins is the ruling itself, so a later packet cannot
 * quietly bring the report back to where the invitation belongs.
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

describe('the empty session opens on the invitation, whatever the queue holds', () => {
  test('a full queue renders NO verdict, NO invitation line, NO ask buttons here', () => {
    const nodes = rawWalk(chat(OPENING).render());
    const opening = nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined);
    expect(opening).toHaveLength(1);
    // Still labelled 'queue' so instrumentation can tell the states apart…
    expect(attr(opening[0], 'data-panel-opening')).toBe('queue');
    // …but none of the queue's content is drawn in the column.
    expect(nodes.filter((n) => attr(n, 'data-opening-verdict') !== undefined)).toHaveLength(0);
    expect(nodes.filter((n) => attr(n, 'data-opening-ask') !== undefined)).toHaveLength(0);
    expect(textOf(opening[0]).join(' ')).not.toContain(PANEL_INVITATION);
    expect(textOf(opening[0]).join(' ')).not.toContain(OPENING.verdict);
  });

  test('the invitation is IDENTICAL on a busy fleet and a quiet one', () => {
    const busy = textOf(rawWalk(chat(OPENING).render()).find((n) => attr(n, 'data-panel-opening') !== undefined)).join(' ');
    const quiet = textOf(rawWalk(chat(null).render()).find((n) => attr(n, 'data-panel-opening') !== undefined)).join(' ');
    expect(busy).toBe(quiet);
  });

  test('no queue means the panel\'s own invitation — a real state, and a labelled one', () => {
    const nodes = rawWalk(chat(null).render());
    const opening = nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined);
    expect(opening).toHaveLength(1);
    expect(attr(opening[0], 'data-panel-opening')).toBe('invitation');
    expect(nodes.filter((n) => attr(n, 'data-opening-ask') !== undefined)).toHaveLength(0);
  });

  test('the opening state is replaced by the transcript, never stacked above it', () => {
    const instance = chat(OPENING);
    instance.state = { ...instance.state, messages: [{ id: 'm1', role: 'user', content: 'hello' }] };
    const nodes = rawWalk(instance.render());
    expect(nodes.filter((n) => attr(n, 'data-panel-opening') !== undefined)).toHaveLength(0);
    expect(serializeTree(instance.render())).toBeDefined();
  });
});
