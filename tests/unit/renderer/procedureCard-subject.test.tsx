/**
 * @jest-environment jsdom
 */
/**
 * WP-36 · the approval card's SUBJECT is the checkpoint, not the tool.
 *
 * On 2026-08-19 the card that attested `cp.approval` — the anchor runbook's
 * "explicit, informed consent" to a presented fleet-update plan — was headed
 * `Verify Site Live` and described as `Runs Verify Site Live on your WordPress
 * sites.` Both strings came from `toolDisplayName`/`toolEffect` over
 * `tc.name`.
 *
 * The tool is INCIDENTAL at this card. `cp.approval` declares no tools at all,
 * and `procedureStream.approvalCheckpoint` finds it by its evidence clause
 * without reference to the call — so the tool on the card is whichever one the
 * guard happened to be refusing when the approval became the first unmet
 * prerequisite. It would have read `Wpe Backup And Verify` just as readily.
 * A card that names an incidental tool, in read-shaped words, asking for the
 * consent that gates a fleet write, is why that consent was easy to grant.
 *
 * The fix is structural and does not wait for the designer's refined copy: the
 * title is the runbook's OWN heading for the step (quoted, never paraphrased —
 * the rule `unverifiablePrecedentOf` already follows), and the tool-mechanics
 * line is not passed at all. Absence beats a sentence about the wrong subject.
 */
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import { ProcedureApprovalCard } from '../../../src/renderer/components/DockedPanel/ProcedureApprovalCard';

const PROCEDURE = {
  runbookId: 'rb.bulk-plugin-update',
  version: '1.2.0',
  strictness: 'strict' as const,
  checkpointId: 'cp.approval',
  checkpointReason: 'explicit, informed consent',
  offersCanaryPolicy: true,
};

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

/** The props PanelChat hands the approval card for a pending procedure call. */
function cardProps(procedure: Record<string, unknown> | undefined, toolName: string): any {
  const c = chat();
  c.state = {
    ...c.state,
    streaming: false,
    streamingId: null,
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 't1',
            name: toolName,
            args: '',
            status: 'awaiting_approval',
            warning: 'Approve this step to let the runbook continue.',
            ...(procedure ? { procedure } : {}),
          },
        ],
      },
    ],
  };
  const found: any[] = [];
  const visit = (n: any) => {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n !== 'object') return;
    if (n.type === ProcedureApprovalCard) found.push(n.props);
    visit(n.props?.children);
  };
  visit(c.render());
  return found[0];
}

/** Every text node in a rendered tree, in order. */
function texts(node: any, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (!node || typeof node !== 'object') return out;
  const kids = Array.isArray(node) ? node : (node.props?.children ?? node.children);
  for (const k of (Array.isArray(kids) ? kids : [kids])) texts(k, out);
  return out;
}

describe('WP-36 · the card takes its subject from the checkpoint', () => {
  test('the title is the runbook’s own heading for the step, not the tool', () => {
    const props = cardProps(PROCEDURE, 'verify_site_live');

    expect(props.title).toBe('explicit, informed consent');
    // The exact string the live card carried, and the display name of the tool
    // it was raised for. Neither may appear.
    expect(props.title).not.toBe('Verify Site Live');
    expect(props.effect).toBeUndefined();
  });

  test('the SAME checkpoint gets the same card whichever tool the guard refused', () => {
    // The proof that the tool is incidental: two different declared tools, one
    // checkpoint, one subject. Keyed on the tool, these produced two different
    // cards for the identical consent.
    const a = cardProps(PROCEDURE, 'verify_site_live');
    const b = cardProps(PROCEDURE, 'wpe_backup_and_verify');

    expect(a.title).toBe(b.title);
    expect(a.effect).toBe(b.effect);
  });

  test('a document with no authored reason falls back to the checkpoint id, never the tool', () => {
    const props = cardProps({ ...PROCEDURE, checkpointReason: null }, 'verify_site_live');

    // Says less rather than inventing more — and still does not name the tool.
    expect(props.title).toBe('cp.approval');
  });

  test('PARITY — a plain tool confirm still describes the tool, because there the tool IS the subject', () => {
    const props = cardProps(undefined, 'wp_eval');
    // No procedure block: PanelChat renders `ActionCard`, unchanged, so
    // `cardProps` finds no ProcedureApprovalCard at all.
    expect(props).toBeUndefined();
  });

  test('the rendered card shows no tool-mechanics line, and still names its checkpoint', () => {
    const rendered = new (ProcedureApprovalCard as any)({
      title: 'explicit, informed consent',
      warning: 'Approve this step to let the runbook continue.',
      procedure: PROCEDURE,
      onApprove: jest.fn(),
      onDeny: jest.fn(),
    }).render();
    const all = texts(rendered).join(' | ');

    expect(all).toContain('explicit, informed consent');
    expect(all).toContain('This approval is checkpoint cp.approval.');
    expect(all).not.toContain('on your WordPress sites');
    // WP-35's fold, still held: the runbook reference lives in the declared
    // block's header and never on the card.
    expect(all).not.toContain('rb.bulk-plugin-update');
  });
});
