#!/usr/bin/env node
'use strict';

/**
 * prepublishOnly guard (P0-4).
 *
 * Runs `npm pack --dry-run` and inspects the EXACT file set npm would upload,
 * refusing the publish if a forbidden path (ACF PRO) is present. `prepublishOnly`
 * fires on `npm publish` but not on `npm pack`, so calling pack here does not
 * recurse. `--ignore-scripts` keeps the guard from triggering a full build.
 *
 * Fail-closed: if the package set cannot be inspected, refuse rather than
 * publish blind.
 *
 * TWO CHECKS, and the second is not optional (v0.6.0). The path check catches
 * a forbidden FILE; it cannot catch a forbidden STRING inside a file that
 * legitimately ships — `lib/main/ipc-handlers.js` names Intelligent Web and the
 * Hub Plugin, and `lib/main/ai-gateway/AIGatewayRoutes.js` names WP Engine
 * Power. The content check unpacks the real tarball and scans its text.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  findForbiddenPublishFiles,
  findForbiddenPublishContent,
} = require('./publish-guard-core');

// Extensions worth scanning. Everything npm publishes here that can carry a
// product string is text; models/*.onnx, images and fonts are skipped by
// omission rather than by a size heuristic, so a new binary type is simply not
// scanned instead of being silently truncated.
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.ts', '.txt', '.html', '.css', '.map', '.yml', '.yaml',
]);

function scanPackedContent() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-publish-guard-'));
  let tgz = null;
  try {
    // Real pack (not --dry-run): the content check needs actual bytes.
    const out = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const parsed = JSON.parse(out);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    tgz = path.resolve(entry.filename);

    execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });

    const files = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) { walk(full); continue; }
        if (!TEXT_EXT.has(path.extname(full))) continue;
        files.push({ path: path.relative(tmp, full), content: fs.readFileSync(full, 'utf8') });
      }
    };
    walk(tmp);
    return { hits: findForbiddenPublishContent(files), scanned: files.length };
  } finally {
    if (tgz) { try { fs.unlinkSync(tgz); } catch { /* already gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function packedFilePaths() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = (entry && entry.files) || [];
  return files.map((f) => (typeof f === 'string' ? f : f && f.path)).filter(Boolean);
}

try {
  const paths = packedFilePaths();
  const forbidden = findForbiddenPublishFiles(paths);
  if (forbidden.length > 0) {
    console.error('\n✗ Refusing to publish: forbidden files are in the npm package set (P0-4):');
    for (const p of forbidden.slice(0, 20)) console.error(`    ${p}`);
    if (forbidden.length > 20) console.error(`    …and ${forbidden.length - 20} more`);
    console.error('\nACF PRO is a paid product and must never be redistributed. It is kept out');
    console.error('of the package by .gitignore only — check for a stray .npmignore, or a build');
    console.error('that copied it into lib/wp-plugins (see create-entry-points.js EXCLUDED_PLUGIN_DIRS).\n');
    process.exit(1);
  }
  const { hits, scanned } = scanPackedContent();
  if (hits.length > 0) {
    console.error('\n✗ Refusing to publish: WP Engine internal product surface is in the package set:');
    const seen = new Set();
    for (const hit of hits) {
      const key = `${hit.path}::${hit.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.error(`    ${hit.path}: ${hit.label}`);
    }
    console.error('\nThis package is PUBLIC on npm. Intelligent Web and Power are unreleased');
    console.error('WP Engine surfaces and must not ship. Remove them, or do not publish.\n');
    process.exit(1);
  }
  console.log(`✓ publish guard: ${paths.length} files in the package set, no forbidden path.`);
  console.log(`✓ publish guard: ${scanned} text files scanned, no internal product surface.`);
} catch (err) {
  console.error('✗ publish guard could not inspect the package set — refusing to publish.');
  console.error(`  ${err && err.message ? err.message : err}`);
  process.exit(1);
}
