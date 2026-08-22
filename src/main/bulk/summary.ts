/**
 * The one derivation of a bulk operation's totals.
 *
 * WP-67: the Operations tab reported "413 sites · 413 succeeded, 0 failed,
 * 0 pending" for a run in which three sites did the work. The count was taken
 * from a completion counter — `progress.completed` was incremented once per
 * site that finished the loop, whether or not anything happened — so it was
 * true of the counter and false of the world.
 *
 * Totals are derived from the recorded per-site states and from nowhere else.
 * Pure and dependency-free so main and renderer can share it rather than
 * keeping two copies that drift; every consumer that kept its own count is how
 * this stayed wrong.
 */
import type { SiteOpResult } from './types';

export interface BulkOperationSummary {
  /** Work ran and completed. */
  succeeded: number;
  /** Work ran and failed, with a reason. */
  failed: number;
  /** Work did not run, with a reason. Never folded into either of the above. */
  skipped: number;
  /**
   * Being worked on right now. Counted separately because folding it into
   * `pending` describes a site under active work as "not yet reached" — and
   * during a fleet run this number is the live concurrency, which is the one
   * thing a watching user actually wants.
   */
  running: number;
  /** Not yet reached — includes sites with no result recorded at all. */
  pending: number;
  total: number;
}

/** The shape both `BulkOperationStatus` declarations satisfy. */
interface SummarizableOperation {
  siteIds: string[];
  siteResults: Record<string, Pick<SiteOpResult, 'status'>>;
}

export function summarizeBulkOperation(op: SummarizableOperation): BulkOperationSummary {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let running = 0;

  // Iterate the selection, not the results map: a site with no entry has not
  // been reached, and counting only what the map happens to hold would let a
  // dropped site vanish from the total rather than show as pending.
  for (const siteId of op.siteIds) {
    switch (op.siteResults[siteId]?.status) {
      case 'completed': succeeded++; break;
      case 'failed': failed++; break;
      case 'skipped': skipped++; break;
      case 'running': running++; break;
      default: break; // pending | absent
    }
  }

  return {
    succeeded,
    failed,
    skipped,
    running,
    pending: op.siteIds.length - succeeded - failed - skipped - running,
    total: op.siteIds.length,
  };
}
