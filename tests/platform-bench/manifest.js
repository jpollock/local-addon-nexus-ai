#!/usr/bin/env node
/**
 * Assemble the manifest for one archived benchmark run. A result without its
 * manifest is an anecdote: the manifest records every pinned-or-recorded
 * variable so a future reader can tell whether two runs are comparable.
 *
 * Usage: node manifest.js <evalId> <outDir> <gtSnapshotPath>
 *
 * Not captured in P2 (deliberate, spec §3.3 "where retrievable"): per-column
 * index age. No verified retrieval mechanism exists yet for either column's
 * index timestamp from a shell context; add it when one is proven rather than
 * guessing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { PF_VERSION, BENCH_MODEL, GRADER_MODEL, resolveModelBackend } = require('./providers/isolation');

const [evalId, outDir, gtSnapshotPath] = process.argv.slice(2);
if (!evalId || !outDir || !gtSnapshotPath) {
  console.error('usage: node manifest.js <evalId> <outDir> <gtSnapshotPath>');
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..', '..');
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: repoRoot }).trim();

const keysPath = path.join(__dirname, 'keys.json');
const configPath = path.join(__dirname, 'promptfooconfig.yaml');
const repeatMatch = fs.readFileSync(configPath, 'utf8').match(/^\s*repeat:\s*(\d+)/m);

const substrateSnapshot = JSON.parse(fs.readFileSync(gtSnapshotPath, 'utf8'));

const manifest = {
  evalId,
  createdAt: new Date().toISOString(),
  harnessGitSha: sh('git', ['rev-parse', 'HEAD']),
  harnessDirty: sh('git', ['status', '--porcelain', '--', 'tests/platform-bench']) !== '',
  benchModel: BENCH_MODEL,
  graderModel: GRADER_MODEL,
  // Which backend served the pinned ids. Both Vertex and a direct login serve
  // the same ids, so a run cannot be told apart after the fact without this.
  // Absent from pre-2026-08-25 manifests and from backfills, where it is
  // genuinely unknown and must never be inferred.
  modelBackend: resolveModelBackend(),
  claudeCliVersion: sh('claude', ['--version']),
  promptfooVersion: PF_VERSION,
  repeat: repeatMatch ? Number(repeatMatch[1]) : null,
  keysSha256: crypto.createHash('sha256').update(fs.readFileSync(keysPath)).digest('hex'),
  // What the Coworker column was actually able to reach. A project key resolves no
  // WordPress user, so every ability call returns unauthorized — a run taken on one
  // cannot be read as evidence about abilities either way. Class only; never the value.
  coworkerKeyClass: process.env.COWORKER_PERSONAL_API_KEY ? 'personal'
                  : process.env.COWORKER_API_KEY ? 'project' : null,
  coworkerAbilities: process.env.COWORKER_ABILITIES === '1',
  // Abilities run AS a WordPress user with that user's capabilities, and the site's
  // logs name them — so the column is "Coworker as this user", not Coworker in the
  // abstract. Set BENCH_COWORKER_WP_USER to record which. Unpinned is not reproducible.
  coworkerWpUser: process.env.BENCH_COWORKER_WP_USER || null,
  substrateSnapshot,
  backfilled: false,
};

// A widened Coworker column is a NEW baseline, not a continuation: every archived run
// was taken with the KB-only scaffolding, so a post-widening number cannot be read
// against a pre-widening one.
if (manifest.coworkerAbilities) {
  manifest.coworkerNote = 'COWORKER ABILITIES ARMED — the Coworker column had the WordPress '
    + 'abilities route. Not comparable to runs before 2026-08-25; re-baseline the four '
    + 'original scenarios before reading any trend across that boundary.'
    + (manifest.coworkerWpUser ? '' : ' Connected WordPress user NOT recorded (set BENCH_COWORKER_WP_USER).');
}

// Mark runs where drift gate was skipped
if (substrateSnapshot.skipped === true) {
  manifest.note = 'DRIFT GATE SKIPPED (BENCH_SKIP_DRIFT=1) — substrate not verified against keys.json; do not publish these numbers.';
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(path.join(outDir, 'manifest.json'));
