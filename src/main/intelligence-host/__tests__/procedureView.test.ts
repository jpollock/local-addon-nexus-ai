/**
 * WP-20e · the render seam.
 *
 * Every test here exists to stop a surface CLAIMING something the platform did
 * not observe. The P7 ruling is one sentence — *the rail must never render a
 * narrative checkpoint with a verified tick* — and the tests below are that
 * sentence in every direction it can be violated: by status, by the `verified`
 * flag, by an evidence line, by an audit row, and by a diff between two states.
 */
import {
  AttestClass,
  ProcedureOutcome,
  Runbook,
  RunbookCheckpoint,
} from '../../../intelligence';
import {
  ATTEST_WORDS,
  BADGE_LABEL,
  CANARY_POLICIES,
  DEFAULT_CANARY_POLICY,
  PROCEDURE_AUDIT_COLUMNS,
  checkpointBadge,
  deriveAbortGroups,
  deriveCanaryPolicy,
  deriveCheckpointStates,
  deriveDeclaredProcedure,
  deriveProcedureAudit,
  diffCheckpointStates,
  isVerified,
  procedureAbortedEvent,
  procedureArmedEvent,
} from '../procedureView';
import type { ProcedureCursorState } from '../procedureCursor';

// ---------------------------------------------------------------------------
// Fixtures — shaped like the anchor runbook, four attestable and four not
// ---------------------------------------------------------------------------

function cp(id: string, attest: AttestClass, extra: Partial<RunbookCheckpoint> = {}): RunbookCheckpoint {
  return { id, attest, tools: [], ...extra };
}

const CHECKPOINTS: RunbookCheckpoint[] = [
  cp('cp.consult-history', 'manifest', { evidence: { topic: 'task.context.assembled' } }),
  cp('cp.dry-run', 'narrative'),
  cp('cp.approval', 'event', {
    evidence: { topic: 'task.rationale.recorded', decision: 'approved' },
  }),
  cp('cp.backup', 'event', {
    evidence: { topic: 'task.action.executed', tool: 'wpe_backup_and_verify', perTarget: true },
    tools: [{ name: 'wpe_backup_and_verify' }],
  }),
  cp('cp.canary', 'narrative', { tools: [{ name: 'bulk_plugin_update' }] }),
  cp('cp.verify-canary', 'narrative'),
  cp('cp.roll-fleet', 'event', {
    evidence: { topic: 'task.action.executed', tool: 'bulk_plugin_update' },
    tools: [{ name: 'bulk_plugin_update' }],
  }),
  cp('cp.report', 'narrative'),
];

const BODY = [
  '# Bulk plugin update',
  '',
  '## cp.consult-history — has this bitten us before?',
  'prose',
  '',
  '## cp.dry-run — show what would change',
  'prose',
  '',
  '## cp.approval — explicit, informed consent',
  '',
  '## cp.backup — before anything writes',
  '',
  '## cp.canary — one low-risk site first',
  '',
  '## cp.verify-canary — prove it before scaling it',
  '',
  '## cp.roll-fleet — the rest, watching',
  '',
  // cp.report deliberately has NO heading: a runbook that does not author a
  // reason must not be given one.
].join('\n');

function runbook(over: Partial<Runbook> = {}): Runbook {
  return {
    id: 'rb.bulk-plugin-update',
    version: '1.0.0',
    capability: 'cap.bulk_plugin_update',
    strictness: 'strict',
    path: 'runbooks/bulk-plugin-update.md',
    hash: 'sha256:abc',
    canonicalBytes: 4858,
    checkpoints: CHECKPOINTS,
    steps: [],
    tools: [],
    toolScope: 'advisory',
    body: BODY,
    canonicalText: BODY,
    frontmatter: {
      communication: [
        'the dry-run diff, before any write',
        'the backup id(s) and verification status',
      ],
    },
    ...over,
  };
}

function cursor(over: Partial<ProcedureCursorState> = {}): ProcedureCursorState {
  return {
    attested: [],
    narrative: ['cp.dry-run', 'cp.canary', 'cp.verify-canary', 'cp.report'],
    denied: [],
    fault: false,
    ...over,
  };
}

const DELIVERED: ProcedureOutcome = {
  status: 'delivered',
  capability: 'cap.bulk_plugin_update',
  runbookId: 'rb.bulk-plugin-update',
  version: '1.0.0',
  hash: 'sha256:abc',
  strictness: 'strict',
  armedBy: 'predicate',
  assertFull: true,
  bodyDelivered: true,
  checkpoints: CHECKPOINTS.map((c) => ({ id: c.id, attest: c.attest, attested: false })),
  steps: [],
  tokens: 1215,
};

// ---------------------------------------------------------------------------
// The P7 ruling
// ---------------------------------------------------------------------------

describe('deriveCheckpointStates — a narrative checkpoint is never verified', () => {
  it('never marks a narrative checkpoint attested, even when a cursor claims it', () => {
    // The hostile input: a cursor that lists a narrative checkpoint as attested.
    // Nothing in the platform produces this today; the seam must not trust it
    // if something ever does, because the fold is the only attestation authority
    // and `narrative` means it CANNOT have folded one.
    const states = deriveCheckpointStates(
      runbook(),
      cursor({ attested: ['cp.consult-history', 'cp.dry-run', 'cp.canary'] })
    );

    const dryRun = states.find((s) => s.id === 'cp.dry-run')!;
    expect(dryRun.attest).toBe('narrative');
    expect(dryRun.status).not.toBe('attested');
    expect(dryRun.verified).toBe(false);
    expect(isVerified(dryRun)).toBe(false);

    // …and the attestable one in the same cursor DOES pass, so the test cannot
    // be satisfied by a derivation that simply never attests anything.
    const consult = states.find((s) => s.id === 'cp.consult-history')!;
    expect(consult.status).toBe('attested');
    expect(consult.verified).toBe(true);
  });

  it('isVerified refuses a hand-built state that claims a narrative checkpoint is attested', () => {
    // The derivation cannot produce this. A surface CAN: a state assembled by
    // hand, or replayed from an older payload, reaches `isVerified` directly —
    // and that function is what a tick is rendered from, so it carries the rule
    // itself rather than trusting its caller to have used the derivation.
    expect(
      isVerified({
        id: 'cp.canary',
        status: 'attested',
        attest: 'narrative',
        verified: true,
        reason: null,
        source: 'runbook',
      })
    ).toBe(false);
    expect(
      isVerified({
        id: 'cp.approval',
        status: 'attested',
        attest: 'event',
        verified: true,
        reason: null,
        source: 'runbook',
      })
    ).toBe(true);
  });

  it('nothing is ACTIVE in an aborted run, even before the abort point', () => {
    // An abort at cp.backup with nothing attested: cp.consult-history is the
    // first provable checkpoint and would otherwise be named as the next gate —
    // inviting the actor to carry on with a run that has stopped.
    const states = deriveCheckpointStates(runbook(), cursor(), { abortedAt: 'cp.backup' });
    expect(states.filter((s) => s.status === 'active')).toHaveLength(0);
    expect(states.find((s) => s.id === 'cp.backup')!.status).toBe('aborted');
  });

  it('gives every narrative checkpoint the shipped "not verified" wording', () => {
    // The words are the ones nexus_load_procedure already tells the model. A
    // second vocabulary on the rail would let the transcript and the surface
    // describe the same checkpoint differently.
    expect(ATTEST_WORDS.narrative).toBe('your account only, not verified');
    expect(ATTEST_WORDS.event).toBe('verified from records');
    expect(ATTEST_WORDS.manifest).toBe('verified as supplied');
  });

  it('marks the first unattested ATTESTABLE checkpoint active, skipping narrative ones', () => {
    // Same rule the turn carrier uses for "Next gated checkpoint": naming a
    // narrative checkpoint would tell the actor to clear a gate that does not
    // exist, every turn, forever.
    const states = deriveCheckpointStates(runbook(), cursor({ attested: ['cp.consult-history'] }));
    expect(states.filter((s) => s.status === 'active').map((s) => s.id)).toEqual(['cp.approval']);
    expect(states.find((s) => s.id === 'cp.dry-run')!.status).toBe('pending');
  });

  it('renders a denied checkpoint as aborted, with the denial in its evidence', () => {
    const states = deriveCheckpointStates(
      runbook(),
      cursor({ attested: ['cp.consult-history'], denied: ['cp.approval'] })
    );
    const approval = states.find((s) => s.id === 'cp.approval')!;
    expect(approval.status).toBe('aborted');
    expect(approval.verified).toBe(false);
    expect(approval.evidence?.summary).toMatch(/denied/i);
    // A denial ends the run: nothing after it is "active", waiting to be done.
    expect(states.filter((s) => s.status === 'active')).toHaveLength(0);
  });

  it('carries the runbook\'s own authored reason line, and null when it authored none', () => {
    const states = deriveCheckpointStates(runbook(), cursor());
    expect(states.find((s) => s.id === 'cp.canary')!.reason).toBe('one low-risk site first');
    // No `## cp.report — …` heading in the body: the badge has no reason, and
    // one is not invented.
    expect(states.find((s) => s.id === 'cp.report')!.reason).toBeNull();
  });

  it('badges every declared step as runbook-supplied — the prompt asked for none of them', () => {
    const states = deriveCheckpointStates(runbook(), cursor());
    const badge = checkpointBadge(states.find((s) => s.id === 'cp.backup')!);
    expect(badge.label).toBe(BADGE_LABEL);
    expect(badge.reason).toBe('before anything writes');
    expect(states.every((s) => s.source === 'runbook')).toBe(true);
  });

  it('reports an unreadable ledger as unknown progress, never as "nothing attested"', () => {
    const states = deriveCheckpointStates(runbook(), cursor({ fault: true }));
    expect(states.every((s) => s.status === 'pending')).toBe(true);
    expect(states.every((s) => s.verified === false)).toBe(true);
    // The distinction the fold makes, preserved: a fault is not an empty cursor.
    expect(states.every((s) => /could not be read/i.test(s.evidence?.summary ?? ''))).toBe(true);
  });

  it('marks unattested checkpoints skipped after an abort', () => {
    const states = deriveCheckpointStates(runbook(), cursor({ attested: ['cp.consult-history'] }), {
      abortedAt: 'cp.backup',
    });
    expect(states.find((s) => s.id === 'cp.backup')!.status).toBe('aborted');
    expect(states.find((s) => s.id === 'cp.roll-fleet')!.status).toBe('skipped');
    expect(states.find((s) => s.id === 'cp.consult-history')!.status).toBe('attested');
  });
});

// ---------------------------------------------------------------------------
// The declared-procedure block (§5b: declared before the run)
// ---------------------------------------------------------------------------

describe('deriveDeclaredProcedure', () => {
  it('declares the whole ordered checkpoint list before anything is attested', () => {
    const declared = deriveDeclaredProcedure({ outcome: DELIVERED, runbook: runbook() })!;
    expect(declared.runbookId).toBe('rb.bulk-plugin-update');
    expect(declared.version).toBe('1.0.0');
    expect(declared.strictness).toBe('strict');
    expect(declared.armedBy).toBe('predicate');
    expect(declared.checkpoints.map((c) => c.id)).toEqual(CHECKPOINTS.map((c) => c.id));
    expect(declared.checkpoints.some((c) => c.verified)).toBe(false);
  });

  it('states how many checkpoints the platform can prove AT ALL', () => {
    // The honest denominator. "3 of 8 done" over a rail where four can never be
    // proved is the half-adherence lie wearing a progress bar.
    const declared = deriveDeclaredProcedure({ outcome: DELIVERED, runbook: runbook() })!;
    expect(declared.verifiableCount).toBe(4);
    expect(declared.checkpoints).toHaveLength(8);
  });

  it('carries the communication obligations, and never ticks them', () => {
    const declared = deriveDeclaredProcedure({ outcome: DELIVERED, runbook: runbook() })!;
    expect(declared.communication).toEqual([
      'the dry-run diff, before any write',
      'the backup id(s) and verification status',
    ]);
    // Deliberately a list of strings, not checkpoint states: nothing can
    // programmatically tick "the user was told".
    expect(declared.communication.every((c) => typeof c === 'string')).toBe(true);
  });

  it('renders a refusal as unavailable, carrying both hashes on an integrity failure', () => {
    const refused: ProcedureOutcome = {
      status: 'refused',
      capability: 'cap.bulk_plugin_update',
      code: 'hash-mismatch',
      runbookId: 'rb.bulk-plugin-update',
      reason: 'on disk is not the document this capability was granted against',
      expectedHash: 'sha256:granted',
      actualHash: 'sha256:ondisk',
      tokens: 0,
    };
    const declared = deriveDeclaredProcedure({ outcome: refused })!;
    expect(declared.unavailable).toEqual({
      code: 'hash-mismatch',
      reason: 'on disk is not the document this capability was granted against',
      expectedHash: 'sha256:granted',
      actualHash: 'sha256:ondisk',
    });
    // A refused procedure declares no checkpoints: there is no reviewed document
    // to list steps from, and listing them anyway would show a rail for a
    // procedure that is not in force.
    expect(declared.checkpoints).toEqual([]);
    expect(declared.verifiableCount).toBe(0);
  });

  it('returns null when nothing was armed', () => {
    expect(deriveDeclaredProcedure({ outcome: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The audit view (RB-B) — one row set, shared with the eval's judgment sheet
// ---------------------------------------------------------------------------

describe('deriveProcedureAudit', () => {
  it('emits the shared columns, spec beside actual', () => {
    expect(PROCEDURE_AUDIT_COLUMNS).toEqual([
      'checkpoint',
      'attest',
      'expected',
      'status',
      'evidence',
    ]);
    const rows = deriveProcedureAudit(runbook(), cursor({ attested: ['cp.consult-history'] }));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      for (const column of PROCEDURE_AUDIT_COLUMNS) {
        expect(row).toHaveProperty(column);
      }
    }
  });

  it('states what WOULD attest each checkpoint, in the guard\'s own words', () => {
    const rows = deriveProcedureAudit(runbook(), cursor());
    const backup = rows.find((r) => r.checkpoint === 'cp.backup')!;
    expect(backup.expected).toContain('task.action.executed');
    expect(backup.expected).toContain('wpe_backup_and_verify');
  });

  it('says a narrative checkpoint can never be attested, rather than leaving it blank', () => {
    const rows = deriveProcedureAudit(runbook(), cursor());
    const canary = rows.find((r) => r.checkpoint === 'cp.canary')!;
    expect(canary.verified).toBe(false);
    expect(canary.expected).toMatch(/nothing in the ledger can attest/i);
    // A blank cell reads as "not done yet". This one is "cannot be proved".
    expect(canary.evidence).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// The approval-carried canary policy (§5b)
// ---------------------------------------------------------------------------

describe('deriveCanaryPolicy', () => {
  const rationale = (payload: Record<string, unknown>) =>
    ({ id: 'ev_1', topic: 'task.rationale.recorded', payload }) as never;

  it('reads the policy the approval carried', () => {
    const state = deriveCanaryPolicy([
      rationale({ decision: 'approved', canary_policy: 'continue-if-clean' }),
    ]);
    expect(state.policy).toBe('continue-if-clean');
    expect(state.declared).toBe(true);
    expect(state.source).toBe('approval');
    expect(state.eventId).toBe('ev_1');
  });

  it('defaults to pause-after-canary and SAYS the default was assumed', () => {
    // The trap this exists to prevent: rendering "pause after canary" as though
    // the human had chosen it, when no approval payload carries the field and
    // no producer writes one yet.
    const state = deriveCanaryPolicy([rationale({ decision: 'approved' })]);
    expect(state.policy).toBe(DEFAULT_CANARY_POLICY);
    expect(DEFAULT_CANARY_POLICY).toBe('pause-after-canary');
    expect(state.declared).toBe(false);
    expect(state.source).toBe('default');
    expect(state.eventId).toBeUndefined();
  });

  it('ignores a policy value that is not one of the two ruled options', () => {
    const state = deriveCanaryPolicy([
      rationale({ decision: 'approved', canary_policy: 'yolo-the-fleet' }),
    ]);
    expect(CANARY_POLICIES).toEqual(['pause-after-canary', 'continue-if-clean']);
    expect(state.policy).toBe(DEFAULT_CANARY_POLICY);
    expect(state.declared).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The four abort groups (design inputs §2)
// ---------------------------------------------------------------------------

describe('deriveAbortGroups', () => {
  const action = (id: string, tool: string) =>
    ({ id, topic: 'task.action.executed', payload: { tool }, entity: {} }) as never;
  const outcome = (id: string, causation: string, tool: string, result: string, env: string) =>
    ({
      id,
      topic: 'task.outcome.recorded',
      causation,
      observed_at: '2026-08-17T10:00:00.000Z',
      payload: { tool, result, result_scope: 'call' },
      entity: { environment: env },
    }) as never;

  const events = [
    action('ev_backup', 'wpe_backup_and_verify'),
    outcome('ev_backup_alpha', 'ev_backup', 'wpe_backup_and_verify', 'success', 'env_alpha'),
    outcome('ev_backup_bravo', 'ev_backup', 'wpe_backup_and_verify', 'success', 'env_bravo'),
    action('ev_roll', 'bulk_plugin_update'),
    outcome('ev_roll_alpha', 'ev_roll', 'bulk_plugin_update', 'success', 'env_alpha'),
    outcome('ev_roll_bravo', 'ev_roll', 'bulk_plugin_update', 'failure', 'env_bravo'),
  ];

  it('groups done and failed from real outcome events, and joins the backup ids', () => {
    const groups = deriveAbortGroups({ events, updateTool: 'bulk_plugin_update' });
    expect(groups.done.map((r) => r.entityId)).toEqual(['env_alpha']);
    expect(groups.failed.map((r) => r.entityId)).toEqual(['env_bravo']);
    expect(groups.done[0].outcomeEventId).toBe('ev_roll_alpha');
    expect(groups.done[0].backupEventId).toBe('ev_backup_alpha');
    expect(groups.failed[0].backupEventId).toBe('ev_backup_bravo');
  });

  it('reports untouched sites from the approved scope, and only with a resolver', () => {
    const withScope = deriveAbortGroups({
      events,
      updateTool: 'bulk_plugin_update',
      scope: ['alpha', 'bravo', 'charlie'],
      resolveEntity: (raw) => `env_${raw}`,
    });
    expect(withScope.untouched.map((r) => r.entityId)).toEqual(['env_charlie']);

    const withoutResolver = deriveAbortGroups({
      events,
      updateTool: 'bulk_plugin_update',
      scope: ['alpha', 'bravo', 'charlie'],
    });
    expect(withoutResolver.untouched).toEqual([]);
    expect(withoutResolver.unavailable.map((u) => u.group)).toContain('untouched');
  });

  it('never invents a skipped site: no producer records a skip reason', () => {
    const groups = deriveAbortGroups({ events, updateTool: 'bulk_plugin_update' });
    expect(groups.skipped).toEqual([]);
    const skipped = groups.unavailable.find((u) => u.group === 'skipped');
    expect(skipped?.reason).toMatch(/no producer/i);
  });

  it('leads with the copy rule: abort stops future work, it does not undo done work', () => {
    const groups = deriveAbortGroups({
      events,
      updateTool: 'bulk_plugin_update',
      scope: ['alpha', 'bravo', 'charlie'],
      resolveEntity: (raw) => `env_${raw}`,
    });
    expect(groups.headline).toBe(
      '1 site already updated and standing; 1 failed; 1 untouched. Stopping here changes none of them.'
    );
  });

  it('builds an abort notice around the groups', () => {
    const notice = procedureAbortedEvent({
      abortId: 'ab.mid-fleet-failure',
      checkpointId: 'cp.roll-fleet',
      reason: 'a site failed during the roll',
      groups: deriveAbortGroups({ events, updateTool: 'bulk_plugin_update' }),
    });
    expect(notice.type).toBe('procedure_aborted');
    expect(notice.abortId).toBe('ab.mid-fleet-failure');
    expect(notice.groups.done).toHaveLength(1);
    // Restore is NAMED, never implied to be part of aborting (Q6 ruling).
    expect(notice.restore.note).toMatch(/separate/i);
    expect(notice.restore.perSite).toEqual([
      { entityId: 'env_alpha', backupEventId: 'ev_backup_alpha' },
    ]);
  });

  it('offers restore ONLY for sites whose backup is in the ledger', () => {
    // "Restorable" is a promise, and the only thing that can support it is a
    // backup act the gateway recorded. A done site with no backup event is
    // still done — it just cannot be offered a restore it may not have.
    const noBackup = [
      action('ev_roll', 'bulk_plugin_update'),
      outcome('ev_roll_alpha', 'ev_roll', 'bulk_plugin_update', 'success', 'env_alpha'),
    ];
    const groups = deriveAbortGroups({ events: noBackup, updateTool: 'bulk_plugin_update' });
    expect(groups.done).toHaveLength(1);
    expect(groups.done[0].backupEventId).toBeUndefined();

    const notice = procedureAbortedEvent({
      abortId: 'ab.mid-fleet-failure',
      checkpointId: 'cp.roll-fleet',
      reason: 'a site failed',
      groups,
    });
    expect(notice.restore.perSite).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stream shapes
// ---------------------------------------------------------------------------

describe('stream shapes', () => {
  it('procedure_armed carries the declaration, not a summary of it', () => {
    const declared = deriveDeclaredProcedure({ outcome: DELIVERED, runbook: runbook() })!;
    const event = procedureArmedEvent(declared);
    expect(event.type).toBe('procedure_armed');
    expect(event.procedure.checkpoints).toHaveLength(8);
  });

  it('checkpoint_changed reports only what actually changed', () => {
    const before = deriveCheckpointStates(runbook(), cursor());
    const after = deriveCheckpointStates(runbook(), cursor({ attested: ['cp.consult-history'] }));
    const changed = diffCheckpointStates(before, after);
    expect(changed.map((c) => c.id)).toEqual(['cp.consult-history', 'cp.approval']);
    expect(changed[0].status).toBe('attested');
    expect(changed[1].status).toBe('active');
    expect(diffCheckpointStates(after, after)).toEqual([]);
  });

  it('reports a checkpoint whose EVIDENCE changed even when its status did not', () => {
    // The status is the same; what the platform can say about it is not. A diff
    // that watched only `status` would leave a rail showing "attested from the
    // ledger" after the event id behind it had been resolved.
    const before = deriveCheckpointStates(runbook(), cursor({ attested: ['cp.consult-history'] }));
    const after = deriveCheckpointStates(
      runbook(),
      cursor({
        attested: ['cp.consult-history'],
        evidence: { 'cp.consult-history': { eventId: 'ev_7', topic: 'task.context.assembled' } },
      })
    );
    const changed = diffCheckpointStates(before, after);
    expect(changed.map((c) => c.id)).toEqual(['cp.consult-history']);
    expect(changed[0].status).toBe('attested');
    expect(changed[0].evidence?.eventId).toBe('ev_7');
  });

  it('reports a checkpoint the previous state did not have at all', () => {
    // A re-arm on an edited document, or a first render: every checkpoint is
    // new, and a diff that treated "unknown before" as "unchanged" would render
    // an empty rail.
    const after = deriveCheckpointStates(runbook(), cursor());
    expect(diffCheckpointStates([], after)).toHaveLength(after.length);
  });
});
