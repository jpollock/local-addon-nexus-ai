#!/usr/bin/env node
'use strict';

/**
 * Copy renderer CSS into lib/, cross-platform.
 *
 * This replaces the npm script
 *
 *     mkdir -p lib/renderer/styles && cp src/renderer/styles/*.css lib/renderer/styles/
 *
 * which failed the Windows leg of the release build on 2026-09-13 with
 * "The syntax of the command is incorrect." npm runs scripts through cmd.exe on
 * Windows, and `mkdir` is a cmd BUILT-IN that shadows Git-for-Windows' mkdir.exe
 * on PATH. cmd's mkdir has no -p. (`rm` and `cp` in the sibling scripts do
 * resolve to Git's binaries, which is why `clean` survived and this did not —
 * the difference is shadowing by a built-in, not the presence of the tools.)
 *
 * Node's fs is the portable answer: no shell, no PATH, no glob expansion.
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer', 'styles');
const destDir = path.join(__dirname, '..', 'lib', 'renderer', 'styles');

if (!fs.existsSync(srcDir)) {
  console.error(`copy-styles: source directory not found: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.css'));
if (files.length === 0) {
  // Loud, not silent: a build that ships no stylesheets should say so rather
  // than produce an unstyled renderer that looks like a CSS bug at runtime.
  console.error(`copy-styles: no .css files in ${srcDir}`);
  process.exit(1);
}

for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
}
console.log(`copy-styles: ${files.length} stylesheet(s) -> lib/renderer/styles/`);
