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
const { PF_VERSION, BENCH_MODEL, GRADER_MODEL } = require('./providers/isolation');

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
  claudeCliVersion: sh('claude', ['--version']),
  promptfooVersion: PF_VERSION,
  repeat: repeatMatch ? Number(repeatMatch[1]) : null,
  keysSha256: crypto.createHash('sha256').update(fs.readFileSync(keysPath)).digest('hex'),
  substrateSnapshot,
  backfilled: false,
};

// Mark runs where drift gate was skipped
if (substrateSnapshot.skipped === true) {
  manifest.note = 'DRIFT GATE SKIPPED (BENCH_SKIP_DRIFT=1) — substrate not verified against keys.json; do not publish these numbers.';
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(path.join(outDir, 'manifest.json'));
