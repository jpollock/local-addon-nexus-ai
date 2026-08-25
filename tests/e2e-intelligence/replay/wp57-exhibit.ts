/**
 * WP-57 · THE RUN-FRAME EXHIBIT, against the real ledger.
 *
 * ── What this IS ─────────────────────────────────────────────────────────────
 *
 * The producer chain this packet ships, driven as `AgentRunner` drives it,
 * against a copy of the developer's own `ledger.db` — the messiest fixture this
 * project has. It answers, with real data:
 *
 *   - does a sentinel run that finds something produce
 *     `task.run.assigned` → incidents → `task.run.completed`, all on ONE
 *     correlation, with the actor naming the agent?
 *   - does a quiet successful run produce NOTHING (the laziness that keeps
 *     auth-probe's 720 runs/day out of an uncompactable substrate)?
 *   - how many agent acts carried no correlation before, and after?
 *
 * ── What this IS NOT, stated because the DoD asks for something else ─────────
 *
 * **This is not the live smoke.** It does not prove that a running Local
 * constructs `AgentRunner` with an intelligence core available, that the
 * scheduler path reaches this code, or that the Electron ABI is sound. Those
 * need `npm run rebuild`, a Local restart and a real run from the UI. What this
 * proves is the producer chain end to end on real data — most of the exhibit's
 * value, none of its wiring claim. Do not cite it as the smoke.
 *
 * ── Safety, copied from `run.ts` rather than reinvented ──────────────────────
 *
 * The live ledger is opened `readonly: true`, for exactly one `VACUUM INTO`
 * (which writes the destination and captures WAL contents a file copy would
 * miss). Every write below lands on the temp copy. The core is booted with
 * in-memory storage, so no marker of yours is touched.
 *
 * Runs under system Node. `npm run rebuild` before loading Local again.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/* eslint-disable no-console, @typescript-eslint/no-var-requires */

const SOURCE = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Local',
  'nexus-ai',
  'ledger.db'
);

type Row = Record<string, unknown>;

function main(): void {
  const Database = require('better-sqlite3');
  const { initIntelligenceCore } = require('../../../src/main/intelligence-host/bootstrap');
  const { setIntelligenceCore } = require('../../../src/main/intelligence-host/coreRegistry');
  const { openAgentTask } = require('../../../src/main/intelligence-host/agentTaskFrame');
  const { recordSentinelIncidents } = require('../../../src/main/intelligence-host/incidentProducer');

  if (!fs.existsSync(SOURCE)) {
    console.error(`No ledger at ${SOURCE} — this exhibit needs a machine that has run the addon.`);
    process.exit(2);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-wp57-exhibit-'));
  const dbPath = path.join(workDir, 'ledger.db');
  console.log(`Copying ${SOURCE}\n      -> ${workDir}\n`);
  {
    const src = new Database(SOURCE, { readonly: true });
    try {
      src.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);
    } finally {
      src.close();
    }
  }

  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    dataDir: workDir,
  });
  if (!core) {
    console.error('core failed to boot on the copy');
    process.exit(1);
  }
  setIntelligenceCore(core);

  const raw = core.ledger.raw();
  const count = (sql: string): number => (raw.prepare(sql).get() as { n: number }).n;

  const BEFORE = {
    runEvents: count("SELECT COUNT(*) n FROM events WHERE topic LIKE 'task.run.%'"),
    agentActsUncorrelated: count(
      "SELECT COUNT(*) n FROM events WHERE json_extract(actor,'$.id') LIKE 'act_agent%'" +
        " AND (correlation IS NULL OR correlation='')"
    ),
    incidentsUncorrelated: count(
      "SELECT COUNT(*) n FROM events WHERE topic='episodic.incident.recorded'" +
        " AND (correlation IS NULL OR correlation='')"
    ),
    total: count('SELECT COUNT(*) n FROM events'),
  };

  // A site the real ledger already knows, so entity resolution is real rather
  // than mocked. Taken from the copy, never invented.
  const knownSite = raw
    .prepare(
      "SELECT value FROM entity_aliases WHERE namespace='wpe.install_name' ORDER BY value LIMIT 1"
    )
    .get() as { value?: string } | undefined;

  // ── Scenario A · a sentinel run that finds something ──────────────────────
  const startedA = Date.parse('2026-08-21T18:00:00.000Z');
  const finishedA = Date.parse('2026-08-21T18:00:41.000Z');
  const frameA = openAgentTask({
    agentName: 'security-sentinel',
    trigger: 'cron',
    startedAt: startedA,
    runId: 'r_exhibit_a',
  });

  const siteKey = knownSite?.value ?? 'unresolvable-site';
  const wrote = recordSentinelIncidents(
    {
      agentId: 'security-sentinel',
      runId: 'r_exhibit_a',
      observedAt: finishedA,
      correlationId: frameA ? () => frameA.correlationId() : undefined,
      sites: {
        [siteKey]: {
          status: 'escalated',
          findings: [
            { id: 'WP57-EXHIBIT-1', severity: 'critical', title: 'exhibit finding one' },
            { id: 'WP57-EXHIBIT-2', severity: 'high', title: 'exhibit finding two' },
          ],
        },
      },
    },
    {}
  );
  frameA?.close({ status: 'success', finishedAt: finishedA, findings: 2 });

  // ── Scenario B · a quiet successful run (auth-probe's every-two-minutes) ──
  const beforeQuiet = count('SELECT COUNT(*) n FROM events');
  const frameB = openAgentTask({
    agentName: 'auth-probe',
    trigger: 'cron',
    startedAt: Date.parse('2026-08-21T18:02:00.000Z'),
    runId: 'r_exhibit_b',
  });
  frameB?.close({ status: 'success', finishedAt: Date.parse('2026-08-21T18:02:03.000Z'), findings: 0 });
  const afterQuiet = count('SELECT COUNT(*) n FROM events');

  const AFTER = {
    runEvents: count("SELECT COUNT(*) n FROM events WHERE topic LIKE 'task.run.%'"),
    total: count('SELECT COUNT(*) n FROM events'),
  };

  const thread = raw
    .prepare(
      "SELECT topic, json_extract(actor,'$.id') actor, correlation, observed_at," +
        " json_extract(payload,'$.status') status, json_extract(payload,'$.autonomy') autonomy" +
        ' FROM events WHERE correlation = ? ORDER BY id'
    )
    .all(frameA?.id) as Row[];

  console.log('='.repeat(78));
  console.log('WP-57 RUN-FRAME EXHIBIT — real ledger copy');
  console.log('='.repeat(78));
  console.log(`\nBEFORE`);
  console.log(`  total events                 ${BEFORE.total}`);
  console.log(`  task.run.* events            ${BEFORE.runEvents}`);
  console.log(`  agent acts with NO correlation  ${BEFORE.agentActsUncorrelated}`);
  console.log(`  incidents with NO correlation   ${BEFORE.incidentsUncorrelated}`);

  console.log(`\nSCENARIO A — security-sentinel, cron, two findings`);
  console.log(`  site (from the real ledger)  ${siteKey}`);
  console.log(`  incidents written            ${wrote}`);
  console.log(`  one thread, in order:`);
  for (const r of thread) {
    console.log(
      `    ${String(r.topic).padEnd(24)} actor=${String(r.actor).padEnd(24)}` +
        ` corr=${String(r.correlation)}` +
        (r.status ? ` status=${r.status}` : '') +
        (r.autonomy ? ` autonomy=${r.autonomy}` : '')
    );
  }

  console.log(`\nSCENARIO B — auth-probe, cron, clean (the every-two-minutes case)`);
  console.log(`  events written by a quiet successful run   ${afterQuiet - beforeQuiet}`);

  console.log(`\nAFTER`);
  console.log(`  total events                 ${AFTER.total}  (+${AFTER.total - BEFORE.total})`);
  console.log(`  task.run.* events            ${AFTER.runEvents}`);

  const distinctCorr = new Set(thread.map((r) => r.correlation)).size;
  const actors = new Set(thread.map((r) => r.actor));
  const ok =
    thread.length === 4 &&
    distinctCorr === 1 &&
    actors.size === 1 &&
    actors.has('act_security_sentinel') &&
    String(thread[0].topic) === 'task.run.assigned' &&
    String(thread[thread.length - 1].topic) === 'task.run.completed' &&
    afterQuiet - beforeQuiet === 0;

  console.log(`\n${'='.repeat(78)}`);
  console.log(ok ? 'EXHIBIT: PASS' : 'EXHIBIT: FAIL');
  console.log('='.repeat(78));
  console.log(`\nCopy left in place: ${workDir}`);
  console.log(
    '\nNOTE: this is the producer chain on real data. It is NOT the live smoke —\n' +
      'it does not prove a running Local wires AgentRunner to the core, nor the\n' +
      'Electron ABI. Those still need rebuild + restart + a run from the UI.\n'
  );
  process.exit(ok ? 0 : 1);
}

main();
