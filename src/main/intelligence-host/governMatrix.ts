/**
 * WP-44 · THE GOVERN MATRIX — M7's derivation, and the control a grant is made AT.
 *
 * XD-25's surface: seven rows, one per capability the registry serves, every
 * fact on them derived. This module is the whole derivation; the renderer that
 * draws it computes nothing and holds no copy of its own.
 *
 * WHY THE ROW SET IS THE REGISTRY'S AND NOT THE RESOLVER'S. It would be natural
 * to build rows from `resolveCapabilityGrants`, which returns `grants` and
 * `disarmed` and looks like it covers the space. It does not. The two GUIDED
 * capabilities appear in NEITHER list — strict-only materialization never names
 * them (WP-20f) and no settings entry covers them — so a matrix built on the
 * resolver alone silently drops two of the seven rows. That is precisely the
 * absence the sheet forbids ("no hiding of ungranted capabilities: a capability
 * with no grant is a row, because a row is the only thing a user can act on").
 * The registry supplies the rows; the grant record only COLOURS them.
 *
 * WHY EVERY COLUMN IS DERIVED RATHER THAN AUTHORED, and what that buys. The
 * ratified pin on the gates column is not its wording — it is the property that
 * *the column moves when the document does*. `gatesForRunbook` reads the
 * checkpoints and nothing else, so authoring an attestable checkpoint into a law
 * document changes this surface with no code change at all. `governMatrix.test.ts`
 * drives exactly that: it copies `law/` to a temp directory, adds one
 * `attest: event` checkpoint, rebuilds the registry, and asserts the column
 * moved. A surface that hardcoded the sheet's numbers would pass a screenshot
 * test and fail the only test that matters.
 *
 * THE SHEET IS ALREADY STALE, ON PURPOSE. It drew `cap.promote_environment` as
 * `rb.promotion-execute · 1.1.0 · sha256:d5fa9bc67d`; WP-20g bumped that document
 * to 1.2.0 and its hash changed with it. This module renders 1.2.0. If you are
 * comparing the running surface to the sheet and find a difference in a version
 * or a hash, the sheet is the snapshot and the surface is the fact.
 *
 * NO CONVERSATIONAL ROUTE, and it is structural rather than promised. Nothing in
 * this module is reachable from a tool, an ability, or the chat assembler: it is
 * not registered in any tool registry, it takes no model-authored input, and the
 * only callers are the two IPC channels the Settings surface owns. XD-8's rule —
 * consent that must be recorded is made at a control, never elicited in chat — is
 * kept by there being no path, not by a check that refuses one.
 */
import type { Runbook, RunbookCheckpoint, RunbookRegistry } from '../../intelligence';
import type { CapabilityGrantSetting, NexusSettings } from '../../common/types';
import type { IntelligenceCore } from './bootstrap';
import { STORAGE_KEYS } from '../../common/constants';
import {
  DisarmReason,
  MATERIALIZED_STORAGE_KEY,
  readGrantIssuance,
  requiresExplicitGrant,
  resolveCapabilityGrants,
  syncCapabilityGrants,
} from './capabilityGrants';
import { governDoorFor, GovernDoorTarget } from './sequenceGuard';

// ---------------------------------------------------------------------------
// The vocabulary (Controlled Vocabulary v1.3, ratified 2026-08-19)
// ---------------------------------------------------------------------------

/**
 * The seven human labels, RATIFIED as vocabulary rows rather than authored here.
 *
 * `docs/intelligence/user-docs/your-copy-and-the-live-site.md` §"v1.3 additions"
 * is the source, and `governMatrixVocabulary.test.ts` re-reads that table on
 * every run and requires this map to equal it — the same transcription pin the
 * journey specs carry, for the same reason. These are, in the designer's words,
 * "the most consequential words on the surface": the refusals cite ids, and a
 * label that drifted from the ratified table would rename a permission.
 *
 * THE ID IS NEVER REPLACED BY THE LABEL. It renders in mono beside it — the
 * ratification's own condition, because the refusals speak ids and a matrix that
 * hides the id breaks the door's vocabulary.
 *
 * A capability with NO ratified label renders its id alone. Inventing a
 * friendlier name at render time is the one thing the absences list names twice.
 */
export const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'cap.bulk_plugin_update': 'Update plugins across sites',
  'cap.incident_containment': 'Contain an incident',
  'cap.incident_remediation': 'Remediate an incident',
  'cap.promotion_preflight': 'Check a promotion before it runs',
  'cap.promote_environment': 'Promote one environment to another',
  'cap.wpe_pull': 'Pull a site from WP Engine',
  'cap.diagnose_site': 'Diagnose a site',
});

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The five states, as drawn.
 *
 * `materialized` and `granted-by-you` are BOTH granted — they differ in which
 * act put the capability in the live set, which is the difference the deny-flip
 * exists to make visible. `disarmed` is granted AND NOT IN FORCE, never denied.
 * `never-by-default` is the mandated-explicit disclosure. `denied` is served and
 * ungranted.
 */
export type GovernState =
  | 'materialized'
  | 'granted-by-you'
  | 'disarmed'
  | 'never-by-default'
  | 'denied';

/** What the row's ceremony reads as. Derived from the mandate and the strictness. */
export type GovernCeremony = 'strict procedure' | 'guided procedure' | 'production consequence';

export interface GovernDocument {
  runbookId: string;
  version: string;
  strictness: string;
  /** `sha256:` + the first 10 hex characters — the pin as a person reads it. */
  hashShort: string;
  /** The whole pin, for a reader who needs to compare it to a document. */
  hash: string;
  /** The grant's pinned hash no longer matches the file on disk. */
  mismatch: boolean;
}

export interface GovernGates {
  kind: 'strict' | 'guided';
  attestable: number;
  checkpoints: number;
  steps: number;
}

export interface GovernIssuance {
  /** The `control.grant.issued` event this grant was announced by. */
  eventId: string;
  issuedAt: string;
}

export interface GovernDisarm {
  reason: DisarmReason;
  detail?: string;
  /** The band's own words. */
  band: string;
  /** The band's door, in the vocabulary the ruling gave it. */
  doorLabel: string;
}

export interface GovernRow {
  capability: string;
  /** The v1.3 label, or the id when no row ratifies one. */
  label: string;
  /** Always rendered, in mono, beside the label. Never replaced by it. */
  id: string;
  ceremony: GovernCeremony;
  state: GovernState;
  /** The chip's word. */
  chip: string;
  /** The state's own sentence — an event citation when there is one, a reason otherwise. */
  stateLine: string;
  /**
   * The SWITCH's position, which renders CONSENT and not force.
   *
   * A disarmed grant renders its switch ON: the user granted this and nothing
   * they did withdrew it. Rendering it off would be the platform quietly
   * revoking on the user's behalf (ruling 3).
   */
  consent: boolean;
  /** Whether the capability is IN FORCE. Never the switch's input. */
  inForce: boolean;
  issuance: GovernIssuance | null;
  document: GovernDocument | null;
  /** The document column, assembled. */
  documentLine: string;
  gates: GovernGates;
  /**
   * The gates column, in order. Never softened, and identical in force on a
   * granted row and a denied one.
   */
  gatesLines: string[];
  disarm: GovernDisarm | null;
  /** Where a refusal's door lands. Absent only when nothing serves the capability. */
  door: GovernDoorTarget | null;
}

export interface GovernMatrix {
  /** The chrome above the table, ratified verbatim. */
  preamble: string;
  rows: GovernRow[];
}

/**
 * The sentence above the table, from the sheet, verbatim.
 *
 * It is the deny-flip in one line, and it is why there is no "recommended set"
 * anywhere on this surface: nothing is granted because a document exists.
 */
export const GOVERN_PREAMBLE =
  'Nothing here is granted because a document exists. A capability arrives denied, ' +
  'and becomes granted only by an act recorded on this list.';

// ---------------------------------------------------------------------------
// The gates column — derived from the checkpoints, and from nothing else
// ---------------------------------------------------------------------------

/** Checkpoints the ledger can prove. Same rule the refusal uses (`sequenceGuard`). */
function isAttestable(checkpoint: RunbookCheckpoint): boolean {
  return checkpoint.attest === 'event' || checkpoint.attest === 'manifest';
}

export function gatesForRunbook(runbook: Runbook): GovernGates {
  return {
    kind: runbook.strictness === 'strict' ? 'strict' : 'guided',
    attestable: runbook.checkpoints.filter(isAttestable).length,
    checkpoints: runbook.checkpoints.length,
    steps: runbook.steps.length,
  };
}

/**
 * What granting this capability would actually gate, in the ratified words.
 *
 * THE LONG FORM RENDERS ON EVERY ZERO-ATTESTABLE ROW, not only the first.
 * The sheet spells the consequence out once and shortens it on the next three
 * rows, which is a reader's economy in a static drawing. Reproducing that would
 * make a row's copy depend on WHICH OTHER ROWS EXIST — the column would stop
 * being a function of the document, and the property the ruling made load-bearing
 * would be the first thing lost. Rendering it everywhere is strictly louder and
 * softer nowhere, so it cannot violate "unsoftened".
 *
 * Every number in here is read off the runbook. Nothing is a literal.
 */
export function gatesLines(gates: GovernGates): string[] {
  if (gates.kind === 'guided') {
    return [
      `${gates.steps} steps, none of them a checkpoint.`,
      'A guided document is adapted as it runs, and deviations are recorded with their reason.',
    ];
  }
  if (gates.attestable === 0) {
    return [
      'The grant itself, and nothing after it.',
      `All ${gates.checkpoints} checkpoints are narrative — the platform can verify none of them, ` +
        'so nothing downstream of this grant is provable.',
    ];
  }
  const narrative = gates.checkpoints - gates.attestable;
  const lines = [`${gates.attestable} of ${gates.checkpoints} checkpoints the platform can verify.`];
  if (narrative > 0) lines.push(`${narrative} are on the agent's account only.`);
  return lines;
}

// ---------------------------------------------------------------------------
// The document column
// ---------------------------------------------------------------------------

/** `sha256:0646cfe11c` — the pin at the length a person compares. */
export function shortHash(hash: string): string {
  const [algo, digest] = hash.split(':');
  if (!digest) return hash;
  return `${algo}:${digest.slice(0, 10)}`;
}

export function documentLineFor(doc: GovernDocument): string {
  const base = `${doc.runbookId} · ${doc.version} · ${doc.strictness} · ${doc.hashShort}`;
  // The mismatch is named IN the document column as well as in the band, because
  // this column is the one a reader checks against the file on disk.
  return doc.mismatch ? `${base} — no longer matches` : base;
}

// ---------------------------------------------------------------------------
// The state column
// ---------------------------------------------------------------------------

/**
 * The ceremony a row reads as.
 *
 * Derived from the MANDATE first and the strictness second, which is the order
 * the sheet draws: `cap.promote_environment` and `cap.incident_remediation` are
 * strict documents, and they read as "production consequence" because that is
 * the fact about them a person weighing a grant needs. Every other row reads as
 * its strictness.
 */
export function ceremonyFor(capability: string, runbook: Runbook): GovernCeremony {
  if (requiresExplicitGrant(capability)) return 'production consequence';
  return runbook.strictness === 'strict' ? 'strict procedure' : 'guided procedure';
}

/**
 * The sentence a NEVER-BY-DEFAULT row carries.
 *
 * ONE SENTENCE FOR BOTH MANDATED ROWS, and the sheet's second one is
 * deliberately not reproduced. It reads "Containment is granted and remediation
 * is not: stopping the bleeding and changing production are two different
 * permissions" — an argument that is true only while `cap.incident_containment`
 * is granted. Revoke containment and that row asserts something false about the
 * platform's own state, on the surface whose entire job is to say what is true
 * about grants. A row may not carry a fact about a DIFFERENT row's state.
 */
const NEVER_BY_DEFAULT_LINE =
  'Production consequence is not a default, so nothing but a grant you make yourself reaches this.';

/**
 * The sentence a DENIED row carries.
 *
 * Rendered in full on both guided rows; the sheet's "as above" on the second is
 * the same reader's economy as the gates column's short form, and the same
 * decision applies — a row's copy may not depend on which other rows exist.
 */
const DENIED_GUIDED_LINE =
  'Guided documents carry no mandatory full-body ride, so nothing materialized this. ' +
  'Grantable by an entry you make.';

/** A strict capability that is served, unmandated, and covered by no grant at all. */
const DENIED_STRICT_LINE =
  'No grant covers this. A capability arrives denied; grantable by an entry you make.';

/**
 * The disarmed band, in the ruled words.
 *
 * NEVER "denied", and the distinction is the ruling: a hash that no longer
 * matches is an INTEGRITY failure — the platform's report about the document —
 * not a permission the user withdrew. The band says "granted, and disarmed",
 * names the reason, and carries the door. Ruling 3 declined a second label on
 * the switch precisely because this band says it better.
 */
export function disarmBand(reason: DisarmReason): { band: string; doorLabel: string } {
  switch (reason) {
    case 'hash-mismatch':
      return {
        band:
          'Granted, and disarmed on an integrity failure. The document on disk is not the one ' +
          'this grant was made against. Not staleness — the review this grant carries happened ' +
          'against different text, so the capability behaves as though it were never granted.',
        doorLabel: 'Re-grant against the current document.',
      };
    case 'disabled-by-settings':
      return {
        band: 'Granted, and switched off by you. The grant stands and nothing else disarmed it.',
        doorLabel: 'Switch it back on.',
      };
    case 'runbook-unavailable':
      return {
        band:
          'Granted, and disarmed because no document serves this capability any more. The ' +
          'runbook was removed, renamed, or refused by the registry, so there is nothing left ' +
          'for the grant to point at.',
        doorLabel: 'Review the documents this grant depends on.',
      };
    case 'requires-explicit-grant':
    default:
      // Not a disarm band at all — this reason is the never-by-default state,
      // and it is handled as a state rather than as a failure. Returning a band
      // for it would render a mandated capability as a broken grant.
      return { band: NEVER_BY_DEFAULT_LINE, doorLabel: '' };
  }
}

/** "18 Aug, 09:12" — local, like every other time this project renders. */
export function formatIssuedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString('en-US', { month: 'short' });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${month}, ${hh}:${mm}`;
}

/**
 * The state line for a granted row: WHICH ACT MADE IT, from its own event.
 *
 * The topic name is rendered verbatim rather than prettified. It is the word the
 * ledger uses, the word the audit trail uses, and the word a person will grep
 * for; a friendlier rendering would be a third name for one thing.
 *
 * A grant with NO issuance record still renders — saying "recorded, event id
 * unavailable" rather than nothing. An emission that failed deliberately leaves
 * the marker unwritten so the next sync re-announces it (WP-20b), so a missing
 * id is a known and temporary state, not a reason to render a granted row as
 * though it had no provenance.
 */
export function grantedStateLine(issuance: GovernIssuance | null): string {
  if (!issuance) return 'control.grant.issued — recorded, event id not yet written back';
  return `control.grant.issued · ${issuance.eventId} · ${formatIssuedAt(issuance.issuedAt)}`;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface MinimalStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * Build the matrix.
 *
 * PURE. No emission, no storage write, no clock beyond formatting a timestamp
 * that was already recorded. `setCapabilityGrant` is the side effect, so this
 * can be read by anything that only wants to know what the surface says.
 *
 * The row set is `runbooks.runbooks()` — every capability the registry SERVES,
 * in the registry's own order. A capability whose document was refused (over the
 * ceiling, duplicate, unhonourable) is not served and gets no row: there is
 * nothing to grant and nothing a person could act on. That is an absence with a
 * cause, not the hiding the absences list forbids.
 */
export function buildGovernMatrix(opts: {
  runbooks: RunbookRegistry;
  settings?: Pick<NexusSettings, 'capabilityGrants'> | null;
  materialized?: readonly string[];
  /** capability → the event that announced its grant. */
  issuance?: Map<string, GovernIssuance>;
}): GovernMatrix {
  const { runbooks } = opts;
  const resolution = resolveCapabilityGrants({
    runbooks,
    settings: opts.settings ?? null,
    materialized: opts.materialized,
  });
  const granted = new Map(resolution.grants.map((g) => [g.capability, g]));
  const disarmed = new Map(resolution.disarmed.map((d) => [d.capability, d]));
  const issuance = opts.issuance ?? new Map<string, GovernIssuance>();

  const rows = runbooks.runbooks().map((rb): GovernRow => {
    const capability = rb.capability;
    const grant = granted.get(capability);
    const off = disarmed.get(capability);
    const gates = gatesForRunbook(rb);
    const issued = issuance.get(capability) ?? null;

    // The document column is the RUNBOOK's, always — the file that is on disk
    // now. A grant pinned to a different hash does not change which document
    // serves the capability; it changes whether the grant is in force, which is
    // the mismatch flag and the band, not this column.
    const mismatch = off?.reason === 'hash-mismatch';
    const document: GovernDocument = {
      runbookId: rb.id,
      version: rb.version,
      strictness: rb.strictness,
      hash: rb.hash,
      hashShort: shortHash(rb.hash),
      mismatch,
    };

    const state = stateFor(capability, !!grant, grant?.source, off?.reason);
    const band = off && state === 'disarmed' ? disarmBand(off.reason) : null;

    return {
      capability,
      label: CAPABILITY_LABELS[capability] ?? capability,
      id: capability,
      ceremony: ceremonyFor(capability, rb),
      state,
      chip: CHIP_WORDS[state],
      stateLine: stateLineFor(state, issued, rb, off?.reason),
      // CONSENT, not force: a disarmed grant's switch is ON.
      consent: state === 'materialized' || state === 'granted-by-you' || state === 'disarmed',
      inForce: !!grant,
      issuance: issued,
      document,
      documentLine: documentLineFor(document),
      gates,
      gatesLines: gatesLines(gates),
      disarm: band ? { reason: off!.reason, ...(off!.detail ? { detail: off!.detail } : {}), ...band } : null,
      door: governDoorFor(capability, rb.id),
    };
  });

  return { preamble: GOVERN_PREAMBLE, rows };
}

/** The chip's word per state. Neutral for granted and denied; the two loud ones are loud. */
const CHIP_WORDS: Readonly<Record<GovernState, string>> = Object.freeze({
  materialized: 'Granted',
  'granted-by-you': 'Granted',
  disarmed: 'Disarmed',
  'never-by-default': 'Never by default',
  denied: 'Denied',
});

/**
 * Which of the five states a row is in.
 *
 * DISARMED IS THE PLATFORM'S REPORT ABOUT THE DOCUMENT, AND NOTHING ELSE.
 * `resolveCapabilityGrants` returns four disarm reasons and they do not all mean
 * the same thing — the ruling on the switch is what separates them. `hash-mismatch`
 * and `runbook-unavailable` are things the PLATFORM observed about a document
 * the user still consents to: the grant stands, it is not in force, the switch
 * stays on. `disabled-by-settings` is the opposite fact — the user themselves
 * withdrew consent — and rendering it as `disarmed` would leave the switch ON
 * for a capability its owner had just switched OFF, which is the ruling read
 * backwards. It is ungranted, and the switch says so.
 *
 * `requires-explicit-grant` is a STATE, not a disarm: nothing was granted, so
 * nothing was disarmed. Folding it into `disarmed` would render the two
 * production capabilities as broken grants rather than as the disclosed,
 * actionable rows XD-8 asks for.
 *
 * The mandate outranks the plain denial in the last two branches, so a
 * production capability a user granted and then revoked returns to reading
 * "Never by default" rather than to a bare "Denied". The mandate did not stop
 * being true while the grant existed.
 */
export function stateFor(
  capability: string,
  isGranted: boolean,
  source: 'shipped' | 'settings' | undefined,
  disarmReason: DisarmReason | undefined
): GovernState {
  if (isGranted) return source === 'settings' ? 'granted-by-you' : 'materialized';
  if (disarmReason === 'hash-mismatch' || disarmReason === 'runbook-unavailable') return 'disarmed';
  return requiresExplicitGrant(capability) ? 'never-by-default' : 'denied';
}

function stateLineFor(
  state: GovernState,
  issued: GovernIssuance | null,
  rb: Runbook,
  disarmReason: DisarmReason | undefined
): string {
  switch (state) {
    case 'materialized':
    case 'granted-by-you':
    case 'disarmed':
      return grantedStateLine(issued);
    case 'never-by-default':
      return NEVER_BY_DEFAULT_LINE;
    case 'denied':
    default:
      // A row the USER switched off says so. The generic denial would be true
      // but useless here: "no grant covers this" reads as something that never
      // happened, on a row where something did — and the difference is the one
      // a person needs to see their own act reflected back.
      if (disarmReason === 'disabled-by-settings') {
        return 'Revoked by you. Grantable again from this row.';
      }
      return rb.strictness === 'guided' ? DENIED_GUIDED_LINE : DENIED_STRICT_LINE;
  }
}

/**
 * Where a refusal's door lands: THE ROW, never the top of Settings.
 *
 * J-Refusal's deep-link criterion, and the reason the target is structured
 * rather than a URL (ruled at WP-31). A door naming a document the capability is
 * no longer served by still lands on the capability's row — the row is where the
 * remedy is, and refusing to land because a version moved would send a person to
 * the top of Settings, which is the exact failure the criterion names.
 */
export function resolveGovernDoor(matrix: GovernMatrix, door: GovernDoorTarget | null | undefined): GovernRow | null {
  if (!door || door.surface !== 'settings' || door.section !== 'capabilities') return null;
  return matrix.rows.find((r) => r.capability === door.capability) ?? null;
}

// ---------------------------------------------------------------------------
// The act
// ---------------------------------------------------------------------------

export interface GovernActResult {
  ok: boolean;
  /** Why an act was refused. Never a thrown error — this seam degrades. */
  reason?: 'no-core' | 'not-served' | 'unwritable';
  matrix: GovernMatrix | null;
}

/**
 * Issue or revoke a grant, AT THE CONTROL.
 *
 * THIS IS THE WHOLE OF PIN 8 AND HALF OF J-REFUSAL'S EXCURSION CRITERION, and
 * the shape is deliberate in three ways.
 *
 * ONE CAPABILITY PER CALL. There is no list parameter and no "grant all"
 * anywhere in this module. The absences list gives the reason and it is not
 * ergonomic: "a widening is one capability at a time because that is the unit a
 * person can weigh". A batch parameter here would be the seed of a bulk enable
 * even if no caller used one today.
 *
 * IT GOES THROUGH WP-20b'S PRODUCER, and does not emit anything itself. The act
 * writes the settings overlay and calls `syncCapabilityGrants`, which is the ONE
 * thing allowed to emit `control.grant.issued` / `control.grant.revoked`. So a
 * grant made here is recorded by the same producer, with the same change gate,
 * as a grant made any other way — and the row can then state which act made it
 * from the grant's own event, because the event genuinely exists. Emitting from
 * here would have been fewer moving parts and a second producer for one topic.
 *
 * A GRANT PINS THE DOCUMENT IT WAS MADE AGAINST. `runbookId` and `runbookHash`
 * are written from the runbook serving the capability at the moment of the act.
 * That is what makes the disarmed state reachable and meaningful later: the
 * hash-mismatch band says "the review this grant carries happened against
 * different text", which is only true if the grant recorded which text. It is
 * also what makes the disarmed row's door — "Re-grant against the current
 * document" — an act with a consequence rather than a no-op.
 *
 * THE MANDATED CAPABILITIES ARE GRANTABLE HERE, and that is the point rather
 * than a gap. WP-20f's ruling is that production consequence is never a DEFAULT
 * and reaches the live set only through "an explicit settings entry — a grant a
 * person made". This control is where a person makes one. The gates column is
 * what keeps that honest: at the time of writing all four attestation-free
 * strict runbooks tell a granter, in the same row, that the grant gates itself
 * and nothing after it.
 *
 * NON-FATAL, like everything on this seam. No core, an unserved capability, or
 * unwritable storage each return a reason; nothing throws into the IPC caller.
 */
export function setCapabilityGrant(opts: {
  core: IntelligenceCore | undefined;
  storage: MinimalStorage;
  logger: { info: (m: string) => void; error: (m: string, ...a: unknown[]) => void };
  capability: string;
  /** true issues, false revokes. */
  grant: boolean;
}): GovernActResult {
  const { core, storage, logger, capability, grant } = opts;
  try {
    const runbooks = core?.law?.runbooks;
    if (!core || !runbooks) return { ok: false, reason: 'no-core', matrix: null };

    const rb = runbooks.byCapability(capability);
    // A grant for a capability nothing serves is not a grant, it is a string in
    // a settings file. Refused rather than written: the surface only ever offers
    // rows the registry serves, so reaching this means the request did not come
    // from the surface.
    if (!rb) return { ok: false, reason: 'not-served', matrix: readGovernMatrix({ core, storage }) };

    const settings = (readSettings(storage) ?? {}) as NexusSettings;
    const existing = Array.isArray(settings.capabilityGrants) ? settings.capabilityGrants : [];
    const entry: CapabilityGrantSetting = grant
      ? { capability, enabled: true, runbookId: rb.id, runbookHash: rb.hash }
      : { capability, enabled: false };
    const next = [...existing.filter((e) => e?.capability !== capability), entry];

    try {
      storage.set(STORAGE_KEYS.SETTINGS, { ...settings, capabilityGrants: next });
    } catch (err) {
      // The act did not happen. Reporting success here would leave a person
      // believing they had granted something, which on this surface is the one
      // lie with a production consequence.
      logger.error(`[Intelligence] capability grant write failed for ${capability}: ${(err as Error).message}`);
      return { ok: false, reason: 'unwritable', matrix: readGovernMatrix({ core, storage }) };
    }

    // WP-20b's producer, unchanged in role. This is what emits the control
    // event, and it is what makes the widening visible and revocable rather
    // than merely configured.
    //
    // WP-45 · IT CARRIES THE REASON, because only this caller knows it. The
    // producer stamped `materialized` on every first issuance, including the
    // one a person makes right here — WP-44's gate found it, and a
    // `control.grant.issued` that calls a human act a migration misdescribes
    // that act in the compliance record. Scoped to the ONE capability this act
    // touched: a sync re-resolves the whole set, and a reason applied to the
    // call would put this person's word on grants they did not make.
    syncCapabilityGrants({
      core,
      storage,
      logger: { ...logger, warn: logger.info },
      ...(grant ? { issueReasons: new Map([[capability, 'granted-at-control' as const]]) } : {}),
    });
    logger.info(`[Intelligence] capability ${grant ? 'granted' : 'revoked'} at the control: ${capability}`);

    return { ok: true, matrix: readGovernMatrix({ core, storage }) };
  } catch (err) {
    logger.error(`[Intelligence] capability grant act failed (non-fatal): ${(err as Error).message}`);
    return { ok: false, reason: 'no-core', matrix: null };
  }
}

/**
 * The matrix as the running process sees it — the read half of the surface.
 *
 * Reads the same three inputs the resolver does (registry, settings overlay,
 * materialized marker) plus the issuance marker, so the rows a person sees are
 * the grants the gate is actually applying. Returns null rather than an empty
 * matrix when there is no core: no rows and "seven rows, all denied" are
 * different claims, and only one of them is true when the law registry is dark.
 */
export function readGovernMatrix(opts: {
  core: IntelligenceCore | undefined;
  storage: MinimalStorage;
}): GovernMatrix | null {
  const runbooks = opts.core?.law?.runbooks;
  if (!runbooks) return null;
  return buildGovernMatrix({
    runbooks,
    settings: readSettings(opts.storage),
    materialized: readMaterialized(opts.storage),
    issuance: readGrantIssuance(opts.storage),
  });
}

function readSettings(storage: MinimalStorage): NexusSettings | null {
  try {
    const raw = storage.get(STORAGE_KEYS.SETTINGS);
    return raw && typeof raw === 'object' ? (raw as NexusSettings) : null;
  } catch {
    return null;
  }
}

/**
 * The materialized capability list, read the way the resolver reads it.
 *
 * ABSENT MEANS ABSENT, never "grant everything": the whole of WP-20f's deny-flip
 * is that there is no argument to the resolver that makes a document grant
 * itself, and a reader here that defaulted to the shipped strict set would put
 * that argument back.
 */
function readMaterialized(storage: MinimalStorage): readonly string[] | undefined {
  try {
    const raw = storage.get(MATERIALIZED_STORAGE_KEY) as { capabilities?: unknown } | null;
    if (raw && Array.isArray(raw.capabilities)) {
      return raw.capabilities.filter((c): c is string => typeof c === 'string');
    }
  } catch {
    /* unreadable = absent, exactly as the resolver treats it */
  }
  return undefined;
}
