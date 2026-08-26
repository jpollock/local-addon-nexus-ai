/**
 * Board D (new-chat sheet) — a session's title derived from what it DID.
 *
 * "The runbook it armed, what it verified, whether it was refused. The first
 * message is what a person meant to do, and nine sessions that meant the same
 * thing are indistinguishable by it."
 *
 * Every word traces to a recorded fact the panel already holds
 * (ProcedureStreamState — the armed declaration, checkpoint `verified` flags,
 * the abort's own groups, the refusal's own code). Nothing here invents an
 * outcome: a session that armed nothing keeps its typed title — what a person
 * MEANT is the honest name for a session that only asked — and its meta says
 * 'no run armed' so the list still tells the categories apart.
 */
import type { ProcedureStreamState } from './procedureModel';

export interface SessionOutcome {
  /** The derived title, or null: the typed first message stands. */
  title: string | null;
  /** The mono line under it — the outcome at a glance, board D's second row. */
  meta: string;
}

/** 'rb.bulk-plugin-update' → 'bulk plugin update' — mechanical, never semantic. */
export function humanizeDocId(id: string): string {
  return id.replace(/^(rb|cap)\./, '').replace(/[-_]+/g, ' ');
}

/**
 * The refusal codes' user-facing phrases. Three refusals are three different
 * facts (assemble/types.ts) — one word for all of them would collapse exactly
 * the distinction the codes exist to carry.
 */
const REFUSAL_META: Record<string, string> = {
  'hash-mismatch': 'document changed since review',
  'not-loaded': 'document unavailable',
  'over-ceiling': 'document too large to deliver whole',
};

export function deriveSessionOutcome(state: ProcedureStreamState): SessionOutcome {
  const proc = state.procedure;

  if (state.abort && proc) {
    const docId = proc.runbookId ?? proc.capability;
    const g = state.abort.groups;
    return {
      title: `Halted ${humanizeDocId(docId)} — ${state.abort.reason}`,
      meta: `${docId} · ${g.done.length} done, ${g.untouched.length} untouched`,
    };
  }

  if (proc?.unavailable) {
    return {
      title: `Refused: ${humanizeDocId(proc.capability)}`,
      meta: REFUSAL_META[proc.unavailable.code] ?? proc.unavailable.code,
    };
  }

  if (proc) {
    const docId = proc.runbookId ?? proc.capability;
    const verified = proc.checkpoints.filter((c) => c.verified).length;
    return {
      title: `Ran ${humanizeDocId(docId)}`,
      // The honest denominator: how many the platform can prove AT ALL, not
      // the checkpoint count — "3 of 8" over a rail where four can never be
      // proved is the half-adherence lie wearing a progress bar.
      meta: `${docId} · ${verified} of ${proc.verifiableCount} verified`,
    };
  }

  return { title: null, meta: 'no run armed' };
}
