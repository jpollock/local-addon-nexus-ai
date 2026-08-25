/**
 * WP-57 Task 5 · the parity proof, against the REAL guard.
 *
 * Before this packet the agent path called ToolRegistry.call with
 * `task: undefined`; now it passes a real task id. Both must reach the SAME
 * refusal decision, or the packet has silently changed what agents may do.
 * This drives `checkCheckpointSequence` itself — not a mock.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp57-parity-'));
const { initIntelligenceCore } = require('../../src/main/intelligence-host/bootstrap');
const { setIntelligenceCore } = require('../../src/main/intelligence-host/coreRegistry');
const { checkCheckpointSequence } = require('../../src/main/intelligence-host/sequenceGuard');
const { taskId } = require('../../src/intelligence');

const kv = new Map<string, unknown>();
const core = initIntelligenceCore({
  storage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) },
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  dataDir: dir,
});
setIntelligenceCore(core);

const TOOLS = [
  'wp_plugin_list',           // tier-1 read
  'wpe_site_deep_refresh',    // tier-2, agent uses it live
  'bulk_plugin_update',       // the anchor capability's own tool
  'wpe_create_backup',
  'wp_plugin_update',
  'wp_core_update',
  'local_wpe_push',
  'nexus_site_refresh',
];

const norm = (r: unknown) =>
  r === null || r === undefined ? 'ALLOW' : JSON.stringify(r);

let mismatches = 0;
console.log('tool'.padEnd(26), '| unframed'.padEnd(12), '| framed');
console.log('-'.repeat(78));
for (const t of TOOLS) {
  const unframed = norm(checkCheckpointSequence(t, undefined));
  const framed = norm(checkCheckpointSequence(t, taskId()));
  const same = unframed === framed;
  if (!same) mismatches++;
  console.log(
    t.padEnd(26),
    '|', (unframed.length > 10 ? unframed.slice(0, 10) + '…' : unframed).padEnd(11),
    '|', (framed.length > 10 ? framed.slice(0, 10) + '…' : framed).padEnd(11),
    same ? '  SAME' : '  *** DIFFERENT ***'
  );
}
console.log('-'.repeat(78));
console.log(mismatches === 0
  ? `PARITY HOLDS — ${TOOLS.length}/${TOOLS.length} identical decisions`
  : `PARITY BROKEN — ${mismatches} differ`);
process.exit(mismatches === 0 ? 0 : 1);
