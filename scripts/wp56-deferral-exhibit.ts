/**
 * WP-56 · THE ACCEPTANCE EXHIBIT — a real situation deferred, on a real ledger.
 *
 * The gate owes one driven demonstration: a real situation deferred, LEAVING
 * THE BADGE, STAYING IN THE LIST, and RETURNING when its wake condition is met.
 * This is the instrument that produces it, committed so the exhibit is
 * reproducible rather than a paragraph in a report.
 *
 * IT NEVER TOUCHES THE OWNER'S LEDGER. `--db <path>` names a COPY, and the
 * script refuses outright to run against `Application Support/Local/nexus-ai`.
 * The deferral it records is a real `Emitter.emit` through the real producer —
 * which is the point, and is exactly why it may only ever reach a copy.
 *
 *   cp -R "~/Library/Application Support/Local/nexus-ai" /tmp/wp56-copy
 *   npx ts-node scripts/wp56-deferral-exhibit.ts --db /tmp/wp56-copy
 *
 * WHAT IT DRIVES, and nothing in it is simulated: `initIntelligenceCore` over
 * the copied ledger, `createSessionRegistry().triage()` for every reading, and
 * `recordDeferral` / `recordDeferralEnded` for every write. The four states are
 * four real folds of a real record.
 *
 * The WOKEN reading is taken by re-folding with a LATER CLOCK rather than by
 * writing anything: a time wake is derived from the fold's own clock, so
 * "returns to full intensity when met" is a property of reading the same
 * record later — which is the strongest form the demonstration can take,
 * because nothing had to happen for the row to come back.
 */
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const dbDir = flag('--db');
if (!dbDir) {
  console.error('usage: wp56-deferral-exhibit.ts --db <dir holding a COPY of ledger.db>');
  process.exit(2);
}
if (path.resolve(dbDir).includes('Application Support/Local/nexus-ai')) {
  console.error('REFUSED: that is the live ledger. Copy it first — this script WRITES.');
  process.exit(2);
}
if (!fs.existsSync(path.join(dbDir, 'ledger.db'))) {
  console.error(`no ledger.db in ${dbDir}`);
  process.exit(2);
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { initIntelligenceCore } = require('../src/main/intelligence-host/bootstrap');
const { setIntelligenceCore } = require('../src/main/intelligence-host/coreRegistry');
const { createSessionRegistry, runCorrelationFor } = require('../src/main/intelligence-host/sessionRegistry');
const { recordDeferral, recordDeferralEnded } = require('../src/main/intelligence-host/actionProducer');

const kv = new Map<string, unknown>();
const core = initIntelligenceCore({
  storage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) },
  logger: { info: () => {}, error: () => {} },
  dataDir: dbDir,
});
if (!core) {
  console.error('the intelligence core did not initialise over that directory');
  process.exit(2);
}
setIntelligenceCore(core);

interface Row {
  id: string;
  tier: number;
  headline: string;
  rule: string;
  deferral?: { reason: string; deferredAt: string; wake: unknown };
}
interface View {
  waiting: Row[];
  counts: { needsYou: number; deferred: number };
  verdict: string;
}

const read = (now: Date): View => createSessionRegistry({ core, now }).triage();

function show(label: string, view: View, subject: string): void {
  console.log(`\n──────── ${label} ────────`);
  console.log(`  BADGE (counts.needsYou) : ${view.counts.needsYou}`);
  console.log(`  DEFERRED (counts.deferred): ${view.counts.deferred}`);
  console.log(`  ROWS IN waiting          : ${view.waiting.length}`);
  console.log(`  VERDICT                  : ${view.verdict || '(none)'}`);
  const row = view.waiting.find((r) => r.id === subject);
  if (!row) {
    console.log(`  THE SUBJECT              : NOT IN THE LIST  <-- this would be the dismissal the ruling refused`);
    return;
  }
  console.log(`  THE SUBJECT              : PRESENT, tier ${row.tier}`);
  console.log(`    headline               : ${row.headline}`);
  console.log(`    rule                   : ${row.rule}`);
  console.log(`    deferral               : ${row.deferral ? JSON.stringify(row.deferral) : '(none — escalating)'}`);
}

const NOW = new Date();
const before = read(NOW);
if (before.waiting.length === 0) {
  console.error('this ledger has no waiting situation to defer — nothing to exhibit');
  process.exit(2);
}

// The subject: the first waiting row, whatever the real record happens to hold.
// Not chosen for convenience — `waiting[0]` is the consequence order's own top
// row, which is the one a user would actually be looking at.
const subject = before.waiting[0]!;
const sessionId = subject.id;
const WAKE_HOURS = 48;
const wakeAt = new Date(NOW.getTime() + WAKE_HOURS * 3_600_000).toISOString();

console.log(`SUBJECT: ${sessionId}`);
console.log(`  "${subject.headline}"`);
show('1 · BEFORE — escalating', before, sessionId);

// THE CORRELATION, resolved exactly as the IPC handler resolves it. The first
// run of this exhibit did NOT do this, and the printed record showed the
// consequence: a deferral with no correlation, recorded on nothing. That is how
// `runCorrelationFor` came to exist.
const correlation = runCorrelationFor(sessionId, { core });
console.log(`\nresolved correlation for ${sessionId}: ${correlation ?? '(none — not a session)'}`);

const deferralId = recordDeferral({
  situationId: sessionId,
  ...(correlation ? { taskId: correlation } : {}),
  reason: 'waiting on the payment gateway vendor',
  wake: { kind: 'time', at: wakeAt },
});
if (typeof deferralId !== 'string') {
  console.error('the deferral was REFUSED by the producer — nothing to exhibit');
  process.exit(2);
}
console.log(`\nrecorded deferral ${deferralId}, wake at ${wakeAt}`);
show('2 · DEFERRED — out of the badge, still in the list', read(NOW), sessionId);

show(
  `3 · WOKEN — same record, clock ${WAKE_HOURS}h later, nothing written`,
  read(new Date(NOW.getTime() + (WAKE_HOURS + 1) * 3_600_000)),
  sessionId
);

// Prove the join the correlation buys, from the record itself.
const runEvents = core.ledger.query({ correlation, limit: 200 }).map((e: { id: string }) => e.id);
console.log(`\nJOINABLE BACK TO THE RUN: reading correlation=${correlation} returns ${runEvents.length} events, `
  + `and the deferral ${runEvents.includes(deferralId) ? 'IS' : 'IS NOT'} among them`);

const endId = recordDeferralEnded({ situationId: sessionId, taskId: correlation, supersedes: deferralId });
console.log(`\nrecorded early end ${endId}, superseding ${deferralId}`);
show('4 · ENDED EARLY — superseded, back in the badge', read(NOW), sessionId);

core.close();
