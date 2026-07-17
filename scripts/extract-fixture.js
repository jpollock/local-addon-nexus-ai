#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai', 'graph.db');

const q = (sql) =>
  JSON.parse(
    execSync(`sqlite3 "${dbPath}" ".mode json" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' })
  );

const sites = q(
  "SELECT id, name, environment, wp_version, php_version, post_count, user_count, settings_json, ssh_last_sync_at FROM sites WHERE name='theawfulpmtest';"
);

if (!sites.length) {
  console.error('theawfulpmtest not found in graph.db');
  process.exit(1);
}

const site = sites[0];
const plugins = q(`SELECT slug, name, version, is_active FROM plugins WHERE site_id='${site.id}';`);
const users = q(`SELECT username, email, roles, created_at FROM users WHERE site_id='${site.id}';`);

fs.mkdirSync('scripts/fixtures', { recursive: true });
fs.writeFileSync(
  'scripts/fixtures/theawfulpmtest-current.json',
  JSON.stringify({ site, plugins, users }, null, 2)
);

console.log(`Written ${plugins.length} plugins, ${users.length} users for ${site.name}`);
console.log('Output: scripts/fixtures/theawfulpmtest-current.json');
