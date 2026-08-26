/**
 * The merged permissions pane's derivations (fixes-082526 phase 5) — built to
 * the reissued sheet (docs/handoff/settings-permissions/, both rulings
 * applied). Everything the pane shows is DERIVED here; the component places
 * strings. `permissionsPane.ts` beside this owns the clipped-line rule; this
 * module supplies its inputs from the live surfaces.
 *
 * The vocabulary split, enforced by construction: this module speaks
 * allowed/blocked about the bound (a state) and granted/held about grants
 * (acts) — never both words for one thing.
 */
import type { NexusSettings } from '../../../common/types';
import {
  Bound,
  BoundState,
  deriveClippedLine,
} from './permissionsPane';

// ---------------------------------------------------------------------------
// Layer 1 — the bound
// ---------------------------------------------------------------------------

type Operation = 'pull' | 'wpcli' | 'push' | 'delete';
type EnvKey = 'development' | 'staging' | 'production';

/**
 * One copy of the shipped defaults, transcribed from
 * `operation-permissions.ts` (the gate) — the pane must render what the gate
 * applies. `wpcli_read` is deliberately absent: reading is stated once, not
 * as a row, because it is not a decision.
 */
const BOUND_DEFAULTS: Record<Operation, Record<EnvKey, boolean>> = {
  pull:   { development: true,  staging: true,  production: true  },
  wpcli:  { development: true,  staging: true,  production: false },
  push:   { development: true,  staging: true,  production: false },
  delete: { development: false, staging: false, production: false },
};

/** The customer's words + the transport that carries each operation (the sheet's own rows). */
const BOUND_ROW_SPECS: Array<{ op: Operation; label: string; transport: string }> = [
  { op: 'pull',   label: 'Copy a site down',                 transport: 'WP Engine' },
  { op: 'wpcli',  label: 'Install or update things',        transport: 'WP Engine + SSH' },
  { op: 'push',   label: 'Push local changes up',           transport: 'WP Engine' },
  { op: 'delete', label: 'Delete or promote an environment', transport: 'WP Engine' },
];

const PLACES: Array<{ key: EnvKey; label: string }> = [
  { key: 'development', label: 'your machine' },
  { key: 'staging', label: 'staging' },
  { key: 'production', label: 'production' },
];

export interface BoundView extends Bound {
  /** Stated once, at the top — not a row, because it is not a decision. */
  readingLine: string;
  /** Ruling 2: the bound's other dimension, stated once at its foot. */
  scope: {
    head: string;
    note: string;
    included: string[];
    excluded: string[];
  };
}

export function deriveBoundView(
  settings: Pick<NexusSettings, 'remoteOperationPermissions' | 'wpeWriteExcludedAccounts'>,
  accounts: Array<{ id: string; name: string }> = [],
): BoundView {
  const perms = settings.remoteOperationPermissions as
    | Partial<Record<Operation, Partial<Record<EnvKey, boolean>>>>
    | undefined;

  const rows = BOUND_ROW_SPECS.map((spec) => ({
    op: spec.label,
    transport: spec.transport,
    states: PLACES.map((place): BoundState => {
      const set = perms?.[spec.op]?.[place.key];
      const allowed = set !== undefined ? set : BOUND_DEFAULTS[spec.op][place.key];
      return allowed ? 'allowed' : 'blocked';
    }),
  }));

  // The scope: excluded ids resolve to names where the account list knows
  // them; an unknown id stays VERBATIM — withheld beats dropped, because a
  // scope entry that silently vanished reads as "not excluded".
  const excludedIds = settings.wpeWriteExcludedAccounts ?? [];
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const excluded = excludedIds.map((id) => nameOf.get(id) ?? id);
  const included = accounts.filter((a) => !excludedIds.includes(a.id)).map((a) => a.name);

  return {
    places: PLACES.map((p) => p.label),
    rows,
    readingLine:
      'Reading is always allowed. This limit applies to every capability below, however it is ' +
      'granted — so a grant can be given and still reach nothing in a place this blocks.',
    scope: {
      head: 'Accounts this bound covers',
      note:
        'The bound’s other dimension: places are its columns, accounts are too many to be, ' +
        'so they are stated here. An excluded account refuses every write, whole — a grant ' +
        'reaches an account only if this bound does.',
      included,
      excluded,
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — the grants
// ---------------------------------------------------------------------------

/**
 * Which bound operation each capability NEEDS — the sheet authored this per
 * row; here it exists once, beside the row specs it references. A capability
 * absent from this map needs no write, so no clipped line renders for it.
 */
const CAPABILITY_NEEDS: Record<string, string> = {
  'cap.bulk_plugin_update': 'Install or update things',
  'cap.incident_containment': 'Install or update things',
  'cap.incident_remediation': 'Install or update things',
  'cap.wpe_pull': 'Copy a site down',
  'cap.promote_environment': 'Delete or promote an environment',
};

/** The matrix-row fields this layer reads, structurally (types-only seam discipline). */
export interface MatrixRowLike {
  capability: string;
  label: string;
  ceremony: string;
  state: string;
  chip: string;
  inForce: boolean;
  holders: string[];
  acts: Record<string, { eventId: string; issuedAt: string }>;
  documentLine: string;
  gatesLines: string[];
  disarm: { reason: string; detail?: string } | null;
}

export interface GrantRowView {
  capability: string;
  label: string;
  /** 'strict procedure' / 'guided procedure' — the sheet's confirmed vocabulary. */
  kind: string;
  chip: string;
  holderLine: string;
  documentLine: string;
  gatesLines: string[];
  /** Derived from bound × capability — null when there is nothing to say. */
  clippedLine: string | null;
  disarm: { reason: string; detail?: string } | null;
}

/** One holder names itself; several name the count; none says so. The ruling's own words. */
export function holderLine(holders: string[]): string {
  if (holders.length === 0) return 'no grantee holds this';
  if (holders.length === 1) return `held by ${holders[0]}`;
  return `granted to ${holders.length} grantees`;
}

export function deriveGrantRows(rows: MatrixRowLike[], bound: Bound): GrantRowView[] {
  return rows.map((row) => ({
    capability: row.capability,
    label: row.label,
    kind: `${row.ceremony} procedure`,
    chip: row.chip,
    holderLine: holderLine(row.holders),
    documentLine: row.documentLine,
    gatesLines: row.gatesLines,
    clippedLine: deriveClippedLine(bound, {
      cap: row.capability,
      label: row.label,
      state: row.inForce ? 'granted' : 'denied',
      needs: CAPABILITY_NEEDS[row.capability] ?? '',
    }),
    disarm: row.disarm,
  }));
}
