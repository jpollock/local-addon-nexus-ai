/**
 * WP-27 · the fake procedure emitter — a SOURCE, never a shape.
 *
 * WP-26 owns emission host-side; this packet owns the surfaces. So the surfaces
 * are built against a local emitter that produces the same three shapes from
 * fixture data, and when WP-26's real emitter lands the swap is a change of
 * subscription: `PanelChat.onStreamEvent` already folds anything shaped like these
 * three events through `applyProcedureEvent`, from whatever source delivers it.
 * `procedureModel.test.ts` pins that literally — the same events applied by hand
 * and delivered by this emitter produce the identical state.
 *
 * The fixtures are LITERAL data, not calls into `procedureView`: this module is
 * importable from the renderer during development, and the seam reaches the
 * intelligence core and its native sqlite (see `procedureModel.ts`'s header). The
 * cost of literal fixtures is drift, so a test derives a real `DeclaredProcedure`
 * through `deriveDeclaredProcedure` and pins this fixture's key set against it.
 *
 * The run modelled here is the anchor capability's: `rb.bulk-plugin-update`, eight
 * checkpoints, four of them narrative — the exact shape that makes the P7 ruling
 * bite, and the exact shape a uniform green rail would lie about.
 */
import type {
  CheckpointChangedEvent,
  CheckpointState,
  ProcedureAbortedEvent,
  ProcedureArmedEvent,
  ProcedureStreamEvent,
} from './procedureModel';

function cp(
  id: string,
  attest: CheckpointState['attest'],
  reason: string | null,
  over: Partial<CheckpointState> = {},
): CheckpointState {
  return {
    id,
    status: 'pending',
    attest,
    verified: false,
    reason,
    source: 'runbook',
    unrequested: false,
    evidence: { summary: over.status ? '' : ATTEST_SUMMARY[attest] },
    ...over,
  };
}

/** What `deriveCheckpointStates` writes into an un-reached checkpoint's evidence. */
const ATTEST_SUMMARY: Record<CheckpointState['attest'], string> = {
  event: 'the platform can verify this from records',
  manifest: 'the platform can verify this from what it supplied',
  narrative: 'on your account only — the platform cannot verify this',
};

/**
 * The eight, in declared order.
 *
 * **WP-35 · every line here is now the GENERATED fixture's, copied from
 * `docs/intelligence/design-fixtures/declared-procedures.json` and pinned to it
 * by `companionDensity.test.tsx`.** WP-27 wrote this list by hand months before
 * the generator existed, and by the time the generator landed the two had
 * drifted: v1.1.0 against v1.2.0, a different hash, "the rest, watching"
 * against the document's "the rest, watched", and a `cp.report` with no reason
 * against one that has had `close the loop` all along. The designer's own
 * cycle-one hold named the remedy — "the day WP-32's generated file lands we
 * diff the two; byte-match lifts the hold, a divergence is a defect in one of
 * them and we say which." It was a defect in this one.
 *
 * What stays local is the RUN: statuses, evidence ids, the abort's site rows.
 * That is the fold's own line — "only scenario narrative is local" — and it is
 * why this is a fake emitter rather than a second copy of the document.
 *
 * `unrequested` is the runbook's own authored mark (WP-28): four of the eight.
 * `cp.roll-fleet` is unmarked and `cp.canary` is marked although they name the
 * same tool — the pair that proves the badge is read from the document rather
 * than inferred from structure.
 */
function checkpoints(): CheckpointState[] {
  return [
    cp('cp.consult-history', 'manifest', 'has this bitten us before?', { unrequested: true }),
    cp('cp.dry-run', 'narrative', 'show what would change', { unrequested: true }),
    cp('cp.approval', 'event', 'explicit, informed consent'),
    cp('cp.backup', 'event', 'before anything writes'),
    cp('cp.canary', 'narrative', 'one low-risk site first', { unrequested: true }),
    cp('cp.verify-canary', 'narrative', 'prove it before scaling it', { unrequested: true }),
    cp('cp.roll-fleet', 'event', 'the rest, watched'),
    cp('cp.report', 'narrative', 'close the loop'),
  ];
}

export function armedFixture(): ProcedureArmedEvent {
  return {
    type: 'procedure_armed',
    procedure: {
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      version: '1.2.0',
      strictness: 'strict',
      hash: 'sha256:0646cfe11c1b813db994d6c95832ae2c6e97528c3748f7eb2aa44e3c736237c8',
      armedBy: 'predicate',
      checkpoints: checkpoints(),
      verifiableCount: 4,
      communication: [
        'the dry-run diff, before any write',
        'the backup id(s) and verification status',
        'which sites were skipped and why (halted, out of scope, data stale)',
        'the canary site chosen and the reason it was chosen',
      ],
    },
  };
}

function attested(id: string, eventId: string, topic: string): CheckpointState {
  const base = checkpoints().find((c) => c.id === id)!;
  return {
    ...base,
    status: 'attested',
    verified: true,
    evidence: { eventId, topic, summary: `attested by ${eventId} (${topic})` },
  };
}

function active(id: string): CheckpointState {
  const base = checkpoints().find((c) => c.id === id)!;
  return { ...base, status: 'active' };
}

export function checkpointChangedFixtures(): CheckpointChangedEvent[] {
  return [
    {
      type: 'checkpoint_changed',
      changed: [attested('cp.consult-history', 'ev_01hq…a1', 'task.context.assembled'), active('cp.dry-run')],
    },
    {
      type: 'checkpoint_changed',
      changed: [attested('cp.approval', 'ev_01hq…b7', 'task.rationale.recorded'), active('cp.backup')],
    },
    {
      type: 'checkpoint_changed',
      changed: [attested('cp.backup', 'ev_01hq…c2', 'task.action.executed'), active('cp.roll-fleet')],
    },
  ];
}

/**
 * The abort, with the four groups exactly as `deriveAbortGroups` builds them —
 * including the two that the substrate cannot fill, NAMED rather than silently
 * empty. An empty "skipped" reads as "nothing was skipped"; that is a claim.
 */
export function abortedFixture(): ProcedureAbortedEvent {
  return {
    type: 'procedure_aborted',
    abortId: 'ab_01hq7m3k9x',
    checkpointId: 'cp.roll-fleet',
    reason: 'the update failed on alpine-outfitters and the runbook aborts on a failed write',
    groups: {
      done: [
        {
          entityId: 'ent_site_goldenecomm_production',
          result: 'updated',
          outcomeEventId: 'ev_01hq…d4',
          actionEventId: 'ev_01hq…d3',
          observedAt: '2026-08-18T22:33:29.000Z',
          backupEventId: 'ev_01hq…c9',
        },
        {
          entityId: 'ent_site_myloop_production',
          result: 'updated',
          outcomeEventId: 'ev_01hq…e1',
          actionEventId: 'ev_01hq…e0',
          observedAt: '2026-08-18T22:34:02.000Z',
          backupEventId: 'ev_01hq…ca',
        },
      ],
      failed: [
        {
          entityId: 'ent_site_alpine_outfitters_production',
          result: 'failed',
          outcomeEventId: 'ev_01hq…f6',
          actionEventId: 'ev_01hq…f5',
          observedAt: '2026-08-18T22:34:41.000Z',
          backupEventId: 'ev_01hq…cb',
        },
      ],
      skipped: [],
      untouched: [
        { entityId: 'ent_site_psbtest2_production', result: 'untouched' },
        { entityId: 'ent_site_testjppstg_production', result: 'untouched' },
      ],
      unavailable: [
        {
          group: 'skipped',
          reason:
            'no producer records a skip reason: `task.outcome.recorded` carries the call\'s result ' +
            '(success/failure) and no "skipped, and why" outcome exists, so a skipped-site group ' +
            'would be inferred rather than observed',
        },
      ],
      headline: '2 sites already updated and standing; 1 failed; 2 untouched. Stopping here changes none of them.',
    },
    restore: {
      perSite: [
        { entityId: 'ent_site_goldenecomm_production', backupEventId: 'ev_01hq…c9' },
        { entityId: 'ent_site_myloop_production', backupEventId: 'ev_01hq…ca' },
      ],
      note:
        'Restoring a completed site is a separate, gated action taken per site. Aborting does not ' +
        'perform it and never implies it: the sites above are updated and stay that way until ' +
        'someone chooses otherwise.',
    },
  };
}

export interface FakeProcedureStream {
  /** Every event this run will emit, in order — the same list `play()` delivers. */
  events(): ProcedureStreamEvent[];
  subscribe(handler: (event: ProcedureStreamEvent) => void): () => void;
  /** Deliver the run to every subscriber, in order. Resolves when the run is done. */
  play(): Promise<void>;
}

/**
 * A run, as a source. Deliberately dependency-free and synchronous-in-order: the
 * emitter's real job (coalescing one event per checkpoint-state transition, never
 * one per ledger event) is WP-26's, host-side, and a fake that spread the events
 * over timers would let a surface accidentally depend on their timing.
 */
export function fakeProcedureStream(
  script: ProcedureStreamEvent[] = [armedFixture(), ...checkpointChangedFixtures(), abortedFixture()],
): FakeProcedureStream {
  const handlers = new Set<(event: ProcedureStreamEvent) => void>();
  return {
    events: () => script.slice(),
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async play() {
      for (const event of script) {
        for (const handler of [...handlers]) handler(event);
      }
    },
  };
}
