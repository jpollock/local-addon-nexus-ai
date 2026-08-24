/**
 * The fleet collapse — the property-grain read model behind the three ratified
 * screens (plan: docs/planning/2026-08-24-fleet-collapse-implementation.md).
 *
 * One computation answers every surface, so each count on screen derives from
 * one place (the WP-67 rule: derived, never independently computed). Sources
 * are the Phase-0 rulings: graph.db grouping via `wpe_site_id`, names from
 * `wpe_sites` (D21), Local's own store for local sites, `site_links` for copy
 * pairing, pipeline twins for checked ages, `wpeGatewayStatus` for ceilings.
 * The entity layer's Site family is deliberately NOT an input (D20).
 *
 * Pure: every input is a plain value the host collects. Nothing here reads a
 * database, so the acceptance fixtures drive the real code.
 */
import { KnowledgeRung } from './knowledgeLadder';
import { SiteRow, buildSiteRows, SiteRowsInput } from './siteRows';

/** The latest pipeline outcome for one place — from `pipeline:l2`/`l3` twins. */
export interface CheckedView {
  state: 'never' | 'ok' | 'fail' | 'skip';
  /** ISO — the run's own finish moment, never "now". Null when state is never. */
  finishedAt: string | null;
  /** The transport's own reason, only when state is fail/skip. */
  reason: string | null;
}

const NEVER: CheckedView = { state: 'never', finishedAt: null, reason: null };

export type PlaceKind = 'production' | 'staging' | 'development' | 'copy' | 'local' | 'unknown';

export interface PlaceView {
  /** Graph row id (`wpe-…`, `ssh:…`) or Local site id. */
  rowId: string;
  kind: PlaceKind;
  source: 'local' | 'wpe' | 'external';
  name: string;
  domain: string | null;
  knowledge: KnowledgeRung;
  /**
   * Why this place cannot be known more deeply — a property of the account,
   * not a failure to retry (D15: "no SSH gateway — WP Engine Autoscale").
   * Null when nothing caps it.
   */
  ceiling: string | null;
  checked: CheckedView;
  /** Local run state; null for remote places (Nexus does not run them). */
  status: string | null;
}

export interface PropertyView {
  /** Stable key: `wpe:<wpe_site_id>` | `local:<siteId>` | `ext:<rowId>`. */
  key: string;
  /**
   * The display name — UNTRUSTED TEXT (a real portal Site is named
   * `<script>alert()</script>`); render as text, never markup.
   */
  name: string;
  /** portal = wpe_sites (D21); install = grouped install names, never a guess. */
  nameSource: 'portal' | 'install' | 'local' | 'alias';
  accountId: string | null;
  accountName: string | null;
  /** The partition axis — every property has exactly one, so counts sum. */
  origin: 'local' | 'wpe' | 'external';
  places: PlaceView[];
  hasCopy: boolean;
  /** Distinct rungs in ladder order — a SET, never an average. */
  rungs: KnowledgeRung[];
  /**
   * The roll-up the row shows, and it says what it is: any fail wins, then
   * never, then the OLDEST successful check. v2 of the mock showed the newest
   * — claiming a freshness only the best-checked place had.
   */
  oldest: CheckedView;
  /** Shares a name with a property of another origin — kept separate, flagged. */
  collision: boolean;
}

export interface FleetCollapse {
  properties: PropertyView[];
  header: {
    total: number;
    /** Sums to total — origin is a partition (the designer's ruling). */
    byOrigin: { local: number; wpe: number; external: number };
    placesTotal: number;
    /** Places at rung `nothing` — the header's call to action. */
    neverLookedInside: number;
    /** Local-only properties plus WPE properties with a copy here (the sidebar-shaped count). */
    onThisMachine: number;
  };
}

export interface FleetCollapseInput extends Omit<SiteRowsInput, 'graphRows'> {
  graphRows: Array<
    SiteRowsInput['graphRows'][number] & {
      remote_install_id?: string | null;
      wpe_site_id?: string | null;
      environment?: string | null;
      account_id?: string | null;
    }
  >;
  /** D21: the CAPI Site names. */
  wpeSites: Array<{ id: string; name: string | null; account_id: string | null }>;
  wpeAccounts: Array<{ id: string; name: string; nickname: string | null }>;
  /** Local↔WPE pairing, from Local's own site_links store (the mirror's source). */
  siteLinks: Array<{ localSiteId: string; wpeInstallId: string }>;
  /** D15: accountId → the stated reason SSH cannot reach this account. */
  gatewaylessAccounts: Map<string, string>;
  /** Latest pipeline outcome per rowId/localSiteId (host reads the twins). */
  checked: Map<string, CheckedView>;
}

const RUNG_ORDER: KnowledgeRung[] = ['nothing', 'basic', 'detailed', 'searchable'];

function placeKindOf(row: SiteRow, environment: string | null | undefined, isCopy: boolean): PlaceKind {
  if (row.source === 'local') return isCopy ? 'copy' : 'local';
  if (environment === 'production' || environment === 'staging' || environment === 'development') {
    return environment;
  }
  return row.source === 'external' ? 'production' : 'unknown';
}

/** fail beats never beats the oldest ok/skip — the labelled set-minimum. */
function rollupChecked(places: PlaceView[]): CheckedView {
  const fail = places.find((p) => p.checked.state === 'fail');
  if (fail) return fail.checked;
  if (places.some((p) => p.checked.state === 'never')) return NEVER;
  let oldest: CheckedView | null = null;
  for (const p of places) {
    if (p.checked.finishedAt === null) continue;
    if (!oldest || p.checked.finishedAt < (oldest.finishedAt as string)) oldest = p.checked;
  }
  return oldest ?? NEVER;
}

function rungSet(places: PlaceView[]): KnowledgeRung[] {
  const seen = new Set<KnowledgeRung>(places.map((p) => p.knowledge));
  return RUNG_ORDER.filter((r) => seen.has(r));
}

export function buildFleetCollapse(input: FleetCollapseInput): FleetCollapse {
  const { rows } = buildSiteRows(input);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const graphById = new Map(input.graphRows.map((g) => [g.id, g]));
  const wpeSiteById = new Map(input.wpeSites.map((s) => [s.id, s]));
  const accountById = new Map(input.wpeAccounts.map((a) => [a.id, a]));
  const checkedOf = (id: string): CheckedView => input.checked.get(id) ?? NEVER;

  // Copy pairing: local site id → the wpe_site_id its linked install belongs to.
  const installToProperty = new Map<string, string>();
  for (const g of input.graphRows) {
    if (g.source === 'wpe' && g.remote_install_id && g.wpe_site_id) {
      installToProperty.set(g.remote_install_id, g.wpe_site_id);
    }
  }
  const copyPropertyOf = new Map<string, string>(); // localSiteId → wpe_site_id
  for (const link of input.siteLinks) {
    const prop = installToProperty.get(link.wpeInstallId);
    if (prop) copyPropertyOf.set(link.localSiteId, prop);
  }

  function toPlace(row: SiteRow, isCopy: boolean): PlaceView {
    const g = graphById.get(row.id);
    const accountId = g?.account_id ?? null;
    const ceiling = accountId ? input.gatewaylessAccounts.get(accountId) ?? null : null;
    return {
      rowId: row.id,
      kind: placeKindOf(row, g?.environment, isCopy),
      source: row.source,
      name: row.name,
      domain: row.domain,
      knowledge: row.knowledge,
      ceiling,
      checked: checkedOf(row.id),
      status: row.status,
    };
  }

  // ── group WPE rows by property ─────────────────────────────────────────────
  const wpeGroups = new Map<string, SiteRow[]>();
  for (const row of rows) {
    if (row.source !== 'wpe') continue;
    const g = graphById.get(row.id);
    // A row with no wpe_site_id is its own single-install property, keyed by
    // its row id — never silently dropped, never folded into a sibling.
    const key = g?.wpe_site_id ?? `row:${row.id}`;
    const list = wpeGroups.get(key) ?? [];
    list.push(row);
    wpeGroups.set(key, list);
  }

  const properties: PropertyView[] = [];

  for (const [groupKey, groupRows] of wpeGroups) {
    const wpeSiteId = groupKey.startsWith('row:') ? null : groupKey;
    const portal = wpeSiteId ? wpeSiteById.get(wpeSiteId) : undefined;
    const places = groupRows.map((r) => toPlace(r, false));

    // Copies whose linked install belongs to this property nest under it.
    for (const [localSiteId, prop] of copyPropertyOf) {
      if (prop !== wpeSiteId) continue;
      const localRow = rowById.get(localSiteId);
      if (localRow) places.push(toPlace(localRow, true));
    }

    const accountId = portal?.account_id ?? graphById.get(groupRows[0].id)?.account_id ?? null;
    const account = accountId ? accountById.get(accountId) : undefined;
    const installNames = groupRows.map((r) => r.name);
    properties.push({
      key: wpeSiteId ? `wpe:${wpeSiteId}` : `wpe:${groupKey}`,
      // Portal name when collected (D21); otherwise the real install names,
      // joined — never a derived guess (the entity-id ruling applies to names).
      name: portal?.name ?? installNames.join(' / '),
      nameSource: portal?.name ? 'portal' : 'install',
      accountId,
      accountName: account ? account.nickname ?? account.name : null,
      origin: 'wpe',
      places,
      hasCopy: places.some((p) => p.kind === 'copy'),
      rungs: rungSet(places),
      oldest: rollupChecked(places),
      collision: false, // filled after all origins exist
    });
  }

  // ── local-only properties (paired copies already nested above) ────────────
  for (const row of rows) {
    if (row.source !== 'local' || copyPropertyOf.has(row.id)) continue;
    const places = [toPlace(row, false)];
    properties.push({
      key: `local:${row.id}`,
      name: row.name,
      nameSource: 'local',
      accountId: null,
      accountName: null,
      origin: 'local',
      places,
      // A local-only site is not a copy OF anything — it is its own property.
      // It reaches onThisMachine through its origin, not this flag.
      hasCopy: false,
      rungs: rungSet(places),
      oldest: rollupChecked(places),
      collision: false,
    });
  }

  // ── external: one property per site row, ungrouped (ratified) ─────────────
  for (const row of rows) {
    if (row.source !== 'external') continue;
    const places = [toPlace(row, false)];
    properties.push({
      key: `ext:${row.id}`,
      name: row.name,
      nameSource: 'alias',
      accountId: null,
      accountName: row.host ? `ssh:${row.host}` : null,
      origin: 'external',
      places,
      hasCopy: false,
      rungs: rungSet(places),
      oldest: rollupChecked(places),
      collision: false,
    });
  }

  // ── collisions: same name, different origin — kept separate, flagged ──────
  const byName = new Map<string, PropertyView[]>();
  for (const p of properties) {
    const k = p.name.toLowerCase();
    const list = byName.get(k) ?? [];
    list.push(p);
    byName.set(k, list);
  }
  for (const list of byName.values()) {
    if (list.length > 1 && new Set(list.map((p) => p.origin)).size > 1) {
      for (const p of list) p.collision = true;
    }
  }

  // ── header: every figure derived from the same property list ──────────────
  const allPlaces = properties.flatMap((p) => p.places);
  const byOrigin = { local: 0, wpe: 0, external: 0 };
  for (const p of properties) byOrigin[p.origin]++;
  return {
    properties,
    header: {
      total: properties.length,
      byOrigin,
      placesTotal: allPlaces.length,
      neverLookedInside: allPlaces.filter((pl) => pl.knowledge === 'nothing').length,
      onThisMachine: properties.filter((p) => p.origin === 'local' || p.hasCopy).length,
    },
  };
}
