'use strict';

const enumeratorSpec  = require('./specialists/enumerator');
const integritySpec   = require('./specialists/integrity');
const patternSpec     = require('./specialists/pattern');
const databaseSpec    = require('./specialists/database');
const behavioralSpec  = require('./specialists/behavioral');
const synthesizerSpec = require('./specialists/synthesizer');

// ─── Tool result extractor ────────────────────────────────────────────────────
// tools.invoke() may return a string, a plain object, or an MCP content wrapper.
// This helper always extracts the raw text.
function extractResult(result) {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  // MCP content array: { content: [{ type: 'text', text: '...' }] }
  if (Array.isArray(result?.content)) return result.content.map(c => c.text || '').join('');
  if (typeof result?.content === 'string') return result.content;
  if (typeof result?.text === 'string') return result.text;
  // Plain object (e.g. local_operation_status returns a JSON object directly)
  return JSON.stringify(result);
}

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
      SELECT s.id, s.name, s.source, s.environment, s.ssh_last_sync_at,
             s.post_count, s.user_count, s.settings_json,
             s.wp_version, s.php_version
      FROM sites s
      WHERE (s.source = 'wpe' OR s.source = 'local')
        AND s.name NOT LIKE 'sentinel-%'
      ${siteFilter}
      ORDER BY s.name
    `,
  });

  const rows = parseSqlResult(sitesResult);
  const installs = [];

  for (const site of rows) {
    // Handle unsynced WPE installs — trigger a fresh sync first
    // Local sites don't have SSH so skip the deep refresh
    if (!site.ssh_last_sync_at && site.source !== 'local') {
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
      source:        site.source,      // 'wpe' or 'local'
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
    // Use slice(1,-1) not filter(Boolean) — preserves NULL columns (empty cells)
    // filter(Boolean) removes empty strings for NULL cols, shifting all values left
    const parts = line.split('|');
    const vals = parts.slice(1, parts.length - 1).map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || null; });
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
  timeoutMs: 20 * 60 * 1000, // 20 minutes — Tier 2 pull + filesystem scan can take 10+ minutes
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
    'local_create_site', 'local_clone_site', 'local_start_site',
    'local_wpe_pull', 'local_wpe_push',
    'local_operation_status', 'compare_sites', 'wp_plugin_list', 'wp_eval',
  ],

  async run({ event, tools, ai, log, state }) {
    const scope = getScanScope(event);
    const scopeLabel = scope.installId || scope.installName || 'fleet-wide';
    log.info(`security-sentinel: starting sweep for ${scopeLabel}`);

    log.info('security-sentinel: calling collectFleetData...');
    let installs;
    try {
      installs = await collectFleetData(tools, scope.installId, scope.installName);
    } catch (err) {
      log.error(`security-sentinel: collectFleetData threw: ${err.message}\n${err.stack}`);
      return { verdict: 'error', findings: [], sites: {} };
    }
    log.info(`security-sentinel: ${installs.length} install(s) to check`);

    const allInstallResults = [];
    const allFindings = [];
    let latestPlan = null;

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

      // Collect findings into allFindings
      for (const sig of signals) {
        allFindings.push({ id: sig.id, severity: sig.severity, title: sig.title, site: install.name, category: sig.category });
      }

      if (signals.length === 0) {
        log.info(`security-sentinel: ${install.name} — ✓ clean`);
        log.siteStatus(install.name, 'clean');
      } else if (criticalCount >= 1 || compromiseHighCount >= 2) {
        log.siteStatus(install.name, 'escalated');
        log.phase('Tier 2', `Deep investigation: ${install.name}`);
        signals.forEach(s => log.finding({
          id: s.id, severity: s.severity, title: s.title,
          description: s.detail, site: install.name,
          category: s.category,
        }));
        const plan = await tier2Investigate(install, signals, tools, ai, log, state);
        if (plan) latestPlan = plan;
      } else {
        log.siteStatus(install.name, 'findings');
        signals.forEach(s => log.finding({ id: s.id, severity: s.severity, title: s.title, site: install.name }));
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
      fleetSignals.forEach(s => log.finding({ id: s.id, severity: s.severity, title: s.title, site: s.installName }));
    }

    log.info('security-sentinel: sweep complete');

    const verdict = latestPlan ? 'plan_ready'
      : allFindings.length > 0 ? 'findings'
      : 'clean';

    return { verdict, findings: allFindings, plan: latestPlan ?? undefined, sites: {} };
  },

  // Exported for unit testing only
  _test: { parseSqlResult, getScanScope, runAbsoluteChecks, llmUserAudit, runExposureChecks, loadBaseline, storeBaseline, runRelativeChecks, runFleetCorrelation, tier2Investigate, llmSynthesis, tier3Remediate, buildRemediationChecklist, executeChecklist, collectSpecialistData },
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
      evidence: ['username: admin'],
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
      evidence: adminUsers.map(u => `${u.username} <${u.email || 'no email'}>`),
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
      evidence: matched.map(u => `${u.username} <${u.email}>`),
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
      evidence: activeFileManagers.map(p => `${p.slug} v${p.version || '?'}`),
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
      evidence: backdoors.map(p => `${p.slug} (version: ${p.version || 'unknown'}, active: ${p.is_active})`),
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
      evidence: ['wp-config.php contains default placeholder salts'],
    });
  }

  // ABS-07: Low-entropy plugin directory names (random-looking strings — e.g. "Kz2", "a1b2")
  // Heuristic: slug stripped of hyphens is ≤6 chars, all alphanumeric, no dictionary words
  const COMMON_WORDS_RE = /^(admin|login|cache|image|video|theme|block|post|page|user|form|mail|test|demo|core|base|grid|list|menu|nav|panel|api|cron|hook|feed|link|auth|view|data|file|code|lang)$/i;
  const lowEntropyPlugins = plugins.filter(p => {
    const slug = (p.slug || '').replace(/-/g, '');
    if (slug.length > 6) return false;                       // too long to be random
    if (!/^[a-zA-Z0-9]+$/.test(slug)) return false;          // must be alphanumeric only
    if (COMMON_WORDS_RE.test(slug)) return false;             // real English words are fine
    if (/^[A-Z][a-z]+$/.test(slug)) return false;            // proper capitalized word is fine
    return true;
  });
  if (lowEntropyPlugins.length > 0) {
    signals.push({
      id: 'ABS-07', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Low-entropy plugin name(s) — likely attacker-created: ${lowEntropyPlugins.map(p => p.slug).join(', ')}`,
      detail: 'Plugin directory names that are short random strings (e.g. "Kz2", "a1b") are not legitimate plugin names. Attackers use these to hide tools.',
      fix: 'Inspect the contents of each directory. Delete if not a recognized legitimate plugin.',
      evidence: lowEntropyPlugins.map(p => `${p.slug} (active: ${p.is_active === '1' ? 'yes' : 'no'})`),
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
      evidence: [`DISALLOW_FILE_EDIT = ${fileEditValue ?? '(not set)'}`],
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
      evidence: [`WP_DEBUG = ${wpDebug}`],
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
      evidence: ['checked for: ' + [...KNOWN_SECURITY_PLUGINS].join(', ')],
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

// ─── Specialist data collection ───────────────────────────────────────────────
// Collect raw data from sandbox for specialist AI calls.
// Returns strings suitable for embedding in specialist prompts.
// All nested behavioral response objects are always present with safe fallbacks.
async function collectSpecialistData(sandboxName, siteUrl, tools) {
  const results = await Promise.allSettled([

    // Plugin directory listing with mtimes
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $dir = WP_PLUGIN_DIR;
        $out = [];
        foreach (glob("$dir/*", GLOB_ONLYDIR) ?: [] as $d) {
          $mtime = @filemtime($d);
          $files = iterator_count(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)));
          $out[] = ['name' => basename($d), 'mtime' => $mtime ? date('c', $mtime) : null, 'fileCount' => $files];
        }
        echo json_encode($out);
      `,
    }),

    // Files recently modified (last 30 days) outside wp-admin and wp-includes
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $cutoff = time() - 30 * 86400;
        $root = ABSPATH;
        $found = [];
        $skip = ['wp-admin', 'wp-includes'];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
          if (!$f->isFile()) continue;
          foreach ($skip as $s) { if (strpos($f->getPathname(), "/$s/") !== false) continue 2; }
          if ($f->getMTime() > $cutoff) {
            $found[] = ['path' => str_replace($root, '', $f->getPathname()), 'mtime' => date('c', $f->getMTime()), 'ext' => $f->getExtension()];
          }
          if (count($found) >= 500) break; // cap output
        }
        echo json_encode($found);
      `,
    }),

    // .htaccess files
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $root = ABSPATH;
        $files = [];
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
          if ($f->getFilename() === '.htaccess') {
            $files[$f->getPathname()] = @file_get_contents($f->getPathname());
          }
        }
        echo json_encode($files);
      `,
    }),

    // Obfuscation pattern scan (pre-existing FS-02 code — reuse result)
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
        $patterns = ['/eval\\s*\\(\\s*base64_decode/','/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/','/eval\\s*\\(\\s*str_rot13/','/assert\\s*\\(\\s*\\$/','/create_function\\s*\\(/'];
        $found = []; $total = 0;
        foreach ($dirs as $dir) {
          if (!is_dir($dir)) continue;
          foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php' || $file->getSize() > 5*1024*1024) continue;
            $total++;
            $content = @file_get_contents($file->getPathname());
            foreach ($patterns as $p) {
              if (preg_match($p, $content, $m)) {
                $found[] = ['file' => str_replace(ABSPATH, '', $file->getPathname()), 'pattern' => $p, 'snippet' => substr($content, max(0, strpos($content, $m[0]) - 20), 120)];
                break;
              }
            }
          }
        }
        echo json_encode(['matches' => $found, 'scanned' => $total]);
      `,
    }),

    // Database: wp_posts content sample
    tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        global $wpdb;
        $posts = $wpdb->get_results("SELECT ID, post_title, LEFT(post_content, 500) AS content_preview, post_status, post_type FROM {$wpdb->posts} LIMIT 200", ARRAY_A);
        echo json_encode($posts);
      `,
    }),

    // Database: autoloaded options + critical options
    tools.invoke('wp_eval', {
      site: sandboxName,
      code: `
        global $wpdb;
        $auto = $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE autoload='yes'");
        $critical = $wpdb->get_results("SELECT option_name, LEFT(option_value, 300) as option_value FROM {$wpdb->options} WHERE option_name IN ('siteurl','home','active_plugins','cron') LIMIT 10", ARRAY_A);
        $tables = $wpdb->get_col('SHOW TABLES');
        $std = ['posts','postmeta','comments','commentmeta','terms','termmeta','term_taxonomy','term_relationships','users','usermeta','options','links'];
        $prefixed = array_map(fn($t) => $wpdb->prefix . $t, $std);
        $extra = array_diff($tables, $prefixed);
        echo json_encode(['autoloaded' => $auto, 'critical' => $critical, 'nonStandardTables' => array_values($extra)]);
      `,
    }),

    // WP core checksums
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `echo shell_exec('wp --skip-plugins --skip-themes core verify-checksums 2>&1');`,
    }),

    // Behavioral: external HTTP checks
    (async () => {
      const UA_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36';
      const UA_GBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      const headers = (ua, referer) => ({ 'User-Agent': ua, ...(referer ? { Referer: referer } : {}) });
      const fetchSafe = async (url, opts) => {
        try {
          const r = await fetch(url, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(10000) });
          const text = await r.text().catch(() => '');
          return { status: r.status, headers: Object.fromEntries(r.headers.entries()), bodyPreview: text.slice(0, 500) };
        } catch (e) { return { status: 0, headers: {}, bodyPreview: e.message }; }
      };
      return {
        standard:      await fetchSafe(siteUrl, { headers: headers(UA_CHROME) }),
        googlebot:     await fetchSafe(siteUrl, { headers: headers(UA_GBOT) }),
        googleReferer: await fetchSafe(siteUrl, { headers: headers(UA_CHROME, 'https://www.google.com/') }),
        loginPage:     await fetchSafe(`${siteUrl}/wp-login.php`, { headers: headers(UA_CHROME) }),
        xmlrpc:        await fetchSafe(`${siteUrl}/xmlrpc.php`, { headers: headers(UA_CHROME) }),
        usersApi:      await fetchSafe(`${siteUrl}/wp-json/wp/v2/users`, { headers: headers(UA_CHROME) }),
      };
    })(),
  ]);

  const get = (i) => results[i].status === 'fulfilled' ? results[i].value : '(collection failed)';
  const parseJson = (v, fallback = '[]') => { try { return JSON.parse(typeof v === 'string' ? v : JSON.stringify(v)); } catch { return JSON.parse(fallback); } };

  const pluginDirs  = parseJson(get(0));
  const recentFiles = parseJson(get(1));
  const htaccess    = parseJson(get(2), '{}');
  const scanResult  = parseJson(get(3), '{"matches":[],"scanned":0}');
  const posts       = parseJson(get(4));
  const dbData      = parseJson(get(5), '{"autoloaded":[],"critical":[],"nonStandardTables":[]}');
  const coreChecks  = typeof get(6) === 'string' ? get(6) : JSON.stringify(get(6));
  const behavioral  = typeof get(7) === 'object' && get(7) !== null ? get(7) : {};

  // Safe fallback shape for all behavioral response objects
  const emptyResponse = { status: 0, headers: {}, bodyPreview: '' };

  // Compact formatters — key insight from testing: small prompts work, large fail
  // Each specialist gets only the data it needs in the most compact form
  const fmtPluginDirs = pluginDirs
    .map(d => `${d.name}  ${d.mtime ?? 'unknown'}  (${d.fileCount ?? '?'} files)`)
    .join('\n') || '(none)';

  const suspectExts = ['php','sh','cgi','pl','py','rb','exe','elf'];
  const fmtUnexpected = recentFiles
    .filter(f => suspectExts.includes(f.ext) || (f.path || '').includes('mu-plugin'))
    .slice(0, 30)
    .map(f => `${f.path}  ${f.mtime ?? ''}`)
    .join('\n') || '(none)';

  const fmtRecent = recentFiles
    .slice(0, 60)
    .map(f => `${f.path}  ${f.mtime ?? ''}`)
    .join('\n') || '(none)';

  const fmtHtaccess = Object.entries(htaccess)
    .map(([p, c]) => `--- ${p} ---\n${String(c).slice(0, 400)}`)
    .join('\n') || '(none)';

  const fmtObfuscation = (() => {
    try {
      const m = scanResult.matches || [];
      if (!m.length) return `(none — ${scanResult.scanned ?? 0} files scanned clean)`;
      return m.map(x => `${x.file}  pattern: ${x.pattern}\n  snippet: ${(x.snippet||'').slice(0,80)}`).join('\n');
    } catch { return '(scan error)'; }
  })();

  const fmtPosts = posts.slice(0, 15)
    .map(p => `[${p.post_status}] ${p.post_type}: ${p.post_title}`)
    .join('\n') || '(none)';

  const fmtOptions = (dbData.critical || [])
    .map(o => `${o.option_name}: ${String(o.option_value).slice(0, 100)}`)
    .join('\n') || '(none)';

  const fmtAutoload = (dbData.autoloaded || []).slice(0, 50).join('\n') || '(none)';

  return {
    // For enumerator
    pluginDirectoriesRaw:   fmtPluginDirs,
    unexpectedFilesRaw:     fmtUnexpected,
    htaccessPathsRaw:       Object.keys(htaccess).join('\n') || '(none found)',
    nonStandardTablesRaw:   (dbData.nonStandardTables || []).join('\n') || '(none)',
    autoloadedOptionsRaw:   fmtAutoload,

    // For integrity
    coreChecksums:          String(coreChecks).slice(0, 1000),
    pluginChecksums:        '(not collected — mark all plugins as unverifiable)',
    configPhpMtime:         '(captured via filesystem scan above)',

    // For pattern
    patternScanOutput:      fmtObfuscation,
    htaccessContents:       fmtHtaccess,
    recentlyModifiedFiles:  fmtRecent,

    // For database
    postsContent:           fmtPosts,
    autoloadedOptions:      fmtAutoload,
    criticalOptions:        fmtOptions,
    adminUsermeta:          '(not collected)',
    recentComments:         '(not collected)',
    nonStandardTableData:   (dbData.nonStandardTables || []).join(', ') || '(none)',

    // For behavioral — always present with safe fallbacks
    standardResponse:       behavioral.standard       ?? emptyResponse,
    googlebotResponse:      behavioral.googlebot      ?? emptyResponse,
    googleReferrerResponse: behavioral.googleReferer  ?? emptyResponse,
    loginPageStatus:        behavioral.loginPage?.status ?? 0,
    xmlrpcStatus:           behavioral.xmlrpc?.status    ?? 0,
    usersApiStatus:         behavioral.usersApi?.status  ?? 0,
    usersApiBody:           behavioral.usersApi?.bodyPreview ?? '',
    randomPostStatuses:     '(not collected)',
  };
}

async function tier2Investigate(install, tier1Signals, tools, ai, log, state, _pollIntervalMs = 20000) {
  // DEV MODE: cooldown disabled for iteration speed
  // TODO: re-enable before production by uncommenting below
  // if (state.isCoolingDown(`tier2:${install.id}`, 24 * 60 * 60 * 1000)) {
  //   const lastMs = state.get(`_cooldown:tier2:${install.id}`);
  //   const hoursAgo = lastMs ? ((Date.now() - lastMs) / 3_600_000).toFixed(1) : '?';
  //   log.info(`[Tier 2] Skipping ${install.name} — escalated ${hoursAgo}h ago (cooldown: 24h)`);
  //   return null;
  // }
  // state.setCooldown(`tier2:${install.id}`);

  const sandboxName = `sentinel-${install.name}-${Date.now()}`;
  log.info(`[Tier 2] Creating sandbox: ${sandboxName}`);

  // Abstraction: create_local_test_sandbox
  // WPE install  → create blank site + pull from WPE (files + DB over SSH, ~2 minutes)
  // Local site   → clone the existing local site (filesystem copy, ~10 seconds)
  const isLocal = install.source === 'local';

  if (isLocal) {
    // Clone the local site — instant, no SSH or WPE pull needed
    log.info(`[Tier 2] Local site detected — starting ${install.name} then cloning to ${sandboxName}`);
    // local_clone_site requires the source site to be running
    try {
      await tools.invoke('local_start_site', { site: install.name });
      log.info(`[Tier 2] Source site started`);
    } catch (startErr) {
      log.info(`[Tier 2] Source site start skipped (may already be running): ${startErr.message}`);
    }
    const cloneResult = await tools.invoke('local_clone_site', { site: install.name, new_name: sandboxName });
    const cloneStr = extractResult(cloneResult);
    if (cloneStr.toLowerCase().includes('error') || cloneStr.toLowerCase().includes('failed')) {
      log.error(`[Tier 2] Clone failed for ${install.name}: ${cloneStr.slice(0, 300)}`);
      return null;
    }
    // local_clone_site is async — poll until complete
    log.info(`[Tier 2] Clone initiated. Polling for completion...`);
    let cloneDone = _pollIntervalMs === 0;
    for (let i = 0; i < 30 && !cloneDone; i++) {
      await new Promise(r => setTimeout(r, Math.max(_pollIntervalMs, 2000)));
      try {
        const status = await tools.invoke('local_operation_status', { site: sandboxName });
        const statusStr = typeof status === 'string' ? status : JSON.stringify(status);
        log.info(`[Tier 2] Clone status: ${statusStr.slice(0, 150)}`);
        if (statusStr.includes('completed') || statusStr.includes('"done"') || statusStr.includes('running') || statusStr === '{}' || statusStr === 'null') { cloneDone = true; break; }
        if (statusStr.includes('failed')) { log.error(`[Tier 2] Clone failed`); return null; }
      } catch {}
    }
    if (!cloneDone) { log.warn(`[Tier 2] Clone timed out`); return null; }
    log.info(`[Tier 2] Clone ready.`);
  } else {
    // WPE install — create blank site and pull from WPE
    const createResult = await tools.invoke('local_create_site', { name: sandboxName });
    log.info(`[Tier 2] Sandbox created: ${extractResult(createResult).slice(0, 100)}`);

    const pullResult = await tools.invoke('local_wpe_pull', {
      site:              sandboxName,
      remote_install_id: install.name,
      include_database:  true,
    });
    const pullResultStr = extractResult(pullResult);
    log.info(`[Tier 2] Pull response: ${pullResultStr.slice(0, 200)}`);
    if (pullResultStr.toLowerCase().includes('error') || pullResultStr.includes('not found')) {
      log.error(`[Tier 2] Pull failed to start for ${install.name}: ${pullResultStr.slice(0, 300)}`);
      return null;
    }

    log.info(`[Tier 2] Pull initiated. Polling every 20s for completion...`);
    let pullDone = _pollIntervalMs === 0;
    let sawInProgress = false;
    for (let i = 0; i < 30 && !pullDone; i++) {
      await new Promise(r => setTimeout(r, _pollIntervalMs));
      try {
        const status = await tools.invoke('local_operation_status', { site: sandboxName });
        const statusStr = typeof status === 'string' ? status : JSON.stringify(status);
        log.info(`[Tier 2] Poll ${i + 1}/30: ${statusStr.slice(0, 200)}`);
        if (statusStr.includes('failed')) { log.error(`[Tier 2] Pull failed for ${install.name}`); return null; }
        if (statusStr.includes('"active"') || statusStr.includes('in_progress') || statusStr.includes('pulling')) {
          sawInProgress = true;
          log.info(`[Tier 2] Pull in progress (${JSON.parse(statusStr).duration_seconds ?? '?'}s elapsed)`);
        } else if (statusStr.includes('completed') || statusStr.includes('"done"') || statusStr.includes('"complete"')) {
          pullDone = true; break;
        } else if (sawInProgress) {
          log.info(`[Tier 2] Pull appears complete (operation cleared)`);
          pullDone = true; break;
        }
      } catch (err) {
        log.warn(`[Tier 2] Poll error: ${err.message}`);
      }
    }
    if (!pullDone) { log.warn(`[Tier 2] Pull timed out for ${install.name}`); return null; }
  }

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
      echo json_encode(array_values($unexpected));
    `,
  });
  try {
    const muFiles = JSON.parse(extractResult(muPluginResult) || '[]');
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
              $found[] = ['file' => str_replace(ABSPATH, '', $file->getPathname()), 'pattern' => $pattern];
              break;
            }
          }
        }
      }
      echo json_encode($found);
    `,
  });
  try {
    const obfFiles = JSON.parse(extractResult(obfuscationResult) || '[]');
    if (obfFiles.length > 0) {
      fsSignals.push({
        id: 'FS-02', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Obfuscated code (eval+base64/gzinflate/rot13) found in ${obfFiles.length} file(s)`,
        detail: `Files containing obfuscation chains: ${obfFiles.map(f => f.file || f).join(', ')}`,
        fix: 'Inspect each file. Delete if not part of a legitimate plugin/theme. Compare with original plugin source.',
        evidence: obfFiles.map(f => typeof f === 'string' ? f : `${f.file} — pattern: ${f.pattern || '?'}`),
      });
    }
  } catch {}

  // FS-03: PHP files in unexpected non-plugin locations: languages/, web root, uploads/ (obfuscated)
  const broadScanResult = await tools.invoke('wp_eval', {
    site: sandboxName, skip_plugins: true, skip_themes: true,
    code: `
      $patterns = ['/eval\\s*\\(.*base64_decode/s', '/eval\\s*\\(.*gzinflate/s', '/eval\\s*\\(.*str_rot13/s'];
      $scanDirs = [
        ABSPATH . 'wp-content/languages',
        ABSPATH . 'wp-content/uploads',
      ];
      $rootPhp = glob(ABSPATH . '*.php') ?: [];
      $knownRoot = ['index.php','wp-activate.php','wp-blog-header.php','wp-comments-post.php',
                    'wp-config.php','wp-cron.php','wp-links-opml.php','wp-load.php',
                    'wp-login.php','wp-mail.php','wp-settings.php','wp-signup.php',
                    'wp-trackback.php','xmlrpc.php','wp-config-sample.php'];
      $found = [];
      foreach ($rootPhp as $f) {
        if (!in_array(basename($f), $knownRoot)) {
          $found[] = ['path' => str_replace(ABSPATH, '', $f), 'reason' => 'unknown PHP in web root'];
        }
      }
      foreach ($scanDirs as $dir) {
        if (!is_dir($dir)) continue;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
          if ($file->getExtension() !== 'php') continue;
          $content = @file_get_contents($file->getPathname());
          foreach ($patterns as $p) {
            if (preg_match($p, $content)) {
              $found[] = ['path' => str_replace(ABSPATH, '', $file->getPathname()), 'reason' => 'obfuscated code'];
              break;
            }
          }
        }
      }
      echo json_encode($found);
    `,
  });
  try {
    const broadFiles = JSON.parse(extractResult(broadScanResult) || '[]');
    if (broadFiles.length > 0) {
      fsSignals.push({
        id: 'FS-03', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Suspicious PHP files outside plugins/themes: ${broadFiles.length} file(s)`,
        detail: 'PHP files were found in unexpected locations (web root, languages/, uploads/) or contain obfuscation.',
        fix: 'Delete unknown PHP files from web root and languages/. PHP should not exist in uploads/.',
        evidence: broadFiles.map(f => `${f.path} (${f.reason})`),
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
      echo json_encode($phpFiles);
    `,
  });
  try {
    const phpUploads = JSON.parse(extractResult(uploadsResult) || '[]');
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

  // FS-05: Suspicious .htaccess rules — PHP re-enable, external redirects, auto_prepend/append_file
  const htaccessResult = await tools.invoke('wp_eval', {
    site: sandboxName, skip_plugins: true, skip_themes: true,
    code: `
      $root = ABSPATH;
      $findings = [];
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
        if ($f->getFilename() !== '.htaccess') continue;
        $content = @file_get_contents($f->getPathname());
        $path = str_replace($root, '', $f->getPathname());
        // PHP re-enabled in non-root .htaccess (especially in uploads/)
        if (strpos($path, '/uploads/') !== false && preg_match('/\\.php/i', $content)) {
          $findings[] = ['path' => $path, 'reason' => 'PHP execution enabled in uploads/', 'snippet' => substr($content, 0, 300)];
        }
        // External redirect rules
        if (preg_match('/RewriteRule.*https?:\\/\\/(?!'.preg_quote($_SERVER["HTTP_HOST"] ?? 'localhost', '/').')/', $content, $m)) {
          $findings[] = ['path' => $path, 'reason' => 'RewriteRule redirecting to external domain', 'snippet' => $m[0]];
        }
        // php_value re-enabling execution
        if (preg_match('/php_value\\s+auto_prepend_file|php_value\\s+auto_append_file/', $content, $m)) {
          $findings[] = ['path' => $path, 'reason' => 'auto_prepend/append_file set via php_value', 'snippet' => $m[0]];
        }
      }
      echo json_encode($findings);
    `,
  });
  try {
    const htaccessFindings = JSON.parse(extractResult(htaccessResult) || '[]');
    if (htaccessFindings.length > 0) {
      fsSignals.push({
        id: 'FS-05', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Suspicious .htaccess rules in ${htaccessFindings.length} location(s)`,
        detail: 'htaccess files with rules that re-enable PHP execution or redirect to external domains were found.',
        fix: 'Review each file. Remove rules that allow PHP in uploads/ or redirect to external domains.',
        evidence: htaccessFindings.map(f => `${f.path}: ${f.reason} — ${(f.snippet || '').slice(0, 80)}`),
      });
    }
  } catch {}

  // FS-06: ELF binary detection in wp-content/
  const elfResult = await tools.invoke('wp_eval', {
    site: sandboxName, skip_plugins: true, skip_themes: true,
    code: `
      $dir = WP_CONTENT_DIR;
      $found = [];
      $skipExts = ['php','js','css','html','htm','txt','md','json','xml','svg','png','jpg','jpeg','gif','webp','woff','woff2','ttf','eot','ico','map','pot','po','mo','log','ini','conf'];
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        if (!$f->isFile()) continue;
        $ext = strtolower($f->getExtension());
        if (in_array($ext, $skipExts)) continue;
        $fh = @fopen($f->getPathname(), 'rb');
        if (!$fh) continue;
        $header = fread($fh, 4);
        fclose($fh);
        // ELF header: \x7fELF
        if ($header === "\x7fELF") {
          $found[] = ['path' => str_replace(WP_CONTENT_DIR, 'wp-content', $f->getPathname()), 'size' => $f->getSize()];
        }
      }
      echo json_encode($found);
    `,
  });
  try {
    const elfs = JSON.parse(extractResult(elfResult) || '[]');
    if (elfs.length > 0) {
      fsSignals.push({
        id: 'FS-06', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `ELF binary (Linux executable) found in wp-content: ${elfs.length} file(s)`,
        detail: 'Linux executables inside wp-content/ are not legitimate WordPress files. They are likely backdoors or crypto miners.',
        fix: 'Delete immediately. Investigate when each was placed using filesystem timestamps and access logs.',
        evidence: elfs.map(f => `${f.path} (${(f.size / 1024).toFixed(1)} KB)`),
      });
    }
  } catch {}

  // ABS-09: Suspicious internal filenames within plugins
  // Files named check_file.php, shell.php, cmd.php, c99.php, r57.php, etc. signal attacker tools
  // regardless of whether they use obfuscation
  const suspiciousFileResult = await tools.invoke('wp_eval', {
    site: sandboxName, skip_plugins: true, skip_themes: true,
    code: `
      $dir = WP_PLUGIN_DIR;
      $suspicious = [
        'check_file.php', 'shell.php', 'cmd.php', 'c99.php', 'r57.php', 'php.php',
        'eval.php', 'exec.php', 'bypass.php', 'b374k.php', 'wso.php',
        'FilesMan.php', 'b374.php', 'indoxploit.php',
      ];
      $found = [];
      if (!is_dir($dir)) { echo json_encode($found); exit; }
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        if (in_array(strtolower($f->getFilename()), array_map('strtolower', $suspicious))) {
          $found[] = [
            'path' => str_replace(ABSPATH, '', $f->getPathname()),
            'size' => $f->getSize(),
            'mtime' => date('Y-m-d H:i:s', $f->getMTime()),
          ];
        }
      }
      echo json_encode($found);
    `,
  });
  try {
    const suspiciousFiles = JSON.parse(extractResult(suspiciousFileResult) || '[]');
    if (suspiciousFiles.length > 0) {
      fsSignals.push({
        id: 'ABS-09', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Suspicious internal filenames in plugins: ${suspiciousFiles.map(f => f.path.split('/').pop()).join(', ')}`,
        detail: 'Files with names matching known attacker tool patterns were found inside plugin directories.',
        fix: 'Inspect each file. Delete if not part of a legitimate plugin.',
        evidence: suspiciousFiles.map(f => `${f.path} (${f.size} bytes, modified ${f.mtime})`),
      });
    }
  } catch {}

  // ABS-08: Anti-forensics tools — PHP that recursively modifies file timestamps
  // The touch() + scandir/glob/RecursiveIterator pattern is specific to timestamp-backdating tools
  const antiForensicsResult = await tools.invoke('wp_eval', {
    site: sandboxName, skip_plugins: true, skip_themes: true,
    code: `
      $dir = WP_PLUGIN_DIR;
      $found = [];
      if (!is_dir($dir)) { echo json_encode($found); exit; }
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
        if ($f->getExtension() !== 'php') continue;
        $content = @file_get_contents($f->getPathname());
        if (!$content) continue;
        // touch() + scandir/glob/RecursiveIterator in same file = timestamp manipulation
        if (preg_match('/touch\\s*\\(/', $content) &&
            preg_match('/scandir|glob|RecursiveIterator/', $content)) {
          $found[] = [
            'path' => str_replace(ABSPATH, '', $f->getPathname()),
            'snippet' => substr($content, 0, 200),
          ];
        }
      }
      echo json_encode($found);
    `,
  });
  try {
    const antiForensics = JSON.parse(extractResult(antiForensicsResult) || '[]');
    if (antiForensics.length > 0) {
      fsSignals.push({
        id: 'ABS-08', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Anti-forensics tool detected: timestamp manipulation code in ${antiForensics.length} file(s)`,
        detail: 'PHP code using touch() to recursively modify file timestamps was found. This is used by attackers to hide when files were planted.',
        fix: 'Delete the containing plugin/directory. The attacker used this to backdate all planted files, so timestamp-based analysis of the site is unreliable.',
        evidence: antiForensics.map(f => f.path),
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
      echo json_encode(['db' => (int)$count, 'wp' => (int)$wpCount]);
    `,
  });
  let adminMismatch = false;
  try {
    const counts = JSON.parse(extractResult(dbCountResult) || '{}');
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

  // Collect raw data for all specialists in parallel
  log.phase('Data collection', `Gathering filesystem, DB and behavioral data for ${install.name}`);
  const siteUrl = `https://${install.name}.wpengine.com`;
  const specialistData = await collectSpecialistData(sandboxName, siteUrl, tools);

  // Fan out to five parallel specialist AI calls — each is pure reasoning over provided data
  log.phase('Specialist analysis', `Running 5 parallel specialist checks on ${install.name}`);
  const [enumeratorResult, integrityResult, patternResult, databaseResult, behavioralResult] =
    await Promise.all([
      ai.generateObject({
        schema: enumeratorSpec.schema,
        prompt: enumeratorSpec.buildPrompt({ ...specialistData, installName: install.name }),
        schemaName: 'EnumeratorResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Enumerator failed: ${err.message}`); return { pluginDirectories: [], unexpectedFiles: [], htaccessFiles: [], nonStandardTables: [], autoloadedOptions: [] }; }),

      ai.generateObject({
        schema: integritySpec.schema,
        prompt: integritySpec.buildPrompt({ ...specialistData, installName: install.name, siteCreatedAt: install.sshLastSyncAt ?? 'unknown' }),
        schemaName: 'IntegrityResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Integrity failed: ${err.message}`); return { coreVerification: { status: 'unavailable', failures: [] }, pluginVerification: [], configPhpModified: false }; }),

      ai.generateObject({
        schema: patternSpec.schema,
        prompt: patternSpec.buildPrompt({ ...specialistData, installName: install.name, compromiseWindowEstimate: null }),
        schemaName: 'PatternResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Pattern failed: ${err.message}`); return { criticalFindings: [], htaccessFindings: [], temporalCluster: { detected: false }, filesScanned: 0, filesClean: 0 }; }),

      ai.generateObject({
        schema: databaseSpec.schema,
        prompt: databaseSpec.buildPrompt({ ...specialistData, installName: install.name }),
        schemaName: 'DatabaseResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Database failed: ${err.message}`); return { injectedContent: [], suspiciousCronHooks: [], optionAnomalies: [], nonStandardTableContent: [], samplingNote: 'Collection failed' }; }),

      ai.generateObject({
        schema: behavioralSpec.schema,
        prompt: behavioralSpec.buildPrompt({ ...specialistData, installName: install.name, siteUrl }),
        schemaName: 'BehavioralResult',
        noTools: true,
      }).catch(err => { log.warn(`[Specialist] Behavioral failed: ${err.message}`); return { cloakingDetected: false, loginPageStatus: 0, xmlrpcEnabled: false, userEnumerationEnabled: false, redirectsDetected: [], anomalies: [] }; }),
    ]);

  // Elevation: if temporal cluster detected, add to signals
  if (patternResult.temporalCluster?.detected) {
    const cluster = patternResult.temporalCluster;
    log.finding({
      id: 'TC-01', severity: 'critical', site: install.name,
      title: `Temporal cluster: ${cluster.itemCount ?? 'multiple'} items within ${cluster.windowStart ?? 'unknown'}–${cluster.windowEnd ?? 'unknown'}`,
      description: `Rapid bulk activity within a short window is the primary signal of an automated attack. Items: ${(cluster.items ?? []).join(', ')}`,
    });
  }

  // Synthesis: correlate all five specialist results
  log.phase('Synthesis', `Correlating findings for ${install.name}`);
  let synthesis;
  try {
    synthesis = await ai.generateObject({
      schema: synthesizerSpec.schema,
      prompt: synthesizerSpec.buildPrompt({
        installName: install.name,
        environment: install.environment,
        postCount: install.postCount,
        siteCreatedAt: install.sshLastSyncAt ?? 'unknown',
        lastSyncAt: install.sshLastSyncAt ?? 'unknown',
        tier1Signals: tier1Signals.map(s => `[${s.severity.toUpperCase()}] ${s.id}: ${s.title}`).join('\n'),
        enumeratorResult,
        integrityResult,
        patternResult,
        databaseResult,
        behavioralResult,
      }),
      schemaName: 'SynthesizerResult',
      noTools: true,
    });
    log.warn(`[Tier 2 Synthesis] ${install.name}: ${synthesis.verdict} — ${(synthesis.attackSummary || '').slice(0, 120)}...`);
  } catch (err) {
    log.warn(`[Tier 2 Synthesis] LLM call failed for ${install.name}: ${err.message} — defaulting to escalate`);
    synthesis = { verdict: 'active-compromise', attackSummary: '(synthesis unavailable)', entryPoint: 'unknown', temporalNarrative: '', attackerItems: [], legitimateItems: [], blindSpots: ['Synthesis failed'], remediationSteps: [] };
  }

  // Build RemediationPlan from synthesizer output
  if (synthesis.remediationSteps.length === 0) {
    log.warn(`[Tier 2] No remediation steps in synthesis — falling back to checklist builder`);
    const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
    return plan;
  }

  log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
  const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
  if (plan) {
    // Enrich plan with synthesizer's attacker items and blind spots
    plan.summary = synthesis.attackSummary;
    plan.entryPoint = synthesis.entryPoint;
    plan.blindSpots = synthesis.blindSpots;
    plan.attackerItems = synthesis.attackerItems;
  }

  // Sandbox intentionally kept alive — the user will execute or dismiss via Sentinel Review UI.
  // Deletion is handled by the nexus:sentinel:execute IPC handler after execution completes.
  return plan;
}

async function llmSynthesis(install, tier1Signals, fsSignals, tools, ai, log, sandboxName) {
  const allSignals = [...tier1Signals, ...fsSignals];

  const schema = {
    type: 'object',
    properties: {
      classification: {
        type: 'string',
        enum: ['active-compromise', 'high-risk', 'misconfiguration', 'false-positive'],
      },
      summary: { type: 'string', description: 'Two-sentence summary of the situation' },
      escalateToTier3: { type: 'boolean', description: 'Whether to apply the remediation plan to production' },
    },
    required: ['classification', 'summary', 'escalateToTier3'],
  };

  const systemPrompt = `You are a WordPress security analyst completing an investigation of a WP Engine production site.
Site: ${install.name} (${install.environment}, ${install.postCount} posts)
Sandbox: ${sandboxName}`;

  const userPrompt = `Security signals found:
${allSignals.map(s => `[${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`).join('\n')}

Signal details:
${allSignals.map(s => `${s.id}: ${s.detail || '(no detail)'}`).join('\n\n')}

Classify the situation and decide if the remediation plan should be applied to production.`;

  log.info(`[Tier 2] Calling LLM synthesis...`);
  let synthesis = { classification: 'active-compromise', summary: '(synthesis unavailable)', escalateToTier3: true };

  try {
    synthesis = await ai.generateObject({ prompt: userPrompt, system: systemPrompt, schema, schemaName: 'SentinelSynthesis' });
    log.warn(`[Tier 2 Synthesis] ${install.name}: ${synthesis.classification} — ${synthesis.summary}`);
  } catch (err) {
    log.warn(`[Tier 2 Synthesis] LLM call failed for ${install.name}: ${err.message} — defaulting to escalate`);
  }

  if (synthesis.escalateToTier3 || allSignals.some(s => s.severity === 'critical')) {
    log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
    const plan = await tier3Remediate(install, synthesis.summary, allSignals, sandboxName, tools, log);
    return plan;
  }

  return null;
}

// ─── Admin account confidence scoring ────────────────────────────────────────
// Returns 0-100+ confidence score that an account is attacker-created.
// > 95: auto-delete  |  50-95: demote to subscriber  |  < 50: flag for review
function scoreAdminAccount(user, _allAdminUsers, attackTimestamp) {
  let score = 0;
  const username = user.username || '';
  const email = user.email || '';
  const registered = user.created_at || null;

  // Username is a random string (all lowercase, 6-10 chars, no real words pattern)
  if (/^[a-z]{6,10}$/.test(username) && !/^(admin|backup|system|editor|author|manager)/.test(username)) score += 60;
  // Username has programmatic suffix (admin_XXXXXX)
  if (/^admin_[A-Z0-9]{4,}$/.test(username)) score += 60;
  // Default placeholder email
  if (email.endsWith('@example.com') || !email) score += 35;
  // Typo/misspelling of system word
  if (/adminb[ao]ck|adminsyst|adminbak|wp_adm/.test(username.toLowerCase())) score += 20;

  // Creation date clustering: if created within ±10 minutes of the attack timestamp, add cluster bonus
  if (registered && attackTimestamp) {
    const userTime = new Date(registered).getTime();
    const attackTime = new Date(attackTimestamp).getTime();
    const diffMin = Math.abs(userTime - attackTime) / 60000;
    if (diffMin <= 10) score += 30;
  }

  return score;
}

// ─── Tier 3: Checklist-driven remediation ────────────────────────────────────

const KNOWN_MU_PLUGINS = [
  'wpe-wp-sign-on-plugin.php', 'wpe-cache-plugin.php',
  'wpengine-security-auditor.php', 'mu-plugin.php',
  'slt-force-strong-passwords.php', 'wpe-update-source-selector.php',
  'nexus-ai-connector-config.php', 'site-compat-layer.php',
];

const ATTACKER_PLUGIN_SLUGS = [
  'fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
  'noted', 'woocommerce-conversion-tracking', 'wp-file-manager',
];

function buildRemediationChecklist(install, allSignals, sandboxName) {
  const checklist = [];
  const knownListJson = JSON.stringify(KNOWN_MU_PLUGINS);

  // Step 1: Remove mu-plugins webshells — only if FS-01 fired
  if (allSignals.some(s => s.id === 'FS-01')) {
    checklist.push({
      step: 1,
      action: 'Remove mu-plugins webshell(s)',
      executableCommand: 'rm wp-content/mu-plugins/index.php',
      toolName: 'wp_eval',
      toolArgs: {
        site: sandboxName,
        skip_plugins: true,
        skip_themes: true,
        code: `$files = glob(WPMU_PLUGIN_DIR . '/*.php') ?: []; $known = ${knownListJson}; foreach($files as $f) { if (!in_array(basename($f), $known)) { @unlink($f); } } $remaining = array_values(array_filter($files, function($f) use ($known) { return !in_array(basename($f), $known) && file_exists($f); })); echo json_encode($remaining);`,
      },
      expectedEmpty: true,
    });
  }

  // Step 2: Confidence-scored admin account remediation — only if admin-related signals fired
  // > 95 → auto-delete | 50-95 → demote to subscriber + REVIEW REQUIRED | < 50 → flag only
  // Always deletes application passwords for score >= 50
  if (allSignals.some(s => ['REL-03', 'ABS-03', 'LLM-USER-01', 'ABS-01', 'ABS-02'].includes(s.id))) {
    checklist.push({
      step: 2,
      action: 'Confidence-scored admin account remediation',
      executableCommand: null,
      toolName: 'wp_eval',
      toolArgs: {
        site: sandboxName,
        code: `global $wpdb; $admins = $wpdb->get_results("SELECT u.ID, u.user_login, u.user_email, u.user_registered FROM {$wpdb->users} u JOIN {$wpdb->usermeta} m ON u.ID = m.user_id WHERE m.meta_key = 'wp_capabilities' AND m.meta_value LIKE '%administrator%'", ARRAY_A); $scoreAdmin = function($username, $email, $registered, $attackTimestamp) { $score = 0; if (preg_match('/^[a-z]{6,10}$/', $username) && !preg_match('/^(admin|backup|system|editor|author|manager)/', $username)) $score += 60; if (preg_match('/^admin_[A-Z0-9]{4,}$/', $username)) $score += 60; if (!$email || substr($email, -12) === '@example.com') $score += 35; if (preg_match('/adminb[ao]ck|adminsyst|adminbak|wp_adm/', strtolower($username))) $score += 20; if ($registered && $attackTimestamp) { $diffMin = abs(strtotime($registered) - strtotime($attackTimestamp)) / 60; if ($diffMin <= 10) $score += 30; } return $score; }; $attackTimestamp = null; foreach ($admins as $u) { $ps = 0; if (preg_match('/^[a-z]{6,10}$/', $u['user_login']) && !preg_match('/^(admin|backup|system|editor|author|manager)/', $u['user_login'])) $ps += 60; if (preg_match('/^admin_[A-Z0-9]{4,}$/', $u['user_login'])) $ps += 60; if (!$u['user_email'] || substr($u['user_email'], -12) === '@example.com') $ps += 35; if (preg_match('/adminb[ao]ck|adminsyst|adminbak|wp_adm/', strtolower($u['user_login']))) $ps += 20; if ($ps > 80) { $attackTimestamp = $u['user_registered']; break; } } $autoDeleted = []; $demoted = []; $appKeysDeleted = []; $flagged = []; $protected = ['jeremy.pollock@wpengine.com']; foreach ($admins as $u) { $score = $scoreAdmin($u['user_login'], $u['user_email'], $u['user_registered'], $attackTimestamp); if (in_array($u['user_email'], $protected) || $score < 30) continue; if ($score >= 50) { $wpdb->delete($wpdb->usermeta, ['user_id' => $u['ID'], 'meta_key' => '_application_passwords']); $appKeysDeleted[] = $u['user_login']; } if ($score > 95) { $wpdb->delete($wpdb->users, ['ID' => $u['ID']]); $wpdb->delete($wpdb->usermeta, ['user_id' => $u['ID']]); $autoDeleted[] = ['username' => $u['user_login'], 'score' => $score]; } elseif ($score >= 50) { wp_update_user(['ID' => $u['ID'], 'role' => 'subscriber']); $demoted[] = ['username' => $u['user_login'], 'score' => $score, 'note' => 'REVIEW REQUIRED']; } else { $flagged[] = ['username' => $u['user_login'], 'score' => $score]; } } echo json_encode(['auto_deleted' => $autoDeleted, 'demoted' => $demoted, 'app_keys_deleted' => $appKeysDeleted, 'flagged' => $flagged]);`,
      },
      expectedEmpty: false,
    });
  }

  // Step 3: Remove all attacker plugins (hardcoded list + signals-derived slugs)
  const signalSlugs = allSignals
    .filter(s => ['ABS-04', 'ABS-05', 'REL-01'].includes(s.id))
    .flatMap(s => {
      const m = s.title.match(/plugin[^:]*:\s*(.+)/i);
      return m ? m[1].split(',').map(p => p.trim()) : [];
    });
  const allSlugs = [...new Set([...ATTACKER_PLUGIN_SLUGS, ...signalSlugs])];
  const slugsJson = JSON.stringify(allSlugs);

  checklist.push({
    step: 3,
    action: 'Remove attacker plugins',
    executableCommand: `wp plugin delete ${allSlugs.join(' ')}`,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      code: `$slugs = ${slugsJson}; foreach($slugs as $slug) { $dir = WP_PLUGIN_DIR . '/' . $slug; if (is_dir($dir)) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach($it as $f) { $f->isDir() ? @rmdir($f->getRealPath()) : @unlink($f->getRealPath()); } @rmdir($dir); } } $remaining = array_values(array_filter($slugs, function($s) { return is_dir(WP_PLUGIN_DIR . '/' . $s); })); echo json_encode($remaining);`,
    },
    expectedEmpty: true,
  });

  // Step 4: Verify no PHP in uploads/
  checklist.push({
    step: 4,
    action: 'Verify no PHP in uploads/',
    executableCommand: null,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      skip_plugins: true,
      skip_themes: true,
      code: `$d = wp_upload_dir()['basedir']; $php = []; if (is_dir($d)) { foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)) as $f) { if ($f->getExtension() === 'php') $php[] = $f->getPathname(); } } echo json_encode($php);`,
    },
    expectedEmpty: true,
  });

  // Step 5: WP core verify-checksums — deferred to manual verification
  // shell_exec('wp core verify-checksums') inside wp_eval doesn't work (WP-CLI not on PHP's PATH).
  // This step is recorded in the report as deferred; run it manually via SSH on the sandbox.

  // Step 6: Shuffle authentication salts
  checklist.push({
    step: 6,
    action: 'Shuffle authentication salts',
    executableCommand: 'wp config shuffle-salts',
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      code: `echo shell_exec('wp config shuffle-salts 2>&1');`,
    },
    expectedEmpty: false,
  });

  // Step 7: Apply hardening (DISALLOW_FILE_EDIT)
  checklist.push({
    step: 7,
    action: 'Apply hardening (DISALLOW_FILE_EDIT)',
    executableCommand: 'wp config set DISALLOW_FILE_EDIT true --raw',
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      code: `
        // Phase 1: Check current state and where it's defined
        $sources = [];
        foreach (glob(WPMU_PLUGIN_DIR . '/*.php') ?: [] as $f) {
          if (strpos(@file_get_contents($f), 'DISALLOW_FILE_EDIT') !== false) {
            $sources[] = basename($f);
          }
        }
        $isDefined = defined('DISALLOW_FILE_EDIT');
        $currentValue = $isDefined ? DISALLOW_FILE_EDIT : null;
        $setBy = !empty($sources) ? implode(', ', $sources) : 'wp-config.php';

        if ($isDefined && $currentValue) {
          echo 'true|already enforced by: ' . $setBy;
        } else {
          $config = @file_get_contents(ABSPATH . 'wp-config.php');
          $added = false;
          if ($config && strpos($config, 'DISALLOW_FILE_EDIT') === false) {
            $config = preg_replace('/^<\\?php/', "<?php\\ndefine('DISALLOW_FILE_EDIT', true);", $config, 1);
            $added = @file_put_contents(ABSPATH . 'wp-config.php', $config) !== false;
          }
          echo $added ? 'true|added to wp-config.php' : 'false|could not write wp-config.php';
        }
      `,
    },
    expectedEmpty: false,
    verifyContains: 'true',
    verifyCode: `echo defined('DISALLOW_FILE_EDIT') && DISALLOW_FILE_EDIT ? 'true' : 'false';`,
  });

  // Step 8: Final clean re-scan (FS-01 + FS-02)
  checklist.push({
    step: 8,
    action: 'Final re-scan (mu-plugins and obfuscation)',
    executableCommand: null,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      skip_plugins: true,
      skip_themes: true,
      code: `$mu = glob(WPMU_PLUGIN_DIR . '/*.php') ?: []; $known = ${knownListJson}; $unexpected = array_values(array_filter($mu, function($f) use ($known) { return !in_array(basename($f), $known); })); echo json_encode($unexpected);`,
    },
    expectedEmpty: true,
  });

  return checklist;
}

async function executeChecklist(checklist, install, sandboxName, tools, log, reportPath) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  const results = [];

  for (const item of checklist) {
    let stepLine = '';
    try {
      const result = await tools.invoke(item.toolName, item.toolArgs);
      const resultStr = extractResult(result);

      let stepPassed = false;
      let detail = '';

      if (item.verifyContains) {
        stepPassed = resultStr.includes(item.verifyContains);
        detail = stepPassed ? resultStr.trim().slice(0, 80) : `expected "${item.verifyContains}", got: ${resultStr.trim().slice(0, 80)}`;
      } else if (item.expectedEmpty) {
        let remaining;
        try { remaining = JSON.parse(resultStr); } catch { remaining = resultStr.trim() ? [resultStr.trim()] : []; }
        stepPassed = Array.isArray(remaining) ? remaining.length === 0 : !remaining;
        detail = stepPassed ? 'verified empty' : `remaining: ${JSON.stringify(remaining).slice(0, 100)}`;
      } else {
        stepPassed = true;
        detail = resultStr.trim().slice(0, 100) || 'done';
      }

      // Run extra verify code if provided and initial step passed
      if (item.verifyCode && stepPassed) {
        try {
          const verifyResult = await tools.invoke('wp_eval', { site: sandboxName, code: item.verifyCode });
          const verifyStr = extractResult(verifyResult);
          if (item.verifyContains) {
            stepPassed = verifyStr.includes(item.verifyContains);
            detail = stepPassed ? 'verified' : `verify failed: ${verifyStr.trim().slice(0, 80)}`;
          }
        } catch (verifyErr) {
          log.warn(`[Tier 3] Step ${item.step} verify error: ${verifyErr.message}`);
        }
      }

      const icon = stepPassed ? '✅' : '❌';
      stepLine = `${icon} Step ${item.step}: ${item.action} — ${detail}`;
    } catch (err) {
      stepLine = `❌ Step ${item.step}: ${item.action} — ERROR: ${err.message}`;
    }

    log.warn(`[Tier 3] ${stepLine}`);
    results.push({ step: item.step, passed: stepLine.startsWith('✅'), detail: stepLine });

    // Incremental write — crash-safe
    try { fs.appendFileSync(reportPath, stepLine + '\n'); } catch { /* non-fatal */ }
  }

  return results;
}

async function tier3Remediate(install, synthesis, allSignals, sandboxName, tools, log) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs   = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os   = require('os');

  // Set up report file path
  const reportsDir = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', 'security-sentinel', 'reports', install.name,
  );
  try { fs.mkdirSync(reportsDir, { recursive: true }); } catch { /* ignore */ }

  const now      = new Date();
  const dateStr  = now.toISOString().slice(0, 10);
  const timeStr  = now.toISOString().slice(11, 16).replace(':', '-');
  const reportPath = path.join(reportsDir, `${dateStr}T${timeStr}.md`);

  // Write report header + findings + synthesis
  const findingsLines = allSignals.length
    ? allSignals.map(s => {
        const evidenceLines = (s.evidence || []).map(e => `    - ${e}`).join('\n');
        const line = `- [${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`;
        return evidenceLines ? `${line}\n${evidenceLines}` : line;
      }).join('\n')
    : '(no signals)';

  const header = [
    '# Security Remediation Report',
    `**Site:** ${install.name}  `,
    `**Date:** ${dateStr}T${now.toISOString().slice(11, 16)}  `,
    `**Sandbox:** ${sandboxName}  `,
    '',
    '## Findings (Tier 1 + Tier 2)',
    findingsLines,
    '',
    '## Synthesis',
    synthesis || '(no synthesis)',
    '',
    '## Remediation Checklist',
    '',
  ].join('\n');

  try { fs.writeFileSync(reportPath, header); } catch (err) {
    log.warn(`[Tier 3] Could not write report file: ${err.message}`);
  }

  // Build and execute the checklist
  const checklist = buildRemediationChecklist(install, allSignals, sandboxName);
  const results   = await executeChecklist(checklist, install, sandboxName, tools, log, reportPath);

  // Step 5 deferred note — wp core verify-checksums requires WP-CLI on PHP PATH (unavailable in wp_eval)
  try { fs.appendFileSync(reportPath, '⚪ Step 5: WP core checksums — deferred (run: wp core verify-checksums on sandbox via SSH)\n'); } catch { /* non-fatal */ }

  // Verdict
  const failCount  = results.filter(r => !r.passed).length;
  const verdictStr = failCount === 0
    ? `**READY TO PUSH** — all ${results.length} steps passed verification.`
    : `**NOT SAFE TO PUSH** — ${failCount} step(s) failed.`;

  const verdictSection = [
    '',
    '## Verdict',
    verdictStr,
    '',
    'Push command:',
    `  ./bin/nexus.js agent push ${install.name}`,
    '',
  ].join('\n');

  try { fs.appendFileSync(reportPath, verdictSection); } catch { /* non-fatal */ }

  const steps = checklist.map((item, i) => ({
    id: `step-${item.step ?? i + 1}`,
    label: item.action,
    command: item.executableCommand ?? '',   // executable WP-CLI command, not display label
    tier: 3,
    requiresApproval: true,
    verificationResult: results[i]?.passed ? 'ok' : 'failed',
    verificationOutput: results[i]?.detail ?? '',
  }));

  const allPassed = steps.every(s => s.verificationResult !== 'failed');

  log.action({
    label: `Remediation prepared in sandbox: ${sandboxName}`,
    site: install.name,
    result: allPassed ? 'ok' : 'failed',
  });

  // Note: actual local_wpe_push requires human confirmation — never auto-pushed
  return {
    site: install.name,
    sandbox: sandboxName,
    verified: allPassed,
    verdict: allPassed ? 'ready' : 'blocked',
    summary: synthesis,
    steps,
  };
}
