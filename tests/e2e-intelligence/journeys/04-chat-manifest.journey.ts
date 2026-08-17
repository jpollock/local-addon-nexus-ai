/**
 * WP-18 · Journey 4 — a docked-panel chat turn leaves a context manifest.
 *
 * ── Why this journey drives the DETECTOR and not the chat turn ────────────
 *
 * Scouted, and reported rather than worked around. The only path that reaches
 * `assembleForChatTurn` — and therefore the only producer of a
 * `task.context.assembled` manifest — is `ChatService.sendMessage`, reached
 * from exactly one caller: the `CHAT_SEND` handler in
 * `src/main/chat/chat-ipc-handlers.ts`, registered with `ipcMain.handle`.
 *
 *   - `ipcMain.handle` is reachable only from a renderer in the SAME Electron
 *     process. There is no HTTP or socket surface in front of it.
 *   - There is no GraphQL mutation for chat (nothing chat-shaped in
 *     `src/main/graphql/schema.ts`), so the CLI/GraphQL endpoint the rest of
 *     this harness uses cannot reach it.
 *   - There is no `nexus chat` CLI command (`src/cli/commands/`), and
 *     `tests/e2e-cli`'s own chat suites say so in as many words: "`nexus mcp
 *     call` does not exist … all tests use CLI proxies".
 *   - There is no MCP tool that sends a chat turn — the MCP surface is what
 *     chat CALLS, not the other way round.
 *
 * Driving it headlessly would mean adding a production seam whose only consumer
 * is a test, on a packet whose charter is zero production edits. So this
 * journey takes the fallback the packet sanctions: `nexus_intelligence_health`'s
 * "Chat context" line IS the assembler's last-manifest age, measured from the
 * ledger by the same GROUP BY that measures every other producer. Driving the
 * turn is a one-line manual precondition, and the failure below says so.
 *
 * What this buys, and what it does not: it proves a manifest exists and how
 * recent it is — the same evidence the health surface gives a user. It does not
 * prove THIS RUN produced one. That gap is real; closing it needs a drivable
 * chat seam, and that is a production change for a future packet, not something
 * to fake here.
 */
import { loadConnectionInfo, NexusMcpClient } from '../../e2e-cli/helpers/mcp-client';
import { parseHealthReport, rowFor } from '../runner/healthReport';

const client = new NexusMcpClient(loadConnectionInfo()!);

const CHAT_CONTEXT_LINE = 'Chat context';

const MANUAL_STEP =
  'Open the Nexus AI docked panel in Local and send ONE message, then re-run. That path ' +
  '(CHAT_SEND → ChatService.sendMessage → assembleForChatTurn) is the only producer of a ' +
  'task.context.assembled manifest, and it is reachable only from the renderer.';

describe('journey: the assembler has produced a context manifest', () => {
  let raw: string;

  beforeAll(async () => {
    raw = await client.callTool('nexus_intelligence_health', {});
  });

  it('has a Chat context line at all', () => {
    // The line is unconditional in PRODUCER_LIVENESS_SLOS, so its absence
    // means the SLO table changed and this journey's detector went blind.
    const row = rowFor(parseHealthReport(raw), CHAT_CONTEXT_LINE);
    expect(row).toBeDefined();
    console.log(`[chat-manifest] ${row!.value} (expected ${row!.threshold}) — ${row!.verdict}`);
  });

  it('has recorded at least one manifest', () => {
    const row = rowFor(parseHealthReport(raw), CHAT_CONTEXT_LINE)!;
    if (row.value === 'nothing yet') {
      throw new Error(
        `No task.context.assembled manifest has ever been recorded on this machine. ${MANUAL_STEP}`
      );
    }
    expect(row.value).toMatch(/^last seen /);
  });

  it('the manifest is inside its liveness SLO — assembly is current, not historical', () => {
    const row = rowFor(parseHealthReport(raw), CHAT_CONTEXT_LINE)!;
    if (row.verdict !== 'OK') {
      throw new Error(
        `The last context manifest is ${row.value}, past the expected ${row.threshold}. ` +
          `Either assembly has stopped, or chat simply has not been used. ${MANUAL_STEP}`
      );
    }
    expect(row.verdict).toBe('OK');
  });
});
