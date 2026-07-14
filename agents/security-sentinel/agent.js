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
  _test: { parseSqlResult, getScanScope },
};

// Stubs — replaced in each task below
function runAbsoluteChecks(install) { return []; }
function runExposureChecks(install) { return []; }
async function llmUserAudit(adminUsers, ai) { return { signals: [] }; }
function loadBaseline(installId, state) { return null; }
function runRelativeChecks(install, baseline) { return []; }
function storeBaseline(install, state) {}
async function tier2Investigate(install, signals, tools, ai, log) {}
