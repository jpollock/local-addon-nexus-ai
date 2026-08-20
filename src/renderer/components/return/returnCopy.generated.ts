/**
 * GENERATED — DO NOT EDIT. `npm run fixtures:return-copy`.
 *
 * WP-46 · the ratified M6 copy (XD-26), extracted verbatim from the designer's
 * own files by `scripts/generate-return-copy.ts`. Every string below is a
 * substring of one of these two, or a mechanical split of one:
 *
 *   docs/intelligence/from-designer/fixtures/scenario-return.js
 *   docs/intelligence/from-designer/from-designer-09-return-arrival.md
 *
 * Editing this file by hand is the defect the generator exists to prevent: it
 * would make the surface a SECOND place the ratified wording lives, free to
 * drift from the sheet that ratified it. `npm run fixtures:return-copy:check`
 * fails closed on a stale copy.
 *
 * The `_PREFIX`/`_SUFFIX` pairs are ratified sentences split on the SCENARIO
 * value they carry ("12 hours", "yesterday, 12:11", "41"), so the product can
 * substitute a derived one without any of the designer's words being retyped.
 */

export const RETURN_COPY_SHAPE_VERSION = 1;

/** The vocabulary's own separator, as the accounting line uses it. */
export const SEP = ' · ';

export const RETURN_COPY = {
  ACCOUNTING_CHANGED: 'changed overnight',
  ACCOUNTING_DARK: 'checks dark',
  ACCOUNTING_NEEDS_YOU: 'need you',
  AWAY_PREFIX: 'You were away ',
  AWAY_SUFFIX: '',
  AWAY_UNIT: 'hours',
  CHANGED_HEAD: 'Changed while you were away',
  DRIFT_COUNTED: 'facts are past their freshness window.',
  DRIFT_REST: 'Nothing is needed of anyone, so nothing is in this list — each one carries its own date where it lives.',
  FILED_BEFORE_YOU_ARRIVED: 'Filed before you arrived — the record was written when the run finished, not when you opened this. Nothing here is composed on demand.',
  GATE_IN: ' in ',
  GATE_OF: ' of ',
  GATE_POSITION_SEP: ' — ',
  GATE_PREFIX: 'Waiting at ',
  OPENED_PREFIX: 'Opened ',
  PARTS_CHIP: 'parts · one situation',
  REENTRY_GATE_HEAD: 'The gate now',
  REENTRY_STANDING_HEAD: 'The standing approval',
  RESERVED_HEAD: 'Reserved · the record’s own health',
  RESUMED: 'Resumed where it stopped · nothing re-derived, nothing re-asked',
  ROW_DOOR: 'Open where you are needed.',
  STANDING_APPROVAL_PREFIX: 'You approved this plan ',
  STANDING_APPROVAL_SUFFIX: '. That approval still stands — you are not being asked again.',
  UNKNOWN_ARM_BODY: 'The arming record for it is not in the ledger this session can reach, so the checkpoints, the document and the attest words cannot be shown. Nothing here is armed now: no write can be made under this session, and the run it belonged to is intact in the record.',
  UNKNOWN_ARM_DOOR: 'Find this run in the record',
  UNKNOWN_ARM_LEAD: 'This session was running a procedure, and the platform can no longer say which',
  UNKNOWN_ARM_OFFER: 'Start a new run from the same selection',
  WAITING_HEAD: 'Waiting on you',
} as const;
