/**
 * WP-32 · THE SCOPE CARRIER — a selection becoming a scope, and staying it.
 *
 * The ratified artifact (XD-15, scope-block draft 2) is one typed thing that
 * travels: cells chosen at a comparator → the task frame → the arming → the
 * dry-run. Its whole reason to exist is the requirement in the middle of that
 * sentence:
 *
 *   > The arming CARRIES the scope. A run that re-derives its own targets fails.
 *
 * Today the model re-derives targets from the plan, which means the set a human
 * selected and the set that runs are two derivations that merely tend to agree.
 * `checkDryRunTargets` is where they stop being two: the dry-run's target set
 * must EQUAL the selected set minus barred and excluded, compared as sets, and
 * a cell that appears from anywhere else is named as unexpected rather than
 * quietly executed.
 *
 * THE UNIT IS THE CELL, NOT THE SITE (pin 1, the designer's refinement). A site
 * at staging and the same site at production are two targets under two
 * different laws; keying by site id alone is how a production write hides
 * inside a staging selection. Every set operation below keys on
 * `${siteId}|${placeToken(place)}`.
 *
 * THE SPLIT IS BY AUTHORITY (pin 4, ordered by `SCOPE_GROUP_ORDER`):
 *
 *   runnable — the grant's declared places admit it, the world left it alone
 *   barred   — needs a grant; carries the capability id in the GRANTS
 *              vocabulary and WP-31's structured `governDoor`
 *   excluded — the world removed it, carrying the record that did
 *
 * This is REFUSAL SHIFTED LEFT: the same refusal the arming would have
 * produced, computed before anyone spends a decision on it. Two rules govern it
 * and both have pins:
 *
 *  - **Barred never blocks runnable, and the two never depend on each other**
 *    (pin 8). Refusing a whole selection because two cells exceed authority is
 *    the trimming the §6.2 doctrine ruled against. Each group is derived from
 *    its own cells alone, which is why the pin can delete either group from the
 *    selection and watch the other come out unchanged.
 *  - **A later widening is a SECOND RUN, never a resumption** (the ruling).
 *    Nothing here extends an existing run's scope: runs are hash-pinned to their
 *    document, approval does not stretch to a plan it never saw, and continuity
 *    lives in the from-line — the new run is born pre-scoped to the barred cells
 *    carrying the SAME `from`, so the two runs share their ancestor. This module
 *    therefore has no `widenScope` and must never grow one.
 *
 * WHAT THE BARRED DOOR MAY PROMISE. Only what is derivable: the specific grant
 * (`governDoor`, WP-31's shape verbatim — one contract read from both ends), and
 * an honest statement about the runbook. `declaredIn` is `null` when no document
 * in the catalogue declares the place, and the reason says so in those words;
 * when a document DOES declare it, the reason names it instead. Neither sentence
 * is authored beside the data — both are read off the catalogue.
 *
 * XD-21 · EMPTY CONSEQUENCE EARNS NO CONTAINER. A scope whose runnable set is
 * empty sets `opensRun: false`. The surface draws no run and no checkpoint list
 * for it; the derived plan still attaches, because the refusal is a turn with
 * the plan and its door, not a silence.
 *
 * THE SEAM. Every import here is `import type` — this module is pure, has no
 * runtime dependency on the intelligence core, and computes only from what it is
 * handed. That is deliberate: `procedureModel.ts`'s header measures what a value
 * import from this directory costs the renderer (77 modules, thirteen of them
 * better-sqlite3). The renderer mirrors `scopeBlockLines` rather than importing
 * it, pinned by a shared case table, exactly as `ATTEST_WORDS` and `localDay`
 * are. Do not "remove the duplication": the duplication is the point.
 */
import type { EnvironmentKind } from './taskFrame';
import type { GovernDoorTarget } from './sequenceGuard';
import type { ResolvedGrant } from './capabilityGrants';
import type { Runbook } from '../../intelligence';

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * WHERE a cell is, in the two vocabularies that both matter.
 *
 * `placeToken` speaks the runbook's scope language (`local`, `wpe_staging`) —
 * that is what a grant's `environments` list is compared against, so it must be
 * derived and never typed by hand. `placeLabel` speaks the human's. One source,
 * two renderings; a hand-written mapping between them would be the third.
 */
export type ScopePlace =
  | { host: 'local' }
  | { host: 'wpe' | 'external'; kind: EnvironmentKind };

/** The token a runbook's `scope.environments` list is written in. */
export function placeToken(place: ScopePlace): string {
  return place.host === 'local' ? 'local' : `${place.host}_${place.kind}`;
}

/**
 * What a human is shown. `external` keeps its host word because "staging at WP
 * Engine and a client's own staging box are different sentences" — `taskFrame`'s
 * own rule, applied to the label instead of to the frame.
 */
export function placeLabel(place: ScopePlace): string {
  if (place.host === 'local') return 'local';
  return place.host === 'external' ? `external ${place.kind}` : place.kind;
}

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

/** One target: the CELL the selection was made over. */
export interface ScopeCell {
  siteId: string;
  /** What the user calls it. Never an id — the block is read by a human. */
  siteName: string;
  place: ScopePlace;
}

/**
 * Why the world removed a cell, and WHAT SAYS SO. The reason is copied from the
 * record, never composed beside it — "Excludes: Foxtrot — halted, and said so"
 * is only honest if something recorded that it said so.
 */
export interface WorldExclusionRecord {
  reason: string;
  causedBy: { recordId: string; topic: string; observedAt: string };
}

/** A cell as the comparator handed it over, carrying any world exclusion. */
export interface SelectedCell extends ScopeCell {
  excluded?: WorldExclusionRecord;
}

/**
 * PROVENANCE to the producing selection (pin 5). Structured rather than a URL,
 * for XD-18's reason: the comparator surface does not exist yet, and a route
 * invented now would be an authored promise. `resolveScopeFrom` is what the pins
 * test — resolution, not string format.
 */
export interface ScopeFrom {
  surface: 'comparator';
  /** The comparator render this selection was made in. */
  comparatorId: string;
  /** The filter that produced the rows, verbatim as the comparator applied it. */
  filter: string;
}

export interface ScopeSelection {
  cells: SelectedCell[];
  from: ScopeFrom;
}

/** Every cell the human selected — the set the dry-run is measured against. */
export function selectedCells(selection: ScopeSelection): ScopeCell[] {
  return selection.cells.map(({ siteId, siteName, place }) => ({ siteId, siteName, place }));
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

/** Authority order: what runs, what needs permission, what the world removed. */
export const SCOPE_GROUP_ORDER = ['runnable', 'barred', 'excluded'] as const;
export type ScopeGroup = (typeof SCOPE_GROUP_ORDER)[number];

export interface BarredCell extends ScopeCell {
  /** `CapabilityGrantSetting.capability` — the key a settings override matches on. */
  capability: string;
  /** WP-31's structured target, shared with the refusal contract from both ends. */
  governDoor: GovernDoorTarget;
  /** The document that DOES declare this place, or null when none does. */
  declaredIn: { runbookId: string; version: string } | null;
  reason: string;
}

export interface ExcludedCell extends ScopeCell, WorldExclusionRecord {}

export interface ProcedureScope {
  capability: string;
  runbookId: string;
  runnable: ScopeCell[];
  barred: BarredCell[];
  excluded: ExcludedCell[];
  /** The places the SELECTION spans, deduplicated, canonical order. */
  places: string[];
  from: ScopeFrom;
  /** XD-21: false when the runnable set is empty — no consequence, no container. */
  opensRun: boolean;
}

/** Only the fields the split reads. Keeps the catalogue cheap to hand in. */
export type ScopeRunbook = Pick<Runbook, 'id' | 'version' | 'capability' | 'frontmatter'>;

export interface ScopeSplitRequest {
  selection: ScopeSelection;
  /** The document the capability is armed under. */
  runbook: ScopeRunbook;
  /** The live grant set. The grant's scope wins — settings may widen the runbook's own. */
  grants: readonly ResolvedGrant[];
  /**
   * Every runbook the registry holds, so "no version declares this place" is
   * ANSWERED rather than assumed. Omitted ⇒ the honest answer is still "none
   * found", which is what an empty catalogue means.
   */
  catalogue?: readonly ScopeRunbook[];
}

/** A runbook's declared environment tokens, or undefined when it declares none. */
function declaredEnvironments(rb: ScopeRunbook): string[] | undefined {
  const raw = (rb.frontmatter as { scope?: unknown } | undefined)?.scope;
  if (!raw || typeof raw !== 'object') return undefined;
  const declared = (raw as { environments?: unknown }).environments;
  if (!Array.isArray(declared) || !declared.every((e) => typeof e === 'string')) return undefined;
  return declared as string[];
}

/**
 * The place gate. Three states, and the third is the one worth naming: a grant
 * that declares NO environments gates nothing. Three of the five shipped
 * runbooks declare `environments`; the others use a different scope vocabulary
 * entirely, and mapping those onto an environment list would be a guess
 * (`capabilityGrants.scopeFromRunbook` makes the same call). Absent is absent —
 * not "deny everything", which would bar cells on a document that never spoke
 * about places.
 */
function allowedPlaces(req: ScopeSplitRequest): string[] | undefined {
  const grant = req.grants.find((g) => g.capability === req.runbook.capability);
  if (!grant) return []; // no grant ⇒ nothing is admitted. A queue is not an authority.
  return grant.scope.environments;
}

export function deriveScope(req: ScopeSplitRequest): ProcedureScope {
  const { selection, runbook } = req;
  const allowed = allowedPlaces(req);

  const runnable: ScopeCell[] = [];
  const barred: BarredCell[] = [];
  const excluded: ExcludedCell[] = [];

  for (const cell of selection.cells) {
    const bare: ScopeCell = { siteId: cell.siteId, siteName: cell.siteName, place: cell.place };

    // The world outranks the grant. A halted site is not "barred pending a
    // grant" — granting the capability would not start it, so offering a door
    // would promise something the door cannot deliver.
    if (cell.excluded) {
      excluded.push({ ...bare, ...cell.excluded });
      continue;
    }

    const token = placeToken(cell.place);
    if (allowed !== undefined && !allowed.includes(token)) {
      barred.push(barredCell(bare, runbook, req.catalogue ?? []));
      continue;
    }

    runnable.push(bare);
  }

  return {
    capability: runbook.capability,
    runbookId: runbook.id,
    runnable,
    barred,
    excluded,
    places: canonicalPlaces(selection.cells),
    from: selection.from,
    opensRun: runnable.length > 0,
  };
}

/** The places the selection spans, as a SET (XD-13: place is a set). */
function canonicalPlaces(cells: readonly SelectedCell[]): string[] {
  return [...new Set(cells.map((c) => placeToken(c.place)))].sort();
}

function barredCell(cell: ScopeCell, runbook: ScopeRunbook, catalogue: readonly ScopeRunbook[]): BarredCell {
  const token = placeToken(cell.place);
  const declaring = catalogue.find(
    (rb) => rb.id !== runbook.id && (declaredEnvironments(rb) ?? []).includes(token)
  );
  const declaredIn = declaring ? { runbookId: declaring.id, version: declaring.version } : null;

  // Both halves of the door's promise, and each is read off the data: the
  // specific grant, and the honest state of the runbook that would cover this
  // place. Today, for production, that state is "there isn't one".
  const tail = declaredIn
    ? `${declaredIn.runbookId} v${declaredIn.version} declares it`
    : 'no runbook version declares it';

  return {
    ...cell,
    capability: runbook.capability,
    governDoor: {
      surface: 'settings',
      section: 'capabilities',
      capability: runbook.capability,
      runbookId: runbook.id,
    },
    declaredIn,
    reason: `${runbook.capability} does not run at ${placeLabel(cell.place)}, and ${tail}`,
  };
}

// ---------------------------------------------------------------------------
// The from-line
// ---------------------------------------------------------------------------

/**
 * Resolve the provenance to whatever the host can find for it.
 *
 * Generic in the resolved shape because this module has no opinion about what a
 * comparator render IS — the surface that owns them owns that. Returns null when
 * the lookup finds nothing, and null is the honest answer: a from-line that
 * resolved to a fabricated render would break the one thing provenance is for.
 */
export function resolveScopeFrom<T>(from: ScopeFrom, lookup: (comparatorId: string) => T | null): T | null {
  try {
    return lookup(from.comparatorId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The dry-run assertion — pin 2
// ---------------------------------------------------------------------------

export interface DryRunTargetVerdict {
  ok: boolean;
  /** In the dry-run, not in the scope. This is the re-derivation, caught. */
  unexpected: ScopeCell[];
  /** In the scope, absent from the dry-run. */
  missing: ScopeCell[];
  /** Null when it matched. Never a sentence composed beside a passing verdict. */
  reason: string | null;
}

const cellKey = (cell: ScopeCell): string => `${cell.siteId}|${placeToken(cell.place)}`;

/**
 * Does this dry-run's target set EQUAL the scope's runnable set?
 *
 * Sets, not sequences: order is not a fact about a plan, and asserting on it
 * would fail runs that are correct. Everything else is an inequality worth
 * failing — a barred cell reappearing, an excluded cell reached, a selected cell
 * dropped, or the same site at a place nobody chose.
 */
export function checkDryRunTargets(
  scope: ProcedureScope,
  targets: readonly ScopeCell[]
): DryRunTargetVerdict {
  const expected = new Map(scope.runnable.map((c) => [cellKey(c), c]));
  const got = new Map(targets.map((c) => [cellKey(c), c]));

  const unexpected = [...got].filter(([k]) => !expected.has(k)).map(([, c]) => c);
  const missing = [...expected].filter(([k]) => !got.has(k)).map(([, c]) => c);

  const parts: string[] = [];
  if (unexpected.length) {
    parts.push(
      `${unexpected.length} target${unexpected.length === 1 ? '' : 's'} did not come from the selection ` +
        `(${unexpected.map(describeCell).join(', ')})`
    );
  }
  if (missing.length) {
    parts.push(
      `${missing.length} selected target${missing.length === 1 ? '' : 's'} are absent from the plan ` +
        `(${missing.map(describeCell).join(', ')})`
    );
  }

  return {
    ok: parts.length === 0,
    unexpected,
    missing,
    reason: parts.length ? `${parts.join('; ')}. The arming carried the scope; the plan must not re-derive it.` : null,
  };
}

// ---------------------------------------------------------------------------
// The scope block — pin 3
// ---------------------------------------------------------------------------

/** "Alpha · staging" — the designer's cell rendering, from the two fields. */
function describeCell(cell: ScopeCell): string {
  return `${cell.siteName} · ${placeLabel(cell.place)}`;
}

/**
 * THE FOUR DERIVED LINES, plus the split groups, in one function.
 *
 * ONE renderer, so the selection bar, the companion head and the stage head are
 * byte-identical by construction rather than by three surfaces agreeing to be
 * (XD-15's byte-identity, XD-20's density-invariance). There is no density
 * parameter on purpose: a parameter is a place for the two to differ.
 *
 * Order: the four ratified lines keep their ratified order (targets → places →
 * excludes → from), and the three GROUPS sit in authority order within it
 * (targets → needs-a-grant → excludes). Both constraints hold at once.
 *
 * A group with nothing in it renders NO LINE. "Excludes: none" is a claim and
 * nothing recorded it — the same rule that forbids rendering an unpopulated
 * abort group as a zero.
 */
export function scopeBlockLines(scope: ProcedureScope): string[] {
  const lines: string[] = [];

  lines.push(
    scope.opensRun
      ? `Targets: ${scope.runnable.map(describeCell).join(', ')}`
      : // XD-21: no consequence, no container. The line states the absence; the
        // groups below carry the plan and the door that answers it.
        'Targets: none — nothing in this selection runs under this grant',
  );

  lines.push(`Places: ${scope.places.map(placeTokenLabel).join(', ')}`);

  if (scope.barred.length) {
    // One line per distinct reason: two cells barred for the same reason are one
    // sentence, and two barred for different reasons must not be merged into a
    // sentence that is true of neither.
    for (const reason of [...new Set(scope.barred.map((c) => c.reason))]) {
      const cells = scope.barred.filter((c) => c.reason === reason);
      lines.push(`Needs a grant: ${cells.map(describeCell).join(', ')} — ${reason}`);
    }
  }

  for (const cell of scope.excluded) {
    lines.push(`Excludes: ${describeCell(cell)} — ${cell.reason}`);
  }

  lines.push(`From: ${scope.from.comparatorId} — ${scope.from.filter}`);
  return lines;
}

/** The places line is human-facing, so the tokens render in the human vocabulary. */
function placeTokenLabel(token: string): string {
  const [host, ...rest] = token.split('_');
  if (host === 'local') return 'local';
  const kind = rest.join('_');
  if (!kind) return token;
  return host === 'external' ? `external ${kind}` : kind;
}
