/**
 * The remote health-factor gate — ONE copy (fixes-082526 item 4).
 *
 * Previously duplicated between `resolvers.ts:3003` (GraphQL/CLI) and
 * `get-site-health.ts:91` (MCP), with CLAUDE.md carrying the standing order
 * to hand-mirror changes. Both callers live in the main bundle, so unlike
 * the resolveAgentCron/effectiveCadence pair there is no bundle boundary
 * forcing a duplicate — extraction retires the order.
 *
 * The rule (the fleet-counts doctrine, unchanged):
 *  - a WPE install is scored on `security` + `performance` — plugin rows
 *    exist via the sync/deep-refresh path. `stability`, `maintenance` and
 *    `activity` read local-only tables and would score a constant for any
 *    remote target.
 *  - an external host is gated on DATA PRESENCE, not host class: plugin rows
 *    AND a real php_version (a refresh populates both; a host whose PHP
 *    disables proc_open never gets a version and stays unscored). Scoring
 *    security off zero plugin rows once produced "no security plugin
 *    detected" and full plugin-hygiene credit from the same absence.
 */
import type { FactorName } from './HealthScoreCalculator';

interface DbLike {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

export interface RemoteSiteRow {
  id: string;
  source: 'wpe' | 'external';
  php_version?: string | null;
}

export function remoteHealthFactors(db: DbLike, row: RemoteSiteRow): FactorName[] {
  if (row.source === 'wpe') return ['security', 'performance'];
  const hasPlugins =
    ((db.prepare('SELECT COUNT(*) as c FROM plugins WHERE site_id = ?').get(row.id) as { c: number })
      ?.c ?? 0) > 0;
  return hasPlugins && !!row.php_version ? ['security', 'performance'] : [];
}
