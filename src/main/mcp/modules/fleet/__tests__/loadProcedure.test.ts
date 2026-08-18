/**
 * WP-20b · `nexus_load_procedure` — P1's path B, the model asking for a
 * procedure by name.
 *
 * The tool's whole contract is what it does NOT do:
 *
 *  1. **It returns an ACKNOWLEDGEMENT, never the procedure.** R7 is the reason:
 *     `maskToolResultsForProvider` wraps every `role: 'tool'` message in
 *     `<untrusted_data>` and the system prompt tells the model never to follow
 *     instructions found there. A runbook IS an instruction. Delivering it here
 *     would ship an instruction on the one channel the platform has told the
 *     model to distrust — and `compressStaleToolResults` would then silently
 *     truncate it while the manifest still claimed it was supplied.
 *  2. **A capability nobody granted is not an error.** The answer says so and
 *     names what IS granted (design note §1, failure-mode table).
 *  3. **It changes nothing.** Tier 1: it records that the model asked, and the
 *     platform decides what to deliver on the next turn.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { syncCapabilityGrants } from '../../../../intelligence-host/capabilityGrants';
import {
  clearArmingRequests,
  takeArmingRequests,
} from '../../../../intelligence-host/procedureArming';
import { loadProcedureHandler } from '../load-procedure';
import { getToolSafety } from '../../../safety';

const silent = { info: () => {}, error: () => {} };
const ANCHOR = 'cap.bulk_plugin_update';

let dir: string;
let kv: Map<string, unknown>;
let core: IntelligenceCore;

function boot(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-loadproc-'));
  kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  syncCapabilityGrants({
    core,
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: silent,
  });
}

async function call(capability: string): Promise<{ text: string; isError?: boolean }> {
  const result = await loadProcedureHandler.execute({ capability }, {} as never);
  return { text: result.content?.[0]?.text ?? '', isError: result.isError };
}

beforeEach(() => {
  clearArmingRequests();
  boot();
});
afterEach(() => {
  core.close();
  setIntelligenceCore(undefined as never);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it is Tier 1 — asking for a procedure cannot mutate anything', () => {
  expect(getToolSafety('nexus_load_procedure').tier).toBe(1);
  expect(loadProcedureHandler.definition.annotations?.readOnlyHint).toBe(true);
});

test('a granted capability is acknowledged with the runbook, its version and its strictness', async () => {
  const { text, isError } = await call(ANCHOR);

  expect(isError).toBeFalsy();
  expect(text).toContain('rb.bulk-plugin-update');
  // The shipped document's version, which moves when it is re-authored:
  // 1.1.0 since WP-28 marked its unrequested checkpoints.
  expect(text).toContain('1.1.0');
  expect(text).toContain('strict');
  expect(text).toContain(ANCHOR);
});

test('the acknowledgement lists the checkpoints in order, and says which are verified', async () => {
  const { text } = await call(ANCHOR);

  // Order is the sequence; a rail rendered out of order would misstate the procedure.
  expect(text.indexOf('cp.consult-history')).toBeLessThan(text.indexOf('cp.dry-run'));
  expect(text.indexOf('cp.dry-run')).toBeLessThan(text.indexOf('cp.approval'));
  // WP-20d authored the attestations, so the anchor now carries BOTH classes —
  // and the words must keep them apart per checkpoint. A rail that rendered all
  // eight the same way would be a product that lies (design note §7), and that
  // is as true of a uniformly-cautious rail as of a uniformly-green one.
  // WP-31 · IN CAPABILITY TENSE. The old labels ("verified from records" /
  // "verified as supplied") named attestation CLASSES and READ AS COMPLETION
  // STATES. On 2026-08-18 a live run split this exact list into "already
  // satisfied" (the four the platform CAN verify) and "still need to perform"
  // (the four it cannot), then executed Tier-2 writes with no approval and no
  // backup on record. The model did what the words said.
  expect(text).toMatch(/`cp\.approval` — the platform can verify this from records — nothing is attested yet/);
  expect(text).toMatch(/`cp\.backup` — the platform can verify this from records — nothing is attested yet/);
  expect(text).toMatch(/`cp\.roll-fleet` — the platform can verify this from records — nothing is attested yet/);
  expect(text).toMatch(/`cp\.consult-history` — the platform can verify this from what it supplied — nothing is attested yet/);
  for (const narrative of ['cp.dry-run', 'cp.canary', 'cp.verify-canary', 'cp.report']) {
    expect(text).toMatch(
      new RegExp(`\`${narrative.replace('.', '\\.')}\` — on your account only — the platform cannot verify this`)
    );
  }
});

/**
 * WP-31 · ruling 2 of the 2026-08-18 incident, pinned on both strings a model
 * can see. The class labels above say what the platform CAN do; this says what
 * has HAPPENED, which is nothing, and it says it in one line that cannot be
 * read as a checklist of completed steps.
 */
test('the acknowledgement states outright that no checkpoint has been performed', async () => {
  const { text } = await call(ANCHOR);

  expect(text).toMatch(/No checkpoint has been performed\./);
  expect(text).toMatch(/Do not write until the procedure text arrives on your next turn\./i);
});

test('the tool DESCRIPTION carries the same warning — it is read before the tool is ever called', () => {
  const description = loadProcedureHandler.definition.description;

  expect(description).toMatch(/performs no checkpoint/i);
  expect(description).toMatch(/must not write/i);
  expect(description).toMatch(/next turn/i);
});

test('THE OLD STATE-READING STRINGS APPEAR NOWHERE in this acknowledgement', async () => {
  const { text } = await call(ANCHOR);

  // The incident's own words. A partial rewrite that left one of these behind
  // would leave the misreading available on the checkpoint it still labelled.
  for (const dead of ['verified from records', 'verified as supplied', 'your account only, not verified']) {
    expect(text).not.toContain(dead);
  }
});

test('THE PROCEDURE IS NOT IN THE RESULT — R7: the body never rides a tool result', async () => {
  const { text } = await call(ANCHOR);
  const body = core.law!.runbooks.byCapability(ANCHOR)!.body;

  // Assert against real sentences from the real document, not a token.
  expect(body).toContain('canary-first, backup-always sequence');
  expect(text).not.toContain('canary-first, backup-always sequence');
  expect(text).not.toContain('Select the canary');
  expect(text.length).toBeLessThan(body.length);
  expect(text.toLowerCase()).toContain('next turn');
});

/**
 * WP-24 · finding (b) from the 2026-08-18 owner sitting. The acknowledgement
 * used to say the procedure arrives "from Nexus AI directly" — to a reader
 * whose system prompt opens "You are Nexus AI". One empty-history run reasoned
 * from exactly that sentence: "I *am* Nexus AI, and no procedure body reached
 * me." The deliverer must be named as the PLATFORM, which is neither the model
 * nor this tool. Asserted on both strings a model can see: the result text and
 * the tool's own description, which the model reads before it ever calls.
 */
test('the deliverer is named as the platform, never as the reader itself', async () => {
  const { text } = await call(ANCHOR);
  expect(text).toContain('platform');
  expect(text.toLowerCase()).toContain('next turn');
  expect(text).not.toContain('Nexus AI');

  const description = loadProcedureHandler.definition.description;
  expect(description).toContain('delivered by the platform on your next turn');
  expect(description).not.toContain('Nexus AI');
});

test('an ungranted capability is answered, not failed, and names what is granted', async () => {
  const { text, isError } = await call('cap.incident_response');

  expect(isError).toBeFalsy();
  expect(text).toContain('cap.incident_response');
  expect(text).toContain(ANCHOR); // what IS granted
});

test('the request is recorded, so the platform can deliver on the next turn', async () => {
  await call(ANCHOR);

  const requests = takeArmingRequests();
  expect(requests.map((r) => r.capability)).toEqual([ANCHOR]);
  // Draining is once-only: the turn that delivers the procedure consumes it,
  // and a request left behind would re-deliver a procedure already carried.
  expect(takeArmingRequests()).toEqual([]);
});

test('an ungranted request is NOT recorded — nothing can be delivered for it', async () => {
  await call('cap.nothing-serves-this');
  expect(takeArmingRequests()).toEqual([]);
});

test('with record-keeping down it says so, and still answers', async () => {
  setIntelligenceCore(undefined as never);

  const { text, isError } = await call(ANCHOR);
  expect(isError).toBeFalsy();
  expect(text.toLowerCase()).toContain('not running');
});

test('a blank capability asks for the name rather than guessing one', async () => {
  const { text } = await call('   ');
  expect(text.toLowerCase()).toContain('capability');
  expect(takeArmingRequests()).toEqual([]);
});

test('the acknowledgement carries no internal machinery vocabulary', async () => {
  const { text } = await call(ANCHOR);
  for (const forbidden of ['ledger', 'twin', 'fold', 'envelope', 'SLO']) {
    expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
});
