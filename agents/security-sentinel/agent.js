'use strict';

// ─── Signal schema ───────────────────────────────────────────────────────────
// severity: 'critical' | 'high' | 'medium' | 'low'
// category: 'active-compromise' | 'pre-breach' | 'misconfiguration'

// ─── Fleet data collection ────────────────────────────────────────────────────

async function collectFleetData(tools, scopeInstallId) {
  // Get all WPE installs (or just the one that triggered the event)
  const siteFilter = scopeInstallId
    ? `AND s.id = '${scopeInstallId}'`
    : '';

  const sitesResult = await tools.invoke('fleet_sql', {
    query: `
      SELECT s.id, s.name, s.environment, s.ssh_last_sync_at,
             s.post_count, s.user_count, s.settings_json,
             s.wp_version, s.php_version
      FROM sites s
      WHERE s.source = 'wpe'
      ${siteFilter}
      ORDER BY s.name
    `,
  });

  const rows = parseSqlResult(sitesResult);
  const installs = [];

  for (const site of rows) {
    // Handle unsynced installs — trigger a fresh sync first
    if (!site.ssh_last_sync_at) {
      try {
        await tools.invoke('wpe_site_deep_refresh', { install_name: site.name });
      } catch (err) {
        // Continue — the site may not be SSH-accessible; we'll flag it
      }
    }

    const pluginsResult = await tools.invoke('fleet_sql', {
      query: `SELECT slug, name, version, is_active FROM plugins WHERE site_id = '${site.id}'`,
    });
    const usersResult = await tools.invoke('fleet_sql', {
      query: `SELECT username, email, roles, created_at FROM users WHERE site_id = '${site.id}'`,
    });

    installs.push({
      id:            site.id,
      name:          site.name,
      environment:   site.environment,
      sshLastSyncAt: site.ssh_last_sync_at,
      postCount:     Number(site.post_count) || 0,
      userCount:     Number(site.user_count) || 0,
      settings:      site.settings_json ? JSON.parse(site.settings_json) : {},
      wpVersion:     site.wp_version,
      phpVersion:    site.php_version,
      plugins:       parseSqlResult(pluginsResult),
      adminUsers:    parseSqlResult(usersResult).filter(u => {
        try { return JSON.parse(u.roles || '[]').includes('administrator'); } catch { return false; }
      }),
    });
  }

  return installs;
}

// Parses the markdown table output from fleet_sql into an array of objects
function parseSqlResult(result) {
  if (!result || typeof result !== 'string') return [];
  const lines = result.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| ---'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const vals = line.split('|').map(v => v.trim()).filter(Boolean);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? null; });
    return obj;
  });
}

// ─── Scope determination ──────────────────────────────────────────────────────

function getScanScope(event) {
  if (!event) return { installId: null }; // cron = sweep all
  if (event.namespace === 'wpe' && event.type === 'sync.completed') {
    return { installId: event.payload?.siteId ?? null };
  }
  return { installId: null };
}

// ─── Agent definition ─────────────────────────────────────────────────────────

module.exports = {
  name: 'security-sentinel',
  version: '1.0.0',
  description: 'Fleet-wide security surveillance — detects compromise and pre-breach exposure across all WPE installs',
  triggers: [
    { type: 'cron', expression: '*/15 * * * *' },
    { type: 'event', pattern: 'wpe:sync.completed' },
    { type: 'event', pattern: 'wp:plugin.activated' },
    { type: 'event', pattern: 'wp:user.created' },
    { type: 'event', pattern: 'local:site.started' },
  ],
  tools: [
    'fleet_sql', 'wpe_site_deep_refresh', 'wp_user_list',
    'local_create_site', 'local_wpe_pull', 'local_wpe_push',
    'compare_sites', 'wp_plugin_list', 'wp_eval',
  ],

  async run({ event, tools, ai, log, state }) {
    const scope = getScanScope(event);
    log.info(`security-sentinel: starting sweep${scope.installId ? ` for install ${scope.installId}` : ' (fleet)'}`);

    const installs = await collectFleetData(tools, scope.installId);
    log.info(`security-sentinel: collected data for ${installs.length} install(s)`);

    // Tier 1, Tier 2, Tier 3 — added in Tasks 3–10
    for (const install of installs) {
      const signals = [];

      // Absolute checks (Tasks 3, 4)
      signals.push(...runAbsoluteChecks(install));
      signals.push(...runExposureChecks(install));

      // LLM-assisted user audit if admin signals present (Task 4)
      const adminSignals = signals.filter(s => s.id === 'ABS-01' || s.id === 'ABS-02');
      if (adminSignals.length > 0) {
        const audit = await llmUserAudit(install.adminUsers, ai);
        signals.push(...audit.signals);
      }

      // Relative checks — requires baseline (Task 6)
      const baseline = loadBaseline(install.id, state);
      signals.push(...runRelativeChecks(install, baseline));

      const criticalCount = signals.filter(s => s.severity === 'critical').length;
      const highCount     = signals.filter(s => s.severity === 'high').length;

      if (criticalCount >= 1 || highCount >= 2) {
        log.warn(`security-sentinel: escalating ${install.name} to Tier 2 (${criticalCount} critical, ${highCount} high)`);
        await tier2Investigate(install, signals, tools, ai, log);
      } else if (signals.length === 0) {
        storeBaseline(install, state);
        log.info(`security-sentinel: ${install.name} — clean`);
      }
    }

    // Fleet correlation (Task 7)
    // Added in Task 7

    log.info('security-sentinel: sweep complete');
  },

  // Exported for unit testing only
  _test: { parseSqlResult, getScanScope, runAbsoluteChecks, llmUserAudit, runExposureChecks },
};

// ─── Tier 1: Absolute checks (ABS-01 to ABS-06) ────────────────────────────────

const FILE_MANAGER_SLUGS = new Set([
  'fileorganizer', 'filester', 'file-manager-advanced',
  'wp-file-manager', 'wp-filemanager',
]);

const KNOWN_BACKDOOR_SLUGS = new Set(['wp-compat']);

function runAbsoluteChecks(install) {
  const signals = [];
  const { adminUsers, plugins, settings, postCount } = install;

  // ABS-01: 'admin' username
  if (adminUsers.some(u => u.username === 'admin')) {
    signals.push({
      id: 'ABS-01', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: "Default 'admin' username exists",
      detail: "An administrator account with username 'admin' was found. This is the most commonly brute-forced username.",
      fix: "Create a new administrator account with a unique username, reassign content, then delete the 'admin' account.",
    });
  }

  // ABS-02: Admin count > 3 on a small site (< 100 posts)
  if (adminUsers.length > 3 && postCount < 100) {
    signals.push({
      id: 'ABS-02', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Excessive administrators (${adminUsers.length}) on a ${postCount}-post site`,
      detail: `${adminUsers.length} administrator accounts on a site with only ${postCount} posts is anomalous.`,
      fix: 'Audit each administrator account. Remove or demote accounts that should not have full access.',
    });
  }

  // ABS-03: @example.com email on admin
  if (adminUsers.some(u => u.email && u.email.toLowerCase().endsWith('@example.com'))) {
    const matched = adminUsers.filter(u => u.email && u.email.toLowerCase().endsWith('@example.com'));
    signals.push({
      id: 'ABS-03', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Admin account with @example.com email: ${matched.map(u => u.username).join(', ')}`,
      detail: "@example.com is the WordPress installer placeholder email. No legitimate admin retains it.",
      fix: 'This account was likely created by the WordPress installer or an attacker. Verify and delete if not legitimate.',
    });
  }

  // ABS-04: Active file manager plugins
  const activeFileManagers = plugins.filter(p => FILE_MANAGER_SLUGS.has(p.slug) && String(p.is_active) === '1');
  if (activeFileManagers.length > 0) {
    signals.push({
      id: 'ABS-04', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `File manager plugin(s) active: ${activeFileManagers.map(p => p.slug).join(', ')}`,
      detail: 'File manager plugins provide full filesystem write access from WP Admin. They are the primary mechanism for deploying webshells.',
      fix: 'Deactivate and delete these plugins unless actively required. Filesystem access should go through SFTP/SSH.',
    });
  }

  // ABS-05: Known backdoor plugin slugs
  const backdoors = plugins.filter(p => KNOWN_BACKDOOR_SLUGS.has(p.slug));
  if (backdoors.length > 0) {
    signals.push({
      id: 'ABS-05', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Known backdoor plugin detected: ${backdoors.map(p => p.slug).join(', ')}`,
      detail: `Plugin slug(s) match known malware from the June 2026 incident: ${backdoors.map(p => p.slug).join(', ')}`,
      fix: 'Delete immediately via SSH: wp plugin delete <slug>. Do not deactivate — delete.',
    });
  }

  // ABS-06: Default auth salts
  const settingsValues = Object.values(settings);
  if (settingsValues.some(v => typeof v === 'string' && v.includes('put your unique phrase here'))) {
    signals.push({
      id: 'ABS-06', severity: 'high', category: 'misconfiguration',
      installName: install.name,
      title: 'Default WordPress authentication salts in use',
      detail: "Auth salts still contain the placeholder 'put your unique phrase here'. Session cookies can be forged.",
      fix: 'Run: wp config shuffle-salts. All users will be logged out.',
    });
  }

  return signals;
}
const KNOWN_SECURITY_PLUGINS = new Set([
  'wordfence', 'all-in-one-wp-security', 'ithemes-security',
  'better-wp-security', 'disable-xml-rpc', 'disable-json-api',
  'wpengine-security-auditor',
]);

function runExposureChecks(install) {
  const signals = [];
  const { settings, plugins, environment } = install;
  const isProduction = environment === 'production';

  if (!isProduction) return signals; // Exposure checks only matter on production

  // EXP-03: Theme/plugin editor enabled (DISALLOW_FILE_EDIT not set or false)
  const fileEditValue = settings['DISALLOW_FILE_EDIT'];
  const fileEditDisabled = fileEditValue === '1' || fileEditValue === 'true';
  if (!fileEditDisabled) {
    signals.push({
      id: 'EXP-03', severity: 'medium', category: 'pre-breach',
      installName: install.name,
      title: 'Theme and plugin file editor is enabled',
      detail: 'DISALLOW_FILE_EDIT is not set to true. A compromised admin account can inject PHP code directly from WP Admin.',
      fix: "Add `define('DISALLOW_FILE_EDIT', true);` to wp-config.php",
    });
  }

  // EXP-05: WP_DEBUG enabled on production
  const wpDebug = settings['WP_DEBUG'];
  if (wpDebug === 'true' || wpDebug === '1') {
    signals.push({
      id: 'EXP-05', severity: 'medium', category: 'pre-breach',
      installName: install.name,
      title: 'WP_DEBUG is enabled on production',
      detail: 'Debug mode exposes PHP errors, file paths, database queries, and internal architecture to page visitors.',
      fix: "Set `define('WP_DEBUG', false);` in wp-config.php",
    });
  }

  // EXP-01 heuristic: user enumeration likely enabled if no known protection
  const hasProtection = plugins.some(p => KNOWN_SECURITY_PLUGINS.has(p.slug) && String(p.is_active) === '1');
  if (!hasProtection) {
    signals.push({
      id: 'EXP-01', severity: 'high', category: 'pre-breach',
      installName: install.name,
      title: 'User enumeration likely enabled (no security plugin detected)',
      detail: 'No known security plugin is active. The REST API likely exposes usernames unauthenticated via /wp-json/wp/v2/users, enabling targeted brute-force attacks.',
      fix: 'Install a security plugin that blocks user enumeration, or add a filter to require authentication on the /users REST endpoint.',
    });
  }

  return signals;
}

async function llmUserAudit(adminUsers, ai) {
  if (!adminUsers || adminUsers.length === 0) return { signals: [] };

  const userList = adminUsers.map(u => `  - username: ${u.username}, email: ${u.email || '(none)'}`).join('\n');

  const response = await ai.run(`You are a WordPress security analyst. Examine these administrator usernames and identify any that appear to be attacker-created accounts.

Administrator accounts:
${userList}

Attacker-created accounts typically look like:
- Programmatically generated suffixes: admin_MT6ZqT, admin_ABC123
- Random strings: oxhuhafz, xkzpqrst
- Misspellings of system words: adminbockup (backup), adminsysem (system)
- Generic placeholders with no legitimate purpose

If you find suspicious usernames, start your response with "SUSPICIOUS:" followed by the usernames and why.
If all usernames appear legitimate, start with "CLEAN:".`);

  const suspicious = response.startsWith('SUSPICIOUS:');

  if (!suspicious) return { signals: [] };

  return {
    signals: [{
      id: 'LLM-USER-01',
      severity: 'critical',
      category: 'active-compromise',
      installName: adminUsers[0]?.installName ?? 'unknown',
      title: 'LLM identified synthetic/attacker-pattern administrator usernames',
      detail: response.slice('SUSPICIOUS:'.length).trim(),
      fix: 'Delete each flagged administrator account after verifying it is not legitimate: wp user delete <id> --reassign=<legitimate-admin-id>',
    }],
  };
}

function loadBaseline(installId, state) { return null; }
function runRelativeChecks(install, baseline) { return []; }
function storeBaseline(install, state) {}
async function tier2Investigate(install, signals, tools, ai, log) {}
