/**
 * WP-19 · The gateway producer — every gated act leaves a record.
 *
 * The assertions that earn their keep are about HONESTY and BOUNDARY:
 *
 *   - the TIER BOUNDARY: a Tier-1 read emits nothing. `task.*` is never
 *     deleted (architecture §4.4), so a producer that recorded reads would
 *     turn the audit substrate into a permanent keystroke log.
 *   - REDACTION: the ledger is a fourth durable sink. A credential that the
 *     three audit sinks withhold must not reach this one verbatim.
 *   - NO FABRICATION: an outcome is the CALL's outcome, per resolved target;
 *     a target the layer cannot identify produces no invented entity id.
 *   - RATIONALE IS VERBATIM: the approval card's own text and the args. A
 *     rationale the actor did not produce would be the worst thing this
 *     packet could add to an audit record.
 *   - NON-FATALITY: a throwing emitter must not reach the caller. The gate
 *     blocks; the audit records.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  ACTION_EXECUTED_TOPIC,
  OUTCOME_RECORDED_TOPIC,
  RATIONALE_RECORDED_TOPIC,
  recordApprovalRationale,
  recordGatedAction,
} from '../actionProducer';
import { environmentEntityId, siteEntityId } from '../provisionalEntity';
import { deriveCanaryPolicy } from '../procedureView';
import type { EventEnvelope } from '../../../intelligence';

const silent = { info: () => {}, error: () => {} };

const SITE_A = 'local-site-a';
const SITE_B = 'local-site-b';

function newCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-action-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

/** Partial NexusServices — `as never` is this subsystem's established pattern. */
function services() {
  const sites: Record<string, { id: string; name: string }> = {
    [SITE_A]: { id: SITE_A, name: 'Acme copy' },
    [SITE_B]: { id: SITE_B, name: 'Beta copy' },
  };
  return {
    siteData: {
      getSite: (id: string) => sites[id],
      getSites: () => sites,
    },
  } as never;
}

function eventsOf(core: IntelligenceCore, topic: string): EventEnvelope[] {
  return core.ledger.query({ topicPrefix: topic, limit: 100 });
}

let core: IntelligenceCore;
beforeEach(() => {
  core = newCore();
});
afterEach(() => {
  core.close();
  setIntelligenceCore(undefined as never);
});

// ───────────────────────────────────────────────────────────────────────────
// The act is recorded
// ───────────────────────────────────────────────────────────────────────────

test('a gated call emits one action and one outcome, correlated to the turn', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A, plugin: 'woocommerce' },
    services: services(),
    accessMethod: 'mcp',
    dispatch: 'registry',
    taskId: 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN',
    outcome: 'success',
    durationMs: 42,
  });

  const actions = eventsOf(core, ACTION_EXECUTED_TOPIC);
  const outcomes = eventsOf(core, OUTCOME_RECORDED_TOPIC);

  expect(actions).toHaveLength(1);
  expect(outcomes).toHaveLength(1);
  expect(actions[0].correlation).toBe('task_01J5X8K3V9Q2M7ABCDEFGHJKMN');
  expect(outcomes[0].correlation).toBe('task_01J5X8K3V9Q2M7ABCDEFGHJKMN');
  expect(actions[0].payload).toMatchObject({ tool: 'wp_plugin_update', tier: 2, dispatch: 'registry' });
  expect(outcomes[0].payload).toMatchObject({ tool: 'wp_plugin_update', result: 'success' });
});

test('the target rides as entity refs the other producers already stamp', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  expect(action.entity.environment).toBe(environmentEntityId(core.entities, SITE_A));
  expect(action.entity.site).toBe(siteEntityId(core.entities, SITE_A));
});

test('actor carries id AND via (ADR-14) — via is the satellite, not the tool', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    accessMethod: 'mcp',
    dispatch: 'registry',
    outcome: 'success',
  });

  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  expect(action.actor.id).toMatch(/^act_/);
  expect(action.actor.kind).toBe('agent');
  expect(action.actor.via).toMatch(/^sat_/);
});

test('a failed call records the failure, not silence', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'failure',
    error: 'WP-CLI exited 1',
  });

  const [outcome] = eventsOf(core, OUTCOME_RECORDED_TOPIC);
  expect(outcome.payload).toMatchObject({ result: 'failure', error: 'WP-CLI exited 1' });
  // The act still happened — it is the OUTCOME that failed, not the record.
  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)).toHaveLength(1);
});

// ───────────────────────────────────────────────────────────────────────────
// The tier boundary
// ───────────────────────────────────────────────────────────────────────────

test('a Tier-1 read emits NOTHING — the ledger is not a keystroke logger', () => {
  recordGatedAction({
    toolName: 'wp_plugin_list',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  expect(core.ledger.query({ topicPrefix: 'task.', limit: 100 })).toHaveLength(0);
});

test('an unknown tool is Tier 2 by default, so it IS recorded', () => {
  recordGatedAction({
    toolName: 'agent__log_processor__rescan',
    args: {},
    dispatch: 'contributed',
    outcome: 'success',
  });

  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)).toHaveLength(1);
  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)[0].payload).toMatchObject({ dispatch: 'contributed' });
});

// ───────────────────────────────────────────────────────────────────────────
// Redaction — this is a durable sink like the other three
// ───────────────────────────────────────────────────────────────────────────

test('a credential argument never reaches the ledger verbatim', () => {
  recordGatedAction({
    toolName: 'wp_user_create',
    args: { site: SITE_A, user_pass: 'hunter2-correct-horse-battery' },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const raw = JSON.stringify(eventsOf(core, ACTION_EXECUTED_TOPIC)[0].payload);
  expect(raw).not.toContain('hunter2-correct-horse-battery');
  expect(raw).toContain('[REDACTED]');
});

test('freeform command syntax is WITHHELD, matching FREEFORM_FIELDS', () => {
  recordGatedAction({
    toolName: 'wp_eval',
    args: { site: SITE_A, code: 'echo DB_PASSWORD;' },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const raw = JSON.stringify(eventsOf(core, ACTION_EXECUTED_TOPIC)[0].payload);
  expect(raw).not.toContain('DB_PASSWORD');
  expect(raw).toContain('WITHHELD');
});

test('the error string is redacted too — it is raw tool output', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'failure',
    error: "Error: define('DB_PASSWORD', 'sk-live-abcdefghijklmnopqrstuvwxyz')",
  });

  const raw = JSON.stringify(eventsOf(core, OUTCOME_RECORDED_TOPIC)[0].payload);
  expect(raw).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz');
});

// ───────────────────────────────────────────────────────────────────────────
// Per target, without fabrication
// ───────────────────────────────────────────────────────────────────────────

test('a multi-site call records one outcome per target site', () => {
  recordGatedAction({
    toolName: 'bulk_plugin_update',
    args: { site_ids: [SITE_A, SITE_B] },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const outcomes = eventsOf(core, OUTCOME_RECORDED_TOPIC);
  expect(outcomes).toHaveLength(2);
  expect(outcomes.map((o) => o.entity.environment).sort()).toEqual(
    [environmentEntityId(core.entities, SITE_A), environmentEntityId(core.entities, SITE_B)].sort()
  );
  // One action for one call, whatever the fan-out.
  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)).toHaveLength(1);
});

test('an unresolvable target invents no entity and still records the outcome', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { install_name: 'someproduction' },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  const outcomes = eventsOf(core, OUTCOME_RECORDED_TOPIC);
  expect(action.entity).toEqual({});
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0].entity).toEqual({});
  expect(action.payload).toMatchObject({ targets: 1, targets_resolved: 0 });
});

test('a multi-target action names no single entity — the outcomes carry the targets', () => {
  recordGatedAction({
    toolName: 'bulk_plugin_update',
    args: { site_ids: [SITE_A, SITE_B] },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  // Stamping one of two targets would misattribute the call to that site.
  expect(action.entity).toEqual({});
  expect(action.payload).toMatchObject({ targets: 2, targets_resolved: 2 });
});

test('the per-target outcome says it is the CALL\'s result, not an observed per-site one', () => {
  recordGatedAction({
    toolName: 'bulk_plugin_update',
    args: { site_ids: [SITE_A, SITE_B] },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  for (const outcome of eventsOf(core, OUTCOME_RECORDED_TOPIC)) {
    expect(outcome.payload.result_scope).toBe('call');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Causation
// ───────────────────────────────────────────────────────────────────────────

test('the outcome is caused by its action', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  const [outcome] = eventsOf(core, OUTCOME_RECORDED_TOPIC);
  expect(outcome.causation).toBe(action.id);
});

describe('WP-26 · the canary policy the approval carried', () => {
  test('the chosen policy rides on the approval, as the approval', () => {
    recordApprovalRationale({
      checkpoint: 'cp.approval',
      toolName: 'bulk_plugin_update',
      args: { site_ids: ['alpha'] },
      cardText: 'Updates plugins on 3 sites.',
      decision: 'approved',
      canaryPolicy: 'continue-if-clean',
    });

    const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
    expect((rationale.payload as Record<string, unknown>).canary_policy).toBe('continue-if-clean');
    // Elicited intent, recorded from a human act. Unchanged by the new field.
    expect(rationale.source).toMatchObject({ class: 'intent', trust: 'elicited' });
  });

  test('ABSENCE means the default — the field is never written when nobody chose', () => {
    // `deriveCanaryPolicy` returns `declared: false` for exactly this case, and a
    // gateway-authored default would make that flag a lie: the surface would then
    // render "pause after the canary" as a decision the human made.
    recordApprovalRationale({
      checkpoint: 'cp.approval',
      toolName: 'bulk_plugin_update',
      args: { site_ids: ['alpha'] },
      cardText: 'Updates plugins on 3 sites.',
      decision: 'approved',
    });

    const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');
  });

  test('a value outside the vocabulary is not recorded at all', () => {
    recordApprovalRationale({
      checkpoint: 'cp.approval',
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'card',
      decision: 'approved',
      canaryPolicy: 'ship-it' as never,
    });

    const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');
  });

  test('a DENIAL carries no policy: there is no canary to have a policy about', () => {
    recordApprovalRationale({
      checkpoint: 'cp.approval',
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'card',
      decision: 'denied',
      canaryPolicy: 'continue-if-clean',
    });

    const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
    expect((rationale.payload as Record<string, unknown>).decision).toBe('denied');
    expect(rationale.payload as Record<string, unknown>).not.toHaveProperty('canary_policy');
  });

  test('the recorded policy is what `deriveCanaryPolicy` reads back, declared', () => {
    // The producer and the reader are pinned together: a field written under a
    // name the reader does not look for is a field that does not exist.
    recordApprovalRationale({
      checkpoint: 'cp.approval',
      toolName: 'bulk_plugin_update',
      args: {},
      cardText: 'card',
      decision: 'approved',
      canaryPolicy: 'continue-if-clean',
    });

    const state = deriveCanaryPolicy(eventsOf(core, RATIONALE_RECORDED_TOPIC));
    expect(state).toMatchObject({
      policy: 'continue-if-clean',
      declared: true,
      source: 'approval',
    });
  });
});

test('an approval chains rationale -> action -> outcome', () => {
  const rationaleId = recordApprovalRationale({
    checkpoint: null,
    toolName: 'wpe_delete_install',
    args: { install_name: 'someproduction' },
    cardText: 'This permanently deletes the install.',
    decision: 'approved',
    taskId: 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN',
  });

  recordGatedAction({
    toolName: 'wpe_delete_install',
    args: { install_name: 'someproduction' },
    dispatch: 'registry',
    taskId: 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN',
    causation: rationaleId,
    outcome: 'success',
  });

  const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
  const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
  const [outcome] = eventsOf(core, OUTCOME_RECORDED_TOPIC);

  expect(rationaleId).toBe(rationale.id);
  expect(action.causation).toBe(rationale.id);
  expect(outcome.causation).toBe(action.id);
  for (const e of [rationale, action, outcome]) {
    expect(e.correlation).toBe('task_01J5X8K3V9Q2M7ABCDEFGHJKMN');
  }
});

test('a direct (unapproved) call carries NO causation — absence is honest', () => {
  recordGatedAction({
    toolName: 'wp_plugin_update',
    args: { site: SITE_A },
    services: services(),
    dispatch: 'registry',
    outcome: 'success',
  });

  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)[0].causation).toBeUndefined();
});

// ───────────────────────────────────────────────────────────────────────────
// Rationale v0 — verbatim, never synthesised
// ───────────────────────────────────────────────────────────────────────────

test('the rationale is the card text and the args, and nothing invented', () => {
  recordApprovalRationale({
    checkpoint: null,
    toolName: 'wp_eval',
    args: { site: SITE_A, code: 'return 1;' },
    cardText: 'Runs arbitrary PHP on this site.',
    decision: 'approved',
    services: services(),
  });

  const [rationale] = eventsOf(core, RATIONALE_RECORDED_TOPIC);
  expect(rationale.payload).toMatchObject({
    tool: 'wp_eval',
    decision: 'approved',
    prompt: 'Runs arbitrary PHP on this site.',
    source: 'approval-card',
  });
  expect(rationale.source.trust).toBe('elicited');
  // The human clicked it, so the human is the actor.
  expect(rationale.actor.kind).toBe('human');
});

test('the approved ARGUMENTS are redacted too — an approval card can carry a credential', () => {
  recordApprovalRationale({
    checkpoint: null,
    toolName: 'wp_user_create',
    args: { site: SITE_A, user_pass: 'hunter2-correct-horse-battery' },
    cardText: 'Creates an administrator account.',
    decision: 'approved',
    services: services(),
  });

  const raw = JSON.stringify(eventsOf(core, RATIONALE_RECORDED_TOPIC)[0].payload);
  expect(raw).not.toContain('hunter2-correct-horse-battery');
  expect(raw).toContain('[REDACTED]');
});

test('a DENIED approval is recorded — that record is what makes "proceeded anyway" checkable', () => {
  recordApprovalRationale({
    checkpoint: null,
    toolName: 'wpe_delete_install',
    args: { install_name: 'someproduction' },
    cardText: 'This permanently deletes the install.',
    decision: 'denied',
  });

  expect(eventsOf(core, RATIONALE_RECORDED_TOPIC)[0].payload.decision).toBe('denied');
  expect(eventsOf(core, ACTION_EXECUTED_TOPIC)).toHaveLength(0);
});

// ───────────────────────────────────────────────────────────────────────────
// Non-fatality
// ───────────────────────────────────────────────────────────────────────────

test('a throwing emitter costs the record, never the call', () => {
  (core as unknown as { emitter: { emit: () => never } }).emitter = {
    emit: () => {
      throw new Error('ledger is on fire');
    },
  };

  expect(() =>
    recordGatedAction({
      toolName: 'wp_plugin_update',
      args: { site: SITE_A },
      services: services(),
      dispatch: 'registry',
      outcome: 'success',
    })
  ).not.toThrow();
  expect(() =>
    recordApprovalRationale({
      checkpoint: null,
      toolName: 'wp_eval',
      args: {},
      cardText: 'x',
      decision: 'approved',
    })
  ).not.toThrow();
});

test('with no intelligence core at all, both producers are silent no-ops', () => {
  setIntelligenceCore(undefined as never);

  expect(
    recordGatedAction({
      toolName: 'wp_plugin_update',
      args: { site: SITE_A },
      dispatch: 'registry',
      outcome: 'success',
    })
  ).toBeUndefined();
  expect(
    recordApprovalRationale({
      toolName: 'wp_eval',
      args: {},
      cardText: 'x',
      decision: 'approved',
      checkpoint: null,
    })
  ).toBeUndefined();
});

/**
 * WP-57 · WHO acted.
 *
 * Added because the mutation battery found this branch UNCOVERED: deleting
 * `if (supplied) return supplied;` from `actorFor` left every test green, so
 * the one behaviour Task 4 exists for was pinned nowhere. The dispatcher's own
 * suite mocks `recordGatedAction`, so it proves the field is PASSED and can
 * never prove it is USED.
 */
describe('WP-57 · the supplied actor outranks the surface inference', () => {
  it('names the agent when the run frame supplies it', () => {
    recordGatedAction({
      toolName: 'wpe_site_deep_refresh',
      args: { site: SITE_A },
      services: services(),
      accessMethod: 'agent',
      dispatch: 'registry',
      tier: 2,
      actor: { id: 'act_security_sentinel', kind: 'agent' },
      taskId: 'task_01J5X8K3V9Q2M7ABCDEFGHJKMN',
      outcome: 'success',
    });

    const [action] = eventsOf(core, ACTION_EXECUTED_TOPIC);
    expect(action).toBeDefined();
    expect(action.actor.id).toBe('act_security_sentinel');
    // The outcome beside it agrees — one act, one actor.
    expect(eventsOf(core, OUTCOME_RECORDED_TOPIC)[0].actor.id).toBe('act_security_sentinel');
  });

  it('PARITY: falls back to the collapsed id when no actor is supplied', () => {
    recordGatedAction({
      toolName: 'wpe_site_deep_refresh',
      args: { site: SITE_A },
      services: services(),
      accessMethod: 'agent',
      dispatch: 'registry',
      tier: 2,
      outcome: 'success',
    });

    // Every caller predating WP-57 behaves exactly as before. This is the
    // parity floor, and it is why the field is optional rather than required.
    expect(eventsOf(core, ACTION_EXECUTED_TOPIC)[0].actor.id).toBe('act_agent_runtime');
  });

  it('two agents produce two actors — the 58-of-58 collapse, closed', () => {
    recordGatedAction({
      toolName: 'wpe_site_deep_refresh', args: { site: SITE_A }, services: services(),
      accessMethod: 'agent', dispatch: 'registry', tier: 2, outcome: 'success',
      actor: { id: 'act_security_sentinel', kind: 'agent' },
    });
    recordGatedAction({
      toolName: 'wpe_site_deep_refresh', args: { site: SITE_B }, services: services(),
      accessMethod: 'agent', dispatch: 'registry', tier: 2, outcome: 'success',
      actor: { id: 'act_seo_insights', kind: 'agent' },
    });

    const ids = eventsOf(core, ACTION_EXECUTED_TOPIC).map((e) => e.actor.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(expect.arrayContaining(['act_security_sentinel', 'act_seo_insights']));
  });
});

