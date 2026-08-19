/**
 * WP-32 · the renderer's half of the scope seam.
 *
 * `src/main/intelligence-host/procedureScope.ts` is the ONLY source of
 * derivations over a scope. This module derives nothing: it MIRRORS the two
 * pure functions a surface needs (`scopeBlockLines`, `placeLabel`) and holds the
 * fixture selection the surfaces are built against while the comparator that
 * will produce real ones does not exist yet.
 *
 * WHY A MIRROR AND NOT AN IMPORT. Same reason, measured the same way, as
 * `procedureModel.ts`'s: a VALUE import from `src/main/intelligence-host/` pulls
 * the intelligence core and, through it, `better-sqlite3` into the renderer's
 * require graph — a native module with the wrong ABI, thrown at panel load, into
 * a surface that predates the intelligence layer. `procedureScope.ts` happens to
 * be pure today (every one of its imports is `import type`), and that is exactly
 * why the mirror must stay: purity is one careless value-import away from being
 * false, and nothing would fail until a user opened the panel.
 *
 * `tests/unit/renderer/scopeBlock.test.ts` runs both copies over one shared case
 * table. That is this repo's answer to "one rule, two bundles that cannot share
 * a runtime" — `localDay`, `resolveAgentCron`/`effectiveCadenceExpression`, and
 * `ATTEST_WORDS` are the three standing precedents. Do not "remove the
 * duplication": the duplication is the point and the case table is what makes it
 * safe.
 *
 * XD-15 · ONE RENDERER, THREE SURFACES. `scopeBlockLines` is called by the
 * selection bar, the companion head and the stage head, and by nothing else.
 * There is no density parameter, deliberately — a parameter is a place for the
 * three to differ, and byte-identity is the pin.
 */
import type {
  ProcedureScope,
  ScopeCell,
  ScopeFrom,
  ScopePlace,
  ScopeSelection,
  SelectedCell,
} from '../../../main/intelligence-host/procedureScope';

export type { ProcedureScope, ScopeCell, ScopeFrom, ScopePlace, ScopeSelection, SelectedCell };

// ---------------------------------------------------------------------------
// The mirror (pinned to procedureScope by the shared case table — see header)
// ---------------------------------------------------------------------------

/** What a human is shown for a place. Verbatim from the seam. */
export function placeLabel(place: ScopePlace): string {
  if (place.host === 'local') return 'local';
  return place.host === 'external' ? `external ${place.kind}` : place.kind;
}

/** "Alpha · staging". Verbatim from the seam. */
export function describeCell(cell: ScopeCell): string {
  return `${cell.siteName} · ${placeLabel(cell.place)}`;
}

function placeTokenLabel(token: string): string {
  const [host, ...rest] = token.split('_');
  if (host === 'local') return 'local';
  const kind = rest.join('_');
  if (!kind) return token;
  return host === 'external' ? `external ${kind}` : kind;
}

/**
 * THE FOUR DERIVED LINES, plus the split groups. Verbatim from the seam.
 *
 * The four ratified lines keep their order (targets → places → excludes → from)
 * and the three groups sit in authority order within it (targets →
 * needs-a-grant → excludes). A group with nothing in it renders NO line: an
 * absence is never a zero.
 */
export function scopeBlockLines(scope: ProcedureScope): string[] {
  const lines: string[] = [];

  lines.push(
    scope.opensRun
      ? `Targets: ${scope.runnable.map(describeCell).join(', ')}`
      : 'Targets: none — nothing in this selection runs under this grant',
  );

  lines.push(`Places: ${scope.places.map(placeTokenLabel).join(', ')}`);

  if (scope.barred.length) {
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

// ---------------------------------------------------------------------------
// Copy rules the surface owns
// ---------------------------------------------------------------------------

/**
 * The three places this block renders, named. Not a density: XD-20 makes
 * density a rendering choice and never a factual one, and this block's FACTS are
 * identical at all three by construction — the surfaces differ only in the frame
 * they draw around the same lines.
 */
export const SCOPE_BLOCK_SURFACES = ['selection-bar', 'companion-head', 'stage-head'] as const;
export type ScopeBlockSurface = (typeof SCOPE_BLOCK_SURFACES)[number];

/**
 * Whether a barred group has a door to offer. Always true when something is
 * barred — WP-31's refusal contract puts the door on every refusal from birth,
 * and this block consumes the same contract from the other end.
 */
export function hasGovernDoor(scope: ProcedureScope): boolean {
  return scope.barred.length > 0;
}

// ---------------------------------------------------------------------------
// The fixture selection (the fake-emitter pattern, WP-27's precedent)
// ---------------------------------------------------------------------------

/**
 * The designer's draft-2 sheet as a real `ScopeSelection`: three staging cells
 * that run, two production cells the anchor runbook's scope refuses, one halted
 * site the world removed.
 *
 * A FIXTURE, and it says so. The comparator surface that will produce real
 * selections is the designer's cycle-one/two seam and a later packet; this is
 * how WP-27 built the procedure surfaces against `procedureStream.fake.ts`
 * before anything emitted. What it is NOT is authored procedure — it authors a
 * SELECTION (which cells a human clicked), never a checkpoint list, which is the
 * thing pin 7 forbids.
 */
export const FIXTURE_SELECTION: ScopeSelection = {
  from: {
    surface: 'comparator',
    comparatorId: 'cmp.fleet-plugins',
    filter: 'plugin=woocommerce outdated=true',
  },
  cells: [
    { siteId: 's.alpha', siteName: 'Alpha', place: { host: 'wpe', kind: 'staging' } },
    { siteId: 's.bravo', siteName: 'Bravo', place: { host: 'wpe', kind: 'production' } },
    { siteId: 's.charlie', siteName: 'Charlie', place: { host: 'wpe', kind: 'staging' } },
    { siteId: 's.delta', siteName: 'Delta', place: { host: 'wpe', kind: 'production' } },
    { siteId: 's.echo', siteName: 'Echo', place: { host: 'wpe', kind: 'staging' } },
    {
      siteId: 's.foxtrot',
      siteName: 'Foxtrot',
      place: { host: 'wpe', kind: 'staging' },
      excluded: {
        reason: 'halted, and said so',
        causedBy: {
          recordId: 'ev.7f31',
          topic: 'site.status.observed',
          observedAt: '2026-08-18T09:04:00.000Z',
        },
      },
    },
  ],
};
