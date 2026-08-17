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
  expect(text).toContain('1.0.0');
  expect(text).toContain('strict');
  expect(text).toContain(ANCHOR);
});

test('the acknowledgement lists the checkpoints in order, and says which are verified', async () => {
  const { text } = await call(ANCHOR);

  // Order is the sequence; a rail rendered out of order would misstate the procedure.
  expect(text.indexOf('cp.consult-history')).toBeLessThan(text.indexOf('cp.dry-run'));
  expect(text.indexOf('cp.dry-run')).toBeLessThan(text.indexOf('cp.approval'));
  // Every shipped checkpoint is narrative today (WP-20a finding 7), and the
  // words must say so: a rail that ticks all eight the same way is a product
  // that lies (design note §7, CheckpointState.attest).
  expect(text).toContain('not verified');
  expect(text).not.toMatch(/\bverified from records\b/);
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
