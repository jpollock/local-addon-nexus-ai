/**
 * WP-41 · THE SITE-AT-PLACES MATRIX — the comparator render, derived.
 *
 * XD-9 ratified this shape and the parked environment-detail screen died with
 * it: "the honest rendering of records is a grid where an empty or disagreeing
 * cell does the work." Rows are Sites, columns are places, a cell is the fact at
 * that place. `ScopeCell` is already keyed `{siteId, siteName, place}`, so the
 * unit the user clicks and the unit the scope carries are the SAME unit — which
 * is pin 1 of the split sheet ("the unit is the cell, not the site") satisfied
 * by construction rather than by two shapes agreeing.
 *
 * THE FOUR BOUNDARY CONDITIONS, each implemented rather than restated:
 *
 * **1 · Divergence is the COMPARATOR'S VERDICT, never cell inequality.** This is
 * the boundary that shapes the whole module. `verdictsFor` reads
 * `divergence()` — WP-15's lineage-aware, per-flow comparator — and attaches a
 * `CellVerdict` only where that function produced a `CodeItem` for this exact
 * fact. Two cells holding different strings produce NOTHING here. The surface
 * renders them as plain difference because that is all they are: development on
 * `alpine` against everything else on `alpine-child` may be intentional
 * per-place configuration, and an alarm drawn from `a !== b` would be the
 * platform inventing a verdict it did not compute. `cellsDisagree` exists and is
 * exported precisely so the surface can say "these differ" WITHOUT that ever
 * being routed into `verdict`; the two are different fields because they are
 * different claims.
 *
 * **2 · The your-copy column is a different species in the same grid.**
 * Environments are durable places; a working copy carries per-flow moving
 * pointers. `divergence()` is a copy-vs-upstream computation, so a verdict can
 * only ever land on a your-copy cell — and that is stated in the matrix itself
 * (`comparedAgainst`) rather than left for a reader to infer. **The honest limit
 * of this build:** there is no environment-vs-environment comparator in the
 * shipped derivations, so a WPE staging cell and a WPE production cell holding
 * different versions get NO verdict. That is not a gap this file may paper over
 * — `verdictCoverage` reports it as a number so the absence is measured on every
 * render instead of being discovered later.
 *
 * **3 · Place-scoped facts are rows with empty cells.** A cell whose place holds
 * no such fact is `absent`, and the surface draws the honest dash. Nothing here
 * substitutes a zero, an empty string or a plausible default — `php_version ||
 * '8.0'` is this repo's own worked example of what that costs.
 *
 * **4 · Pre-tracking history says "watching since", never "unknown".**
 * `watchingSince` is the `observed_at` of the earliest ledger event naming the
 * entity — a fact we own. An entity whose origin predates tracking therefore has
 * an honestly absent history and a date we can stand behind, which is the
 * controlled vocabulary's omit-never-"unknown" rule applied at its hardest case.
 * There is no `'unknown'` string anywhere in this module and a test forbids one.
 *
 * READ-ONLY, and it never mints. Every id is resolved through links and aliases
 * that already exist; `ensure()` is not called and must never be. ADR-21 froze
 * entity ids, and a comparison that registered an entity for whatever handle it
 * was passed would split the history it exists to join (audit A7).
 *
 * NON-FATAL, like everything on this seam: a dark core, an unreadable graph or a
 * throw anywhere yields an EMPTY matrix, never a partial one presented as whole.
 */
import { divergence, TwinStore, EntityService, Ledger } from '../../intelligence';
import type { CodeItem, TwinFact } from '../../intelligence';
import type {
  ScopeCell,
  ScopePlace,
  SelectedCell,
  WorldExclusionRecord,
} from '../intelligence-host/procedureScope';
import { placeToken } from '../intelligence-host/procedureScope';
import type { EnvironmentKind } from '../intelligence-host/taskFrame';

/**
 * What the comparator computed for this cell, in the vocabulary WP-15 uses.
 *
 * `comparedAgainst` is not decoration: a direction with no named other side is
 * an alarm without a subject, and XD-9's boundary 2 is that a copy's comparisons
 * run along ITS flows rather than pairwise against every column.
 */
export interface CellVerdict {
  direction: 'ahead' | 'behind';
  /** What the comparator measured this cell against, in the user's words. */
  comparedAgainst: string;
  /** The other side's value, so the marker is inspectable rather than asserted. */
  upstreamValue?: string;
}

/** One (site, place). The cell a human clicks and the cell the scope carries. */
export interface MatrixCell {
  /** The environment entity holding the fact. The cell's own identity. */
  entityId: string;
  place: ScopePlace;
  /** Rendered value. ABSENT when this place holds no such fact — never a default. */
  value?: string;
  /** When the value was last true at its source. Absent with the value. */
  observedAt?: string;
  /**
   * The comparator's verdict. Present ONLY where `divergence()` produced one.
   * A cell that merely differs from its neighbours has no verdict and must not
   * be given one — boundary 1.
   */
  verdict?: CellVerdict;
  /**
   * The world's own state removing this cell from any selection, carrying the
   * record that observed it. Shaped as `SelectedCell.excluded` so a selected
   * cell hands it straight to `deriveScope` without a second derivation.
   */
  excluded?: WorldExclusionRecord;
}

export interface MatrixRow {
  /** The Site entity — the row's identity. Never rendered. */
  siteEntityId: string;
  /** What the user calls this site. Derived, never an id. */
  siteName: string;
  /** One entry per column, in column order. `undefined` is boundary 3's dash. */
  cells: Array<MatrixCell | undefined>;
  /**
   * Boundary 4. The `observed_at` of the earliest record naming this site — a
   * fact we own, offered in place of the shrug we do not.
   */
  watchingSince?: string;
}

export interface SiteAtPlacesMatrix {
  /** The twin fact key this render is over, e.g. `plugin:woocommerce`. */
  fact: string;
  /** The filter as APPLIED, verbatim — it rides onto `ScopeFrom.filter`. */
  filter: string;
  /** Identifies this render for the from-line. Derived from the filter. */
  comparatorId: string;
  columns: ScopePlace[];
  rows: MatrixRow[];
  /**
   * Boundary 2's honest limit, MEASURED. `cells` is every populated cell;
   * `verdicts` is how many carry a comparator verdict. When the second is much
   * smaller than the first, that is the shipped comparator's reach and not a
   * defect — but it is a fact the surface must be able to state.
   */
  verdictCoverage: { cells: number; verdicts: number };
}

export interface MatrixDeps {
  ledger: Ledger;
  twins: TwinStore;
  entities?: EntityService;
  /** `describeEnvironmentsFor`'s output — entityId → what the graph calls it. */
  describe?: (entityId: string) => { name?: string; kind?: EnvironmentKind; host?: 'wpe' | 'external' } | undefined;
  /** Entity ids the world has removed, with the record that says so. */
  exclusions?: Map<string, WorldExclusionRecord>;
  now?: Date;
}

/**
 * Column order is by AUTHORITY-adjacent convention, fixed rather than derived
 * from the data: a grid whose columns move when a site is added is a grid nobody
 * can read twice. `local` sits last because it is the different species
 * (boundary 2) and the reader should meet the durable places first.
 */
export const COLUMN_ORDER: ScopePlace[] = [
  { host: 'wpe', kind: 'production' },
  { host: 'wpe', kind: 'staging' },
  { host: 'wpe', kind: 'development' },
  { host: 'local' },
];

/** Two cells differ. NOT a divergence verdict — see boundary 1 in the header. */
export function cellsDisagree(a: MatrixCell | undefined, b: MatrixCell | undefined): boolean {
  if (!a?.value || !b?.value) return false;
  return a.value !== b.value;
}

/** `{version, active}` as a human reads it. Absent version ⇒ no value at all. */
function renderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { version?: unknown; active?: unknown; removed?: unknown };
  if (v.removed === true) return undefined; // removed is an absence, not a value
  if (typeof v.version !== 'string' || !v.version) return undefined;
  // `active` rides only when it is FALSE: "9.5.0" is the fact, and appending
  // "· active" to every cell would make the exceptional case the invisible one.
  return v.active === false ? `${v.version} · inactive` : v.version;
}

function placeOf(
  described: { kind?: EnvironmentKind; host?: 'wpe' | 'external' } | undefined
): ScopePlace {
  // taskFrame's rule 3, inherited rather than restated: only a REMOTE row's
  // column names an environment. A local row's backfilled 'development'
  // describes a copy, not a place at WP Engine — so it lands in the your-copy
  // column, which is where boundary 2 says a copy belongs.
  if (described?.host && described.kind) return { host: described.host, kind: described.kind };
  return { host: 'local' };
}

function columnIndex(columns: ScopePlace[], place: ScopePlace): number {
  const token = placeToken(place);
  return columns.findIndex((c) => placeToken(c) === token);
}

/**
 * The earliest record naming this entity — boundary 4's date.
 *
 * `undefined` when the ledger holds nothing, and the surface then says nothing.
 * An absent date is an absent date; it is never rendered as a word.
 */
function watchingSince(ledger: Ledger, entityId: string): string | undefined {
  try {
    const [first] = ledger.query({ entityId, order: 'asc', limit: 1 });
    return first?.observed_at;
  } catch {
    return undefined;
  }
}

/**
 * Every verdict the comparator has for this copy, keyed by fact.
 *
 * The whole point of routing through `divergence()` rather than comparing twin
 * rows here: it resolves lineage, declines when the upstream is ambiguous, and
 * knows that activation state is not a direction. Reimplementing any of that
 * beside it would be the second copy of a rule this repo has already paid for
 * three times.
 */
function verdictsFor(
  copyEntityId: string,
  deps: MatrixDeps,
  now: Date
): { items: Map<string, CodeItem>; upstreamName?: string } {
  try {
    const report = divergence(copyEntityId, {
      ledger: deps.ledger,
      twins: deps.twins,
      ...(deps.entities ? { entities: deps.entities } : {}),
      now,
    });
    const items = new Map(report.code.items.map((i) => [i.fact, i]));
    const upstreamId = report.upstream?.entityId;
    const described = upstreamId ? deps.describe?.(upstreamId) : undefined;
    return { items, ...(described?.name ? { upstreamName: described.name } : {}) };
  } catch {
    return { items: new Map() };
  }
}

/**
 * The row's label. Derived from the cells' own names in a FIXED precedence, so
 * the same site renders under the same word on every screen.
 *
 * Why a precedence rather than the Site entity: the graph names INSTALLS, not
 * Sites, so there is no single stored name to read. Production's name is the one
 * a human uses for the site when asked; the order below falls back through the
 * places in the order a reader would.
 */
function rowName(named: Array<{ place: ScopePlace; name?: string }>, columns: ScopePlace[]): string | undefined {
  for (const column of columns) {
    const hit = named.find((n) => placeToken(n.place) === placeToken(column) && n.name);
    if (hit?.name) return hit.name;
  }
  return named.find((n) => n.name)?.name;
}

/**
 * Build the render.
 *
 * Rows whose Site cannot be resolved are DROPPED rather than gathered into a
 * synthetic row: an entity with no Site is a fact about the identity spine, and
 * folding several of them under one heading would invent a site that does not
 * exist. Dropping is visible (the row is absent); inventing is not.
 */
export function buildSiteAtPlaces(
  fact: string,
  filter: string,
  deps: MatrixDeps
): SiteAtPlacesMatrix {
  const now = deps.now ?? new Date();
  const columns = COLUMN_ORDER;
  const empty: SiteAtPlacesMatrix = {
    fact,
    filter,
    comparatorId: comparatorIdFor(fact),
    columns,
    rows: [],
    verdictCoverage: { cells: 0, verdicts: 0 },
  };

  let facts: TwinFact[];
  try {
    facts = deps.twins.byFact(fact);
  } catch {
    return empty;
  }

  // entity → its Site. Resolved once per entity; `siteOf` is a link read.
  const bySite = new Map<string, TwinFact[]>();
  for (const row of facts) {
    let site: string | undefined;
    try {
      site = deps.entities?.siteOf(row.entityId);
    } catch {
      site = undefined;
    }
    if (!site) continue;
    const list = bySite.get(site) ?? [];
    list.push(row);
    bySite.set(site, list);
  }

  let cellCount = 0;
  let verdictCount = 0;
  const rows: MatrixRow[] = [];

  for (const [siteEntityId, siteFacts] of [...bySite].sort(([a], [b]) => a.localeCompare(b))) {
    const cells: Array<MatrixCell | undefined> = columns.map(() => undefined);
    const named: Array<{ place: ScopePlace; name?: string }> = [];

    for (const row of siteFacts) {
      const described = deps.describe?.(row.entityId);
      const place = placeOf(described);
      named.push({ place, ...(described?.name ? { name: described.name } : {}) });

      const index = columnIndex(columns, place);
      if (index < 0) continue; // a place outside the rendered columns is not shown

      const value = renderValue(row.value);
      const cell: MatrixCell = {
        entityId: row.entityId,
        place,
        ...(value ? { value, observedAt: row.observedAt } : {}),
        ...(deps.exclusions?.get(row.entityId)
          ? { excluded: deps.exclusions.get(row.entityId) as WorldExclusionRecord }
          : {}),
      };
      if (value) cellCount += 1;

      // Boundary 1 and 2 together: a verdict is asked for ONLY on the your-copy
      // column, and only accepted when the comparator produced one for THIS fact.
      if (place.host === 'local' && value) {
        const { items, upstreamName } = verdictsFor(row.entityId, deps, now);
        const item = items.get(fact);
        if (item && (item.direction === 'ahead' || item.direction === 'behind')) {
          cell.verdict = {
            direction: item.direction,
            comparedAgainst: upstreamName ?? THE_SITE_IT_TRACKS,
            ...(item.upstream?.version ? { upstreamValue: item.upstream.version } : {}),
          };
          verdictCount += 1;
        }
      }

      cells[index] = cell;
    }

    const name = rowName(named, columns);
    if (!name) continue; // no name ⇒ no honest row label, and an id is never one
    rows.push({
      siteEntityId,
      siteName: name,
      cells,
      ...(watchingSince(deps.ledger, siteEntityId)
        ? { watchingSince: watchingSince(deps.ledger, siteEntityId) }
        : {}),
    });
  }

  return {
    fact,
    filter,
    comparatorId: comparatorIdFor(fact),
    columns,
    rows: rows.sort((a, b) => a.siteName.localeCompare(b.siteName)),
    verdictCoverage: { cells: cellCount, verdicts: verdictCount },
  };
}

/**
 * The last resort when nothing names the other side — `divergenceReport.ts`'s
 * own constant, and the same reason: never an id, and never a shrug.
 */
const THE_SITE_IT_TRACKS = 'the site it tracks';

/**
 * The render's id, for `ScopeFrom.comparatorId`.
 *
 * Derived from the fact so the from-line resolves BACK to a render a reader can
 * re-open with the same filter (pin 5 / XD-18: resolution, not string format).
 * `resolveScopeFrom` is what turns it back into a render.
 */
export function comparatorIdFor(fact: string): string {
  return `cmp.${fact.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/**
 * A clicked cell, as `deriveScope` wants it.
 *
 * The exclusion travels WITH the cell rather than being re-derived at the split:
 * the record that observed a site halted is the record the block quotes, and
 * re-deriving it at the seam would be the same re-derivation the carrier exists
 * to stop, one layer down.
 */
export function toSelectedCell(row: MatrixRow, cell: MatrixCell): SelectedCell {
  const bare: ScopeCell = { siteId: cell.entityId, siteName: row.siteName, place: cell.place };
  return cell.excluded ? { ...bare, excluded: cell.excluded } : bare;
}
