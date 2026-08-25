#!/usr/bin/env node
/**
 * Trend report over the archived benchmark runs in results/.
 *
 * One row per (scenario × column), one column per run, chronological. Cells:
 * "pass/total · median-cost · median-turns" — cost and turns appear only for
 * runs whose providers captured them (pre-v2 backfills show "–").
 *
 * Deliberately NO aggregate score: per spec §3.5, a single "X wins N%" number
 * invites exactly the scrutiny it cannot survive. Per-scenario rows, each
 * explainable by its mechanism, are the report.
 *
 * Usage:  node tests/platform-bench/report.js
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');

const scenarioOf = (desc) => String(desc).split(' — ')[0].trim();
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const runs = fs.existsSync(RESULTS_DIR)
  ? fs.readdirSync(RESULTS_DIR)
      .filter((d) => fs.existsSync(path.join(RESULTS_DIR, d, 'results.json')))
      .map((d) => {
        const results = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, d, 'results.json'), 'utf8'));
        const manifestPath = path.join(RESULTS_DIR, d, 'manifest.json');
        const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
        return { id: d, results, manifest };
      })
      .sort((a, b) => String(a.manifest.createdAt || a.id).localeCompare(String(b.manifest.createdAt || b.id)))
  : [];

if (!runs.length) { console.log('No archived runs in results/.'); process.exit(0); }

// cells[scenario][column][runId] = {pass, total, costs[], turns[]}
const cells = {};
for (const run of runs) {
  for (const r of run.results.results.results) {
    const scenario = scenarioOf(r.testCase?.description ?? '');
    const column = r.provider?.label || r.provider?.id || '?';
    const slot = (((cells[scenario] ??= {})[column] ??= {})[run.id] ??= { pass: 0, total: 0, costs: [], turns: [] });
    slot.total += 1;
    if (r.success) slot.pass += 1;
    const c = r.response?.cost;
    if (typeof c === 'number') slot.costs.push(c);
    const turns = r.response?.metadata?.numTurns ?? r.metadata?.numTurns;
    if (typeof turns === 'number') slot.turns.push(turns);
  }
}

const fmt = (s) => {
  if (!s) return '·';
  const c = median(s.costs), t = median(s.turns);
  return `${s.pass}/${s.total}` + (c != null ? ` · $${c.toFixed(2)}` : ' · –') + (t != null ? ` · ${t}t` : ' · –');
};

console.log('# Platform benchmark — run ledger\n');
console.log('| run | date | model | grader | repeat | note |');
console.log('|---|---|---|---|---|---|');
for (const run of runs) {
  const m = run.manifest;
  console.log(`| ${run.id} | ${(m.createdAt || '').slice(0, 10)} | ${m.benchModel || '?'} | ${m.graderModel || '–'} | ${m.repeat ?? '?'} | ${m.backfilled ? 'backfilled (pre-v2 grading)' : ''} |`);
}
console.log('\n| scenario | column | ' + runs.map((r) => r.id.slice(0, 12)).join(' | ') + ' |');
console.log('|---|---|' + runs.map(() => '---').join('|') + '|');
for (const scenario of Object.keys(cells).sort()) {
  for (const column of Object.keys(cells[scenario]).sort()) {
    console.log(`| ${scenario} | ${column} | ` + runs.map((r) => fmt(cells[scenario][column][r.id])).join(' | ') + ' |');
  }
}
