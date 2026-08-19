/**
 * @jest-environment jsdom
 */
/**
 * WP-36 · the display half — a refused tool call renders as a completed one.
 *
 * This is the defect that manufactured the whole incident scare. On 2026-08-19
 * the sequence guard REFUSED `verify_site_live` (operation-audit.log,
 * 00:39:01.047Z, outcome=failure, "cp.backup is not attested") and the Docked
 * Panel showed `✓ Verify Site Live`. Reading the screenshot, the smoke recorded
 * that a declared tool had executed with a gated predecessor unattested — the
 * incident class — and a packet was opened to explain a thing that never
 * happened. The gate held; the panel said it hadn't.
 *
 * The cause is one field, dropped. `tool_call_result` carries `isError`
 * (`src/common/chat-types.ts:55`), the legacy `ChatTab.tsx:418` reads it
 * (`status: event.isError ? 'error' : 'completed'`), and `PanelChat.onStreamEvent`
 * hardcodes `status: 'done'`. `ToolCallState` even DECLARES an `'error'` status
 * (PanelChat.tsx:44) that nothing ever assigns — the eleventh vacuous-guard
 * shape's cousin: what the structure omits by design is where the defect lives.
 *
 * Characterization, not a wish: these assert what SHIPS. A fix turns the first
 * two RED at the line naming the wrong status, which is the point.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';

/** The exact refusal message the live audit log holds, truncated to its head. */
const REFUSAL_TEXT =
  'REFUSED by procedure rb.bulk-plugin-update (cap.bulk_plugin_update): ' +
  'verify_site_live belongs to checkpoint cp.verify-canary, and cp.backup is not attested.';

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

/** setState applied synchronously, so a stream event can be read straight back. */
function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any, cb?: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    if (update) Object.assign(this.state, update);
    if (typeof cb === 'function') cb();
  });
}

/** Drive one tool call from start to result, and hand back its state row. */
function runOneCall(isError: boolean | undefined): any {
  const c = chat();
  c.state = {
    ...c.state,
    streaming: true,
    streamingId: 'm1',
    messages: [{ id: 'm1', role: 'assistant', content: '', toolCalls: [] }],
  };
  spySetState(c);

  c.onStreamEvent({ type: 'tool_call_start', id: 't1', name: 'verify_site_live' });
  c.onStreamEvent({
    type: 'tool_call_result',
    id: 't1',
    name: 'verify_site_live',
    result: REFUSAL_TEXT,
    ...(isError === undefined ? {} : { isError }),
  });

  return c.state.messages[0].toolCalls[0];
}

describe('WP-36 · PanelChat renders a refusal as a success', () => {
  test('a tool_call_result carrying isError:true still lands as status "done"', () => {
    const call = runOneCall(true);

    // The field arrives and is discarded. `done` is the same status a genuine
    // success gets, and the done-chip branch (PanelChat.tsx:772) paints it with
    // a green ✓ — so a gate that fired reads on screen as an act that happened.
    expect(call.status).toBe('done');
    expect(call.result).toBe(REFUSAL_TEXT);
  });

  test('an errored and a successful result are INDISTINGUISHABLE in panel state', () => {
    // The assertion that matters. It is not that the error status is missing —
    // it is that nothing downstream of this handler can tell the two apart, so
    // no amount of care in the chip renderer could have saved the screenshot.
    expect(runOneCall(true).status).toBe(runOneCall(false).status);
    expect(runOneCall(true).status).toBe(runOneCall(undefined).status);
  });

  test('the surface that DOES read isError is the legacy one — same event, two answers', () => {
    // ChatTab.tsx:416-419 maps the same event to 'error'. Two chat surfaces
    // disagreeing about whether a call succeeded is the drift this pins; the
    // docked panel is the one users were looking at during the smoke.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/renderer/components/ChatTab.tsx'),
      'utf8',
    );
    expect(source).toContain("status: event.isError ? 'error' : 'completed'");

    const panel = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/renderer/components/DockedPanel/PanelChat.tsx'),
      'utf8',
    );
    // Zero references — the field is never consulted anywhere in the panel.
    expect(panel).not.toContain('isError');
  });
});
