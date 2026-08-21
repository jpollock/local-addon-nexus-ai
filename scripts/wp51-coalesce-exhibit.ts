/**
 * WP-51 · THE ACCEPTANCE EXHIBIT — the owner's real ledger, re-folded, printed.
 *
 * The instrument that produces the packet's required exhibit: **a newly
 * produced sibling set coalescing into one situation with parts, beside the
 * four historical ones staying separate.** Committed so the exhibit is
 * reproducible rather than a paragraph in a report. Same shape and the same
 * refusals as `wp50-refold-exhibit.ts`.
 *
 * IT NEVER TOUCHES THE OWNER'S LEDGER. `--db <dir>` names a COPY, and the
 * script refuses to run against `Application Support/Local/nexus-ai` at all.
 * Nothing it writes is an edit: the ledger is append-only, and rewriting
 * history to make a screenshot better is escalation-grade. **The four existing
 * incidents stay four rows, and their stated limit stays true of them.**
 *
 *   npx ts-node scripts/wp51-coalesce-exhibit.ts --db <dir holding a COPY>
 *   npx ts-node scripts/wp51-coalesce-exhibit.ts --db <dir> --append-scan
 *   npx ts-node scripts/wp51-coalesce-exhibit.ts --db <dir> --append-scan --append-containment
 *
 * WHAT EACH APPEND IS, AND WHAT IN IT IS SUPPLIED:
 *
 * `--append-scan` (items 1 + 2) hands `recordSentinelIncidents` — the SHIPPED
 * producer, called exactly as `AgentRunner` calls it — one report. Two things
 * about that report are read off the owner's own record and one is supplied,
 * and the difference is stated rather than blurred:
 *
 *   READ    the finding classes and their symptom lines, verbatim from the four
 *           `episodic.incident.recorded` events already on the ledger.
 *   READ    the target: a real site resolved through the ledger's OWN entity
 *           aliases, chosen because the producer's durable dedup would suppress
 *           these four classes on the site that already has them open. That
 *           suppression is correct behaviour and is printed when it happens.
 *   SUPPLIED the fact that a scan happened at all. No scan has run since the
 *           producer learned to mint a TaskId, so there is nothing on the
 *           ledger to replay; a report in the shape `AgentResult` carries is
 *           the input, and the PRODUCER and the FOLD are what the exhibit
 *           proves.
 *
 * `--append-containment` (item 3) appends one manifest for a containment run
 * whose arming NAMES the open orphan incidents it answers, through
 * `manifestCauseFor` — `chatAssembly`'s own derivation, not a copy of its
 * reasoning. The ids come off the ledger; nothing about the join is inferred
 * from a target or a timestamp, which is the whole of the designer's Q1.
 */
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const APPEND_SCAN = args.includes('--append-scan');
const APPEND_CONTAINMENT = args.includes('--append-containment');
const dbDir = flag('--db');
if (!dbDir) {
  console.error(
    'usage: wp51-coalesce-exhibit.ts --db <dir holding a COPY of ledger.db> [--append-scan] [--append-containment]',
  );
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
const { setIntelligenceCore } = require('../src/main/intelligence-host/coreRegistry');
const { createSessionRegistry } = require('../src/main/intelligence-host/sessionRegistry');
const {
  INCIDENT_TOPIC,
  SCAN_TOPIC,
  recordSentinelIncidents,
} = require('../src/main/intelligence-host/incidentProducer');
/* eslint-enable @typescript-eslint/no-var-requires */

const memory = new Map<string, unknown>();
const storage = {
  get: (k: string) => (memory.has(k) ? memory.get(k) : null),
  set: (k: string, v: unknown) => {
    memory.set(k, v);
  },
};
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const core = initIntelligenceCore({ storage, logger: quiet, dataDir: dbDir });
if (!core) {
  console.error('core failed to initialise');
  process.exit(1);
}
// The producer reads the process-wide core, like every producer.
setIntelligenceCore(core);

if (APPEND_SCAN) appendScan(core);
if (APPEND_CONTAINMENT) appendContainment(core);

const registry = createSessionRegistry({ core });
const triage = registry.triage();
const snapshot = registry.snapshot();

const mode = [APPEND_SCAN ? 'scan appended' : null, APPEND_CONTAINMENT ? 'containment appended' : null]
  .filter(Boolean)
  .join(' + ');
console.log(`=== WP-51 COALESCE EXHIBIT · ${mode || 'BEFORE (record untouched)'} ===`);
console.log(`ledger: ${path.join(dbDir, 'ledger.db')}`);
console.log(
  `manifests read: ${snapshot.horizon.manifestsRead}  sessions: ${snapshot.sessions.length}  ` +
    `incident events: ${core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 500 }).length}  ` +
    `scan acts: ${core.ledger.query({ topicPrefix: SCAN_TOPIC, limit: 500 }).length}`,
);
console.log('');
console.log(`VERDICT: ${triage.verdict || '(none — nothing waiting)'}`);
console.log(`BADGE (rows needing you): ${triage.waiting.length}`);
console.log('');

for (const s of triage.waiting) {
  const folded =
    s.linkKind === undefined || s.linkKind === null
      ? `${s.memberCount ?? '-'} member, not folded`
      : `${s.memberCount} members, linked by ${s.linkKind}`;
  console.log(`--- WAITING · ${s.kind.toUpperCase()} · ${s.id}`);
  console.log(`    template : ${s.headlineTemplate ?? 'DERIVED (no ratified class fired)'}`);
  console.log(`    fold     : ${folded}`);
  console.log(`    headline : ${s.headline}`);
  if (s.ask) console.log(`    ask      : ${s.ask}`);
  console.log(`    rule     : ${s.rule}`);
  console.log(`    tier     : ${s.tier}  (${s.tierReason})`);
  for (const p of s.parts) console.log(`    part     : [${p.kind}] ${p.summary}`);
  console.log('');
}
console.log(`CHANGED: ${triage.changed.length}`);
for (const s of triage.changed) console.log(`    ${s.headlineTemplate ?? 'derived'} · ${s.headline}`);

/**
 * One sentinel sweep, through the shipped producer.
 *
 * The finding classes are the owner's own, read off the ledger. The target is a
 * second real site, resolved through the entity service's own aliases — the
 * producer's `entityRefsFor` does that resolution, and a name it cannot resolve
 * produces no event at all (rule 2), so a site named here that the ledger does
 * not know simply prints as zero and nothing is invented.
 */
function appendScan(c: {
  ledger: { query: (o: Record<string, unknown>) => Array<Record<string, any>>; raw: () => any };
}): void {
  const existing = c.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 500, order: 'desc' });
  const classes: Array<{ id: string; severity: string; title: string }> = [];
  const seen = new Set<string>();
  for (const event of existing) {
    const payload = (event.payload ?? {}) as Record<string, any>;
    if (typeof payload.fact !== 'string' || seen.has(payload.fact)) continue;
    seen.add(payload.fact);
    classes.push({
      id: payload.fact,
      severity: typeof payload.severity === 'string' ? payload.severity : 'high',
      title: typeof payload.symptom === 'string' ? payload.symptom : payload.fact,
    });
  }
  if (classes.length === 0) {
    console.error('[scan] the ledger holds no incident to read a finding class from — nothing appended');
    return;
  }

  // A second real site: an install this ledger already has an alias for, and
  // not one that already carries an open incident of these classes.
  const used = new Set(existing.map((e) => JSON.stringify(e.entity ?? {})));
  const candidates: string[] = c.ledger
    .raw()
    .prepare('SELECT value FROM entity_aliases WHERE namespace = ? ORDER BY value LIMIT 50')
    .all('wpe.install_name')
    .map((r: { value: string }) => r.value);

  const target = candidates.find((name) => {
    const refs = require('../src/main/intelligence-host/actionProducer').entityRefsFor(core, name, undefined);
    return refs && !used.has(JSON.stringify(refs));
  });
  if (!target) {
    console.error('[scan] no resolvable second site on this ledger — nothing appended');
    return;
  }

  const observedAt = new Date().toISOString();
  const written = recordSentinelIncidents(
    {
      agentId: 'security-sentinel',
      runId: `r_exhibit_${Date.now().toString(36)}`,
      observedAt,
      sites: { [target]: { status: 'escalated', findings: classes } },
    },
    {},
  );
  console.error(
    `[scan] target=${target}  classes=${classes.map((f) => f.id).join(',')}  incidents written=${written}` +
      `${written === 0 ? '  (the durable dedup suppressed them — already open on this site)' : ''}`,
  );
}

/**
 * THE NEXT TURN of a containment run already on this ledger, with its arming
 * naming the incidents it answers.
 *
 * WP-50's exhibit set the shape and it is followed here: the capability, the
 * runbook, the hash and the entity map are READ OFF THE RUN'S OWN NEWEST
 * MANIFEST, so this is what the changed producer writes the next time that run
 * takes a turn. The only thing this script contributes is the `cause` — which
 * is the packet's subject, is derived by `chatAssembly`'s own
 * `manifestCauseFor`, and whose ids come off the ledger's own open incidents.
 *
 * If no containment run exists it appends NOTHING. Inventing a run to
 * demonstrate a join would be the fabrication the join exists to prevent.
 */
function appendContainment(c: {
  ledger: { query: (o: Record<string, unknown>) => Array<Record<string, any>> };
  emitter: { emit: (d: Record<string, unknown>) => unknown };
}): void {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { manifestCauseFor } = require('../src/main/intelligence-host/chatAssembly');
  const { taskId: mintTaskId } = require('../src/intelligence');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // The OPEN incidents nothing has answered — the rows the screen is showing.
  const open = c.ledger
    .query({ topicPrefix: INCIDENT_TOPIC, limit: 500, order: 'desc' })
    .filter((e) => (e.payload ?? {}).resolved !== true);
  const answers = open.map((e) => e.id as string);
  const cause = manifestCauseFor(answers);
  if (!cause) {
    console.error('[containment] no open incident to answer — nothing appended');
    return;
  }

  // The containment run this ledger already holds, newest turn first.
  const containment = c.ledger
    .query({ topicPrefix: 'task.context.assembled', limit: 2000, order: 'desc' })
    .find((m) => {
      const proc = (m.payload ?? {}).procedure;
      return (
        proc &&
        proc.status === 'delivered' &&
        typeof proc.capability === 'string' &&
        /contain|remediat|incident/.test(proc.capability)
      );
    });
  if (!containment) {
    console.error('[containment] no containment run on this ledger — nothing appended, nothing invented');
    return;
  }

  const previous = containment.payload as Record<string, any>;
  const taskId = mintTaskId();
  const assembledAt = new Date().toISOString();
  c.emitter.emit({
    observed_at: assembledAt,
    topic: 'task.context.assembled',
    schema: 'context.assembled/1',
    entity: containment.entity ?? {},
    actor: { id: 'act_chat_assembler', kind: 'system' },
    source: { class: 'work', system: 'assembler:chat', trust: 'emitted' },
    correlation: taskId,
    payload: {
      ...previous,
      bundle_id: `bun_${taskId.slice(5)}`,
      task: taskId,
      assembled_at: assembledAt,
      cause,
    },
  });
  console.error(
    `[containment] next turn of ${previous.procedure.capability} (${previous.procedure.runbook}) ` +
      `task=${taskId} answers=${answers.length} incidents`,
  );
}
