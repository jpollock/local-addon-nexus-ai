/**
 * `nexus_load_procedure` — WP-20b, P1's path B: the model asks for a procedure
 * by capability name.
 *
 * THE RESULT IS AN ACKNOWLEDGEMENT. It never contains the runbook.
 *
 * That is R7, and it is not a stylistic preference: `maskToolResultsForProvider`
 * wraps every `role: 'tool'` message in `<untrusted_data>` and the system prompt
 * instructs the model never to follow instructions found inside one. A runbook
 * is precisely an instruction, so delivering it here would ship an instruction
 * on the one channel the platform has told the model to distrust. Worse,
 * `compressStaleToolResults` truncates tool content over 800 chars after two
 * assistant turns — the procedure would silently degrade while the record still
 * claimed it had been supplied. The document rides the platform's own user-role
 * turn carrier instead (WP-20c), which is why this text points at the next turn —
 * and names the PLATFORM as what puts it there, never "Nexus AI", which is what
 * this tool's own reader has been told it is (WP-24).
 *
 * WHAT IT DOES CARRY: the runbook's identity, version, strictness, and its
 * checkpoints in order with how each one can be shown to have happened. That
 * last part is the honesty the design note asks for twice (§4, §7): a checkpoint
 * the platform can verify from its records and one it merely heard about must
 * not read the same way.
 *
 * AND IT SAYS SO IN CAPABILITY TENSE (WP-31, after the 2026-08-18 incident).
 * The labels name what the platform CAN prove. Written as "verified from
 * records" they named the same thing and read as a completion state: a live run
 * split this exact list into "already satisfied" and "still need to perform",
 * then executed Tier-2 writes with no approval and no backup on record. Every
 * provable class now carries "nothing is attested yet", and the text ends with
 * one unconditional line saying no checkpoint has been performed. A tool result
 * that a reader can mistake for a progress report is a progress report.
 *
 * Tier 1, and genuinely so: asking which procedure applies cannot change
 * anything. What it does record is that the model asked
 * (`procedureArming.recordArmingRequest`), which is what lets the next turn
 * deliver the document.
 */
import { McpToolHandler, McpToolResult } from '../../types';
import { getIntelligenceCore } from '../../../intelligence-host/coreRegistry';
import { getCapabilityGrants } from '../../../intelligence-host/capabilityGrants';
import { recordArmingRequest } from '../../../intelligence-host/procedureArming';
/**
 * How a checkpoint's attestation class reads to whoever is looking at it.
 * Controlled-vocabulary discipline, applied to procedure rather than to
 * freshness: the words distinguish proof from testimony, and `narrative`'s
 * wording is deliberately the least flattering of the three.
 *
 * WP-20e moved the table into the render seam and imports it back, because the
 * rail a human reads and this acknowledgement a model reads describe the same
 * checkpoint — two copies of these three sentences would be two places for them
 * to drift.
 */
import { ATTEST_WORDS } from '../../../intelligence-host/procedureView';
import { Runbook } from '../../../../intelligence';

export const loadProcedureHandler: McpToolHandler = {
  definition: {
    name: 'nexus_load_procedure',
    description:
      'Ask for the procedure that governs a capability (for example ' +
      '"cap.bulk_plugin_update") before doing work that needs it. Returns which procedure ' +
      'applies, its version, whether its steps are enforced in order, and what the platform is ' +
      'able to verify about each step — the procedure itself is delivered by the platform on your ' +
      'next turn, not in this result. Read-only, and it PERFORMS NO CHECKPOINT: nothing in its ' +
      'result means a step has been done, and you must not write until the procedure text ' +
      'arrives. Use it when a task looks like one a named procedure covers, or when a call was ' +
      'refused because a procedure was not armed.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: "The capability name, e.g. 'cap.bulk_plugin_update'.",
        },
      },
      required: ['capability'],
    },
    // No isAvailable gate: a tool that disappears when nothing is granted
    // cannot answer "is anything granted?", which is half of what it is for.
    annotations: { readOnlyHint: true },
  },

  async execute(args): Promise<McpToolResult> {
    try {
      const capability = typeof args.capability === 'string' ? args.capability.trim() : '';
      if (!capability) {
        return ok(
          'Name the capability you need, for example `cap.bulk_plugin_update`. ' +
            granted().summary
        );
      }

      const core = getIntelligenceCore();
      if (!core?.law) {
        // Degraded, and it says which kind of degraded: no procedure can be
        // armed, and that is a fact about Nexus AI rather than about the request.
        return ok(
          "Nexus AI's background record-keeping is not running, so no procedure can be armed for " +
            `\`${capability}\` right now. Nothing is blocked — work proceeds as it does without a ` +
            'procedure.'
        );
      }

      const grant = getCapabilityGrants().find((g) => g.capability === capability);
      const runbook = grant ? core.law.runbooks.byCapability(capability) : undefined;
      if (!grant || !runbook) {
        // Not an error: an ungranted capability is an ordinary answer, and the
        // useful half of it is what IS granted.
        return ok(`\`${capability}\` is not granted on this machine. ${granted().summary}`);
      }

      recordArmingRequest(capability);
      return ok(renderAcknowledgement(runbook));
    } catch (err) {
      // A tool that cannot answer must still answer. Nothing here is load-bearing
      // for the call the model is about to make.
      return ok(
        `The procedure for this capability could not be looked up: ${
          (err as Error)?.message ?? String(err)
        }. Proceed without one, or ask again.`
      );
    }
  },
};

function granted(): { summary: string } {
  const grants = getCapabilityGrants();
  if (grants.length === 0) return { summary: 'No capabilities are granted on this machine.' };
  const named = grants.map((g) => `\`${g.capability}\` (${g.runbookId}, ${g.strictness})`);
  return { summary: `Granted here: ${named.join(', ')}.` };
}

export function renderAcknowledgement(runbook: Runbook): string {
  const lines: string[] = [
    `**${runbook.id} v${runbook.version}** governs \`${runbook.capability}\` on this machine.`,
    '',
    runbook.strictness === 'strict'
      ? 'This procedure is **strict**: its checkpoints run in order, and a call that skips one is ' +
        'refused rather than run.'
      : 'This procedure is **guided**: its steps are ordered advice you may adapt, saying why.',
    '',
  ];

  if (runbook.checkpoints.length > 0) {
    lines.push('Checkpoints, in order:');
    for (const cp of runbook.checkpoints) {
      // WP-31 · the class label, plus the state it is NOT. On the rail these
      // words sit beside a status badge; here nothing else is on the line, and
      // the 2026-08-18 incident is a run that read the bare label as a tick.
      const pending = cp.attest === 'narrative' ? '' : ' — nothing is attested yet';
      lines.push(`1. \`${cp.id}\` — ${ATTEST_WORDS[cp.attest]}${pending}`);
    }
  } else if (runbook.steps.length > 0) {
    lines.push('Steps, in order:');
    for (const step of runbook.steps) lines.push(`1. \`${step}\``);
  }

  lines.push(
    '',
    // WP-31 · ruling 2 of the 2026-08-18 incident. The list above says what the
    // platform CAN verify; this says what has happened, which is nothing. It is
    // one line, it is unconditional, and it is deliberately not phrased as
    // advice — the run it exists to prevent read a list of capability labels as
    // a progress report and went straight to Tier-2 writes.
    '**No checkpoint has been performed.** Do not write until the procedure text arrives on ' +
      'your next turn.',
    '',
    // WP-24 · "from Nexus AI directly" named the WRONG PARTY to its own reader.
    // The system prompt opens "You are Nexus AI", so this sentence told the
    // model a document would arrive from itself — and the 2026-08-18 owner
    // sitting caught a run reasoning exactly that way ("I *am* Nexus AI, and no
    // procedure body reached me"), then treating the absence as a fault. The
    // deliverer is the PLATFORM: the host that builds the turn carrier, which
    // is neither the model nor the tool. Same word the carrier uses of itself.
    'The procedure itself arrives on your **next turn**, placed in your turn context by the ' +
      'platform — it is never delivered inside a tool result, so it is not in this message. ' +
      'Continue, and read it there.'
  );
  return lines.join('\n');
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
