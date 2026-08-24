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
import * as os from 'os';

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
  indexEntries: Array<{ siteId: string; state: string; documentCount?: number }>;
  wpeSites: Array<{ id: string; name: string | null; account_id: string | null }>;
  wpeAccounts: Array<{ id: string; name: string; nickname: string | null }>;
  siteLinks: Array<{ localSiteId: string; wpeInstallId: string; wpeInstallName?: string }>;
  /** localSiteId → the copy's content-lineage record (host reads readSiteContentStatus). */
  contentStatus?: Map<string, { state: string; sourceName?: string; behindSeconds?: number }>;
  /** The intelligence core, for pipeline twins. Null → every place reads `never`. */
  core: CoreLike | null;
  /** Phase 3: the registry's per-site needs-you reading (entity-id keyed). */
  needsYouPerSite?: { byEntity: Array<{ entityId: string; count: number; tier: number }>; unattributed: number; situations: number };
}

const NEVER: CheckedView = { state: 'never', finishedAt: null, reason: null };

/**
 * The one assembly both surfaces share (GraphQL resolver, IPC handler) — two
 * copies of "which sources feed the collapse" would drift the same way the
 * pre-WP-68 resolvers did.
 */
export async function collectFleetCollapseFromServices(s: {
  graphService: { getDb?(): unknown; getWpeSites?(): Promise<unknown>; getAccounts?(): Promise<unknown> } | null | undefined;
  siteData: { getSites?(): Record<string, unknown> } | null | undefined;
  indexRegistry: { listAll?(): unknown[] } | null | undefined;
  statuses?: Record<string, string>;
}): Promise<FleetCollapse> {
  const db = (s.graphService?.getDb?.() ?? null) as DbLike | null;

  let siteLinks: Array<{ localSiteId: string; wpeInstallId: string; wpeInstallName?: string }> = [];
  try {
    if (db) {
      siteLinks = (db.prepare('SELECT local_site_id, wpe_install_id, wpe_install_name FROM site_links').all() as Array<Record<string, unknown>>)
        .map((l) => ({
          localSiteId: String(l.local_site_id),
          wpeInstallId: String(l.wpe_install_id),
          ...(l.wpe_install_name ? { wpeInstallName: String(l.wpe_install_name) } : {}),
        }));
    }
  } catch { /* no links → no copy nesting, honestly */ }

  // The copy's content-lineage record, per linked local site. Async and few
  // (one read per copy); a failed read is an absent record, never a guess.
  const contentStatus = new Map<string, { state: string; sourceName?: string; behindSeconds?: number }>();
  try {
    const { readSiteContentStatus } = await import('../intelligence-host/siteContentStatus');
    for (const link of siteLinks) {
      try {
        const cs = await readSiteContentStatus({ siteData: s.siteData as never }, link.localSiteId);
        if (cs) contentStatus.set(link.localSiteId, cs);
      } catch { /* absent record */ }
    }
  } catch { /* module unavailable → no lineage detail */ }

  let wpeSites: CollectFleetCollapseDeps['wpeSites'] = [];
  let wpeAccounts: CollectFleetCollapseDeps['wpeAccounts'] = [];
  try { wpeSites = ((await s.graphService?.getWpeSites?.()) ?? []) as CollectFleetCollapseDeps['wpeSites']; } catch { /* names absent */ }
  try { wpeAccounts = ((await s.graphService?.getAccounts?.()) ?? []) as CollectFleetCollapseDeps['wpeAccounts']; } catch { /* accounts absent */ }

  let core: CoreLike | null = null;
  try {
    const { getIntelligenceCore } = await import('../intelligence-host/coreRegistry');
    core = (getIntelligenceCore() ?? null) as CoreLike | null;
  } catch { /* core down → every place reads never */ }

  // Phase 3: one triage read; the counts are derived from the same rows the
  // Now panel renders, so the column and the badge cannot disagree.
  let needsYouPerSite: CollectFleetCollapseDeps['needsYouPerSite'];
  try {
    const { createSessionRegistry } = await import('../intelligence-host/sessionRegistry');
    needsYouPerSite = createSessionRegistry().triage().counts.perSite;
  } catch { /* registry unavailable → the header keeps its stated absence */ }

  return collectFleetCollapse({
    localSites: Object.values(s.siteData?.getSites?.() ?? {}) as Array<Record<string, any>>,
    statuses: s.statuses,
    db,
    indexEntries: (s.indexRegistry?.listAll?.() ?? []) as Array<{ siteId: string; state: string; documentCount?: number }>,
    wpeSites,
    wpeAccounts,
    siteLinks,
    contentStatus,
    core,
    needsYouPerSite,
  });
}

function twinLayer(core: CoreLike, envId: string, layer: 'pipeline:l2' | 'pipeline:l3'): CheckedView {
  const fact = core.twins.get(envId, layer);
  const v = fact?.value as { outcome?: string; finished_at?: string; reason?: string } | undefined;
  if (!v?.outcome || !v.finished_at) return NEVER;
  return {
    state: v.outcome === 'ok' ? 'ok' : v.outcome === 'skip' ? 'skip' : 'fail',
    finishedAt: v.finished_at,
    reason: v.reason ?? null,
  };
}

function twinChecked(core: CoreLike, envId: string): { l2: CheckedView; l3: CheckedView } {
  return {
    l2: twinLayer(core, envId, 'pipeline:l2'),
    l3: twinLayer(core, envId, 'pipeline:l3'),
  };
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
  const checked = new Map<string, { l2?: CheckedView; l3?: CheckedView }>();
  const entityToRow = new Map<string, string>();
  if (deps.core) {
    try {
      for (const g of graphRows) {
        const kind = g.source === 'external' ? ('external' as const) : ('wpe' as const);
        const envId = pipelineEntityId(deps.core as never, { kind, graphRowId: g.id });
        entityToRow.set(envId, g.id);
        checked.set(g.id, twinChecked(deps.core, envId));
      }
      for (const s of deps.localSites) {
        if (!s?.id) continue;
        const envId = pipelineEntityId(deps.core as never, { kind: 'local', localSiteId: s.id });
        entityToRow.set(envId, s.id);
        checked.set(s.id, twinChecked(deps.core, envId));
      }
    } catch {
      /* a twin-read fault must not blank the fleet */
    }
  }

  // Phase 3: entity-id → row translation, the SAME resolution the producers
  // stamp with. An entity no row claims stays in the stated remainder — a
  // situation is never guessed onto a site (the round-7 ruling).
  let needsYou: Map<string, { count: number; tier: number }> | undefined;
  let needsYouMeta: { situations: number; unattributed: number } | undefined;
  if (deps.needsYouPerSite) {
    needsYou = new Map();
    let unmatched = 0;
    for (const e of deps.needsYouPerSite.byEntity) {
      const rowId = entityToRow.get(e.entityId);
      if (!rowId) { unmatched++; continue; }
      const cur = needsYou.get(rowId) ?? { count: 0, tier: 0 };
      cur.count += e.count;
      if (e.tier > cur.tier) cur.tier = e.tier;
      needsYou.set(rowId, cur);
    }
    needsYouMeta = {
      situations: deps.needsYouPerSite.situations,
      unattributed: deps.needsYouPerSite.unattributed + unmatched,
    };
  }

  // Place-screen facts: plugin rows per site (graph), indexed docs (registry).
  // Absent = unknown = NULL downstream, never a default.
  const pluginCounts = new Map<string, number>();
  try {
    if (db) {
      for (const r of db
        .prepare('SELECT p.site_id AS site_id, COUNT(*) AS c FROM plugins p GROUP BY p.site_id')
        .all() as Array<{ site_id: string; c: number }>) {
        pluginCounts.set(r.site_id, r.c);
      }
    }
  } catch { /* unknown, honestly */ }

  const docCounts = new Map<string, number>();
  for (const e of deps.indexEntries) {
    if (typeof e.documentCount === 'number') docCounts.set(e.siteId, e.documentCount);
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
    pluginCounts,
    docCounts,
    contentStatus: deps.contentStatus,
    needsYou,
    needsYouMeta,
    localPaths: new Map(
      deps.localSites
        .filter((s) => s?.id && s?.path)
        .map((s) => [s.id as string, String(s.path).replace(os.homedir(), '~')]),
    ),
  });
}
