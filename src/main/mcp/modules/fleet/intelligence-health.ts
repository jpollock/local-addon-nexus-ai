/**
 * nexus_intelligence_health — WP-17's read-only self-report.
 *
 * The layer beneath this tool is non-fatal by construction: when it breaks,
 * nothing else does, which is exactly why its breakage is invisible. This
 * tool is the visibility half (TESTING_STRATEGY.md layers 7 and 9) — every
 * line carries what was measured, what was expected, and a verdict.
 *
 * Two constraints shape the file:
 *   - READ-ONLY. It measures; it never repairs, never re-runs a producer,
 *     never writes. (`verifyMirror()` compares live settings with the
 *     mirrored copy and logs a warning on divergence — that is the mirror's
 *     own tripwire, not a write.)
 *   - IT CANNOT CRASH WHAT IT CHECKS. A health check that takes down the
 *     thing it monitors is the one unforgivable irony, so the whole execute
 *     body is guarded and a failure inside it still returns a readable
 *     answer. That claim is pinned, not just asserted here.
 *
 * Verdict words are the Controlled Vocabulary v1 translation — OK / needs a
 * check / not reporting. The internal OK/STALE/DARK never leaves the host
 * module, and producer system ids ('wp-webhook') are rendered as their user
 * names ('In-site events').
 *
 * ONE DELIBERATE EXCEPTION to that translation, disclosed rather than
 * hidden: the "Other sources" line names sources that have no liveness
 * expectation yet, and therefore no user name to render — 'graph-backfill'
 * appears as itself. A diagnostic surface that cannot name an unknown source
 * cannot diagnose it, and inventing a friendly label for something the
 * vocabulary does not cover would be worse than the raw id. Pinned below, so
 * it stays a choice rather than drifting into a leak.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import {
  collectIntelligenceHealth,
  HealthVerdict,
  IntelligenceHealthReport,
} from '../../../intelligence-host/health';

/** Controlled Vocabulary v1 — the ONLY verdict words a user ever sees. */
const VERDICT_WORDS: Record<HealthVerdict, string> = {
  OK: 'OK',
  STALE: 'needs a check',
  DARK: 'not reporting',
};

/**
 * The non-fatality promise, stated as the user benefit it actually is rather
 * than as an architecture note. It closes every rendering, including the
 * degraded ones — the moment it matters most is the moment something above it
 * says "not reporting".
 */
const NON_FATALITY_PROMISE =
  '_Whatever this says, Nexus AI keeps working. Everything here is extra: when a line reads ' +
  '**not reporting**, you lose the added history and freshness notes until it recovers — never an ' +
  'answer, never a command, never your data._';

export const intelligenceHealthHandler: McpToolHandler = {
  definition: {
    name: 'nexus_intelligence_health',
    description:
      "Report whether Nexus AI's background record-keeping is working: whether it started, what " +
      'each source has recorded and how recently, whether anything is waiting to be processed, and ' +
      'whether the copy of your Access & Permissions settings still matches. Read-only — it ' +
      'measures and changes nothing. Use it when answers seem to be missing history or freshness ' +
      'notes, or when asked whether Nexus AI is recording.',
    inputSchema: { type: 'object', properties: {} },
    // No isAvailable gate, deliberately: a health tool that disappears when
    // the thing it reports on is down reports nothing at the one moment it
    // is needed.
    annotations: { readOnlyHint: true },
  },

  async execute(): Promise<McpToolResult> {
    try {
      const report = collectIntelligenceHealth({ core: getIntelligenceCore() });
      return ok(renderHealthReport(report));
    } catch (err) {
      // Rule 2, at the outermost boundary: still an answer, never a crash.
      return ok(
        [
          '## Nexus AI background record-keeping — not reporting',
          '',
          `The check itself could not complete: ${(err as Error)?.message ?? String(err)}`,
          '',
          NON_FATALITY_PROMISE,
        ].join('\n')
      );
    }
  },
};

export function renderHealthReport(report: IntelligenceHealthReport): string {
  const lines: string[] = [
    `## Nexus AI background record-keeping — ${VERDICT_WORDS[report.worst]}`,
    '',
    '| Check | Now | Expected | Verdict |',
    '|---|---|---|---|',
  ];

  for (const line of report.lines) {
    lines.push(
      `| ${line.label} | ${line.value} | ${line.threshold} | ${VERDICT_WORDS[line.verdict]} |`
    );
  }

  if (!report.coreUp) {
    lines.push(
      '',
      'Nothing else can be measured while record-keeping is not running — the rest of this ' +
        'report comes from what it recorded.'
    );
  }

  const notes = report.lines.filter((l) => l.detail);
  if (notes.length > 0) {
    lines.push('', '**Notes**');
    for (const n of notes) lines.push(`- **${n.label}** — ${n.detail}`);
  }

  if (report.errors.length > 0) {
    lines.push('', '**Could not be measured**');
    // Named, never swallowed: an unmeasured check silently dropped from the
    // table would read as a check that passed.
    for (const e of report.errors) lines.push(`- ${e}`);
  }

  lines.push('', `_Checked ${report.checkedAt}._`, '', NON_FATALITY_PROMISE);
  return lines.join('\n');
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
