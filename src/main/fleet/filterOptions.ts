/**
 * The Site Finder / Properties filter axes, read from the graph.
 *
 * ── fixes-082526 · issue 5 ────────────────────────────────────────────────
 * The Themes axis was offered in the UI and never populated. Plugins and WP
 * versions were read from `graph.db` — fast, and covering local, WP Engine
 * and external rows alike — while themes were collected by running WP-CLI
 * against **local sites that happened to be running**. With no running local
 * site the list was empty, which is every WPE-only or laptop-just-opened
 * case; and the axis was still offered, so the menu answered "no themes"
 * when the truth was "not asked".
 *
 * Themes now come from the same place plugins do. Two consequences beyond
 * the bug: the axis covers the whole fleet rather than the running local
 * subset, and an options call stops blocking on N WP-CLI round trips.
 */

/** Minimal shape of the better-sqlite3 handle these reads need. */
export interface GraphDbLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

export interface FacetRows {
  values: string[];
  counts: Record<string, number>;
}

const EMPTY: FacetRows = { values: [], counts: {} };

/**
 * Distinct theme names across every ACTIVE site, with the number of sites
 * carrying each.
 *
 * Counts are `COUNT(DISTINCT site_id)`, matching the plugin axis: the figure
 * a reader wants is "how many of my sites have this", not how many rows the
 * table holds. Sites are constrained to `is_active = 1` because
 * `nexus host remove` soft-deletes — a removed host must not keep voting on
 * what the fleet runs (CLAUDE.md, "every external lookup needs is_active = 1").
 *
 * Grouped by `name`, not `slug`: the menu is read by a person, and
 * "Twenty Twenty-Five" is the label the product shows everywhere else.
 */
export function collectThemeFacet(db: GraphDbLike | null | undefined): FacetRows {
  if (!db) return EMPTY;
  try {
    const rows = db
      .prepare(
        `SELECT t.name AS name, COUNT(DISTINCT t.site_id) AS c
           FROM themes t
           JOIN sites s ON s.id = t.site_id
          WHERE s.is_active = 1 AND t.name IS NOT NULL AND t.name != ''
          GROUP BY t.name
          ORDER BY t.name`,
      )
      .all() as Array<{ name: string; c: number }>;
    return {
      values: rows.map((r) => r.name),
      counts: Object.fromEntries(rows.map((r) => [r.name, r.c])),
    };
  } catch {
    // An older graph.db may predate the themes table. An empty axis is the
    // honest answer there; throwing would take the whole options call down
    // and cost the reader the plugin and version axes too.
    return EMPTY;
  }
}
