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
 */

const { execFileSync } = require('child_process');
const { findForbiddenPublishFiles } = require('./publish-guard-core');

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
  console.log(`✓ publish guard: ${paths.length} files in the package set, no forbidden content.`);
} catch (err) {
  console.error('✗ publish guard could not inspect the package set — refusing to publish.');
  console.error(`  ${err && err.message ? err.message : err}`);
  process.exit(1);
}
