'use strict';

// ─── Signal schema ───────────────────────────────────────────────────────────
// severity: 'critical' | 'high' | 'medium' | 'low'
// category: 'active-compromise' | 'pre-breach' | 'misconfiguration'

// ─── Fleet data collection ────────────────────────────────────────────────────

async function collectFleetData(tools, scopeInstallId, scopeInstallName) {
  // Get all WPE installs (or just the one that triggered the event)
  let siteFilter = '';
  if (scopeInstallId) {
    siteFilter = `AND s.id = '${scopeInstallId}'`;
  } else if (scopeInstallName) {
    siteFilter = `AND s.name = '${scopeInstallName}'`;
  }

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
  if (!event) return { installId: null, installName: null };
  if (event.namespace === 'wpe' && event.type === 'sync.completed') {
    return {
      installId:   event.payload?.siteId ?? null,
      installName: event.payload?.installName ?? null,
    };
  }
  return { installId: null, installName: null };
}

// ─── Fleet correlation (Task 6) ───────────────────────────────────────────────

function runFleetCorrelation(allResults, suspiciousSlugsFound) {
  const signals = [];

  // FLEET-01: Same suspicious plugin slug on 2+ installs
  const slugToInstalls = {};
  for (const { install } of allResults) {
    for (const plugin of install.plugins) {
      if (suspiciousSlugsFound.has(plugin.slug) || KNOWN_BACKDOOR_SLUGS.has(plugin.slug)) {
        if (!slugToInstalls[plugin.slug]) slugToInstalls[plugin.slug] = [];
        slugToInstalls[plugin.slug].push(install.name);
      }
    }
  }
  for (const [slug, installNames] of Object.entries(slugToInstalls)) {
    if (installNames.length >= 2) {
      signals.push({
        id: 'FLEET-01', severity: 'critical', category: 'active-compromise',
        installName: installNames.join(', '),
        title: `Suspicious plugin '${slug}' found on ${installNames.length} installs`,
        detail: `Same suspicious plugin slug '${slug}' on: ${installNames.join(', ')}. This suggests account-level compromise or a shared attack vector.`,
        fix: 'This is likely a coordinated attack. Audit all listed installs immediately and check WPE portal for unauthorized SSH key additions.',
      });
    }
  }

  // FLEET-02: New admin accounts with matching email domains across installs
  const emailDomainToInstalls = {};
  for (const { install, signals: instSignals } of allResults) {
    const newAdminSignal = instSignals.find(s => s.id === 'REL-03');
    if (!newAdminSignal) continue;
    for (const user of install.adminUsers) {
      const domain = (user.email || '').split('@')[1];
      if (!domain || domain === 'example.com') continue;
      if (!emailDomainToInstalls[domain]) emailDomainToInstalls[domain] = [];
      emailDomainToInstalls[domain].push(install.name);
    }
  }
  for (const [domain, installNames] of Object.entries(emailDomainToInstalls)) {
    if (installNames.length >= 2) {
      signals.push({
        id: 'FLEET-02', severity: 'critical', category: 'active-compromise',
        installName: installNames.join(', '),
        title: `New admin accounts with same email domain @${domain} across ${installNames.length} installs`,
        detail: `Matching email domain @${domain} on new admin accounts across: ${installNames.join(', ')}`,
        fix: 'Account-level compromise suspected. Audit portal access and SSH keys immediately.',
      });
    }
  }

  return signals;
}

// ─── Agent definition ─────────────────────────────────────────────────────────

module.exports = {
  name: 'security-sentinel',
  version: '1.0.0',
  description: 'Fleet-wide security surveillance — detects compromise and pre-breach exposure across all WPE installs',
  triggers: [
    { type: 'cron', expression: '*/15 * * * *' },
    { type: 'event', pattern: 'wpe:sync.completed' },
    // wp:plugin.activated and wp:user.created work for local sites
    { type: 'event', pattern: 'wp:plugin.activated' },
    { type: 'event', pattern: 'wp:user.created' },
    // local:site.started EXCLUDED — triggers on sandbox creation → infinite loop
  ],
  tools: [
    'fleet_sql', 'wpe_site_deep_refresh', 'wp_user_list',
    'local_create_site', 'local_wpe_pull', 'local_wpe_push',
    'local_operation_status', 'compare_sites', 'wp_plugin_list', 'wp_eval',
  ],

  async run({ event, tools, ai, log, state }) {
    const scope = getScanScope(event);
    const scopeLabel = scope.installId || scope.installName || 'fleet-wide';
    log.info(`security-sentinel: starting sweep for ${scopeLabel}`);

    const installs = await collectFleetData(tools, scope.installId, scope.installName);
    log.info(`security-sentinel: ${installs.length} install(s) to check`);

    const allInstallResults = [];

    for (const install of installs) {
      const signals = [];

      // Tier 1: Absolute checks
      signals.push(...runAbsoluteChecks(install));
      signals.push(...runExposureChecks(install));

      // Phase 1.5: LLM user audit if admin signals present
      if (signals.some(s => s.id === 'ABS-01' || s.id === 'ABS-02')) {
        try {
          const audit = await llmUserAudit(install.adminUsers, ai);
          signals.push(...audit.signals);
        } catch (err) {
          log.warn(`security-sentinel: LLM user audit failed for ${install.name} — ${err.message} (skipping)`);
        }
      }

      // Relative checks
      const baseline = loadBaseline(install.id, state);
      signals.push(...runRelativeChecks(install, baseline));

      allInstallResults.push({ install, signals });

      const criticalCount = signals.filter(s => s.severity === 'critical').length;
      // Only active-compromise signals count toward Tier 2 escalation — EXP (pre-breach) signals are informational
      const compromiseHighCount = signals.filter(s => s.severity === 'high' && s.category === 'active-compromise').length;

      if (signals.length === 0) {
        log.info(`security-sentinel: ${install.name} — ✓ clean`);
      } else if (criticalCount >= 1 || compromiseHighCount >= 2) {
        log.warn(`security-sentinel: ${install.name} — ESCALATING to Tier 2 ...`);
        signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
        await tier2Investigate(install, signals, tools, ai, log, state);
      } else {
        log.warn(`security-sentinel: ${install.name} — ${signals.length} finding(s):`);
        signals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
      }
      // Always store baseline so relative checks fire on next scan
      storeBaseline(install, state);
    }

    // Fleet correlation
    const suspiciousSlugs = new Set(
      allInstallResults.flatMap(r => r.signals)
        .filter(s => s.id === 'ABS-05')
        .map(s => { const m = s.title.match(/'([^']+)'/); return m ? m[1] : null; })
        .filter(Boolean)
    );
    const fleetSignals = runFleetCorrelation(allInstallResults, suspiciousSlugs);
    if (fleetSignals.length > 0) {
      log.warn(`security-sentinel: FLEET CORRELATION — ${fleetSignals.length} cross-site signal(s):`);
      fleetSignals.forEach(s => log.warn(`  [${s.severity.toUpperCase()}] ${s.id}: ${s.title}`));
    }

    log.info('security-sentinel: sweep complete');
  },

  // Exported for unit testing only
  _test: { parseSqlResult, getScanScope, runAbsoluteChecks, llmUserAudit, runExposureChecks, loadBaseline, storeBaseline, runRelativeChecks, runFleetCorrelation, tier2Investigate, llmSynthesis, tier3Remediate },
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

function storeBaseline(install, state) {
  const baseline = {
    capturedAt: Date.now(),
    syncedAt:   install.sshLastSyncAt ?? null,
    pluginSlugs: install.plugins
      .map(p => `${p.slug}:${p.version || ''}:${p.is_active}`)
      .sort(),
    adminUserIds: install.adminUsers.map(u => u.username).sort(),
    adminCount: install.adminUsers.length,
  };
  state.set(`baseline:${install.id}`, baseline);
}

function loadBaseline(installId, state) {
  return state.get(`baseline:${installId}`) ?? null;
}

function runRelativeChecks(install, baseline) {
  if (!baseline) return []; // Cold start — suppress all relative checks

  const signals = [];
  const currentSlugs = new Set(install.plugins.map(p => `${p.slug}:${p.version || ''}:${p.is_active}`));
  const baselineSlugs = new Set(baseline.pluginSlugs);

  // REL-01: New plugin appeared
  const newPlugins = install.plugins.filter(p =>
    !baselineSlugs.has(`${p.slug}:${p.version || ''}:${p.is_active}`) &&
    !baseline.pluginSlugs.some(s => s.startsWith(`${p.slug}:`))
  );
  if (newPlugins.length > 0) {
    signals.push({
      id: 'REL-01', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `New plugin(s) appeared since last scan: ${newPlugins.map(p => p.slug).join(', ')}`,
      detail: `These plugins were not present in the last clean baseline: ${newPlugins.map(p => `${p.slug} v${p.version}`).join(', ')}`,
      fix: 'Verify each new plugin was intentionally installed. If not, delete immediately.',
    });
  }

  // REL-02: Previously-inactive plugin activated
  const nowActive = install.plugins.filter(p => {
    const baselineEntry = baseline.pluginSlugs.find(s => s.startsWith(`${p.slug}:`));
    if (!baselineEntry) return false;
    const wasActive = baselineEntry.split(':')[2] === '1';
    return !wasActive && String(p.is_active) === '1';
  });
  if (nowActive.length > 0) {
    signals.push({
      id: 'REL-02', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Plugin(s) activated since last scan: ${nowActive.map(p => p.slug).join(', ')}`,
      detail: `These plugins were installed but inactive in the baseline and are now active: ${nowActive.map(p => p.slug).join(', ')}`,
      fix: 'Verify the plugin activation was intentional.',
    });
  }

  // REL-03: New admin user
  const currentUsernames = new Set(install.adminUsers.map(u => u.username));
  const baselineUsernames = new Set(baseline.adminUserIds);
  const newAdmins = install.adminUsers.filter(u => !baselineUsernames.has(u.username));
  if (newAdmins.length > 0) {
    signals.push({
      id: 'REL-03', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `New administrator account(s) created since last scan: ${newAdmins.map(u => u.username).join(', ')}`,
      detail: `New admin users: ${newAdmins.map(u => `${u.username} (${u.email || 'no email'})`).join(', ')}`,
      fix: 'Delete each unauthorized admin account: wp user delete <id> --reassign=<legitimate-id>',
    });
  }

  // REL-04: Admin count increased
  if (install.adminUsers.length > baseline.adminCount) {
    // Only add if not already covered by REL-03
    if (newAdmins.length === 0) {
      signals.push({
        id: 'REL-04', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Admin count increased from ${baseline.adminCount} to ${install.adminUsers.length}`,
        detail: 'Administrator count increased but new accounts may be hidden from WordPress Users screen.',
        fix: 'Check for hidden admin accounts by querying the database directly.',
      });
    }
  }

  return signals;
}

async function tier2Investigate(install, tier1Signals, tools, ai, log, state) {
  // Cooldown: don't re-investigate the same install within 24 hours
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const lastEscalation = state.get(`tier2-last:${install.id}`);
  if (lastEscalation && (Date.now() - lastEscalation) < COOLDOWN_MS) {
    const hoursAgo = Math.round((Date.now() - lastEscalation) / 3600000);
    log.info(`[Tier 2] Skipping ${install.name} — escalated ${hoursAgo}h ago (cooldown: 24h)`);
    return;
  }
  state.set(`tier2-last:${install.id}`, Date.now());

  const sandboxName = `sentinel-${install.name}-${Date.now()}`;
  log.info(`[Tier 2] Creating sandbox: ${sandboxName}`);

  // Create isolated sandbox — uses remote_install_id, NOT a formal link
  await tools.invoke('local_create_site', { name: sandboxName });
  await tools.invoke('local_wpe_pull', {
    site:              sandboxName,
    remote_install_id: install.id,
    include_database:  true,
  });

  // local_wpe_pull is async — poll every 20s for status: completed or failed.
  // "running normally, no tracked operation" = site is idle, NOT a completion signal.
  log.info(`[Tier 2] Pull initiated. Polling every 20s for completion...`);
  let pullDone = false;
  for (let i = 0; i < 30; i++) { // max 10 minutes (30 × 20s)
    await new Promise(r => setTimeout(r, 20000));
    try {
      const status = await tools.invoke('local_operation_status', { site: sandboxName });
      const statusStr = String(status);
      log.info(`[Tier 2] Poll ${i + 1}/30: ${statusStr.slice(0, 120)}`);
      if (statusStr.includes('completed')) { pullDone = true; break; }
      if (statusStr.includes('failed')) {
        log.error(`[Tier 2] Pull failed for ${install.name}: ${statusStr.slice(0, 200)}`);
        return;
      }
      // 'in_progress' or 'no tracked operation' (still starting) — keep polling
    } catch (err) {
      log.warn(`[Tier 2] Poll error: ${err.message}`);
    }
  }
  if (!pullDone) { log.warn(`[Tier 2] Pull timed out after 10 minutes for ${install.name}`); return; }

  log.info(`[Tier 2] Sandbox ready. Running filesystem checks...`);

  // Filesystem checks via wp_eval (runs inside Local sandbox, not live site)
  const fsSignals = [];

  // FS-01: PHP files in mu-plugins/
  const muPluginResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    skip_plugins: true,
    skip_themes: true,
    code: `
      $dir = WPMU_PLUGIN_DIR;
      $files = glob("$dir/*.php") ?: [];
      $unexpected = array_filter($files, function($f) {
        $basename = basename($f);
        // WPE managed mu-plugins are expected
        $known = ['wpe-wp-sign-on-plugin.php','wpe-cache-plugin.php',
                  'wpengine-security-auditor.php','mu-plugin.php',
                  'slt-force-strong-passwords.php','wpe-update-source-selector.php',
                  'nexus-ai-connector-config.php','site-compat-layer.php'];
        return !in_array($basename, $known);
      });
      return json_encode(array_values($unexpected));
    `,
  });
  try {
    const muFiles = JSON.parse(muPluginResult || '[]');
    if (muFiles.length > 0) {
      fsSignals.push({
        id: 'FS-01', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `PHP file(s) in mu-plugins/: ${muFiles.map(f => f.split('/').pop()).join(', ')}`,
        detail: `Unexpected PHP files in mu-plugins/ load on every request and cannot be deactivated: ${muFiles.join(', ')}`,
        fix: `Remove via SSH: rm ${muFiles.join(' ')}`,
      });
    }
  } catch {}

  // FS-02: Obfuscation chains
  const obfuscationResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    skip_plugins: true,
    skip_themes: true,
    code: `
      $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
      $patterns = [
        '/eval\\s*\\(\\s*base64_decode/',
        '/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/',
        '/eval\\s*\\(\\s*gzuncompress\\s*\\(\\s*base64_decode/',
        '/eval\\s*\\(\\s*str_rot13/',
        '/base64_decode.*base64_decode/s',
        '/eval\\s*\\(\\s*\\$/',
        '/assert\\s*\\(\\s*\\$/',
        '/create_function\\s*\\(/',
        '/preg_replace\\s*\\(\\s*[\\'"].*\\/e/',
      ];
      $found = [];
      foreach ($dirs as $dir) {
        if (!is_dir($dir)) continue;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
          if ($file->getExtension() !== 'php') continue;
          if ($file->getSize() > 5 * 1024 * 1024) continue; // skip files > 5MB
          $content = file_get_contents($file->getPathname());
          foreach ($patterns as $pattern) {
            if (preg_match($pattern, $content)) {
              $found[] = $file->getPathname();
              break;
            }
          }
        }
      }
      return json_encode(array_unique($found));
    `,
  });
  try {
    const obfFiles = JSON.parse(obfuscationResult || '[]');
    if (obfFiles.length > 0) {
      fsSignals.push({
        id: 'FS-02', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Obfuscated code (eval+base64/gzinflate/rot13) found in ${obfFiles.length} file(s)`,
        detail: `Files containing obfuscation chains: ${obfFiles.join(', ')}`,
        fix: 'Investigate each file. These patterns hide malicious payloads. Compare with original plugin/theme source.',
      });
    }
  } catch {}

  // FS-04: PHP files in uploads/
  const uploadsResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    skip_plugins: true,
    skip_themes: true,
    code: `
      $uploads = wp_upload_dir();
      $dir = $uploads['basedir'];
      $phpFiles = [];
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->getExtension() === 'php') $phpFiles[] = $file->getPathname();
      }
      return json_encode($phpFiles);
    `,
  });
  try {
    const phpUploads = JSON.parse(uploadsResult || '[]');
    if (phpUploads.length > 0) {
      fsSignals.push({
        id: 'FS-04', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `PHP file(s) found in uploads/: ${phpUploads.map(f => f.split('/').pop()).join(', ')}`,
        detail: `PHP files in uploads/ can be executed by visiting their URL directly: ${phpUploads.join(', ')}`,
        fix: 'Delete all PHP files from uploads/. Add .htaccess rule to deny PHP execution in uploads.',
      });
    }
  } catch {}

  // FS-MISMATCH: intentionally runs WITH plugins loaded to detect account-hiding hooks
  const dbCountResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      global $wpdb;
      $count = $wpdb->get_var("SELECT COUNT(DISTINCT u.ID) FROM {$wpdb->users} u JOIN {$wpdb->usermeta} m ON u.ID = m.user_id WHERE m.meta_key = 'wp_capabilities' AND m.meta_value LIKE '%administrator%'");
      $wpCount = count(get_users(['role' => 'administrator']));
      return json_encode(['db' => (int)$count, 'wp' => (int)$wpCount]);
    `,
  });
  let adminMismatch = false;
  try {
    const counts = JSON.parse(dbCountResult || '{}');
    if (counts.db && counts.wp && counts.db !== counts.wp) {
      adminMismatch = true;
      fsSignals.push({
        id: 'FS-MISMATCH', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Admin count mismatch: ${counts.db} in DB vs ${counts.wp} visible via WordPress`,
        detail: `Direct DB query found ${counts.db} admins but WordPress reports ${counts.wp}. A plugin is hiding ${counts.db - counts.wp} account(s).`,
        fix: "The wp-compat backdoor plugin hooks WordPress to hide accounts. Delete wp-compat first, then audit all admin accounts.",
      });
    }
  } catch {}

  log.info(`[Tier 2] Filesystem scan complete: ${fsSignals.length} finding(s)`);

  // LLM synthesis (Task 8) — runs after filesystem checks
  await llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName);

  return { filesystemSignals: fsSignals, adminMismatch, sandboxName };
}

async function llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName) {
  const allSignals = [...tier1Signals, ...fsSignals];

  const prompt = `You are a WordPress security analyst completing an investigation of a WP Engine production site.

Site: ${install.name} (${install.environment}, ${install.postCount} posts)
Sandbox for investigation: ${sandboxName}

Security signals found:
${allSignals.map(s => `[${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`).join('\n')}

Signal details:
${allSignals.map(s => `${s.id}: ${s.detail || '(no detail)'}`).join('\n\n')}

Based on these signals:
1. Classify the situation: active-compromise | high-risk | misconfiguration | false-positive
2. List the top 3 immediate remediation steps in priority order, with exact WP-CLI commands
3. Identify anything that should be checked next that was not covered above
4. Recommend whether to escalate to Tier 3 (fix + push) or monitor only

Format:
CLASSIFICATION: <one of the four values>
IMMEDIATE ACTIONS:
1. <action>
2. <action>
3. <action>
NEXT CHECKS: <what to verify next>
TIER3: yes | no`;

  const synthesis = await ai.run(prompt);
  log.warn(`[Tier 2 Synthesis] ${install.name}:\n${synthesis}`);

  const shouldEscalateToTier3 = synthesis.includes('TIER3: yes') ||
    allSignals.some(s => s.severity === 'critical');

  if (shouldEscalateToTier3) {
    log.warn(`[Tier 3] Preparing remediation plan for ${install.name}`);
    await tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log);
  }
}

async function tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log) {
  // Step 1: Apply remediations in sandbox
  const maliciousPlugins = allSignals
    .filter(s => ['ABS-04', 'ABS-05', 'REL-01'].includes(s.id))
    .flatMap(s => {
      const match = s.title.match(/plugin[^:]*:\s*(.+)/i);
      return match ? match[1].split(',').map(p => p.trim()) : [];
    });

  if (maliciousPlugins.length > 0) {
    log.warn(`[Tier 3] Quarantining plugins: ${maliciousPlugins.join(', ')}`);
    await tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        $quarantine = WP_CONTENT_DIR . '/quarantine/' . date('Y-m-d-His');
        wp_mkdir_p($quarantine);
        $plugins = ${JSON.stringify(maliciousPlugins)};
        $moved = [];
        foreach ($plugins as $slug) {
          $src = WP_PLUGIN_DIR . '/' . $slug;
          if (is_dir($src)) {
            rename($src, $quarantine . '/' . $slug);
            $moved[] = $slug;
          }
        }
        return json_encode($moved);
      `,
    });
  }

  // Step 2: Delete backdoor admin accounts
  const backdoorSignals = allSignals.filter(s => ['REL-03', 'ABS-03', 'LLM-USER-01'].includes(s.id));
  if (backdoorSignals.length > 0) {
    log.warn(`[Tier 3] Flagged suspicious admin accounts — manual review required before deletion`);
    log.warn(`  Run on sandbox: wp user list --role=administrator`);
  }

  // Step 3: Shuffle salts
  await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `return shell_exec('wp config shuffle-salts 2>&1');`,
  }).catch(() => {});

  // Step 4: Apply hardening
  await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      // Disable file editor
      $config = file_get_contents(ABSPATH . 'wp-config.php');
      if (strpos($config, 'DISALLOW_FILE_EDIT') === false) {
        $config = str_replace("/* That's all", "define('DISALLOW_FILE_EDIT', true);\n/* That's all", $config);
        file_put_contents(ABSPATH . 'wp-config.php', $config);
      }
      return 'hardening applied';
    `,
  }).catch(() => {});

  // Step 5: Reconciliation — check for existing local copy before push
  log.warn(`[Tier 3] Remediation prepared in sandbox: ${sandboxName}`);
  log.warn(`[Tier 3] MANUAL STEP REQUIRED:`);
  log.warn(`  1. Review sandbox: ${sandboxName}`);
  log.warn(`  2. Check reconciliation: nexus agent run security-sentinel-reconcile`);
  log.warn(`  3. If clean, push: nexus agent run security-sentinel-push`);
  log.warn(`  Synthesis:\n${synthesis}`);

  // Note: the actual local_wpe_push requires human confirmation — logged above
  // A future Tier 3 interactive flow will present this through the Nexus UI
}
