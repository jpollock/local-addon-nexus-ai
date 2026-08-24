/**
 * The one vocabulary for "how much does Nexus know about this site?".
 *
 * Replaces six overlapping vocabularies: Scanned/Configured/Searchable,
 * none/filesystem/metadata/indexed, fresh/stale, synced/needs-SSH-sync, a
 * three-dot meter and a percentage bar.
 *
 * Four rungs, not three. `nothing` is a real and separately tracked state
 * (`neverScannedCount`) and is the most actionable one — it is what lets the UI
 * say "77 sites we haven't looked inside yet — Sync now". Freshness is NOT a
 * rung; it is a separate `last_sync_at` timestamp.
 */

export type KnowledgeRung = 'nothing' | 'basic' | 'detailed' | 'searchable';

export const KNOWLEDGE_LABELS: Record<KnowledgeRung, string> = {
  nothing: 'Never looked inside',  // one sentence for the fourth rung, everywhere (round-3 finding 2)
  basic: 'Basic',
  detailed: 'Detailed',
  searchable: 'Searchable',
};

const RUNG_ORDER: KnowledgeRung[] = ['nothing', 'basic', 'detailed', 'searchable'];

const FROM_COMPLETENESS: Record<string, KnowledgeRung> = {
  none: 'nothing',
  filesystem: 'basic',
  metadata: 'detailed',
  indexed: 'searchable',
};

/**
 * Per-source ceiling on what Nexus can claim to know.
 *
 * External used to cap at `detailed`, on the reasoning that "a generic SSH
 * connection cannot yield indexed content". That stopped being true when
 * external content indexing shipped — `ExternalContentIndexScheduler` runs on
 * an opt-in timer and `nexus host index <alias>` runs one host on demand, and
 * `ipc-handlers` already counts those hosts as searchable. An indexed external
 * host is searchable, and saying otherwise on the Sites table would be a
 * statement we know to be false.
 *
 * The map itself stays — even though all three known sources now map to the
 * same rung, so it caps nothing today — because it is where the next source
 * declares its ceiling, and because of the `?? 'nothing'` fallback below: an
 * unrecognised source must still fail closed rather than inherit the most
 * permissive rung.
 */
const SOURCE_CEILING: Record<string, KnowledgeRung> = {
  local: 'searchable',
  wpe: 'searchable',
  external: 'searchable',
};

export function toKnowledgeRung(
  completeness: string | null | undefined,
  source: 'local' | 'wpe' | 'external',
): KnowledgeRung {
  const rung = (completeness && FROM_COMPLETENESS[completeness]) || 'nothing';
  // Fail closed. An unrecognised source must never receive the most permissive
  // ceiling — that silently overstates what Nexus knows about a site type the
  // ladder was never designed to score. Matches the module's own treatment of
  // an unrecognised `completeness`, and the project's rule against queries that
  // silently absorb a future source.
  const ceiling = SOURCE_CEILING[source] ?? 'nothing';
  return RUNG_ORDER.indexOf(rung) > RUNG_ORDER.indexOf(ceiling) ? ceiling : rung;
}
