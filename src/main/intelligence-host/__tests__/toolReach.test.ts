/**
 * WP-20g · RULE 7 — reach. The half of the deny-flip that subtracts REACH.
 *
 * WP-20f made a grant an explicit act and then said, in its own delivery note,
 * exactly what it had NOT done: *"v0 grants remain ADDITIVE over the tool
 * surface, so denying these two subtracts CEREMONY and not REACH.
 * `wpe_promote_environment` is reachable today with no procedure at all."*
 * This suite is that sentence being retired, and the first section is the proof
 * in the terms the packet was set: the tool is unreachable without a grant, and
 * a grant restores it.
 *
 * THREE DISCIPLINES THIS SUITE HOLDS ITSELF TO.
 *
 *  1. **The premise is asserted before the refusal is read.** A refusal that
 *     passed because nothing served the capability would be worthless, and
 *     WP-20f's own suite established the shape: assert that the capability IS
 *     served here and is NOT granted, then read the message.
 *  2. **Nothing hardcodes the binding.** The shipped assertions read the
 *     document through the real registry, and one test greps this repository's
 *     own guard source to pin that IT names no tool either. A binding a human
 *     typed into `sequenceGuard.ts` would pass every behavioural test in this
 *     file and be the exact thing the packet was forbidden to build.
 *  3. **What is NOT true is pinned too.** `cap.incident_remediation` binds no
 *     tool in shipped law, and `rb.promotion-execute` declares no attestable
 *     checkpoint. Both are recorded as tests rather than left for a reader to
 *     assume otherwise — see their own comments.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { armProcedureRun, forgetProcedureRun, registerProcedureTurn } from '../procedureCursor';
import { clearArmingRequests } from '../procedureArming';
import { checkCheckpointSequence as guardWithCaller } from '../sequenceGuard';

/**
 * Phase 2 (fixes-082526) made the guard PER CALLER; this suite's subject is
 * the sequence/reach rules themselves, so every call asks as 'chat' — the
 * builtin identity its fixtures grant to. The per-caller semantics have
 * their own pins in agentGranteeGate.test.ts.
 */
const checkCheckpointSequence = (toolName: string, taskId?: string) =>
  guardWithCaller(toolName, taskId, 'chat');

import {
  BUILTIN_GRANTEES,
  MANDATED_EXPLICIT_CAPABILITIES,
  MATERIALIZED_STORAGE_KEY,
  getCapabilityGrants,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { taskId as mintTaskId } from '../../../intelligence';
import type { Runbook, RunbookRegistry } from '../../../intelligence';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const PROMOTE = 'cap.promote_environment';
const REMEDIATE = 'cap.incident_remediation';
const ANCHOR = 'cap.bulk_plugin_update';
const PROMOTE_TOOL = 'wpe_promote_environment';

let core: IntelligenceCore;
let dir: string;
let kv: Map<string, unknown>;
let task: string;

const storage = () => ({
  get: (k: string) => kv.get(k) ?? null,
  set: (k: string, v: unknown) => kv.set(k, v),
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-reach-'));
  kv = new Map<string, unknown>();
  // The boot itself runs WP-20f's migration, so every test below stands on a
  // machine that has ALREADY crossed the flip — which is the machine the reach
  // half is about.
  core = initIntelligenceCore({ storage: storage(), logger: silent, dataDir: dir })!;
  setIntelligenceCore(core);
  clearArmingRequests();
  forgetProcedureRun('s1');
  task = mintTaskId();
});

afterEach(() => {
  clearArmingRequests();
  setIntelligenceCore(core);
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write an explicit settings grant and re-resolve, the way `onSettingsUpdated` does. */
function grant(...capabilities: string[]): void {
  kv.set(STORAGE_KEYS.SETTINGS, {
    // Named to a grantee since the agent-addressing flip; the reach gate is
    // grantee-blind in phase 1 (any holder opens reach — phase 2 keys it on
    // the caller), so one builtin suffices.
    capabilityGrants: capabilities.map((capability) => ({ grantee: BUILTIN_GRANTEES[0], capability })),
  });
  syncCapabilityGrants({ core, storage: storage(), logger: silent });
}

function granted(): string[] {
  // DISTINCT capabilities — one per (grantee, capability) since the flip.
  return [...new Set(getCapabilityGrants().map((g) => g.capability))].sort();
}

// ---------------------------------------------------------------------------
// 1 · THE PROOF, over shipped law
// ---------------------------------------------------------------------------

describe('the mandated capabilities, on a machine that has crossed the flip', () => {
  test('PREMISE: promote_environment is SERVED here and is NOT granted', () => {
    // Read first, because both halves of the proof below are worthless without
    // it. A refusal on a capability nothing serves proves nothing.
    expect(core.law!.runbooks.byCapability(PROMOTE)?.id).toBe('rb.promotion-execute');
    expect(MANDATED_EXPLICIT_CAPABILITIES).toContain(PROMOTE);
    expect(granted()).not.toContain(PROMOTE);
    // ...and the tool really is declared by that document, derived not assumed.
    expect(
      core
        .law!.runbooks.byCapability(PROMOTE)!
        .checkpoints.filter((c) => (c.tools ?? []).some((t) => t.name === PROMOTE_TOOL))
        .map((c) => c.id)
    ).toEqual(['cp.promote']);
  });

  test('wpe_promote_environment is UNREACHABLE without a grant — no run, no request, no task', () => {
    // `undefined` for the task id on purpose: this must refuse with nothing
    // armed and nothing pending, which is precisely the state WP-20f left
    // reachable. Every other rule in the guard needs a run or a request.
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined)!;

    expect(refusal.reason).toBe('not-granted');
    expect(refusal.capability).toBe(PROMOTE);
    expect(refusal.runbookId).toBe('rb.promotion-execute');
    expect(refusal.checkpoint).toBe('cp.promote');
    expect(refusal.claimedBy).toBe('cp.promote');
    // WP-31's payload contract, built by the same `governDoorFor` the other
    // refusals use — one builder, so a model's door and a human's cannot drift.
    expect(refusal.governDoor).toEqual({
      surface: 'settings',
      section: 'capabilities',
      capability: PROMOTE,
      runbookId: 'rb.promotion-execute',
    });
    // The message states the LAW, and says the turn cannot change it — the
    // 2026-08-18 lesson that a model reads "not yet" as an invitation to retry.
    expect(refusal.message).toContain('NEVER granted by default');
    expect(refusal.message).toContain('Nothing you can do in this turn grants it');
    expect(refusal.message).toContain(PROMOTE_TOOL);
    expect(refusal.message).toContain('rb.promotion-execute');
  });

  test('an explicit grant RESTORES reach — same call, same machine, one settings entry apart', () => {
    expect(checkCheckpointSequence(PROMOTE_TOOL, task)).not.toBeNull();

    grant(PROMOTE);

    expect(granted()).toContain(PROMOTE);
    expect(checkCheckpointSequence(PROMOTE_TOOL, task)).toBeNull();
  });

  test('THE ASTERISK IS RETIRED (WP-45): a granted promotion run is now SEQUENCED, not merely reachable', () => {
    // WP-20g recorded an honest asterisk here: granting `cap.promote_environment`
    // restored REACH but gated nothing after it, because every checkpoint of
    // rb.promotion-execute defaulted to narrative. That tripwire was written to
    // FAIL the day a law edit added `attest: event` to cp.backup or cp.approval,
    // "rather than silently changing what this suite believes". The ratified
    // attestation law review is that edit, and this is the tripwire being read.
    //
    // Read from the document through the real registry — nothing here is typed
    // from the review note.
    const rb = core.law!.runbooks.byCapability(PROMOTE)!;
    expect(rb.checkpoints.map((c) => c.attest)).toEqual([
      'event',      // cp.backup
      'event',      // cp.approval
      'event',      // cp.promote
      'narrative',  // cp.verify-destination
      'narrative',  // cp.report
    ]);

    grant(PROMOTE);
    armProcedureRun({ sessionId: 's1', capability: PROMOTE, runbookId: rb.id, runbookHash: rb.hash });
    registerProcedureTurn({ sessionId: 's1', taskId: task });

    // The grant is held and reach is restored — rule 7 is satisfied — and the
    // write is STILL refused, by the sequencer, because the backup and the
    // consent in front of it are now checkpoints the platform can require.
    // This is the review's acceptance criterion at the gate rather than in the
    // gates column: the backup that makes the overwrite recoverable is no
    // longer something a run can simply skip.
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, task)!;
    expect(refusal).not.toBeNull();
    expect(refusal.reason).not.toBe('not-granted');
    expect(refusal.checkpoint).toBe('cp.backup');
  });

  test('THE RECORDED GAP: cap.incident_remediation binds NO tool in shipped law, so reach cannot bite for it', () => {
    // The ruling of 2026-08-19: the remediation half is DERIVED or it waits,
    // and `cp.execute-cleanup`'s body names no instrument — it enumerates a
    // CATALOGUE of destructive classes ("item by item") and the one
    // tool-shaped name in the document (`wp_plugin_list`, in
    // `requires_sources`) is a read in the bill of intelligence, which the
    // design note explicitly forbids deriving from. So this half is
    // fixture-proven and the gap is recorded HERE, as an assertion, not as a
    // sentence in a report nobody re-runs.
    const rb = core.law!.runbooks.byCapability(REMEDIATE)!;
    const declared = rb.checkpoints.flatMap((c) => [
      ...(c.tools ?? []).map((t) => t.name),
      ...(c.evidence?.tool ? [c.evidence.tool] : []),
    ]);

    expect(declared).toEqual([]);
    expect(granted()).not.toContain(REMEDIATE);
  });
});

// ---------------------------------------------------------------------------
// 2 · What rule 7 does NOT touch — the parity floor
// ---------------------------------------------------------------------------

describe('the parity floor', () => {
  test('the anchor capability is materialized, so all three of its tools stay reachable', () => {
    // WP-20g's own disclosure, as a pin: `cap.bulk_plugin_update` is strict and
    // not mandated, so WP-20f's migration materializes it, so rule 7 refuses
    // NOTHING on a default machine. Anyone reading "WP-20g made the deny-flip
    // subtract reach" should find this test in the same breath.
    expect(granted()).toContain(ANCHOR);

    for (const tool of ['bulk_plugin_update', 'wpe_backup_and_verify', 'verify_site_live']) {
      expect([tool, checkCheckpointSequence(tool, task)]).toEqual([tool, null]);
    }
  });

  /**
   * WP-45 · THE ONE REACH NARROWING THIS PACKET INTRODUCES, disclosed as a test
   * rather than as a sentence in a report.
   *
   * P3 gives cp.backup `tools: [wpe_create_backup, wpe_backup_and_verify]`,
   * quoted from the document's own text. The second was already declared by the
   * anchor, so adding a declarer only WIDENS it — reach is a disjunction. The
   * FIRST was declared by nothing, which put it in rule 7's zero case: the
   * legacy surface, reachable with no grant at all. It now has exactly one
   * declaring capability, and that capability is MANDATED-EXPLICIT, so on a
   * default machine `wpe_create_backup` moves from reachable to refused.
   *
   * That is WP-20d's permanently-narrowed-surface trap in miniature, and it is
   * accepted here rather than overlooked: the tool creates a backup on a WP
   * Engine install, the document that names it is the one governing overwrites
   * of live environments, and rule 7's whole claim is that a write bound to a
   * capability is unreachable without it. Recorded so the next reader finds the
   * consequence beside the declaration instead of discovering it in the field.
   */
  test('WP-45: wpe_create_backup leaves the zero case and is now grant-gated', () => {
    const rb = core.law!.runbooks.byCapability(PROMOTE)!;
    const backup = rb.checkpoints.find((c) => c.id === 'cp.backup')!;
    expect(backup.tools.map((t) => t.name)).toEqual(['wpe_create_backup', 'wpe_backup_and_verify']);

    // Ungranted (cap.promote_environment is never granted by default): refused.
    expect(granted()).not.toContain(PROMOTE);
    const refusal = checkCheckpointSequence('wpe_create_backup', task)!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.capability).toBe(PROMOTE);
    expect(refusal.checkpoint).toBe('cp.backup');

    // And the grant restores it, which is what makes this a gate and not a ban.
    grant(PROMOTE);
    expect(checkCheckpointSequence('wpe_create_backup', task)).toBeNull();
  });

  test('WP-45: wpe_backup_and_verify was already declared, so it only WIDENED', () => {
    // Two declaring capabilities now. Reach is a disjunction, so the anchor's
    // materialized grant still reaches it with cap.promote_environment denied —
    // the direction that proves nothing was taken away here.
    expect(granted()).toContain(ANCHOR);
    expect(granted()).not.toContain(PROMOTE);
    expect(checkCheckpointSequence('wpe_backup_and_verify', task)).toBeNull();
  });

  test('a tool NO runbook declares is untouched — the zero case falls through', () => {
    // `wp_plugin_update` is a tier-2 WRITE, so this pass is attributable to the
    // binding being empty and not to the tier gate. It is also the tool the
    // 2026-08-18 incident reached the effect through, so its behaviour here is
    // worth stating: rule 7 does not touch it, and rule 5 still does.
    expect(checkCheckpointSequence('wp_plugin_update', task)).toBeNull();
  });

  test('reads are untouched even when the tier gate is the only thing standing', () => {
    expect(checkCheckpointSequence('nexus_list_sites', task)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixtures — the boundaries shipped law cannot exhibit
// ---------------------------------------------------------------------------

const HASH = `sha256:${'b'.repeat(64)}`;

function fixture(opts: {
  id: string;
  capability: string;
  tools?: string[];
  evidenceTool?: string;
}): Runbook {
  return {
    id: opts.id,
    version: '1.0.0',
    capability: opts.capability,
    strictness: 'strict',
    path: `runbooks/${opts.id}.md`,
    hash: HASH,
    canonicalBytes: 100,
    checkpoints: [
      {
        id: 'cp.act',
        attest: 'event',
        ...(opts.evidenceTool
          ? { evidence: { topic: 'task.action.executed', tool: opts.evidenceTool } }
          : {}),
        tools: (opts.tools ?? []).map((name) => ({ name })),
      },
    ],
    steps: [],
    tools: [],
    toolScope: 'exclusive',
    body: '',
    canonicalText: '',
    frontmatter: {},
  } as Runbook;
}

function stubRegistry(runbooks: Runbook[]): RunbookRegistry {
  return {
    runbooks: () => runbooks,
    byCapability: (c: string) => runbooks.find((r) => r.capability === c),
    byId: (i: string) => runbooks.find((r) => r.id === i),
    documents: () => [],
    errors: () => [],
    warnings: () => [],
  } as unknown as RunbookRegistry;
}

/**
 * Serve a synthetic law set and resolve grants against it.
 *
 * The materialized marker is seeded EMPTY so nothing is granted by derivation —
 * the settings overlay is then the only source, which is what makes each
 * fixture's grant state exactly what the test says it is.
 */
function serve(runbooks: Runbook[], grants: string[] = []): void {
  const fake = { ...core, law: { ...core.law!, runbooks: stubRegistry(runbooks) } } as IntelligenceCore;
  setIntelligenceCore(fake);
  // v2-empty: nothing granted by derivation, and no v1 shape for the
  // agent-addressing flip to fire on mid-fixture.
  kv.set(MATERIALIZED_STORAGE_KEY, { version: 2, migratedAt: '2026-08-19T00:00:00.000Z', grants: [] });
  kv.set(STORAGE_KEYS.SETTINGS, {
    capabilityGrants: grants.map((capability) => ({ grantee: BUILTIN_GRANTEES[0], capability })),
  });
  syncCapabilityGrants({ core: fake, storage: storage(), logger: silent });
}

// A name absent from the safety table, which defaults it to Tier 2 — a write.
const FIXTURE_TOOL = 'fixture_write_tool';

// ---------------------------------------------------------------------------
// 3 · The binding is DERIVED
// ---------------------------------------------------------------------------

describe('the binding is derived from law, never authored', () => {
  test('the guard source names no tool of its own', () => {
    // The structural pin. Every behavioural test in this file would pass
    // against a hand-authored map in `sequenceGuard.ts`, which is the one
    // implementation the packet was forbidden to build.
    const src = fs.readFileSync(path.join(__dirname, '..', 'sequenceGuard.ts'), 'utf8');
    // The tool names that appear in shipped law, plus the two the incident
    // record names. `bulk_plugin_update` appears in this file's own prose about
    // rules 2 and 6, so the assertion is over CODE with comments stripped.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const tool of [
      'wpe_promote_environment',
      'bulk_plugin_update',
      'wpe_backup_and_verify',
      'verify_site_live',
      'wp_plugin_update',
    ]) {
      expect([tool, code.includes(tool)]).toEqual([tool, false]);
    }
  });

  test('a declared tool binds; the same runbook without the declaration does not', () => {
    serve([fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [FIXTURE_TOOL] })]);
    expect(checkCheckpointSequence(FIXTURE_TOOL, undefined)!.reason).toBe('not-granted');

    // The ONLY difference is the declaration. The document changed; the binding
    // changed the same day, which is the property a hardcoded list lacks.
    serve([fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [] })]);
    expect(checkCheckpointSequence(FIXTURE_TOOL, undefined)).toBeNull();
  });

  test('`evidence.tool` is a declaration too — the same two places abortForTool reads', () => {
    serve([fixture({ id: 'rb.alpha', capability: 'cap.alpha', evidenceTool: FIXTURE_TOOL })]);

    const refusal = checkCheckpointSequence(FIXTURE_TOOL, undefined)!;
    expect([refusal.reason, refusal.capability]).toEqual(['not-granted', 'cap.alpha']);
  });
});

// ---------------------------------------------------------------------------
// 4 · Zero, one, many
// ---------------------------------------------------------------------------

describe('zero falls through, many fails closed', () => {
  const two = () => [
    fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [FIXTURE_TOOL] }),
    fixture({ id: 'rb.beta', capability: 'cap.beta', tools: [FIXTURE_TOOL] }),
  ];

  test('TWO declaring capabilities, neither granted: refused, and the message names BOTH', () => {
    // Ruled 2026-08-19, overruling this packet's own permissive proposal: a
    // tool two capabilities declare is MORE governed, not less. The permissive
    // reading would let a second runbook declaring an already-protected tool
    // silently un-protect it.
    serve(two());

    const refusal = checkCheckpointSequence(FIXTURE_TOOL, undefined)!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toContain('cap.alpha');
    expect(refusal.message).toContain('cap.beta');
    expect(refusal.message).toContain('granting ANY ONE of');
    // The door names one — sufficient, because this is a disjunction — and the
    // one it names is deterministic across boots.
    expect(refusal.governDoor.capability).toBe('cap.alpha');
  });

  test('granting EITHER one restores reach — the disjunction, both directions', () => {
    serve(two(), ['cap.alpha']);
    expect(checkCheckpointSequence(FIXTURE_TOOL, undefined)).toBeNull();

    // The second direction matters: an implementation that only consulted the
    // capability its door names would pass the first half and fail here.
    serve(two(), ['cap.beta']);
    expect(checkCheckpointSequence(FIXTURE_TOOL, undefined)).toBeNull();
  });

  test('ONE capability declaring a tool at two checkpoints is not the many case', () => {
    const rb = fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [FIXTURE_TOOL] });
    serve([{ ...rb, checkpoints: [...rb.checkpoints, { ...rb.checkpoints[0], id: 'cp.again' }] }]);

    const refusal = checkCheckpointSequence(FIXTURE_TOOL, undefined)!;
    expect(refusal.capability).toBe('cap.alpha');
    expect(refusal.message).not.toContain('granting ANY ONE of');
    // Rule 2's shape: the EARLIEST declaring checkpoint is the one named.
    expect(refusal.claimedBy).toBe('cp.act');
  });

  test('a tier-1 read a runbook declares is still reachable', () => {
    serve([fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: ['nexus_list_sites'] })]);

    expect(checkCheckpointSequence('nexus_list_sites', undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5 · The disarmed row's own reason rides the refusal
// ---------------------------------------------------------------------------

describe('why it is not granted is not interchangeable', () => {
  test('disabled-by-settings says so, and says what restores it', () => {
    const fake = { ...core, law: { ...core.law!, runbooks: stubRegistry([fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [FIXTURE_TOOL] })]) } } as IntelligenceCore;
    setIntelligenceCore(fake);
    kv.set(MATERIALIZED_STORAGE_KEY, { version: 1, migratedAt: '2026-08-19T00:00:00.000Z', capabilities: ['cap.alpha'] });
    kv.set(STORAGE_KEYS.SETTINGS, { capabilityGrants: BUILTIN_GRANTEES.map((grantee) => ({ grantee, capability: 'cap.alpha', enabled: false })) });
    syncCapabilityGrants({ core: fake, storage: storage(), logger: silent });

    const refusal = checkCheckpointSequence(FIXTURE_TOOL, undefined)!;
    expect(refusal.message).toContain('switched OFF in settings');
    expect(refusal.message).not.toContain('NEVER granted by default');
  });

  test('hash-mismatch says INTEGRITY, not "not granted yet"', () => {
    // §6(b): the document on disk is not the document that was reviewed. A
    // message that said "grant it" would send the user to re-grant against a
    // file whose change nobody has read.
    const fake = { ...core, law: { ...core.law!, runbooks: stubRegistry([fixture({ id: 'rb.alpha', capability: 'cap.alpha', tools: [FIXTURE_TOOL] })]) } } as IntelligenceCore;
    setIntelligenceCore(fake);
    kv.set(MATERIALIZED_STORAGE_KEY, { version: 1, migratedAt: '2026-08-19T00:00:00.000Z', capabilities: [] });
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: BUILTIN_GRANTEES.map((grantee) => ({ grantee, capability: 'cap.alpha', runbookHash: `sha256:${'c'.repeat(64)}` })),
    });
    syncCapabilityGrants({ core: fake, storage: storage(), logger: silent });

    const refusal = checkCheckpointSequence(FIXTURE_TOOL, undefined)!;
    expect(refusal.message).toContain('integrity, not staleness');
  });
});

// ---------------------------------------------------------------------------
// 6 · Fault isolation — rule 7 must never take rules 1-6 down with it
// ---------------------------------------------------------------------------

describe('a fault in rule 7 is not in the path', () => {
  test('a registry that cannot enumerate degrades to null AND leaves the other rules working', () => {
    // This is not hypothetical hardening: several suites in this directory stub
    // the registry as `{ byCapability }` alone, and rule 7 runs FIRST. Without
    // its own catch, its throw would fall into `checkCheckpointSequence`'s and
    // silently disable rules 1-6 — every one of those suites would go green for
    // the wrong reason.
    const rb = fixture({ id: 'rb.alpha', capability: ANCHOR, tools: [FIXTURE_TOOL] });
    setIntelligenceCore({
      ...core,
      law: { ...core.law!, runbooks: { byCapability: () => rb } },
    } as never);
    armProcedureRun({ sessionId: 's1', capability: ANCHOR, runbookId: rb.id, runbookHash: rb.hash });
    registerProcedureTurn({ sessionId: 's1', taskId: task });

    // Rule 7 cannot answer, so it says nothing...
    expect(checkCheckpointSequence('nexus_list_sites', task)).toBeNull();
    // ...and rule 5 still refuses the unclaimed write, which is the half that
    // would be lost if rule 7's fault escaped into the shared catch.
    expect(checkCheckpointSequence('wp_plugin_update', task)!.reason).toBe('exclusive-scope');
  });

  test('no core at all: nothing is in the path', () => {
    setIntelligenceCore(undefined as never);

    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined)).toBeNull();
  });
});
