/**
 * WP-25 · The incident producer — the two taps, the payload contract, the
 * resolution amendments and the dedup.
 *
 * The assertions that earn their keep here are about FABRICATION and about
 * REPETITION, because those are the two ways this producer could do damage:
 *
 *   - `observed_at` is the SCAN's time and the ABORT's time, never the fold's.
 *     A backdated report whose incidents come back stamped "now" is the data
 *     laundering the layer's own invariant forbids, and an episodic family is
 *     exactly where it would go unnoticed (nothing else reads these times).
 *   - A site the layer cannot resolve produces NO event. Deriving an entity for
 *     an install name is audit A7, and the sentinel addresses sites by name.
 *   - Resolution is OBSERVED. A clean scan that skipped checks does not resolve
 *     anything: the sentinel's own summary says `clean` means "the checks that
 *     ran found nothing", and turning that into "the incident is over" would be
 *     the fabrication with the largest blast radius in this packet.
 *   - The same finding on consecutive scans emits ONCE, and the dedup is
 *     DURABLE (a ledger read, not a process cache) — a producer that re-emits
 *     after a restart is the heartbeat P4 forbids, one restart later.
 *   - The abort ids are DERIVED FROM THE SHIPPED DOCUMENT, not from a constant
 *     list in this file. The three the design note names are asserted as a
 *     CONSEQUENCE of `rb.bulk-plugin-update`, so a runbook edit that changes
 *     them fails here rather than silently disagreeing with the note.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { environmentEntityId, siteEntityId } from '../provisionalEntity';
import type { ProcedureRun } from '../procedureCursor';
import type { Runbook } from '../../../intelligence';
import {
  INCIDENT_SCHEMA,
  INCIDENT_TOPIC,
  SCAN_SCHEMA,
  SCAN_TOPIC,
  SENTINEL_AGENT_ID,
  SEVERITY_FLOOR,
  abortForTool,
  recordAbortIncidents,
  recordSentinelIncidents,
} from '../incidentProducer';
import type { NexusServices } from '../../mcp/types';

const SITE_A = 'local-site-a';
const SITE_B = 'local-site-b';
const SCAN_AT = '2026-07-04T10:00:00.000Z';
const LATER_SCAN_AT = '2026-07-11T10:00:00.000Z';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let dirs: string[] = [];
let cores: IntelligenceCore[] = [];

function newCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-incident-'));
  dirs.push(dir);
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  cores.push(core);
  setIntelligenceCore(core);
  return core;
}

/** Local's site store, as the target resolver reads it. */
function services(): NexusServices {
  const sites: Record<string, { id: string; name: string; domain: string }> = {
    [SITE_A]: { id: SITE_A, name: 'Alpha Staging', domain: 'alpha.local' },
    [SITE_B]: { id: SITE_B, name: 'Bravo Staging', domain: 'bravo.local' },
  };
  return {
    siteData: {
      getSite: (id: string) => sites[id],
      getSites: () => sites,
    },
  } as unknown as NexusServices;
}

function incidents(core: IntelligenceCore) {
  return core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 100 });
}

function entityCount(core: IntelligenceCore): number {
  return (core.ledger.raw().prepare('SELECT COUNT(*) n FROM entities').get() as { n: number }).n;
}

/** One sentinel sweep, in the shape `AgentResult` actually carries. */
function sweep(
  sites: Record<
    string,
    {
      status: string;
      findings: Array<{ id: string; severity: string; title: string; category?: string }>;
      notChecked?: string[];
    }
  >,
  observedAt = SCAN_AT,
  runId = 'r_scan_1'
) {
  return { agentId: SENTINEL_AGENT_ID, runId, observedAt, sites };
}

afterEach(() => {
  setIntelligenceCore(null as never);
  // `scheduleFolds` arms a real debounce timer; closing the core clears it.
  // `detectOpenHandles` is on precisely so a NEW leak stays visible, and a
  // suite that leaves fourteen timers behind is the noise that hides one.
  for (const core of cores) {
    try {
      core.close();
    } catch {
      /* a core closed twice must not fail teardown */
    }
  }
  cores = [];
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

// ---------------------------------------------------------------------------
// Tap A · sentinel findings
// ---------------------------------------------------------------------------

describe('the sentinel tap', () => {
  test('a finding at the floor becomes one Site-stamped incident carrying the payload contract', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      sweep({
        [SITE_A]: {
          status: 'escalated',
          findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell in wp-content/uploads' }],
        },
      }),
      { services: services() }
    );

    expect(written).toBe(1);
    const events = incidents(core);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.topic).toBe(INCIDENT_TOPIC);
    expect(event.schema).toBe(INCIDENT_SCHEMA);
    // ADR-22: episodic is Site-scoped across environments.
    expect(event.entity.site).toBe(siteEntityId(core.entities, SITE_A));
    expect(event.entity.environment).toBe(environmentEntityId(core.entities, SITE_A));
    // `component` is ABSENT, not 'site' (gate ruling 1a). toEqual would treat an
    // explicit `component: undefined` as equal to an absent one, so presence
    // itself is asserted separately — WP-26's trap, and this is exactly the
    // shape it catches.
    expect(event.payload).toEqual({
      fact: 'FS-02',
      symptom: 'Webshell in wp-content/uploads',
      severity: 'critical',
      resolved: false,
      source: 'sentinel:r_scan_1',
    });
    expect(Object.keys(event.payload)).not.toContain('component');
  });

  test('observed_at is the scan time, never the fold time', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] },
      }),
      { services: services() }
    );
    const [event] = incidents(core);
    expect(event.observed_at).toBe(SCAN_AT);
    expect(event.recorded_at).not.toBe(SCAN_AT);
    expect(Date.parse(event.recorded_at)).toBeGreaterThan(Date.parse(event.observed_at));
  });

  test('a scan with no usable time emits nothing rather than stamping now', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      {
        agentId: SENTINEL_AGENT_ID,
        runId: 'r_scan_1',
        observedAt: undefined as never,
        sites: {
          [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] },
        },
      },
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(0);
  });

  test('findings below the severity floor are not incidents', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      sweep({
        [SITE_A]: {
          status: 'findings',
          findings: [
            { id: 'CFG-01', severity: 'medium', title: 'Directory listing enabled' },
            { id: 'LOG-AUTH', severity: 'low', title: 'Failed logins' },
            { id: 'INF-01', severity: 'info', title: 'WordPress 6.9 available' },
          ],
        },
      }),
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(0);
    // The floor is a named constant, and the test above is only meaningful
    // because it sits below it.
    expect(SEVERITY_FLOOR).toBe('high');
  });

  test('the same finding on a consecutive scan emits once — and the dedup survives a new process', () => {
    const core = newCore();
    const report = sweep({
      [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
    });
    expect(recordSentinelIncidents(report, { services: services() })).toBe(1);
    expect(recordSentinelIncidents({ ...report, runId: 'r_scan_2' }, { services: services() })).toBe(0);
    expect(incidents(core)).toHaveLength(1);
  });

  test('a site the layer cannot resolve produces no event and no entity', () => {
    const core = newCore();
    const before = entityCount(core);
    const written = recordSentinelIncidents(
      sweep({
        'someone-elses-install': {
          status: 'escalated',
          findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }],
        },
      }),
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(0);
    expect(entityCount(core)).toBe(before);
    // Not "no entity was created" alone — no event was written AT ALL. An
    // incident stamped with an empty entity block is worse than no incident: it
    // is a security finding about nothing, which no reader can route or act on.
    // (Scoped to incidents: `control.grant.issued` legitimately carries no
    // entity — a grant is about a capability, not about a site.)
    expect(
      core.ledger
        .query({ topicPrefix: INCIDENT_TOPIC, limit: 1000 })
        .filter((e) => Object.keys(e.entity).length === 0)
    ).toHaveLength(0);
  });

  test('a run that is not the sentinel emits nothing', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      {
        ...sweep({
          [SITE_A]: { status: 'escalated', findings: [{ id: 'X', severity: 'critical', title: 'x' }] },
        }),
        agentId: 'seo-insights',
      },
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(0);
  });

  test('a later clean scan with full coverage resolves by amendment — the original is untouched', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
      }),
      { services: services() }
    );
    const openId = incidents(core)[0].id;

    const written = recordSentinelIncidents(
      sweep({ [SITE_A]: { status: 'clean', findings: [], notChecked: [] } }, LATER_SCAN_AT, 'r_scan_2'),
      { services: services() }
    );

    expect(written).toBe(1);
    const events = incidents(core);
    expect(events).toHaveLength(2);
    // Superseding, never mutating: the original still says what it said.
    const original = events.find((e) => e.id === openId)!;
    expect(original.payload.resolved).toBe(false);
    const amendment = events.find((e) => e.id !== openId)!;
    expect(amendment.payload).toEqual({
      fact: 'FS-02',
      symptom: 'Webshell',
      resolved: true,
      resolved_at: LATER_SCAN_AT,
      source: 'sentinel:r_scan_2',
    });
    expect(Object.keys(amendment.payload)).not.toContain('component');
    expect(amendment.causation).toBe(openId);
    expect(amendment.observed_at).toBe(LATER_SCAN_AT);
  });

  test('a clean scan that skipped checks resolves NOTHING — clean means only what ran', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
      }),
      { services: services() }
    );
    const written = recordSentinelIncidents(
      sweep(
        { [SITE_A]: { status: 'clean', findings: [], notChecked: ['filesystem contents'] } },
        LATER_SCAN_AT,
        'r_scan_2'
      ),
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(1);
    expect(incidents(core)[0].payload.resolved).toBe(false);
  });

  test('a scan that still finds the class resolves nothing and repeats nothing', () => {
    const core = newCore();
    const report = sweep({
      [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
    });
    recordSentinelIncidents(report, { services: services() });
    const written = recordSentinelIncidents(
      sweep(
        {
          [SITE_A]: {
            status: 'escalated',
            findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }],
            notChecked: [],
          },
        },
        LATER_SCAN_AT,
        'r_scan_2'
      ),
      { services: services() }
    );
    expect(written).toBe(0);
    expect(incidents(core)).toHaveLength(1);
  });

  test('resolution is per site: a clean Alpha does not close Bravo', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
        [SITE_B]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell' }] },
      }),
      { services: services() }
    );
    expect(incidents(core)).toHaveLength(2);

    recordSentinelIncidents(
      sweep({ [SITE_A]: { status: 'clean', findings: [], notChecked: [] } }, LATER_SCAN_AT, 'r_scan_2'),
      { services: services() }
    );

    const bravo = siteEntityId(core.entities, SITE_B);
    const bravoEvents = core.ledger.query({ entityId: bravo, topicPrefix: INCIDENT_TOPIC, limit: 10 });
    expect(bravoEvents).toHaveLength(1);
    expect(bravoEvents[0].payload.resolved).toBe(false);
  });

  test('no core, a faulty ledger and a malformed report are all silent', () => {
    setIntelligenceCore(null as never);
    expect(() =>
      recordSentinelIncidents(
        sweep({ [SITE_A]: { status: 'escalated', findings: [{ id: 'X', severity: 'critical', title: 'x' }] } }),
        { services: services() }
      )
    ).not.toThrow();

    // A ledger that cannot be READ must not be treated as a ledger holding
    // nothing: "no history" is the one reading that re-emits everything this
    // site already has. So the producer records NOTHING while it cannot see
    // what is already open — silence, not repetition.
    const core = newCore();
    const realQuery = core.ledger.query.bind(core.ledger);
    core.ledger.query = () => {
      throw new Error('ledger is gone');
    };
    let written = -1;
    expect(() => {
      written = recordSentinelIncidents(
        sweep({ [SITE_A]: { status: 'escalated', findings: [{ id: 'X', severity: 'critical', title: 'x' }] } }),
        { services: services() }
      );
    }).not.toThrow();
    expect(written).toBe(0);
    core.ledger.query = realQuery;
    expect(incidents(core)).toHaveLength(0);

    const clean = newCore();
    expect(() => recordSentinelIncidents({} as never, { services: services() })).not.toThrow();
    expect(incidents(clean)).toHaveLength(0);
  });

  test('the incident renders through the assembler the anchor slice already ships', async () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: {
          status: 'escalated',
          findings: [{ id: 'FS-02', severity: 'critical', title: 'Webshell in wp-content/uploads' }],
        },
      }),
      { services: services() }
    );

    const { assemble } = await import('../../../intelligence');
    const bundle = await assemble(
      {
        actor: { id: 'act_wp25_test', kind: 'agent', autonomy: 'interactive' },
        task: { id: 'task_' + '0'.repeat(26), intent: 'What happened on Alpha Staging?' },
        targets: [{ role: 'site', id: siteEntityId(core.entities, SITE_A), label: 'Alpha Staging' }],
        surface: 'eval.wp-25',
      },
      { ledger: core.ledger, twins: core.twins }
    );

    const item = bundle.retrieved.find((r) => r.title === INCIDENT_TOPIC);
    expect(item).toBeDefined();
    // The payload's field NAMES are the contract with `episodicSummary`'s
    // allow-list — a rename that no consumer reads would be invisible without
    // this assertion.
    expect(item!.summary).toContain('Webshell in wp-content/uploads');
    expect(item!.summary).toContain('UNRESOLVED');
    expect(item!.detail).toBe('FS-02');
    // Gate ruling 1a, pinned on the RENDERED LINE rather than on the payload:
    // the summary OPENS on the symptom. A producer that wrote `component:
    // 'site'` would put the schema's own word in front of the model, and the
    // only place that is visible is here.
    expect(item!.summary!.startsWith('Webshell in wp-content/uploads')).toBe(true);
    expect(item!.summary).not.toContain('site;');
  });
});

// ---------------------------------------------------------------------------
// Tap B · procedure aborts
// ---------------------------------------------------------------------------

const CAPABILITY = 'cap.bulk_plugin_update';
const TASK_ID = 'task_' + '1'.repeat(26);

function anchorRunbook(core: IntelligenceCore): Runbook {
  const runbook = core.law?.runbooks.byCapability(CAPABILITY);
  if (!runbook) throw new Error('the shipped anchor runbook did not load — nothing below is measurable');
  return runbook;
}

function run(core: IntelligenceCore): ProcedureRun {
  return {
    sessionId: 'session-wp25',
    capability: CAPABILITY,
    runbookId: anchorRunbook(core).id,
    runbookHash: anchorRunbook(core).hash,
    taskIds: [TASK_ID],
  };
}

/** One gated call, as `actionProducer` writes it: an action, then its outcome. */
function gatedCall(
  core: IntelligenceCore,
  args: { tool: string; siteId: string; result: 'success' | 'failure'; at: string }
): { actionId: string; outcomeId: string } {
  const entity = {
    environment: environmentEntityId(core.entities, args.siteId),
    site: siteEntityId(core.entities, args.siteId),
  };
  const action = core.emitter.emit({
    observed_at: args.at,
    topic: 'task.action.executed',
    schema: 'action.executed/1',
    entity,
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: TASK_ID,
    payload: { tool: args.tool, tier: 3, dispatch: 'registry' },
  });
  const outcome = core.emitter.emit({
    observed_at: args.at,
    topic: 'task.outcome.recorded',
    schema: 'outcome.recorded/1',
    entity,
    actor: { id: 'act_chat_agent', kind: 'agent' },
    source: { class: 'work', system: 'gateway:tool-call', trust: 'emitted' },
    correlation: TASK_ID,
    causation: action.id,
    payload: { tool: args.tool, result: args.result, result_scope: 'call' },
  });
  return { actionId: action.id, outcomeId: outcome.id };
}

describe('the abort tap', () => {
  test('the shipped anchor runbook maps its tools to exactly the three ratified abort ids', () => {
    const core = newCore();
    const runbook = anchorRunbook(core);
    expect(abortForTool(runbook, 'wpe_backup_and_verify')?.id).toBe('ab.backup-failed');
    expect(abortForTool(runbook, 'verify_site_live')?.id).toBe('ab.canary-regression');
    expect(abortForTool(runbook, 'bulk_plugin_update')?.id).toBe('ab.mid-fleet-failure');
    // Not a hand-kept list: the ids are what the DOCUMENT declares, and a tool
    // the document ties to no abort path yields nothing.
    expect(abortForTool(runbook, 'nexus_list_sites')).toBeUndefined();
  });

  test('a checkpoint id matches WHOLE, so cp.backup is not cp.backup-verify', () => {
    const core = newCore();
    // The condition names a DIFFERENT checkpoint whose id merely starts with
    // this one's. A substring match would file every failed backup under an
    // abort path the document never tied to it — and the anchor runbook has no
    // such pair, so nothing else in this suite would notice.
    const neighbouring = {
      ...anchorRunbook(core),
      frontmatter: { aborts: [{ id: 'ab.verify-failed', on: 'cp.backup-verify failure' }] },
    } as Runbook;
    expect(abortForTool(neighbouring, 'wpe_backup_and_verify')).toBeUndefined();

    const exact = {
      ...anchorRunbook(core),
      frontmatter: { aborts: [{ id: 'ab.verify-failed', on: 'on cp.backup failure, stop' }] },
    } as Runbook;
    expect(abortForTool(exact, 'wpe_backup_and_verify')?.id).toBe('ab.verify-failed');
  });

  test('a tool whose checkpoints reach two abort paths declines rather than guesses', () => {
    const core = newCore();
    const ambiguous = {
      ...anchorRunbook(core),
      frontmatter: {
        aborts: [
          { id: 'ab.one', on: 'cp.backup failure' },
          { id: 'ab.two', on: 'cp.backup taking too long' },
        ],
      },
    } as Runbook;
    expect(abortForTool(ambiguous, 'wpe_backup_and_verify')).toBeUndefined();
  });

  test('a failed backup in an armed run becomes an ab.backup-failed incident on that site', () => {
    const core = newCore();
    const { outcomeId } = gatedCall(core, {
      tool: 'wpe_backup_and_verify',
      siteId: SITE_A,
      result: 'failure',
      at: SCAN_AT,
    });

    const written = recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger });

    expect(written).toBe(1);
    const [event] = incidents(core);
    expect(event.entity.site).toBe(siteEntityId(core.entities, SITE_A));
    expect(event.observed_at).toBe(SCAN_AT);
    expect(event.causation).toBe(outcomeId);
    expect(event.correlation).toBe(TASK_ID);
    expect(event.payload).toEqual({
      fact: 'ab.backup-failed',
      // The runbook's own `on:` clause, VERBATIM — the condition that halted
      // the run, which is also where the checkpoint id is carried. `do:` is the
      // instruction for a human, not a symptom, and composing a sentence here
      // would put words in the document's mouth.
      symptom: 'cp.backup failure or unverifiable backup',
      resolved: false,
      source: `abort:${TASK_ID}/ab.backup-failed`,
    });
  });

  test.each([
    ['verify_site_live', 'ab.canary-regression'],
    ['bulk_plugin_update', 'ab.mid-fleet-failure'],
  ])('a failed %s becomes %s', (tool, abortId) => {
    const core = newCore();
    gatedCall(core, { tool, siteId: SITE_A, result: 'failure', at: SCAN_AT });
    expect(recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger })).toBe(1);
    expect(incidents(core)[0].payload.fact).toBe(abortId);
  });

  test('a failure on a tool the runbook maps to no abort path records nothing', () => {
    const core = newCore();
    gatedCall(core, { tool: 'nexus_list_sites', siteId: SITE_A, result: 'failure', at: SCAN_AT });
    expect(recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger })).toBe(0);
    expect(incidents(core)).toHaveLength(0);
  });

  test('a successful call records nothing', () => {
    const core = newCore();
    gatedCall(core, { tool: 'wpe_backup_and_verify', siteId: SITE_A, result: 'success', at: SCAN_AT });
    expect(recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger })).toBe(0);
    expect(incidents(core)).toHaveLength(0);
  });

  test('the tap is idempotent — it runs on every armed turn and the run keeps its events', () => {
    const core = newCore();
    gatedCall(core, { tool: 'wpe_backup_and_verify', siteId: SITE_A, result: 'failure', at: SCAN_AT });
    const args = { run: run(core), runbook: anchorRunbook(core), ledger: core.ledger };
    expect(recordAbortIncidents(args)).toBe(1);
    expect(recordAbortIncidents(args)).toBe(0);
    expect(recordAbortIncidents(args)).toBe(0);
    expect(incidents(core)).toHaveLength(1);
  });

  test('a later success on the same site and capability resolves the abort by amendment', () => {
    const core = newCore();
    gatedCall(core, { tool: 'wpe_backup_and_verify', siteId: SITE_A, result: 'failure', at: SCAN_AT });
    const args = { run: run(core), runbook: anchorRunbook(core), ledger: core.ledger };
    recordAbortIncidents(args);
    const openId = incidents(core)[0].id;

    gatedCall(core, { tool: 'wpe_backup_and_verify', siteId: SITE_A, result: 'success', at: LATER_SCAN_AT });
    expect(recordAbortIncidents(args)).toBe(1);

    const events = incidents(core);
    expect(events).toHaveLength(2);
    const amendment = events.find((e) => e.id !== openId)!;
    expect(amendment.payload.resolved).toBe(true);
    expect(amendment.payload.resolved_at).toBe(LATER_SCAN_AT);
    expect(amendment.payload.fact).toBe('ab.backup-failed');
    expect(amendment.causation).toBe(openId);
    // And it does not then re-open, turn after turn, off the same failure.
    expect(recordAbortIncidents(args)).toBe(0);
    expect(incidents(core)).toHaveLength(2);
  });

  test('the abort halt is per site: a failure on Bravo leaves Alpha alone', () => {
    const core = newCore();
    gatedCall(core, { tool: 'bulk_plugin_update', siteId: SITE_A, result: 'success', at: SCAN_AT });
    gatedCall(core, { tool: 'bulk_plugin_update', siteId: SITE_B, result: 'failure', at: SCAN_AT });
    expect(recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger })).toBe(1);
    const [event] = incidents(core);
    expect(event.entity.site).toBe(siteEntityId(core.entities, SITE_B));
  });

  test('an unreadable ledger, an absent run and an absent runbook are all silent', () => {
    const core = newCore();
    expect(() =>
      recordAbortIncidents({ run: undefined as never, runbook: anchorRunbook(core), ledger: core.ledger })
    ).not.toThrow();
    expect(() =>
      recordAbortIncidents({ run: run(core), runbook: undefined as never, ledger: core.ledger })
    ).not.toThrow();
    const faulty = {
      query: () => {
        throw new Error('ledger is gone');
      },
    };
    expect(() =>
      recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: faulty as never })
    ).not.toThrow();
    expect(incidents(core)).toHaveLength(0);
  });

  test('an abort mints no entity — the sites are the ones the run already touched', () => {
    const core = newCore();
    gatedCall(core, { tool: 'wpe_backup_and_verify', siteId: SITE_A, result: 'failure', at: SCAN_AT });
    const before = entityCount(core);
    recordAbortIncidents({ run: run(core), runbook: anchorRunbook(core), ledger: core.ledger });
    expect(entityCount(core)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// WP-51 item 1 · the scan is an ACT, and that is what makes its id valid
// ---------------------------------------------------------------------------

/**
 * WP-50's gate ruling, §7.1: *"Mint the scan's TaskId. A sentinel scan is an ACT
 * and belongs in the record as one; its findings then carry a real
 * `correlation: task_<ULID>`. The envelope validator is not bent — the id
 * becomes valid because the thing it names becomes real."*
 *
 * The second sentence is the one with teeth, and it is the invariant these
 * cases exist to hold: **a correlation is written only when the act it names
 * was recorded.** Minting an id and stamping it on four findings while nothing
 * anywhere describes the scan would satisfy the validator's REGEX and be a
 * fabricated join — the exact thing WP-48a refused to do with `causation`.
 */
describe('WP-51 · the scan mints a TaskId, and the act it names is on the record', () => {
  const scanActs = (core: IntelligenceCore) =>
    core.ledger.query({ topicPrefix: SCAN_TOPIC, limit: 100 });

  test('one act per report, and every finding it wrote carries that act as its correlation', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      sweep({
        [SITE_A]: {
          status: 'escalated',
          findings: [
            { id: 'ABS-05', severity: 'critical', title: 'Known backdoor plugin detected: wp-compat' },
            { id: 'FS-01', severity: 'critical', title: 'PHP file(s) in mu-plugins/: index.php' },
          ],
        },
        [SITE_B]: {
          status: 'escalated',
          findings: [{ id: 'ABS-04', severity: 'high', title: 'File manager plugin(s) active' }],
        },
      }),
      { services: services() }
    );

    // shape #15: assert the events exist before asserting anything about them.
    expect(written).toBe(3);
    const acts = scanActs(core);
    expect(acts).toHaveLength(1);
    const events = incidents(core);
    expect(events).toHaveLength(3);

    // ONE act for the whole report — a scan is one act however many sites it
    // covers, and an act per site would make the health surface count scans by
    // fleet size.
    const [act] = acts;
    expect(act.correlation).toMatch(/^task_[0-9A-HJKMNP-TV-Z]{16,26}$/);
    for (const event of events) expect(event.correlation).toBe(act.correlation);
  });

  test('the act is stamped with the SCAN\'s time and names what the report says', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({
        [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] },
        [SITE_B]: { status: 'clean', findings: [], notChecked: [] },
      }),
      { services: services() }
    );
    const [act] = scanActs(core);
    expect(act).toBeDefined();
    expect(act.topic).toBe(SCAN_TOPIC);
    expect(act.schema).toBe(SCAN_SCHEMA);
    // Rule 1 of this file, applied to the act: the scan's own completion time,
    // never the fold's.
    expect(act.observed_at).toBe(SCAN_AT);
    expect(Date.parse(act.recorded_at)).toBeGreaterThan(Date.parse(act.observed_at));
    expect(act.payload).toEqual({ agent: SENTINEL_AGENT_ID, run: 'r_scan_1', sites: 2 });
    // A scan spans the sites in its report; stamping ONE of them would
    // misattribute the act to that site. The FINDINGS carry the entity.
    expect(act.entity).toEqual({});
    expect(act.actor.id).toBe('act_security_sentinel');
    expect(act.source).toEqual({ class: 'work', system: 'sentinel:scan', trust: 'emitted' });
  });

  test('a report with no run id records the act without inventing one', () => {
    const core = newCore();
    recordSentinelIncidents(
      { ...sweep({ [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] } }), runId: undefined },
      { services: services() }
    );
    const [act] = scanActs(core);
    expect(act).toBeDefined();
    expect(act.payload).toEqual({ agent: SENTINEL_AGENT_ID, sites: 1 });
    expect(Object.keys(act.payload)).not.toContain('run');
  });

  test('A SCAN THAT RECORDS NOTHING RECORDS NO ACT — the record takes change, not repetition', () => {
    // P4's rule, and the reason the act is minted lazily rather than at entry:
    // security-sentinel runs on a timer, so an act per sweep would be one row a
    // day per fleet forever, saying nothing. The scan that finds nothing new is
    // the overwhelmingly common case.
    const core = newCore();
    const clean = sweep({ [SITE_A]: { status: 'clean', findings: [], notChecked: [] } });
    expect(recordSentinelIncidents(clean, { services: services() })).toBe(0);
    expect(scanActs(core)).toHaveLength(0);
    expect(incidents(core)).toHaveLength(0);

    // …and the same finding on a SECOND scan is deduped, so the second scan
    // records neither an incident nor an act.
    const found = sweep({
      [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] },
    });
    expect(recordSentinelIncidents(found, { services: services() })).toBe(1);
    expect(scanActs(core)).toHaveLength(1);
    expect(recordSentinelIncidents({ ...found, runId: 'r_scan_2' }, { services: services() })).toBe(0);
    expect(scanActs(core)).toHaveLength(1);
  });

  test('a resolution carries the CLOSING scan\'s act, not the opening one\'s', () => {
    const core = newCore();
    recordSentinelIncidents(
      sweep({ [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] } }),
      { services: services() }
    );
    recordSentinelIncidents(
      sweep({ [SITE_A]: { status: 'clean', findings: [], notChecked: [] } }, LATER_SCAN_AT, 'r_scan_2'),
      { services: services() }
    );

    const acts = scanActs(core);
    expect(acts).toHaveLength(2);
    const events = incidents(core);
    expect(events).toHaveLength(2);
    const opened = events.find((e) => (e.payload as Record<string, unknown>).resolved === false)!;
    const closed = events.find((e) => (e.payload as Record<string, unknown>).resolved === true)!;
    const firstScan = acts.find((a) => (a.payload as Record<string, unknown>).run === 'r_scan_1')!;
    const secondScan = acts.find((a) => (a.payload as Record<string, unknown>).run === 'r_scan_2')!;

    expect(opened.correlation).toBe(firstScan.correlation);
    // The amendment is an observation OF THE SECOND SCAN. Carrying the first
    // scan's task would say the closing was observed by the scan that opened it.
    expect(closed.correlation).toBe(secondScan.correlation);
    expect(closed.correlation).not.toBe(opened.correlation);
  });

  test('THE ID IS VALID BECAUSE THE ACT IS REAL — an unrecordable act leaves the findings uncorrelated', () => {
    // The ruling's own sentence, driven. If the act cannot be written, a
    // correlation stamped on the findings would pass the validator's regex and
    // name NOTHING — a fabricated join, which is precisely what WP-48a refused
    // to do rather than route around.
    const core = newCore();
    const refuseTheAct = {
      ...core,
      emitter: {
        emit: (draft: { topic?: string }) => {
          if (draft.topic === SCAN_TOPIC) throw new Error('the act could not be recorded');
          return core.emitter.emit(draft as never);
        },
      },
    } as unknown as IntelligenceCore;

    const written = recordSentinelIncidents(
      sweep({
        [SITE_A]: {
          status: 'escalated',
          findings: [
            { id: 'ABS-05', severity: 'critical', title: 'a' },
            { id: 'FS-01', severity: 'critical', title: 'b' },
          ],
        },
      }),
      { services: services(), core: refuseTheAct }
    );

    // The incidents are still recorded — the layer is non-fatal by construction
    // and a lost act must not cost the finding.
    expect(written).toBe(2);
    const events = incidents(core);
    expect(events).toHaveLength(2);
    expect(scanActs(core)).toHaveLength(0);
    for (const event of events) expect(event.correlation).toBeUndefined();
  });

  test('the return value counts INCIDENTS, not the act beside them', () => {
    const core = newCore();
    const written = recordSentinelIncidents(
      sweep({ [SITE_A]: { status: 'escalated', findings: [{ id: 'FS-02', severity: 'critical', title: 'x' }] } }),
      { services: services() }
    );
    expect(written).toBe(1);
    expect(incidents(core)).toHaveLength(1);
    expect(scanActs(core)).toHaveLength(1);
  });
});
