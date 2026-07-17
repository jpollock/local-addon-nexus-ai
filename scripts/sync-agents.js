#!/usr/bin/env node
// Syncs agents/ from the dev repo to the Local user data directory.
// Run after editing agent.js files — no restart needed (hot reload picks it up).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const src = path.join(__dirname, '..', 'agents');
const dst = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'agents');

function copyRecursive(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const sp = path.join(s, entry.name), dp = path.join(d, entry.name);
    if (entry.isDirectory()) copyRecursive(sp, dp);
    else { fs.copyFileSync(sp, dp); console.log(`  copied ${path.relative(src, sp)}`); }
  }
}

copyRecursive(src, dst);
console.log('\nDone. Hot reload will pick up changes in ~2s.');
