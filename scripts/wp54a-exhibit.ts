/**
 * WP-54a · THE REAL-LEDGER EXHIBIT — auth-probe as a situation.
 *
 * Runs the SHIPPED fold over a COPY of the owner's real
 * `~/Library/Application Support/Local/nexus-ai/ledger.db`, with one event
 * added by the SHIPPED producer from the values on the owner's real
 * `inbox_items` row. Nothing is fabricated: the agent id, the timeout and the
 * failure moment are all read out of `graph.db` at run time and printed
 * alongside the row they produce, so the exhibit can be checked against its
 * own inputs.
 *
 * THE LIVE DATABASES ARE NEVER WRITTEN. The ledger is copied to a temp dir and
 * `graph.db` is opened readonly. Run:
 *
 *   npx ts-node --transpile-only scripts/wp54a-exhibit.ts
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { initIntelligenceCore } from '../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../src/main/intelligence-host/coreRegistry';
import { recordAgentRunOutcome } from '../src/main/intelligence-host/agentFailureProducer';
import { createSessionRegistry, ageLabel } from '../src/main/intelligence-host/sessionRegistry';

const LOCAL = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp54a-exhibit-'));

// --- 1 · the real failure, read out of the real graph.db ---------------------
const graph = new Database(path.join(LOCAL, 'graph.db'), { readonly: true });
const row = graph
  .prepare(`SELECT source, title, detail, payload, first_seen_at FROM inbox_items WHERE kind='problem' ORDER BY id LIMIT 1`)
  .get() as { source: string; title: string; detail: string; payload: string; first_seen_at: number } | undefined;
graph.close();

if (!row) {
  console.error('No kind=problem inbox row on this machine — nothing to exhibit.');
  process.exit(1);
}

console.log('=== THE RECORD AS IT STANDS TODAY (graph.db · inbox_items) ===');
console.log(`  source        ${row.source}`);
console.log(`  title         ${row.title}`);
console.log(`  detail        ${row.detail}`);
console.log(`  payload       ${row.payload}`);
console.log(`  first_seen_at ${row.first_seen_at}  (${new Date(row.first_seen_at).toISOString()})`);

// The timeout is free text inside `detail` and nowhere structured — THE producer
// debt this packet pays. It is parsed HERE, in the exhibit only, purely to
// reconstruct what the runtime already had in a local when the run failed. The
// producer itself never parses: `AgentRunner` hands it `timeoutMs` directly.
const ms = /timed out after (\d+)ms/.exec(row.detail ?? '');
if (!ms) {
  console.error('The live detail line does not carry a timeout — re-measure before quoting.');
  process.exit(1);
}
const timeoutMs = Number(ms[1]);
console.log(`\n  timeout, recovered from the message for this exhibit ONLY: ${timeoutMs}ms`);
console.log('  (nothing structured carries it today — that is the debt this packet pays)');

// --- 2 · a copy of the real ledger, so the fold sees the real fleet ----------
const source = path.join(LOCAL, 'ledger.db');
const copy = path.join(dir, 'ledger.db');
fs.copyFileSync(source, copy);

const kv = new Map<string, unknown>();
const core = initIntelligenceCore({
  storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
  logger: { info: () => {}, error: () => {} },
  dataDir: dir,
})!;
setIntelligenceCore(core);

const before = core.ledger.query({ limit: 1, order: 'desc' });
const census = (core.ledger as unknown as { query(o: unknown): unknown[] });
console.log(`\n=== THE LEDGER THE FOLD READS (a copy of the real one) ===`);
console.log(`  copied from   ${source}`);
console.log(`  newest event  ${before[0]?.id ?? '(none)'}`);
console.log(`  agent-failure events before the producer runs: ${
  core.ledger.query({ topicPrefix: 'episodic.agent_run.failed', limit: 100 }).length
}`);
void census;

// --- 3 · the shipped producer, on the real values ----------------------------
const written = recordAgentRunOutcome({
  agentId: row.source,
  status: 'timeout',
  timeoutMs,
  error: row.detail,
  finishedAt: row.first_seen_at,
});
console.log(`\n=== THE PRODUCER ===`);
console.log(`  events written: ${written}`);
const emitted = core.ledger.query({ topicPrefix: 'episodic.agent_run.failed', limit: 100 });
for (const e of emitted) {
  console.log(`  ${e.id}  ${e.topic}`);
  console.log(`    observed_at ${e.observed_at}   recorded_at ${e.recorded_at}`);
  console.log(`    actor       ${JSON.stringify(e.actor)}`);
  console.log(`    entity      ${JSON.stringify(e.entity)}`);
  console.log(`    payload     ${JSON.stringify(e.payload)}`);
}

// --- 4 · the shipped fold, over the real fleet -------------------------------
const now = new Date();
const triage = createSessionRegistry({ core, now }).triage();

console.log(`\n=== THE NOW LIST, RANKED (fold at ${now.toISOString()}) ===`);
console.log(`  verdict: ${triage.verdict}`);
console.log(`  waiting: ${triage.waiting.length} row(s)\n`);
triage.waiting.forEach((s, i) => {
  console.log(`  ${i + 1}. [T${s.tier}] ${s.headline}`);
  if (s.ask) console.log(`        ask   ${s.ask}`);
  console.log(`        rule  ${s.rule}`);
  console.log(`        meta  ${[s.state, s.meta, s.places.summary, ageLabel(s.since, now)].filter(Boolean).join(' · ')}`);
  console.log(`        class ${s.headlineTemplate ?? '(derived)'}   kind ${s.kind}   chip ${s.chip || '(none)'}`);
  console.log('');
});

console.log('=== THE ROW THIS PACKET EXISTS FOR ===');
const stuck = triage.waiting.find((s) => s.kind === 'agentFailure');
if (!stuck) {
  console.log('  ABSENT — the fold did not produce it. The exhibit FAILS.');
  process.exitCode = 1;
} else {
  console.log(`  position ${triage.waiting.indexOf(stuck) + 1} of ${triage.waiting.length}  (last, as the template's own note requires)`);
  console.log(`  ${JSON.stringify({
    kind: stuck.kind, tier: stuck.tier, headlineTemplate: stuck.headlineTemplate,
    headline: stuck.headline, ask: stuck.ask, chip: stuck.chip, meta: stuck.meta, rule: stuck.rule,
    age: ageLabel(stuck.since, now),
  }, null, 2).split('\n').join('\n  ')}`);
}

core.close();
fs.rmSync(dir, { recursive: true, force: true });
