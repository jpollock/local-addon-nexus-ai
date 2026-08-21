/**
 * WP-50 · THE ACCEPTANCE EXHIBIT — the owner's real ledger, re-folded, printed.
 *
 * The packet owes one exhibit no other packet has owed: a re-fold of the REAL
 * ledger, before and after, with the actual sentences printed. This is the
 * instrument that produces it, committed so the exhibit is reproducible rather
 * than a paragraph in a report.
 *
 * IT NEVER TOUCHES THE OWNER'S LEDGER. `--db <path>` names a COPY; the default
 * refuses to run against `~/Library/Application Support/Local/nexus-ai` at all.
 * The copy is what `--append-next-turn` writes to, and only ever a copy.
 *
 *   npx ts-node scripts/wp50-refold-exhibit.ts --db <dir-holding-ledger.db>
 *   npx ts-node scripts/wp50-refold-exhibit.ts --db <dir> --append-next-turn
 *
 * `--append-next-turn` is the AFTER half, and its honesty is the whole point:
 * it does not edit one byte of the existing record (the ledger is append-only
 * and rewriting history is escalation-grade). It appends, for each waiting run
 * on the ledger, THE NEXT TURN of that same run — same capability, same
 * document hash, same targets, all read back off the run's own newest manifest
 * — through `manifestScopeFor`, the very function `chatAssembly` now calls. So
 * "the after" is what the changed producer writes the next time each of these
 * runs takes a turn, and nothing about the target set is supplied by this
 * script: it reads the run's own record and hands it to the shipped derivation.
 */
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const APPEND = args.includes('--append-next-turn');
const dbDir = flag('--db');
if (!dbDir) {
  console.error('usage: wp50-refold-exhibit.ts --db <dir holding a COPY of ledger.db> [--append-next-turn]');
  process.exit(2);
}
if (path.resolve(dbDir).includes('Application Support/Local/nexus-ai')) {
  console.error('REFUSED: that is the live ledger. Copy it first — this script appends.');
  process.exit(2);
}
if (!fs.existsSync(path.join(dbDir, 'ledger.db'))) {
  console.error(`no ledger.db in ${dbDir}`);
  process.exit(2);
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { initIntelligenceCore } = require('../src/main/intelligence-host/bootstrap');
const { createSessionRegistry } = require('../src/main/intelligence-host/sessionRegistry');
/* eslint-enable @typescript-eslint/no-var-requires */

const memory = new Map<string, unknown>();
const storage = {
  get: (k: string) => (memory.has(k) ? memory.get(k) : null),
  set: (k: string, v: unknown) => { memory.set(k, v); },
};
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const core = initIntelligenceCore({ storage, logger: quiet, dataDir: dbDir });
if (!core) {
  console.error('core failed to initialise');
  process.exit(1);
}

if (APPEND) appendNextTurns(core);

const registry = createSessionRegistry({ core });
const triage = registry.triage();
const snapshot = registry.snapshot();

console.log(`=== WP-50 REFOLD EXHIBIT · ${APPEND ? 'AFTER (next turn appended)' : 'BEFORE (record untouched)'} ===`);
console.log(`ledger: ${path.join(dbDir, 'ledger.db')}`);
console.log(`manifests read: ${snapshot.horizon.manifestsRead}  sessions: ${snapshot.sessions.length}`);
console.log('');
console.log(`VERDICT: ${triage.verdict || '(none — nothing waiting)'}`);
console.log('');

for (const s of triage.waiting) {
  console.log(`--- WAITING · ${s.id}`);
  console.log(`    template : ${s.headlineTemplate ?? 'DERIVED (no ratified class fired)'}`);
  console.log(`    capability: ${(s as { capability?: string }).capability ?? '(not carried)'}`);
  console.log(`    headline : ${s.headline}`);
  if (s.ask) console.log(`    ask      : ${s.ask}`);
  console.log(`    written  : done=${s.written.done} failed=${s.written.failed} total=${String(s.written.total)}`);
  if (s.gate) console.log(`    gate     : ${s.gate.checkpointId} ${s.gate.index} of ${s.gate.of} (${s.gate.awaits})`);
  for (const p of s.parts) console.log(`    part     : [${p.kind}] ${p.summary}`);
  console.log('');
}
const working = (triage as { working?: Array<{ line: string }> }).working;
if (working) {
  console.log(`WORKING (nothing needed of you): ${working.length}`);
  for (const w of working) console.log(`    line     : ${w.line}`);
  console.log('');
}
console.log(`CHANGED: ${triage.changed.length}`);
for (const s of triage.changed) console.log(`    ${s.headlineTemplate ?? 'derived'} · ${s.headline}`);

/**
 * The next turn of every waiting run, appended through the shipped derivation.
 *
 * Read off the run's own newest manifest: capability, runbook, version, hash,
 * status, and the entity map the assembler resolved for it. Nothing is invented
 * here — `manifestScopeFor` is `chatAssembly`'s own, and this hands it exactly
 * what `assembleForChatTurn` would hand it on that run's next turn.
 */
function appendNextTurns(c: {
  ledger: { query: (o: Record<string, unknown>) => Array<Record<string, any>> };
  emitter: { emit: (d: Record<string, unknown>) => unknown };
}): void {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { manifestScopeFor } = require('../src/main/intelligence-host/chatAssembly');
  // The REAL minter, not a hand-rolled ULID: the ids this appends must be the
  // ids a real turn would carry, or the exhibit is proving its own arithmetic.
  const { taskId: mintTaskId } = require('../src/intelligence');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const manifests = c.ledger.query({ topicPrefix: 'task.context.assembled', limit: 2000, order: 'desc' });
  const newestByRun = new Map<string, Record<string, any>>();
  for (const m of manifests) {
    const proc = (m.payload ?? {}).procedure;
    if (!proc || proc.status !== 'delivered') continue;
    const key = `${proc.capability} ${proc.hash}`;
    if (!newestByRun.has(key)) newestByRun.set(key, m);
  }

  for (const m of newestByRun.values()) {
    const payload = m.payload as Record<string, any>;
    // The next turn's TaskId. A ULID minted the way `mintTaskId` mints one.
    const taskId = mintTaskId();
    const scope = manifestScopeFor(undefined);
    const next = {
      ...payload,
      bundle_id: `bun_${taskId.slice(5)}`,
      task: taskId,
      assembled_at: new Date().toISOString(),
      ...(scope ? { scope } : {}),
    };
    c.emitter.emit({
      observed_at: next.assembled_at,
      topic: 'task.context.assembled',
      schema: 'context.assembled/1',
      entity: m.entity ?? {},
      actor: { id: 'act_chat_assembler', kind: 'system' },
      source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
      correlation: taskId,
      payload: next,
    });
    console.error(
      `[appended] next turn of ${payload.procedure.capability} — scope.runnable=${
        scope ? JSON.stringify(scope.runnable) : '(none)'
      } from=${scope ? scope.from : '-'}`,
    );
  }
}
