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
  nothing: 'Nothing yet',
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

/** A generic SSH connection cannot yield indexed content, so external caps here. */
const SOURCE_CEILING: Record<string, KnowledgeRung> = {
  local: 'searchable',
  wpe: 'searchable',
  external: 'detailed',
};

export function toKnowledgeRung(
  completeness: string | null | undefined,
  source: 'local' | 'wpe' | 'external',
): KnowledgeRung {
  const rung = (completeness && FROM_COMPLETENESS[completeness]) || 'nothing';
  const ceiling = SOURCE_CEILING[source] ?? 'searchable';
  return RUNG_ORDER.indexOf(rung) > RUNG_ORDER.indexOf(ceiling) ? ceiling : rung;
}
