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
 * FIXED (WP-36 gate ratification): the handler reads `isError`, the chip is
 * grouped by tool AND status, and a refusal renders `✕` in STATUS_ERROR with an
 * aria-label — colour alone would leave the two identical to a reader who
 * cannot see it, which is the same failure with a narrower audience.
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

/** Every ✓/✕ mark in a rendered tree, in order. */
function collectMarks(node: any): string[] {
  const marks: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string') {
      if (n === '✓' || n === '✕') marks.push(n);
      return;
    }
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n === 'object') visit(n.props?.children ?? n.children);
  };
  visit(node);
  return marks;
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

describe('WP-36 · a refusal is not rendered as a success', () => {
  test('a tool_call_result carrying isError:true lands as status "error"', () => {
    const call = runOneCall(true);

    expect(call.status).toBe('error');
    expect(call.result).toBe(REFUSAL_TEXT);
  });

  test('a successful result is still "done" — the parity half', () => {
    expect(runOneCall(false).status).toBe('done');
    // Absent `isError` is a success, exactly as every pre-WP-36 emitter meant
    // it. Nothing that used to render a tick stops rendering one.
    expect(runOneCall(undefined).status).toBe('done');
  });

  test('an errored and a successful result are DISTINGUISHABLE in panel state', () => {
    // The assertion that matters, inverted from the one that reproduced the
    // defect. Everything downstream can now tell the two apart.
    expect(runOneCall(true).status).not.toBe(runOneCall(false).status);
  });

  test('the chip carries the outcome in its MARK, not only its colour', () => {
    const c = chat();
    c.state = {
      ...c.state,
      streaming: false,
      streamingId: null,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'x',
          toolCalls: [
            { id: 't1', name: 'verify_site_live', args: '', status: 'error', result: REFUSAL_TEXT },
            { id: 't2', name: 'nexus_list_sites', args: '', status: 'done', result: 'ok' },
          ],
        },
      ],
    };
    const marks = collectMarks(c.render());

    // A refusal and a success on the same turn, and they do not look alike.
    expect(marks).toContain('✕');
    expect(marks).toContain('✓');
  });

  test('the same tool refused AND succeeded does not collapse into one mark', () => {
    const c = chat();
    c.state = {
      ...c.state,
      streaming: false,
      streamingId: null,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'x',
          toolCalls: [
            { id: 't1', name: 'verify_site_live', args: '', status: 'error', result: REFUSAL_TEXT },
            { id: 't2', name: 'verify_site_live', args: '', status: 'done', result: 'ok' },
          ],
        },
      ],
    };
    const marks = collectMarks(c.render());

    // Grouping is by tool AND status. Grouping by tool alone would put one mark
    // on two different answers — the original defect, one level up.
    expect(marks.filter((m) => m === '✕')).toHaveLength(1);
    expect(marks.filter((m) => m === '✓')).toHaveLength(1);
  });

  test('both chat surfaces now agree that isError means error', () => {
    const read = (rel: string) =>
      require('fs').readFileSync(require('path').join(__dirname, '../../../src/', rel), 'utf8');

    expect(read('renderer/components/ChatTab.tsx')).toContain(
      "status: event.isError ? 'error' : 'completed'",
    );
    // The docked panel — the surface the user was actually looking at during
    // the 2026-08-19 smoke — reads the same field rather than dropping it.
    expect(read('renderer/components/DockedPanel/PanelChat.tsx')).toContain('event.isError');
  });
});
