/**
 * WP-55 · THE ACCEPTANCE EXHIBIT — the coalesced screen, DRIVEN THROUGH THE
 * COMPONENT, against a copy of the owner's real ledger.
 *
 * The packet's requirement, in its own words: *"a coalesced row with its parts
 * open, a grouped caption with two rows under it, and a deferred row in the same
 * list."* All three at once, in ONE list, because the three are only meaningful
 * beside each other: the whole of XD-28 is that a coalesced set looks different
 * from a grouped one, and a claim about that cannot be made one screenshot at a
 * time.
 *
 * **IT DRIVES `Arrival.render()`, NOT THE FOLD.** WP-56's own ruling is why: *"a
 * ruling states what must be true; only an exhibit shows whether the caller can
 * say it"* — a fold-level print would have re-described the screen instead of
 * asking the surface to produce it, and the defect that ruling came from was
 * invisible to every fold-level test. What is printed below is the text of the
 * React tree the component actually built.
 *
 * IT NEVER TOUCHES THE OWNER'S LEDGER. `--db <dir>` names a COPY and the script
 * refuses the live path outright. Every append goes through a SHIPPED PRODUCER
 * — `recordSentinelIncidents` and `recordDeferral`, called as their real callers
 * call them — so nothing here writes an event this product could not write.
 *
 *   npx ts-node scripts/wp55-screen-exhibit.ts --db <dir holding a COPY>
 *   npx ts-node scripts/wp55-screen-exhibit.ts --db <dir> --append-scan --append-deferral
 *
 * WHAT IS READ AND WHAT IS SUPPLIED, stated rather than blurred:
 *
 *   READ     the four finding classes and their symptom lines, verbatim from the
 *            `episodic.incident.recorded` events already on the ledger.
 *   READ     the target for the appended scan: a real install, resolved through
 *            the ledger's OWN entity aliases. A name it cannot resolve produces
 *            no event at all (the producer's rule 2), so nothing is invented.
 *   SUPPLIED that a scan happened, and that a person deferred something. No scan
 *            has run since the producer learned to mint a TaskId and no deferral
 *            exists on this ledger, so there is nothing to replay — the PRODUCER
 *            and the SCREEN are what the exhibit proves.
 *
 * **THE GROUPED CAPTION NEEDS NO APPEND AT ALL.** The owner's four historical
 * findings carry no correlation, sit on one site, and are exactly the
 * un-coalesced case XD-28 describes. They are the caption, live.
 */
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const APPEND_SCAN = args.includes('--append-scan');
const APPEND_DEFERRAL = args.includes('--append-deferral');
const dbDir = flag('--db');
if (!dbDir) {
  console.error('usage: wp55-screen-exhibit.ts --db <dir holding a COPY of ledger.db> [--append-scan] [--append-deferral]');
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
const { INCIDENT_TOPIC, SCAN_TOPIC, recordSentinelIncidents } = require('../src/main/intelligence-host/incidentProducer');
const { recordDeferral } = require('../src/main/intelligence-host/actionProducer');
const { Arrival } = require('../src/renderer/components/return/Arrival');
const { nowRows, nowGroups, arrivalCounts, nowVerdict } = require('../src/renderer/components/return/arrivalModel');
/* eslint-enable @typescript-eslint/no-var-requires */

const memory = new Map<string, unknown>();
const storage = { get: (k: string) => (memory.has(k) ? memory.get(k) : null), set: (k: string, v: unknown) => { memory.set(k, v); } };
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

const core = initIntelligenceCore({ storage, logger: quiet, dataDir: dbDir });
if (!core) { console.error('core failed to initialise'); process.exit(1); }
setIntelligenceCore(core);

if (APPEND_SCAN) appendScan();
const triageBefore = createSessionRegistry({ core }).triage();
if (APPEND_DEFERRAL) appendDeferral(triageBefore);

const registry = createSessionRegistry({ core });
const triage = registry.triage();
const now = new Date();

// ---------------------------------------------------------------------------
// THE SCREEN — built by the component, walked for its text.
// ---------------------------------------------------------------------------

const rows = nowRows(triage, undefined);
const groups = nowGroups(rows);
const counts = arrivalCounts(triage, undefined);

// Every coalesced row OPEN, because the packet asks for its parts open. This is
// the same state the disclosure sets; it is set here rather than clicked
// because a script has no pointer.
const openParts: Record<string, boolean> = {};
for (const row of rows) if ((row.situation?.parts?.length ?? 0) > 1) openParts[row.situation.id] = true;

const instance = new (Arrival as any)({
  electron: { ipcRenderer: { invoke: () => Promise.resolve(triage) } },
  now,
  store: { getItem: () => null, setItem: () => undefined },
});
instance.state = { triage, loading: false, error: null, awayMs: 12 * 3_600_000, openParts };
const tree = instance.render();

console.log('=== WP-55 SCREEN EXHIBIT ===');
console.log(`ledger: ${path.join(dbDir, 'ledger.db')}`);
console.log(
  `incident events: ${core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 500 }).length}  ` +
  `scan acts: ${core.ledger.query({ topicPrefix: SCAN_TOPIC, limit: 500 }).length}`,
);
console.log('');
console.log(`VERDICT : ${nowVerdict(triage, undefined) || '(none — nothing waiting)'}`);
console.log(`BADGE   : ${counts.needsYou} needs you · ${counts.deferred} deferred by you`);
console.log(`IDENTITY: arrivalCounts().needsYou(${counts.needsYou}) === triage.counts.needsYou(${triage.counts.needsYou}) + unheld(0)  → ${counts.needsYou === triage.counts.needsYou ? 'HOLDS' : 'BROKEN'}`);
console.log('');

for (const group of groups) {
  if (group.caption) {
    console.log(`  ┌ CAPTION (no border, no fill, no stripe, no door)`);
    console.log(`  │ ${group.caption.label}`);
    console.log(`  │ ${group.caption.limit}`);
  }
  for (const row of group.rows) {
    const s = row.situation;
    const pad = group.caption ? '  │   ' : '';
    console.log(`${pad}--- ROW ${s ? s.id : `inbox-${row.item.id}`}`);
    console.log(`${pad}    stripe   : tier ${row.tier ?? '-'}${s?.deferral ? '   [DEFERRED — dimmed, tier and place unchanged]' : ''}`);
    if (s) {
      console.log(`${pad}    template : ${s.headlineTemplate ?? 'DERIVED (no ratified class fired)'}`);
      console.log(`${pad}    fold     : ${s.linkKind == null ? `${s.memberCount ?? '-'} member, not folded` : `${s.memberCount} findings, linked by ${s.linkKind}`}`);
      console.log(`${pad}    rule     : ${s.deferral ? '(the deferral’s rule line replaces the class’s)' : s.rule}`);
      console.log(`${pad}    headline : ${s.headline}`);
      if (s.ask) console.log(`${pad}    ask      : ${s.ask}`);
      if (s.parts.length > 1) for (const p of s.parts) console.log(`${pad}    · part   : ${p.summary}`);
      if (s.door) console.log(`${pad}    door     : ${s.door.label}  → ${s.door.kind}:${s.door.target}`);
      if (s.deferral) console.log(`${pad}    deferral : ${s.deferral.reason}  (wake: ${s.deferral.wake ? s.deferral.wake.kind : 'unconditioned'})`);
    }
  }
  if (group.caption) console.log('  └');
  console.log('');
}

console.log('--- THE SCREEN, AS THE COMPONENT BUILT IT ---');
for (const line of textOf(tree)) console.log(line);

function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  if (typeof node !== 'object') return out;
  return textOf(node.props?.children, out);
}

/**
 * One sentinel sweep, through the shipped producer — the SAME derivation
 * `wp51-coalesce-exhibit.ts` uses, and for the same reasons.
 *
 * The finding classes are the owner's own, read off the ledger. The target is a
 * second real install, because the producer's durable dedup would suppress
 * these classes on the site that already has them open — which is correct
 * behaviour and is printed when it happens.
 */
function appendScan(): void {
  const existing = core.ledger.query({ topicPrefix: INCIDENT_TOPIC, limit: 500, order: 'desc' });
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
  if (classes.length === 0) { console.error('[scan] no incident on the ledger to read a class from — nothing appended'); return; }

  const used = new Set(existing.map((e: any) => JSON.stringify(e.entity ?? {})));
  const candidates: string[] = core.ledger.raw()
    .prepare('SELECT value FROM entity_aliases WHERE namespace = ? ORDER BY value LIMIT 50')
    .all('wpe.install_name').map((r: { value: string }) => r.value);
  const target = candidates.find((name) => {
    const refs = require('../src/main/intelligence-host/actionProducer').entityRefsFor(core, name, undefined);
    return refs && !used.has(JSON.stringify(refs));
  });
  if (!target) { console.error('[scan] no resolvable second site on this ledger — nothing appended'); return; }

  const written = recordSentinelIncidents(
    {
      agentId: 'security-sentinel',
      runId: `r_exhibit_${Date.now().toString(36)}`,
      observedAt: new Date().toISOString(),
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
 * ONE DEFERRAL, through the shipped producer, on a row the screen is showing.
 *
 * It names a SITUATION id, which since WP-56a is the incident's SUBJECT rather
 * than the event that reported it — which is why a deferral recorded here
 * survives the producer's next amendment of the same finding. The row it picks
 * is the LAST waiting row, so the coalesced and captioned rows above stay
 * escalating and all three states are on one screen.
 *
 * NO WAKE CONDITION IS SUPPLIED. `OFFERABLE_WAKE_KINDS` is `['time']` and the
 * platform has no `wakeFired` port, so an unconditioned deferral is what this
 * surface may honestly produce today — ruled at WP-56's gate.
 */
function appendDeferral(view: { waiting: Array<{ id: string; headline: string }> }): void {
  const row = view.waiting[view.waiting.length - 1];
  if (!row) { console.error('[deferral] nothing waiting — nothing appended'); return; }
  const id = recordDeferral({ situationId: row.id, reason: 'client is rebuilding the site next week' });
  console.error(`[deferral] situation=${row.id}  event=${id ?? '(refused)'}`);
}
