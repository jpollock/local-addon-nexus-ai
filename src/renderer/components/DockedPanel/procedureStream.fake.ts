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
  event: 'verified from records',
  manifest: 'verified as supplied',
  narrative: 'your account only, not verified',
};

/**
 * The eight, in declared order. Reasons are the runbook's own `## cp.x — reason`
 * tails, and `unrequested` is the runbook's own authored mark (WP-28): four of
 * the eight, which is the set the shipped document marks. `cp.roll-fleet` is
 * unmarked and `cp.canary` is marked although they name the same tool — the
 * fixture keeps that pair because it is the one that proves the badge is read
 * from the document rather than inferred from structure.
 */
function checkpoints(): CheckpointState[] {
  return [
    cp('cp.consult-history', 'manifest', 'has this bitten us before?', { unrequested: true }),
    cp('cp.dry-run', 'narrative', 'show what would change', { unrequested: true }),
    cp('cp.approval', 'event', 'explicit, informed consent'),
    cp('cp.backup', 'event', 'before anything writes'),
    cp('cp.canary', 'narrative', 'one low-risk site first', { unrequested: true }),
    cp('cp.verify-canary', 'narrative', 'prove it before scaling it', { unrequested: true }),
    cp('cp.roll-fleet', 'event', 'the rest, watching'),
    // No `## cp.report` heading in the runbook body: a runbook that authored no
    // reason must not be given one.
    cp('cp.report', 'narrative', null),
  ];
}

export function armedFixture(): ProcedureArmedEvent {
  return {
    type: 'procedure_armed',
    procedure: {
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      version: '1.1.0',
      strictness: 'strict',
      hash: 'sha256:9f2c1a7d4e6b0c83a15f2d9e7b4c6081a3d5e7f9b2c4d6e8f0a1b3c5d7e9f1a3',
      armedBy: 'predicate',
      checkpoints: checkpoints(),
      verifiableCount: 4,
      communication: [
        'say which sites are in scope before asking for approval',
        'say what the canary showed before rolling the rest',
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
