import { toKnowledgeRung, KnowledgeRung } from './knowledgeLadder';
import type { PopulationCount } from './FleetCounts';

export interface SiteRow {
  id: string;
  name: string;
  source: 'local' | 'wpe' | 'external';
  /** For external rows, the ssh alias the site lives under. Null otherwise. */
  host: string | null;
  domain: string | null;
  status: string | null;
  wpVersion: string | null;
  phpVersion: string | null;
  knowledge: KnowledgeRung;
  lastSyncAt: number | null;
}

export interface SiteRowsInput {
  localSites: Array<{ id: string; name: string; status?: string }>;
  graphRows: Array<{
    id: string; source: string; name: string | null; domain: string | null;
    wp_version: string | null; php_version: string | null;
    host: string | null; content_indexed_at: number | null; last_sync_at: number | null;
  }>;
  /** Site ids with an IndexRegistry entry in `indexed` or `stale`. */
  indexedSiteIds: Set<string>;
}

export interface SiteRowsResult {
  rows: SiteRow[];
  total: PopulationCount;
}

/**
 * `ssh:<alias>/<site>` → `<alias>`. Returns null for anything else.
 * The alias is a connection, not a site — one alias can host several.
 */
function hostFromExternalId(id: string): string | null {
  const m = /^ssh:([^/]+)/.exec(id);
  return m ? m[1] : null;
}

/**
 * Derive the ladder's `completeness` value from the columns that actually
 * exist. There is no `completeness` column on `sites` — selecting one throws.
 *
 * Two independent records of indexing, and either is sufficient: an
 * `IndexRegistry` entry in `indexed`/`stale`, or a `content_indexed_at`
 * timestamp on the row. They can disagree — the registry is the live view and
 * the column is what the last sync wrote — so trusting only one would
 * under-report a genuinely indexed site.
 */
function completenessOf(
  g: { wp_version: string | null; content_indexed_at: number | null; id: string },
  indexedSiteIds: Set<string>,
): string {
  if (indexedSiteIds.has(g.id) || g.content_indexed_at) return 'indexed';
  if (g.wp_version) return 'metadata';
  return 'none';
}

export function buildSiteRows(input: SiteRowsInput): SiteRowsResult {
  const rows: SiteRow[] = [];

  // Local sites come from Local's own store, never the graph. The graph keeps
  // rows for sites that have since been deleted, so a graph-derived local list
  // resurrects them. Same reasoning as collectFleetCounts.
  for (const s of input.localSites) {
    rows.push({
      id: s.id,
      name: s.name,
      source: 'local',
      host: null,
      domain: null,
      status: s.status ?? null,
      wpVersion: null,
      phpVersion: null,
      knowledge: input.indexedSiteIds.has(s.id)
        ? toKnowledgeRung('indexed', 'local')
        : toKnowledgeRung(null, 'local'),
      lastSyncAt: null,
    });
  }

  for (const g of input.graphRows) {
    // Only the two remote sources. Never `!== 'local'` — that silently absorbs
    // any future source (see source-semantics.test.ts).
    if (g.source !== 'wpe' && g.source !== 'external') continue;
    const source = g.source as 'wpe' | 'external';

    rows.push({
      id: g.id,
      name: g.name ?? g.id,
      source,
      // `host` is a real column; only fall back to parsing the id when it is null.
      host: source === 'external' ? (g.host ?? hostFromExternalId(g.id)) : null,
      domain: g.domain,
      status: null,
      wpVersion: g.wp_version,
      phpVersion: g.php_version,
      knowledge: toKnowledgeRung(completenessOf(g, input.indexedSiteIds), source),
      lastSyncAt: g.last_sync_at,
    });
  }

  return {
    rows,
    total: {
      count: rows.length,
      scope: 'installs on this Mac, WP Engine and other hosts',
    },
  };
}
