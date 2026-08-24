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

/**
 * Whose failure is this? A transport refusal ("ssh: connection refused") is a
 * fact about the PLACE; a constraint violation in our own store is a fact
 * about NEXUS, and must never be phrased as if the site failed (designer
 * round-2 finding 3 — QWERKY's D11 error was dressed as theirs).
 */
export function reasonBlame(reason: string | null): 'place' | 'nexus' {
  if (!reason) return 'place';
  return /constraint failed|SqliteError|no such (table|column)|database is locked|UNIQUE constraint/i.test(reason)
    ? 'nexus'
    : 'place';
}

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
  /** The later of the two layers — what the fleet row shows. */
  checked: CheckedView;
  /** Per-layer detail for the place screen: metadata vs content pipeline. */
  checkedL2: CheckedView;
  checkedL3: CheckedView;
  /** Local run state; null for remote places (Nexus does not run them). */
  status: string | null;
  // Place-screen facts — NULL is the honest unknown, never a default.
  wpVersion: string | null;
  phpVersion: string | null;
  pluginCount: number | null;
  docCount: number | null;
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
  /**
   * The lineage block, COMPOSED HERE (the RowDoor rule: a sentence built in
   * the surface is a second place the vocabulary lives). Stated absence is
   * the common case and is a sentence with a reason, never an empty list.
   */
  lineage: string[];
}

/**
 * One account-level ceiling, COALESCED (round-3 finding 1): the fact belongs
 * to the account, so it is stated once as a verdict about the whole — never
 * amplified into one alarm per install. Rows carry at most a quiet marker.
 */
export interface CeilingVerdict {
  accountId: string;
  accountName: string | null;
  /** The whole sentence, composed here: subject, cause, scope. */
  statement: string;
  placeCount: number;
  propertyKeys: string[];
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
    /** Account-level ceilings, one verdict each. */
    ceilings: CeilingVerdict[];
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
  siteLinks: Array<{ localSiteId: string; wpeInstallId: string; wpeInstallName?: string }>;
  /** D15: accountId → the stated reason SSH cannot reach this account. */
  gatewaylessAccounts: Map<string, string>;
  /** Per-layer pipeline outcome per rowId/localSiteId (host reads the twins). */
  checked: Map<string, { l2?: CheckedView; l3?: CheckedView }>;
  /** rowId/localSiteId → active plugin-row count in the graph. Absent = unknown. */
  pluginCounts?: Map<string, number>;
  /** siteId → indexed document count from the registry. Absent = unknown. */
  docCounts?: Map<string, number>;
  /**
   * localSiteId → the copy's content-lineage record (from
   * `readSiteContentStatus`). Absent = no recorded lineage.
   */
  contentStatus?: Map<string, { state: string; sourceName?: string; behindSeconds?: number }>;
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
  const layersOf = (id: string): { l2: CheckedView; l3: CheckedView } => {
    const c = input.checked.get(id);
    return { l2: c?.l2 ?? NEVER, l3: c?.l3 ?? NEVER };
  };
  /** The later of the two layers — what the fleet row shows. */
  const mergedOf = (l: { l2: CheckedView; l3: CheckedView }): CheckedView => {
    if (l.l2.finishedAt === null) return l.l3;
    if (l.l3.finishedAt === null) return l.l2;
    return l.l3.finishedAt > l.l2.finishedAt ? l.l3 : l.l2;
  };

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
    const layers = layersOf(row.id);
    return {
      rowId: row.id,
      kind: placeKindOf(row, g?.environment, isCopy),
      source: row.source,
      name: row.name,
      domain: row.domain,
      knowledge: row.knowledge,
      ceiling,
      checked: mergedOf(layers),
      checkedL2: layers.l2,
      checkedL3: layers.l3,
      status: row.status,
      wpVersion: row.wpVersion,
      phpVersion: row.phpVersion,
      pluginCount: input.pluginCounts?.get(row.id) ?? null,
      docCount: input.docCounts?.get(row.id) ?? null,
    };
  }

  /**
   * The lineage sentences — the ratified two-leg block. Content leg from the
   * copy's recorded status; code leg is a stated absence until a deploy
   * producer exists. Never composed in a renderer, never empty.
   */
  function lineageOf(
    origin: 'local' | 'wpe' | 'external',
    places: PlaceView[],
    copyLocalIds: string[],
  ): string[] {
    const out: string[] = [];
    if (origin === 'external') {
      out.push(
        'No recorded relationship links this place to any other. Nexus reads it over SSH and never writes to the server.',
      );
      return out;
    }
    if (origin === 'local') {
      out.push('This site exists only on your machine — no linked place anywhere else is recorded.');
      return out;
    }
    const copies = places.filter((p) => p.kind === 'copy');
    if (copies.length === 0) {
      out.push(
        'No copy of this site exists on your machine. Each place stands alone until a pull or deploy is observed.',
      );
    } else {
      for (const copy of copies) {
        const link = input.siteLinks.find(
          (l) => copyLocalIds.includes(l.localSiteId) && l.localSiteId === copy.rowId,
        );
        const linkedTo = link?.wpeInstallName ? ` — linked to ${link.wpeInstallName}` : '';
        out.push(`A copy of this site lives on your machine (${copy.name})${linkedTo}.`);
        const cs = input.contentStatus?.get(copy.rowId);
        if (cs?.state === 'pulled' && cs.sourceName) {
          const behind =
            typeof cs.behindSeconds === 'number' && cs.behindSeconds > 0
              ? ` — its content is ${Math.max(1, Math.round(cs.behindSeconds / 86_400))} day(s) behind`
              : '';
          out.push(`Your copy's content was pulled from ${cs.sourceName}${behind}.`);
        } else {
          out.push(
            "No recorded pull links your copy's content to any place here — as far as Nexus can see, they are unrelated. Pulling again will record the link.",
          );
        }
      }
    }
    out.push(
      'Code moves through git; Nexus has no record of a deploy to any place here and says so rather than guessing.',
    );
    return out;
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
    const copyLocalIds: string[] = [];
    for (const [localSiteId, prop] of copyPropertyOf) {
      if (prop !== wpeSiteId) continue;
      const localRow = rowById.get(localSiteId);
      if (localRow) {
        places.push(toPlace(localRow, true));
        copyLocalIds.push(localSiteId);
      }
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
      lineage: lineageOf('wpe', places, copyLocalIds),
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
      lineage: lineageOf('local', places, []),
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
      lineage: lineageOf('external', places, []),
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

  // Account-level ceilings, coalesced to one verdict each (round-3 finding 1):
  // the fact is the account's, so it is said once about the whole — the rows
  // carry a quiet marker, and the screen must not read as hundreds of alarms.
  const ceilingsByAccount = new Map<string, CeilingVerdict>();
  for (const p of properties) {
    for (const pl of p.places) {
      if (!pl.ceiling) continue;
      const g = graphById.get(pl.rowId);
      const accountId = g?.account_id ?? 'unknown';
      let v = ceilingsByAccount.get(accountId);
      if (!v) {
        const account = accountById.get(accountId);
        v = { accountId, accountName: account ? account.nickname ?? account.name : null, statement: '', placeCount: 0, propertyKeys: [] };
        ceilingsByAccount.set(accountId, v);
      }
      v.placeCount++;
      if (!v.propertyKeys.includes(p.key)) v.propertyKeys.push(p.key);
    }
  }
  for (const v of ceilingsByAccount.values()) {
    const who = v.accountName ?? v.accountId;
    v.statement =
      `${who} has no SSH gateway, so Nexus cannot index its ` +
      `${v.placeCount} install${v.placeCount === 1 ? '' : 's'} over SSH.`;
  }

  return {
    properties,
    header: {
      total: properties.length,
      byOrigin,
      placesTotal: allPlaces.length,
      neverLookedInside: allPlaces.filter((pl) => pl.knowledge === 'nothing').length,
      onThisMachine: properties.filter((p) => p.origin === 'local' || p.hasCopy).length,
      ceilings: [...ceilingsByAccount.values()].sort((a, b) => b.placeCount - a.placeCount),
    },
  };
}
