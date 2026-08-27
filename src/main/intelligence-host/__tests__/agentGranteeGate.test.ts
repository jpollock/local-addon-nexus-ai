/**
 * fixes-082526 · agent-addressed grants, phase 2 — the gate learns who is
 * asking.
 *
 * Phase 1 made the grant unit (grantee, capability); until this phase the
 * reach check was grantee-blind — ANY holder opened the tool for EVERY
 * caller, which reduces agent addressing to a bookkeeping exercise. Now the
 * CALLER's grantee must hold a declaring capability, the refusal names both
 * the holder set and the asker, and an unattributable caller holds nothing
 * (fail closed — an identity the platform cannot establish is not one it
 * grants things to).
 *
 * Reads stay untouched on every path: the parity floor is per-surface, not
 * per-identity.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  CHAT_GRANTEE,
  MCP_CLIENT_GRANTEE,
  syncCapabilityGrants,
} from '../capabilityGrants';
import { checkCheckpointSequence } from '../sequenceGuard';
import { agentActorId, agentNameFromActorId } from '../agentTaskFrame';
import { STORAGE_KEYS } from '../../../common/constants';

const silent = { info: () => {}, error: () => {} };
const AGENT = 'security-sentinel';
// A write tool the shipped strict promotion runbook declares — the same
// anchor toolReach uses for the mandated path, chosen because nothing
// materializes its capability (mandated-explicit), so every grant here is
// this suite's own explicit act.
const PROMOTE = 'cap.promote_environment';
const PROMOTE_TOOL = 'wpe_promote_environment';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-ggate-'));
  kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});
afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const storage = () => ({ get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) });

function grantTo(...grantees: string[]): void {
  kv.set(STORAGE_KEYS.SETTINGS, {
    capabilityGrants: grantees.map((grantee) => ({ grantee, capability: PROMOTE, enabled: true })),
  });
  syncCapabilityGrants({ core, storage: storage(), logger: silent });
}

describe('reach is per caller', () => {
  it('the grantee that holds it passes; one that does not is refused BY NAME', () => {
    grantTo(AGENT);
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, AGENT)?.reason ?? null).not.toBe('not-granted');
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, CHAT_GRANTEE)!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toContain(AGENT);        // who holds it
    expect(refusal.message).toContain(CHAT_GRANTEE); // who asked and does not
  });

  it("another grantee's grant no longer opens the tool for everyone — the phase-1 blindness is dead", () => {
    grantTo(MCP_CLIENT_GRANTEE);
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, AGENT)?.reason).toBe('not-granted');
  });

  it('an unattributable caller holds nothing — fail closed, and the message says so', () => {
    grantTo(AGENT);
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, undefined)!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toMatch(/unattributable|could not be attributed/i);
  });

  it('with NO holder at all the refusal says nobody holds it, not a fabricated holder list', () => {
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, CHAT_GRANTEE)!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toMatch(/no grantee holds|not granted/i);
  });

  it('reads are untouched for every identity, attributed or not — the parity floor', () => {
    expect(checkCheckpointSequence('nexus_list_sites', undefined, undefined)).toBeNull();
    expect(checkCheckpointSequence('nexus_list_sites', undefined, CHAT_GRANTEE)).toBeNull();
  });
});

describe('agentNameFromActorId — the pinned inverse', () => {
  it('round-trips every shipped agent name', () => {
    for (const name of ['security-sentinel', 'log-processor', 'seo-insights', 'web-analytics']) {
      expect(agentNameFromActorId(agentActorId(name))).toBe(name);
    }
  });

  it('a non-act id resolves to nothing, never a guessed agent', () => {
    // The inverse is mechanical over act_ ids and is CALLED only where the
    // task actor's kind says 'agent' (the registry gates on kind before
    // inverting) — a human or system actor id never reaches it. A string
    // without the prefix still refuses here, as the last net.
    expect(agentNameFromActorId('u_someone')).toBeUndefined();
    expect(agentNameFromActorId('')).toBeUndefined();
  });
});

/**
 * §D.7 · cross-agent reach — the conjunction (owner ruling 2026-08-26, C).
 * Spec: docs/planning/2026-08-26-cross-agent-reach.md
 *
 * A contributed-tool call has TWO parties: the caller that initiated and the
 * contributor whose code executes. Actor-scoping shipped checking only the
 * contributor, which is the escape §D.7 named — a capability granted to
 * log-processor reachable by anything that declares one of its tools.
 */
describe('every party to a contributed call must hold the SAME capability', () => {
  const CALLER = 'seo-insights';
  const CONTRIBUTOR = 'log-processor';
  // Declared by BOTH cap.promote_environment and cap.bulk_plugin_update
  // (law/runbooks/promotion-execute.md:48, bulk-plugin-update.md:49) — the
  // only shape that can tell a per-party disjunction from a cross-party one.
  const BACKUP_TOOL = 'wpe_backup_and_verify';
  const BULK = 'cap.bulk_plugin_update';

  function grantPairs(...pairs: Array<[string, string]>): void {
    kv.set(STORAGE_KEYS.SETTINGS, {
      capabilityGrants: pairs.map(([grantee, capability]) => ({ grantee, capability, enabled: true })),
    });
    syncCapabilityGrants({ core, storage: storage(), logger: silent });
  }

  it('THE SHIPPED HOLE: the contributor holding it does not open the tool for the caller', () => {
    grantPairs([CONTRIBUTOR, PROMOTE]);
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, [CALLER, CONTRIBUTOR])!;
    expect(refusal.reason).toBe('not-granted');
    // The remedy is only findable if the message says WHICH party is missing it.
    expect(refusal.message).toContain(CALLER);
  });

  it('the caller alone is not enough either — the contributor executes, so it holds it too', () => {
    grantPairs([CALLER, PROMOTE]);
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, [CALLER, CONTRIBUTOR])!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toContain(CONTRIBUTOR);
  });

  it('both parties holding the same declaring capability passes', () => {
    grantPairs([CALLER, PROMOTE], [CONTRIBUTOR, PROMOTE]);
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, [CALLER, CONTRIBUTOR])?.reason ?? null)
      .not.toBe('not-granted');
  });

  it('two DIFFERENT declaring capabilities do not combine into an authority neither was granted', () => {
    grantPairs([CALLER, PROMOTE], [CONTRIBUTOR, BULK]);
    expect(checkCheckpointSequence(BACKUP_TOOL, undefined, [CALLER, CONTRIBUTOR])?.reason)
      .toBe('not-granted');
    // …and the same pair on ONE capability is the passing case, so the refusal
    // above is the combination rule and not the tool being unreachable.
    grantPairs([CALLER, BULK], [CONTRIBUTOR, BULK]);
    expect(checkCheckpointSequence(BACKUP_TOOL, undefined, [CALLER, CONTRIBUTOR])?.reason ?? null)
      .not.toBe('not-granted');
  });

  it('an unattributable party refuses the call however well-granted the other is', () => {
    grantPairs([CONTRIBUTOR, PROMOTE]);
    const refusal = checkCheckpointSequence(PROMOTE_TOOL, undefined, [undefined, CONTRIBUTOR])!;
    expect(refusal.reason).toBe('not-granted');
    expect(refusal.message).toMatch(/unattributable|could not be attributed/i);
  });

  it('caller === contributor collapses to the single check — the same-agent path is unchanged', () => {
    grantPairs([AGENT, PROMOTE]);
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, [AGENT, AGENT])?.reason ?? null)
      .not.toBe('not-granted');
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, [AGENT])?.reason ?? null)
      .not.toBe('not-granted');
  });

  it('a single grantee passed as a bare string behaves exactly as before', () => {
    grantPairs([AGENT, PROMOTE]);
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, AGENT)?.reason ?? null).not.toBe('not-granted');
    expect(checkCheckpointSequence(PROMOTE_TOOL, undefined, CHAT_GRANTEE)?.reason).toBe('not-granted');
  });

  it('reads stay untouched on the cross-agent path too — the parity floor is per surface', () => {
    expect(checkCheckpointSequence('nexus_list_sites', undefined, [CALLER, CONTRIBUTOR])).toBeNull();
  });
});
