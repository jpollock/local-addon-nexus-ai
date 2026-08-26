/**
 * nexus_rebuild_twins — the shipped surface for the ADR-1/§4.3 property.
 *
 * "The twin view is rebuildable from the ledger" was, until this tool, a
 * claim exercisable only by a manual replay harness on one machine. The
 * mechanism lives in `src/intelligence/folds/rebuild.ts` (seam-pure, tested
 * there); this file is only the door: resolve the core, run the rebuild,
 * report what moved.
 *
 * Tier: 2 — the default for an absent TIER_OVERRIDES entry, and correct
 * here on the merits: this WRITES (wipes and re-materialises `twin_facts`
 * and `fold_cursors`), so the operation-audit.log line the chokepoint
 * writes for Tier 2 is exactly the record a destructive-then-restorative
 * maintenance action owes. Do not add a Tier 1 entry to quiet the audit.
 *
 * When the core is down there is nothing to rebuild FROM, and the tool says
 * so instead of pretending — the same honesty rule as everywhere else on
 * this seam: a refusal names the reason.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { rebuildTwins } from '../../../../intelligence/folds/rebuild';

export const rebuildTwinsHandler: McpToolHandler = {
  definition: {
    name: 'nexus_rebuild_twins',
    description:
      "Rebuild Nexus AI's materialised twin view from the append-only event ledger: wipes " +
      'twin_facts and fold cursors, then replays every recorded event through every fold. Use it ' +
      'when the twin view is suspected corrupt or after a schema repair — the ledger is the source ' +
      'of truth and is never touched. Safe to re-run; an interrupted rebuild completes on the next ' +
      'run.',
    inputSchema: { type: 'object', properties: {} },
  },

  async execute(): Promise<McpToolResult> {
    const core = getIntelligenceCore();
    if (!core) {
      return ok(
        'Nothing to rebuild: background record-keeping is not running, so the ledger is not ' +
          'open. Run nexus_intelligence_health for why. Your data is unaffected — the twin view ' +
          'is an extra layer, never the source.'
      );
    }

    const result = rebuildTwins(core.ledger, core.folds);
    return ok(
      [
        '## Twin view rebuilt from the ledger',
        '',
        `- Events replayed: ${result.eventsReplayed}`,
        `- Twin facts: ${result.twinsBefore} before → ${result.twinsAfter} after`,
        `- Folds run: ${result.folds.join(', ') || '(none wired)'}`,
        '',
        '_The ledger was read, never written. A count that moved means the old view had drifted ' +
          'from the record — the rebuilt view is the authoritative fold of what was actually ' +
          'observed._',
      ].join('\n')
    );
  },
};

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
