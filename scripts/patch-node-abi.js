#!/usr/bin/env node
/**
 * Patch node-abi's registry for Electron 42.2.0 (P1-4).
 *
 * `@electron/rebuild`'s bundled `node-abi` does not know about Electron 42.2.0 yet, so
 * `npm run rebuild` (electron-rebuild) errors on the unknown ABI. Every `npm install` /
 * `npm ci` restores the unpatched registry, so this must run as part of `rebuild` rather than
 * being hand-applied (the old, CLAUDE.md-only procedure that a fresh clone had no way to know).
 *
 * Idempotent: removes any existing 42.2.0 entry and re-adds it LAST with `future: true` (the
 * node-abi boundary check requires the newest future entry to be last — `false` breaks it).
 *
 * Patches EVERY node-abi registry present, not a hardcoded list: node-abi is vendored under
 * node-abi/, electron-rebuild/, and prebuild-install/ (the exact set drifts across installs).
 */
const fs = require('fs');
const path = require('path');

const TARGET = '42.2.0';
const ABI = '146';
const NEW_ENTRY = { abi: ABI, future: true, lts: false, runtime: 'electron', target: TARGET };

const nodeModules = path.join(__dirname, '..', 'node_modules');

/** Collect every `<dir>/node-abi/abi_registry.json` that exists. */
function findRegistries(nm) {
  const found = [];
  const check = (dir) => {
    const reg = path.join(dir, 'node-abi', 'abi_registry.json');
    if (fs.existsSync(reg)) found.push(reg);
  };
  if (!fs.existsSync(nm)) return found;
  check(nm); // top-level node_modules/node-abi
  for (const entry of safeReaddir(nm)) {
    const pkgDir = path.join(nm, entry);
    if (!isDir(pkgDir)) continue;
    if (entry.startsWith('@')) {
      for (const scoped of safeReaddir(pkgDir)) {
        check(path.join(pkgDir, scoped, 'node_modules')); // @scope/pkg/node_modules/node-abi
      }
    } else {
      check(path.join(pkgDir, 'node_modules')); // pkg/node_modules/node-abi
    }
  }
  return found;
}

function safeReaddir(dir) { try { return fs.readdirSync(dir); } catch { return []; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function patch(regPath) {
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const filtered = reg.filter((e) => e.target !== TARGET);
  filtered.push({ ...NEW_ENTRY });
  fs.writeFileSync(regPath, JSON.stringify(filtered, null, 2));
}

const registries = findRegistries(nodeModules);
if (registries.length === 0) {
  console.warn('patch-node-abi: no node-abi registries found (is electron-rebuild installed?) — nothing to patch.');
  process.exit(0);
}
for (const reg of registries) {
  patch(reg);
  console.log(`patch-node-abi: ${path.relative(process.cwd(), reg)} → Electron ${TARGET} (ABI ${ABI})`);
}
