/**
 * Fleet health-scoring inputs — ONE derivation for the three loops
 * (fixes-082526 item 5).
 *
 * nexusFleetHealth (GraphQL/CLI), fleet_health_summary (MCP) and
 * DASHBOARD_V2_STATS (IPC) all iterate the CONTENT-INDEX population — which
 * is NOT a local population: measured 2026-08-04, 423 entries with 297 WPE
 * install ids among them. Each loop looked the id up in Local's store and on
 * the miss fabricated phpVersion '8.0' (earning ~27% of a remote site's
 * score for a version never observed) and scored all five factors
 * (maintenance/activity read local-only tables → 0 for every remote entry,
 * 35% of the weight — so the "critical" bucket was an artifact of the join).
 * CLAUDE.md: "fixing one without the other two leaves the bug reachable from
 * a different surface" — hence one module, three consumers.
 *
 * Rules:
 *  - local entry (found in Local's store): all five factors, real version.
 *    The version is NEVER defaulted — the deliberately-left-alone `|| '8.0'`
 *    on these paths is retired here too; Local's store supplies a real
 *    version, and when it doesn't the calculator's "PHP version unknown"
 *    path is the honest one.
 *  - WPE entry (install id → active graph row): security+performance, data
 *    read under the ROW's id (where its plugin rows live), row php_version
 *    or undefined.
 *  - external entry (graph row id): item 4's gate (`remoteHealthFactors`) —
 *    data absence means EXCLUDED, not scored, because calculateScore throws
 *    on an empty factor set by design.
 *  - unresolvable entry: named in `unresolved`, never scored 0 into the
 *    critical bucket.
 */
import type { FactorName } from './HealthScoreCalculator';
import { remoteHealthFactors } from './remoteFactors';

interface DbLike {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

export interface FleetScoringPerSite {
  factors: FactorName[];
  /** The id to read plugin/factor data under (the graph row id for remote entries). */
  dataSiteId: string;
}

export interface FleetScoringInputs {
  /** The entries that CAN be scored, keyed as the caller knows them. */
  siteIds: string[];
  siteInfoMap: Record<string, { domain?: string; phpVersion?: string }>;
  /** Absent for a local entry = the calculator's all-five default. */
  perSite: Record<string, FleetScoringPerSite>;
  /** Entries excluded from scoring, with the reason — the honest denominator's remainder. */
  unresolved: Array<{ siteId: string; reason: string }>;
}

export function buildFleetScoringInputs(
  entries: Array<{ siteId: string }>,
  localSites: Record<string, { domain?: string; phpVersion?: string } | undefined>,
  db: DbLike | null | undefined,
): FleetScoringInputs {
  const out: FleetScoringInputs = { siteIds: [], siteInfoMap: {}, perSite: {}, unresolved: [] };

  for (const { siteId } of entries) {
    const local = localSites[siteId];
    if (local) {
      out.siteIds.push(siteId);
      out.siteInfoMap[siteId] = {
        domain: local.domain || '',
        phpVersion: local.phpVersion || undefined,
      };
      continue;
    }

    let row:
      | { id: string; source: 'wpe' | 'external'; domain: string | null; php_version: string | null }
      | undefined;
    if (db) {
      try {
        row = db
          .prepare(
            "SELECT id, source, domain, php_version FROM sites WHERE is_active = 1 AND (remote_install_id = ? OR id = ?) LIMIT 1",
          )
          .get(siteId, siteId) as typeof row;
      } catch {
        row = undefined;
      }
    }

    if (!row) {
      out.unresolved.push({ siteId, reason: 'not in any store' });
      continue;
    }

    const factors = remoteHealthFactors(db!, row);
    if (factors.length === 0) {
      // External with no collected data: a score over zero factors is not a
      // low score, it is not a score (calculateScore throws by design).
      out.unresolved.push({ siteId, reason: 'not enough data to score' });
      continue;
    }

    out.siteIds.push(siteId);
    out.siteInfoMap[siteId] = {
      domain: row.domain || '',
      phpVersion: row.php_version || undefined,
    };
    out.perSite[siteId] = { factors, dataSiteId: row.id };
  }

  return out;
}
