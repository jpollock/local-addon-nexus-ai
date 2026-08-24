/**
 * Host-side assembly for the fleet-collapse read model — Phase 1.4 of the
 * plan. Gathers every committed source (graph rows, D21 names, accounts,
 * site_links pairing, D15 gateway verdicts, pipeline twins) into the pure
 * `buildFleetCollapse` input.
 *
 * Non-fatal by construction: any absent source degrades to its honest empty
 * value (no rows, no names, `never` checked) — the collapse must render on a
 * machine where the intelligence core failed to start or the graph is empty.
 */
import { buildFleetCollapse, FleetCollapse, FleetCollapseInput, CheckedView } from './fleetCollapse';
import { sshGatewayUnavailableReason } from '../transport/wpeGatewayStatus';
import { pipelineEntityId } from '../intelligence-host/pipelineRunProducer';

interface DbLike {
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
}

interface CoreLike {
  twins: { get(entityId: string, fact: string): { value: unknown } | undefined };
}

export interface CollectFleetCollapseDeps {
  /** Values of Local's own store — the authority on which local sites exist. */
  localSites: Array<Record<string, any>>;
  /** localSiteId → run status, when the caller has them. */
  statuses?: Record<string, string>;
  db: DbLike | null;
  indexEntries: Array<{ siteId: string; state: string }>;
  wpeSites: Array<{ id: string; name: string | null; account_id: string | null }>;
  wpeAccounts: Array<{ id: string; name: string; nickname: string | null }>;
  siteLinks: Array<{ localSiteId: string; wpeInstallId: string }>;
  /** The intelligence core, for pipeline twins. Null → every place reads `never`. */
  core: CoreLike | null;
}

const NEVER: CheckedView = { state: 'never', finishedAt: null, reason: null };

function twinChecked(core: CoreLike, envId: string): CheckedView {
  let best: CheckedView = NEVER;
  for (const layer of ['pipeline:l2', 'pipeline:l3']) {
    const fact = core.twins.get(envId, layer);
    const v = fact?.value as
      | { outcome?: string; finished_at?: string; reason?: string }
      | undefined;
    if (!v?.outcome || !v.finished_at) continue;
    if (best.finishedAt === null || v.finished_at > best.finishedAt) {
      best = {
        state: v.outcome === 'ok' ? 'ok' : v.outcome === 'skip' ? 'skip' : 'fail',
        finishedAt: v.finished_at,
        reason: v.reason ?? null,
      };
    }
  }
  return best;
}

export function collectFleetCollapse(deps: CollectFleetCollapseDeps): FleetCollapse {
  const { db } = deps;

  // content_indexed_at is written by an optional path and may be absent on a
  // machine that never opted in — same degrade as the DASHBOARD handler: no
  // column means no writer ever stamped it, so NULL is the true value.
  let hasIndexedAt = false;
  try {
    hasIndexedAt = db
      ? !!(db.prepare(
          "SELECT COUNT(*) AS c FROM pragma_table_info('sites') WHERE name = 'content_indexed_at'",
        ).get() as { c: number }).c
      : false;
  } catch {
    hasIndexedAt = false;
  }

  let graphRows: FleetCollapseInput['graphRows'] = [];
  try {
    graphRows = db
      ? (db.prepare(`
          SELECT id, source, name, domain, wp_version, php_version, host,
                 ${hasIndexedAt ? 'content_indexed_at' : 'NULL AS content_indexed_at'},
                 last_sync_at, remote_install_id, wpe_site_id, environment, account_id
          FROM sites WHERE source IN ('wpe','external') AND is_active = 1
        `).all() as FleetCollapseInput['graphRows'])
      : [];
  } catch {
    graphRows = [];
  }

  // Local graph rows enrich (wp_version) but never decide which local sites exist.
  const localGraph = new Map<string, { wp_version: string | null }>();
  try {
    if (db) {
      for (const r of db
        .prepare("SELECT id, wp_version FROM sites WHERE source = 'local' AND is_active = 1")
        .all() as Array<{ id: string; wp_version: string | null }>) {
        localGraph.set(r.id, r);
      }
    }
  } catch {
    /* enrich only */
  }

  // D15: one stated reason per gatewayless account. Absent verdicts read null.
  const gatewaylessAccounts = new Map<string, string>();
  try {
    if (db) {
      for (const a of deps.wpeAccounts) {
        const reason = sshGatewayUnavailableReason(db as never, a.id);
        if (reason) gatewaylessAccounts.set(a.id, reason);
      }
    }
  } catch {
    /* no verdicts → no ceilings, honestly */
  }

  // Pipeline twins: latest of l2/l3 per place. Core down → everything `never`.
  const checked = new Map<string, CheckedView>();
  if (deps.core) {
    try {
      for (const g of graphRows) {
        const kind = g.source === 'external' ? ('external' as const) : ('wpe' as const);
        const envId = pipelineEntityId(deps.core as never, { kind, graphRowId: g.id });
        checked.set(g.id, twinChecked(deps.core, envId));
      }
      for (const s of deps.localSites) {
        if (!s?.id) continue;
        const envId = pipelineEntityId(deps.core as never, { kind: 'local', localSiteId: s.id });
        checked.set(s.id, twinChecked(deps.core, envId));
      }
    } catch {
      /* a twin-read fault must not blank the fleet */
    }
  }

  return buildFleetCollapse({
    localSites: deps.localSites
      .filter((s) => s?.id)
      .map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        status: deps.statuses?.[s.id],
        domain: s.domain ?? null,
        // Real shapes only: PHP lives at services.php.version in sites.json;
        // WP version comes from the graph. Never invent either (the '8.0' rule).
        phpVersion: s.services?.php?.version ?? null,
        wpVersion: localGraph.get(s.id)?.wp_version ?? null,
      })),
    graphRows,
    indexedSiteIds: new Set(
      deps.indexEntries
        .filter((e) => e.state === 'indexed' || e.state === 'stale')
        .map((e) => e.siteId),
    ),
    wpeSites: deps.wpeSites,
    wpeAccounts: deps.wpeAccounts,
    siteLinks: deps.siteLinks,
    gatewaylessAccounts,
    checked,
  });
}
