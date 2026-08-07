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

// ─── PHP safe data injector ───────────────────────────────────────────────────
// Raw JSON.stringify interpolated into double-quoted PHP strings re-exposes the
// ${varname} interpolation vector — an attacker who can write files with names
// like `$_GET['cmd']` gets code execution inside the wp_eval sandbox.
// phpJson() emits `json_decode(base64_decode('...'), true)` which is safe because
// base64 contains no PHP-interpolatable characters ($, {, `). Transport to WP-CLI
// is identical to a raw JSON.stringify; the only thing that changes is the PHP
// parser's interpretation of the payload. Use this for all values sourced from the
// scanned site (file paths, option names, plugin slugs). Do NOT use for constants
// defined in this file — JSON.stringify is fine for those.
function phpJson(value) {
  return `json_decode(base64_decode('${Buffer.from(JSON.stringify(value)).toString('base64')}'), true)`;
}

// ─── Signal schema ───────────────────────────────────────────────────────────
// severity: 'critical' | 'high' | 'medium' | 'low'
// category: 'active-compromise' | 'pre-breach' | 'misconfiguration'

// ─── Fleet data collection ────────────────────────────────────────────────────

async function collectFleetData(tools, scopeInstallId, scopeInstallName, log) {
  // Warn (don't silently drop) when a fleet_sql row can't be parsed — a "|" in an
  // attacker-controlled value would otherwise make a malicious row vanish unseen.
  const warnDrop = (context) => (line, want, got) => {
    if (log && typeof log.warn === 'function') {
      log.warn(`[fleet_sql] dropped unparseable ${context} row (expected ${want} cols, got ${got}): ${String(line).slice(0, 120)}`);
    }
  };
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
             s.wp_version, s.php_version, s.admin_email, s.account_id, s.domain
      FROM sites s
      WHERE (s.source = 'wpe' OR s.source = 'local')
        AND s.name NOT LIKE 'sentinel-%'
      ${siteFilter}
      ORDER BY s.name
    `,
  });

  const rows = parseSqlResult(sitesResult, warnDrop('sites'));
  const installs = [];

  // protectedEmails sourced from graph.db admin_email (synced by WPE sync, not read live from
  // the compromised site). Per-account portal owner lookup (wpe_get_account_users) was deferred
  // because those MCP tools return markdown text, not JSON — s.account_id is now in the SELECT
  // for when a proper structured lookup is available.

  // Deep refresh is capped and reported, not attempted for the whole fleet.
  //
  // Every WPE install here has a null ssh_last_sync_at, and the old loop retried every one of
  // them, one SSH round trip at a time, on every sweep. That is self-perpetuating: the serial
  // sweep never reaches the end, so ssh_last_sync_at is never written, so the next sweep starts
  // over with the same full list. It never converges and never gets cheaper.
  //
  // Freshness is WpeRefreshScheduler's job — it owns the staleness threshold and runs on its own
  // interval. The sentinel's job is to say what it looked at. So: refresh a bounded number per
  // sweep, and report the rest as stale rather than silently reading old rows.
  const needsRefresh = rows.filter(s => !s.ssh_last_sync_at && s.source !== 'local');
  const toRefresh = needsRefresh.slice(0, MAX_REFRESH_PER_SWEEP);
  const refreshDeferred = needsRefresh.length - toRefresh.length;

  if (needsRefresh.length > 0 && log?.info) {
    log.info(
      `[fleet] ${needsRefresh.length} install(s) have never completed an SSH sync; ` +
      `refreshing ${toRefresh.length} this sweep (concurrency ${FLEET_CONCURRENCY})` +
      (refreshDeferred > 0 ? `, ${refreshDeferred} deferred to WpeRefreshScheduler` : ''),
    );
  }

  const refreshOutcomes = await mapWithConcurrency(toRefresh, FLEET_CONCURRENCY, (site) =>
    tools.invoke('wpe_site_deep_refresh', { install_name: site.name }),
  );
  const refreshFailed = refreshOutcomes.filter(r => r.error).length;
  if (refreshFailed > 0 && log?.warn) {
    // Previously an empty catch. If every refresh is failing, that is the reason the fleet never
    // becomes fresh, and it needs to be visible rather than absorbed once per site per sweep.
    const sample = refreshOutcomes.find(r => r.error)?.error?.message ?? 'unknown';
    log.warn(`[fleet] ${refreshFailed}/${toRefresh.length} deep refresh(es) failed — e.g. ${String(sample).slice(0, 160)}`);
  }

  const collected = await mapWithConcurrency(rows, FLEET_CONCURRENCY, async (site) => {
    const pluginsResult = await tools.invoke('fleet_sql', {
      query: `SELECT slug, name, version, is_active FROM plugins WHERE site_id = ?`,
      params: [site.id],
    });
    const usersResult = await tools.invoke('fleet_sql', {
      query: `SELECT username, email, roles, created_at FROM users WHERE site_id = ?`,
      params: [site.id],
    });

    return {
      id:            site.id,
      name:          site.name,
      source:        site.source,      // 'wpe' or 'local'
      domain:        site.domain,      // real primary domain — see siteUrlFor()
      environment:   site.environment,
      sshLastSyncAt: site.ssh_last_sync_at,
      postCount:     Number(site.post_count) || 0,
      userCount:     Number(site.user_count) || 0,
      settings:      site.settings_json ? JSON.parse(site.settings_json) : {},
      wpVersion:     site.wp_version,
      phpVersion:    site.php_version,
      protectedEmails: site.admin_email ? [site.admin_email.toLowerCase()] : [],
      plugins:       parseSqlResult(pluginsResult, warnDrop(`plugins@${site.name}`)),
      adminUsers:    parseSqlResult(usersResult, warnDrop(`users@${site.name}`)).filter(u => {
        try { return JSON.parse(u.roles || '[]').includes('administrator'); } catch { return false; }
      }),
    };
  });

  for (let i = 0; i < collected.length; i++) {
    if (collected[i].error) {
      // A site whose metadata could not be read must not silently vanish from the sweep — that
      // is a site reported on by omission.
      log?.warn?.(`[fleet] could not collect metadata for "${rows[i].name}": ${collected[i].error.message}`);
      continue;
    }
    installs.push(collected[i].value);
  }

  return installs;
}

/**
 * Turn a coverage record into two human-readable lists: what was inspected, and what was not.
 *
 * The second list is the point. A Tier 1 pass that finds nothing is not evidence a site is
 * uncompromised — it is evidence that the specific things it looked at were unremarkable. Any
 * verdict that omits the second list is overstating its own result.
 */
function describeCoverage(coverage) {
  const LABELS = {
    metadata:   'plugin/user/config metadata (cached)',
    exposure:   'production exposure config',
    relative:   'change vs. previous baseline',
    logs:       'access-log attack signals',
    filesystem: 'filesystem contents',
  };
  const checked = [];
  const skipped = [];
  for (const [key, label] of Object.entries(LABELS)) {
    (coverage[key] ? checked : skipped).push(label);
  }
  return { checked, skipped };
}

/**
 * Resolve the URL the behavioral probes should hit.
 *
 * These probes send real HTTP requests to a live site — including one that spoofs Googlebot to
 * test for cloaking. The previous implementation built the URL as
 * `https://${install.name}.wpengine.com` unconditionally, which is wrong twice over: a *local*
 * site has no such host, and a local site whose name happens to collide with someone else's WPE
 * install would send Googlebot-spoofed traffic to a stranger's production site every scan.
 *
 * Prefer the real domain from graph.db. Fall back to the wpengine.com convention only for
 * source='wpe' installs, and return null rather than guessing for anything else — the caller
 * treats a null URL as "behavioral probes unavailable", which is honest, where probing the
 * wrong host is not.
 */
function siteUrlFor(install, log) {
  const domain = (install.domain || '').trim();
  if (domain) {
    return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  }
  if (install.source === 'wpe') {
    const url = `https://${install.name}.wpengine.com`;
    log?.warn?.(`[Tier 2] No domain recorded for "${install.name}"; falling back to ${url}`);
    return url;
  }
  log?.warn?.(`[Tier 2] No domain for local site "${install.name}" — skipping behavioral probes`);
  return null;
}

// Parses the markdown table output from fleet_sql into an array of objects
function parseSqlResult(result, onDrop) {
  if (!result || typeof result !== 'string') return [];
  const lines = result.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| ---'));
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean);
  const out = [];
  for (const line of lines.slice(1)) {
    const parts = line.split('|');
    const vals = parts.slice(1, parts.length - 1).map(v => v.trim());
    // Column-count mismatch means a pipe char in a value shifted the columns.
    // Propagating that garbage is unsafe, but SILENTLY dropping it is dangerous in
    // a security scanner: a malicious plugin whose name contains "|" would vanish
    // from the scan and never fire a signal. So we drop the row (correctness) but
    // surface it via onDrop (visibility) — a human sees "N rows unparsed", not nothing.
    if (vals.length !== headers.length) {
      if (typeof onDrop === 'function') onDrop(line, headers.length, vals.length);
      continue;
    }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || null; });
    out.push(obj);
  }
  return out;
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

// ─── Contributed tools ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _os = require('os');

const REPORTS_BASE = _path.join(
  _os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
  'agents', 'security-sentinel', 'reports',
);

// ─── Host and addon file allowlists (FS-01, FS-03) ──────────────────────────
//
// These name files that the *host* and *this addon itself* install. A file here is expected;
// anything else in the same location is reported.
//
// Both lists were wrong, and wrong in the worst direction: they omitted files we install
// ourselves, so FS-01 raised a **critical** "PHP file in mu-plugins" on 15 of 15 local sites for
// `nexus-hub-bridge.php`, and FS-03 raised "unknown PHP in web root" on all 15 for Local's
// `local-xdebuginfo.php`. A security tool whose loudest signal fires on its own installer,
// every run, on every site, trains its reader to ignore it — the false positive is not a
// cosmetic bug, it is the failure mode.
//
// They are module-level constants rather than literals buried in two PHP heredocs so that the
// tests below can assert against them and so the two cannot drift apart independently.
//
// KNOWN WEAKNESS — this is name trust. Nothing verifies that the file named
// `nexus-hub-bridge.php` is ours; an attacker who knows the list can adopt a name on it. The
// real fix is checksum verification against a manifest of what the addon and host actually
// wrote, which the pre-execution byte scan is designed to provide. Until then, prefer adding a
// name here over shipping a known false critical, and treat the list as a triage aid rather
// than an integrity check.

const KNOWN_MU_PLUGINS = [
  // WP Engine platform
  'wpe-wp-sign-on-plugin.php', 'wpe-cache-plugin.php', 'wpengine-security-auditor.php',
  'mu-plugin.php', 'slt-force-strong-passwords.php', 'wpe-update-source-selector.php',
  // Local by WP Engine
  'site-compat-layer.php',
  // This addon. Verified present on 15/15 local sites; nexus-hub-bridge.php was the omission
  // that produced the false critical.
  'nexus-ai-connector-config.php', 'nexus-hub-bridge.php',
];

// KNOWN_ROOT_PHP and phpStringArray lived here to build PHP array literals for FS-01 and
// FS-03. Both checks now read bytes in Node (src/main/sentinel/scanner), so the docroot
// allowlist lives there and nothing here generates PHP from it. KNOWN_MU_PLUGINS stays —
// Tier 3 remediation still uses it, and a test asserts it agrees with the scanner's copy.


// ─── Fleet sweep cost controls ──────────────────────────────────────────────
//
// The cron trigger is `*/15 * * * *` and fires with no event, so getScanScope() returns nulls,
// collectFleetData() applies no site filter, and every sweep covers the whole fleet — 375 sites
// on this machine. That was previously two nested serial loops with no cap and no guard:
//
//   1. collectFleetData ran wpe_site_deep_refresh, one SSH round trip at a time, for every
//      install with a null ssh_last_sync_at. All 343 WPE installs here have one.
//   2. The main loop ran Tier 1 per site, then Tier 2 inline for anything that escalated.
//      A measured Tier 2 took ~5 minutes for a single site: 14 s to start the source, 106 s to
//      clone, 20 s to poll, then 120 s of specialist LLM calls.
//
// A sweep therefore takes far longer than the 15 minutes between fires, and AgentScheduler has
// no overlap guard — nodeCron calls runner.run() unconditionally. Overlapping sweeps each build
// their own sandboxes, which is how thirteen accumulated to 6.5 GB.

// Local's GraphQL server is single-threaded, and the house rule for resolvers that do real work
// (WP-CLI, SSH, file ops) is a p-queue capped at 3. Same ceiling here: the goal is to stop the
// serial crawl, not to stampede the event loop.
const FLEET_CONCURRENCY = 3;

// Tier 2 builds a sandbox — a full site clone plus five LLM specialist calls. It is deliberately
// NOT parallelised and is capped per sweep. Anything over the cap is reported as deferred, never
// silently dropped.
const MAX_TIER2_PER_SWEEP = 3;

// SSH deep refreshes per sweep. WpeRefreshScheduler owns fleet freshness on its own interval;
// the sentinel does a bounded top-up so a security sweep cannot turn into a fleet-wide SSH job.
const MAX_REFRESH_PER_SWEEP = 10;

/**
 * Which sites a scheduled sweep is allowed to touch.
 *
 * Scanning is opt-in per site. The cron trigger carries no event, so nothing in the trigger
 * narrows the scope — without this the fleet-wide default is whatever happens to be in
 * graph.db, which here is 375 sites nobody chose.
 *
 * Reads `settings.scope.siteIds` — the same field the site scope picker's Settings tab and Run
 * Now modal use (AgentStore.ts's `AgentScope`). There is no "scan everything" mode: that concept
 * (formerly `scanScope: {mode:'all'}`) was retired when "Every site" was removed from the picker
 * UI as a live rule that contradicted the explicit-list model — selecting all 384 sites in the
 * picker now IS the explicit list, just a long one.
 *
 * Absent or empty settings resolve to an empty list, which scans **nothing** and says so. That
 * asymmetry is the whole point: defaulting to "everything" would be the same permissive-default
 * bug that made this agent sweep the fleet unattended for weeks, just spelled differently. An
 * empty list is a configuration the user has not finished, and the safe reading of "I don't know
 * which sites you meant" is none of them.
 *
 * An explicitly-triggered run (wpe:sync.completed for one install, or Run Now) is not
 * constrained by this — the user named the target.
 *
 * Reads the legacy `settings.scanScope` shape (pre-migration on-disk settings from earlier
 * builds this session) only when `settings.scope` is entirely absent, so an unmigrated install
 * doesn't silently revert to "scan nothing" the first time it loads post-upgrade. `mode: 'all'`
 * in that legacy shape has no equivalent here and is treated as "no explicit list" (empty).
 */
function resolveScanScope(settings, log) {
  const scope = settings && typeof settings === 'object' ? settings.scope : undefined;
  if (scope && Array.isArray(scope.siteIds)) {
    const siteIds = scope.siteIds.filter(id => typeof id === 'string' && id.length > 0);
    return { siteIds: new Set(siteIds) };
  }

  const legacy = settings && typeof settings === 'object' ? settings.scanScope : undefined;
  if (legacy) {
    if (legacy.mode === 'all') {
      log?.warn?.('security-sentinel: legacy scanScope.mode "all" has no equivalent under the current scope model — treating as no sites selected. Re-select sites in Settings.');
      return { siteIds: new Set() };
    }
    const siteIds = Array.isArray(legacy.siteIds)
      ? legacy.siteIds.filter(id => typeof id === 'string' && id.length > 0)
      : [];
    return { siteIds: new Set(siteIds) };
  }

  return { siteIds: new Set() };
}

/** Map with bounded concurrency, preserving input order. Rejections surface as {error}. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// One sweep at a time, per process. The scheduler has no overlap guard, so this is the only
// thing standing between a slow fleet sweep and N concurrent copies of itself.
let sweepInFlight = false;

const contributedTools = {
  /** Trigger a targeted security scan for a specific site on demand. */
  scan: {
    description: 'Run the Security Sentinel on a specific site — detects malware, backdoor plugins, obfuscated code, tampered core files, spam injection, ELF binaries, and C2 indicators. Use this (not scan_database_health) when security investigation is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name or install ID to scan (e.g. "theawfulpm-test" or a WPE install name)' },
      },
      required: ['site'],
    },
    executionMode: 'function',
    handler: async ({ site }, ctx) => {
      const scopedEvent = {
        namespace: 'wpe', type: 'sync.completed', key: 'wpe:sync.completed',
        siteId: site, payload: { installName: site }, createdAt: Date.now(),
      };
      try {
        await module.exports.run({ event: scopedEvent, tools: ctx.tools, ai: ctx.ai, log: ctx.log, state: ctx.state, autonomy: ctx.autonomy });
        return { content: [{ type: 'text', text: `Scan complete for ${site}. Check the Agents tab or use the get-report tool to see findings.` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Scan failed: ${err.message}` }], isError: true };
      }
    },
  },

  /** Return the content of the latest forensic report for a site. */
  'get-report': {
    description: 'Return the latest Sentinel forensic report for a site as markdown text.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name (e.g. "theawfulpm-test")' },
      },
      required: ['site'],
    },
    executionMode: 'function',
    handler: async ({ site }) => {
      const dir = _path.join(REPORTS_BASE, site);
      if (!_fs.existsSync(dir)) {
        return { content: [{ type: 'text', text: `No reports found for site "${site}". Run a scan first.` }] };
      }
      const files = _fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
      if (files.length === 0) {
        return { content: [{ type: 'text', text: `No reports found for site "${site}". Run a scan first.` }] };
      }
      const latest = files.at(-1);
      const content = _fs.readFileSync(_path.join(dir, latest), 'utf8');
      return { content: [{ type: 'text', text: content }] };
    },
  },

  /** List all available sentinel reports across all sites. */
  'list-reports': {
    description: 'List all available Sentinel reports grouped by site, newest first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    executionMode: 'function',
    handler: async () => {
      if (!_fs.existsSync(REPORTS_BASE)) {
        return { content: [{ type: 'text', text: 'No reports directory found. Run a scan first.' }] };
      }
      const sites = _fs.readdirSync(REPORTS_BASE).filter(f =>
        _fs.statSync(_path.join(REPORTS_BASE, f)).isDirectory()
      );
      if (sites.length === 0) {
        return { content: [{ type: 'text', text: 'No reports found. Run a scan first.' }] };
      }
      const lines = sites.flatMap(site => {
        const dir = _path.join(REPORTS_BASE, site);
        const files = _fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse();
        return files.slice(0, 3).map(f => `- **${site}** → ${f}`);
      });
      return { content: [{ type: 'text', text: `## Sentinel Reports\n\n${lines.join('\n')}` }] };
    },
  },
};

module.exports = {
  name: 'security-sentinel',
  version: '1.0.0',
  timeoutMs: 20 * 60 * 1000, // 20 minutes — Tier 2 pull + filesystem scan can take 10+ minutes
  description: 'Fleet-wide security surveillance — detects compromise and pre-breach exposure across all WPE installs',
  // Renders the "Always do full run" toggle in Local's Run Now dialog (AgentRunModal.tsx,
  // gated on this.props.supportsFullRun). Declaring it here is what makes the toggle appear —
  // ctx.fullRun forcing Tier 2 past a Tier-1-clean verdict is dead code to a user who can never
  // set it.
  supportsFullRun: true,
  // Investigates and surfaces findings; never writes to the production site it scans (the
  // sandbox clone/pull/push tools above operate on a throwaway `sentinel-*` copy, not the site
  // itself). Drives the site-picker's production-warning verb: "will be scanned", not "modified".
  effect: 'readonly',
  // NO CRON. Removing this earlier from nexus.agent.yaml's `triggers:` list did nothing —
  // AgentRegistry.loadAgent() reads triggers exclusively from THIS array (module.exports),
  // never from the YAML manifest (loadManifest() there only pulls contributes.tools). The cron
  // kept firing every 15 minutes for the rest of this session; the opt-in scope check
  // (resolveScanScope) is the only reason it swept 0 sites instead of the whole fleet. That
  // check is a safety net, not a substitute for not scheduling this at all — a corrupted or
  // reset agent-settings.json (the exact class of bug fixed earlier today, cross-branch schema
  // collision) removes the net with nothing behind it.
  // wpe:sync.completed EXCLUDED (2026-08-06 incident) — this trigger, and resolveScanScope's
  // comment justifying its exemption from the scope check ("the user named the target"), assumed
  // the event only ever meant a human manually synced one install. WpeRefreshScheduler (opt-in,
  // wpeRefreshAutoEnabled) publishes the exact same event automatically for every stale WPE
  // install in a cycle — dozens at once, on an 8h timer, zero user involvement. Same event,
  // security-sentinel can't tell the two apart, so it fired a full Tier 2/3 investigation —
  // fresh sandbox site included — per install per cycle. Live result: dozens of orphaned
  // `sentinel-*` sites (nginx/php-fpm/mysqld each) accumulated across the fleet, several installs
  // re-investigated multiple times within an hour, until the whole app had to be force-killed to
  // stop it. This is the identical class of bug as the cron runaway below, just a second,
  // unguarded event source the cron fix never covered. If this needs to come back, it must carry
  // a way to distinguish "user synced one site" from "scheduler swept the fleet" — e.g. a
  // `source` field on the published event — and route the scheduler's case through
  // resolveScanScope like every other unattended trigger.
  triggers: [
    // wp:plugin.activated and wp:user.created work for local sites
    { type: 'event', pattern: 'wp:plugin.activated' },
    { type: 'event', pattern: 'wp:user.created' },
    // local:site.started EXCLUDED — triggers on sandbox creation → infinite loop
  ],
  tools: [
    'fleet_sql', 'wpe_site_deep_refresh', 'wp_user_list',
    // local_restart_site was dropped when the php.ini hardening was removed — it had no other
    // caller, and an unused capability grant is one an agent can still be induced to misuse.
    'local_create_site', 'local_clone_site', 'local_start_site', 'local_stop_site',
    'local_wpe_pull', 'local_wpe_push',
    'local_operation_status', 'compare_sites', 'wp_plugin_list', 'wp_eval',
    'get_log_aggregates', 'fetch_log_window',
    'local_wpe_link',
    // Byte-level filesystem read. Tier 1, needs no running site — see runByteScan below.
    'scan_site_files',
  ],
  contributes: { tools: contributedTools },

  async run({ event, tools, ai, log, state, autonomy, settings, fullRun }) {
    const scope = getScanScope(event);
    const scopeLabel = scope.installId || scope.installName || 'fleet-wide';

    // fullRun forces Tier 2 on the scoped site regardless of what Tier 1 found — the lever for
    // "I don't trust the quick pass, investigate properly." The AgentRunner/AGENT_RUN_NOW
    // plumbing for this already existed; the sentinel itself never read it, so the "Full Run"
    // toggle in Local's Run Now dialog was silently a no-op for this agent. Gated on an actual
    // scope, never for a fleet-wide sweep — forcing a ~5 minute sandbox investigation on every
    // clean site in the fleet on every cron tick would be the disk-filling problem
    // MAX_TIER2_PER_SWEEP exists to prevent, self-inflicted.
    const forceEscalate = !!fullRun && (!!scope.installId || !!scope.installName);

    // The cron fires every 15 minutes; a fleet sweep takes considerably longer than that, and
    // AgentScheduler starts a run without checking whether the last one finished. Refuse rather
    // than pile up — overlapping sweeps duplicate every SSH round trip and every sandbox.
    if (sweepInFlight) {
      log.warn(
        `security-sentinel: a sweep is already running — skipping this ${scopeLabel} trigger. ` +
        `The scheduler has no overlap guard, so this is expected when a sweep outlives its interval.`,
      );
      return { verdict: 'skipped', findings: [], sites: {}, summary: 'Skipped: a sweep was already in progress.' };
    }
    sweepInFlight = true;

    try {
    log.info(`security-sentinel: starting sweep for ${scopeLabel}`);

    log.info('security-sentinel: calling collectFleetData...');
    let installs;
    try {
      installs = await collectFleetData(tools, scope.installId, scope.installName, log);
    } catch (err) {
      log.error(`security-sentinel: collectFleetData threw: ${err.message}\n${err.stack}`);
      return { verdict: 'error', findings: [], sites: {} };
    }
    // Opt-in scoping. Only applies to a sweep nothing else narrowed — an event naming one
    // install, or a Run Now against a target, is the user pointing at a site directly.
    const isUnscopedSweep = !scope.installId && !scope.installName;
    if (isUnscopedSweep) {
      const scanScope = resolveScanScope(settings, log);
      const before = installs.length;
      installs = installs.filter(i => scanScope.siteIds.has(i.id) || scanScope.siteIds.has(i.name));
      if (scanScope.siteIds.size === 0) {
        log.warn(
          `security-sentinel: no sites are in this agent's scope, so this sweep checked NOTHING. ` +
          `Choose sites in the agent's settings. (${before} site(s) are known but unselected.)`,
        );
        return {
          verdict: 'skipped', findings: [], sites: {},
          summary: `No sites in scope for scheduled scanning — ${before} known, 0 scanned. Nothing was checked.`,
        };
      }
      const missing = [...scanScope.siteIds].filter(
        id => !installs.some(i => i.id === id || i.name === id),
      );
      log.info(
        `security-sentinel: scope — ${installs.length} of ${before} known site(s) in scope` +
        (missing.length ? ` (${missing.length} selected site(s) not found in graph.db: ${missing.slice(0, 5).join(', ')})` : ''),
      );
      if (missing.length) {
        // A selected site that no longer resolves is a silent coverage hole — the user believes
        // it is being scanned.
        log.warn(`security-sentinel: ${missing.length} scoped site(s) could not be resolved and were NOT scanned`);
      }
    }

    log.info(`security-sentinel: ${installs.length} install(s) to check`);

    const allInstallResults = [];
    const allFindings = [];
    let latestPlan = null;
    // Tier 2 is the expensive tier and the one that leaves artifacts on disk. Count escalations
    // so the cap can defer rather than let one sweep build an unbounded number of sandboxes.
    let tier2Count = 0;
    const tier2Deferred = [];

    for (const install of installs) {
      const signals = [];

      // What did we ACTUALLY inspect? Several Tier 1 check groups return an empty array under
      // ordinary conditions — no baseline yet, not a production environment, no log data — and
      // an empty array is indistinguishable from "looked and found nothing". Reporting "clean"
      // on that basis overstates the result, which is the single most misleading thing this
      // agent can do. Track coverage explicitly and report it alongside the verdict.
      const coverage = {
        metadata: true,   // plugins, users, settings from graph.db — always available
        exposure: install.environment === 'production',
        relative: false,  // set below, once we know whether a baseline existed
        logs: false,      // set by the log-check block
        filesystem: false, // Tier 1 never reads the filesystem; only Tier 2 does
      };

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

      // Relative checks. With no stored baseline these return [] — a cold start cannot detect
      // change, so REL-01..04 contribute nothing on a site's first ever scan.
      const baseline = loadBaseline(install.id, state);
      coverage.relative = !!baseline;
      signals.push(...runRelativeChecks(install, baseline));

      // Log-backed checks (LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST)
      // For local sites linked to WPE, resolve the WPE install name for log lookup.
      let logSiteId = install.name;
      if (install.source === 'local') {
        try {
          const linkResult = await tools.invoke('local_wpe_link', { site: install.name });
          const linkText = typeof linkResult === 'string' ? linkResult : linkResult?.content?.[0]?.text ?? '';
          const match = linkText.match(/\*\*\w+:\*\*\s+(\S+)/);
          if (match?.[1]) {
            let candidate = match[1];
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate);
            if (isUuid) {
              try {
                const rows = await tools.invoke('fleet_sql', {
                  query: `SELECT name FROM sites WHERE source = 'wpe' AND (remote_install_id = ? OR wpe_site_id = ?) LIMIT 1`,
                  params: [candidate, candidate],
                });
                const text = typeof rows === 'string' ? rows : rows?.content?.[0]?.text ?? '';
                const nameLine = text.split('\n').find(l => l.startsWith('|') && !l.includes('---') && !l.includes('name'));
                const name = nameLine?.split('|')[1]?.trim();
                if (name) candidate = name;
              } catch { /* keep UUID */ }
            }
            logSiteId = candidate;
            log.info(`security-sentinel: resolved log siteId for "${install.name}": ${logSiteId}`);
          }
        } catch { /* no WPE link — use install name */ }
      }

      // Byte-level filesystem check — the first Tier 1 signal derived from the site's actual
      // contents rather than cached metadata.
      try {
        const byteResult = await runByteScan(install, tools, log);
        signals.push(...byteResult.signals);
        coverage.filesystem = byteResult.available === true;
      } catch (err) {
        log.warn(`security-sentinel: byte scan failed for ${install.name}: ${err.message} (skipping)`);
      }

      let attackSummary = null;
      let logMetrics = null;
      try {
        const logResult = await runLogChecks(logSiteId, tools, log);
        signals.push(...logResult.signals);
        attackSummary = logResult.attackSummary;
        coverage.logs = logResult.available === true;
        logMetrics = logResult.metrics ?? null;
      } catch (err) {
        log.warn(`security-sentinel: log checks failed for ${install.name}: ${err.message} (skipping)`);
      }

      allInstallResults.push({ install, signals, coverage, logMetrics });

      const criticalCount = signals.filter(s => s.severity === 'critical').length;
      // Only active-compromise signals count toward Tier 2 escalation — EXP (pre-breach) signals are informational
      const compromiseHighCount = signals.filter(s => s.severity === 'high' && s.category === 'active-compromise').length;

      // Collect findings into allFindings
      for (const sig of signals) {
        allFindings.push({ id: sig.id, severity: sig.severity, title: sig.title, site: install.name, category: sig.category });
      }

      if (signals.length === 0 && !forceEscalate) {
        // Say what was actually inspected. "clean" on its own invites the reader to conclude
        // the site is not compromised, when a Tier 1 pass has read cached plugin, user and
        // settings rows and nothing else — no files, no database contents, no core integrity.
        const { checked, skipped } = describeCoverage(coverage);
        log.info(
          `security-sentinel: ${install.name} — no signals from ${checked.join(', ')}` +
          (skipped.length ? ` — NOT checked: ${skipped.join(', ')}` : ''),
        );
        log.siteStatus(install.name, 'clean');
      } else if (forceEscalate || criticalCount >= 1 || compromiseHighCount >= 2) {
        if (forceEscalate && signals.length === 0) {
          log.info(`security-sentinel: ${install.name} — Tier 1 found nothing, but Full Run forces Tier 2 anyway`);
        }
        log.siteStatus(install.name, 'escalated');
        signals.forEach(s => log.finding({
          id: s.id, severity: s.severity, title: s.title,
          description: s.detail, site: install.name,
          category: s.category,
        }));
        if (tier2Count >= MAX_TIER2_PER_SWEEP) {
          // Deferred, and said out loud. A measured Tier 2 is ~5 minutes and leaves a full site
          // clone on disk; without a cap one fleet-wide sweep can escalate dozens of sites and
          // fill the disk. Silently skipping would be worse than the accumulation — the site
          // would read as "escalated" with no investigation and no explanation.
          tier2Deferred.push(install.name);
          log.warn(
            `security-sentinel: ${install.name} escalated but Tier 2 was DEFERRED — ` +
            `${MAX_TIER2_PER_SWEEP} deep investigations already run this sweep. ` +
            `It will be picked up on the next sweep; its Tier 1 findings stand.`,
          );
        } else {
          tier2Count++;
          log.phase('Tier 2', `Deep investigation: ${install.name} (${tier2Count}/${MAX_TIER2_PER_SWEEP})`);

          // Filesystem detection runs HERE — against the original install, stopped, before any
          // sandbox exists. Creating the sandbox executes site code (local_clone_site starts it
          // and runs four search-replace passes), so anything that can be learned from bytes
          // must be learned first, or it is learned from a copy the act of copying has changed.
          let preflightSignals = [];
          try {
            const deepScan = await runByteScan(install, tools, log, { deep: true });
            preflightSignals = deepScan.signals;
            log.info(
              `[Tier 2] Pre-flight byte scan of ${install.name}: ${preflightSignals.length} finding(s), ` +
              `nothing executed` + (deepScan.available ? '' : ' (UNAVAILABLE — filesystem not examined)'),
            );
          } catch (err) {
            log.warn(`[Tier 2] Pre-flight byte scan failed for ${install.name}: ${err.message}`);
          }

          const plan = await tier2Investigate(install, signals, tools, ai, log, state, 20000, autonomy, attackSummary, preflightSignals);
          if (plan) latestPlan = plan;
        }
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

    // Populate the SDK's per-site map. It was previously returned as {} on every run, so nothing
    // downstream could tell which sites were swept, let alone what was inspected on each.
    const sites = {};
    for (const { install, signals, coverage, logMetrics } of allInstallResults) {
      const { checked, skipped } = describeCoverage(coverage || {});
      sites[install.name] = {
        status: signals.length === 0 ? 'clean'
          : signals.some(s => s.severity === 'critical') ? 'escalated'
          : 'findings',
        findings: signals.map(s => ({
          id: s.id, severity: s.severity, title: s.title,
          site: install.name, category: s.category,
        })),
        checked,
        notChecked: skipped,
        logMetrics: logMetrics ?? null,
      };
    }

    // Fleet-level triage scoping. Access logs are the only compromise evidence available for a
    // remote WPE install without building a local sandbox, which makes attack pressure the
    // cheapest basis the fleet has for choosing where to spend the expensive checks next.
    //
    // This ranks and reports; it deliberately does NOT change escalation. Auto-escalating on log
    // pressure alone would build a sandbox per noisy site, and a brute-force wave against
    // /wp-login.php is evidence of being *targeted*, not of being *compromised* — the two are
    // routinely confused, and conflating them here would spend gigabytes chasing failed logins.
    // Whether pressure should trigger Tier 2 on its own is a policy call for the operator.
    const pressure = allInstallResults
      .filter(r => r.logMetrics)
      .map(r => ({
        name: r.install.name,
        score: r.logMetrics.authAttacks + r.logMetrics.enumerationHits + r.logMetrics.peakDayDistinctIps * 10,
        m: r.logMetrics,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (pressure.length > 0) {
      log.info('security-sentinel: attack pressure ranking (log-derived, for scoping the next sweep):');
      for (const p of pressure) {
        log.info(
          `  ${p.name}: ${p.m.authAttacks.toLocaleString()} auth, ${p.m.enumerationHits} enum, ` +
          `${p.m.peakDayDistinctIps} peak-day IPs over ${p.m.daysAvailable} day(s)` +
          (p.m.topProbePath ? ` — top probe ${p.m.topProbePath} (${p.m.topProbeHits})` : ''),
        );
      }
    }

    // A summary that states its own limits. `clean` here means "the checks that ran found
    // nothing", never "this site is not compromised" — Tier 1 does not read the filesystem.
    const swept = allInstallResults.length;
    const withLogs = allInstallResults.filter(r => r.coverage?.logs).length;
    const coldStart = allInstallResults.filter(r => r.coverage && !r.coverage.relative).length;
    const summary = [
      `Swept ${swept} site(s). Verdict: ${verdict}, ${allFindings.length} finding(s).`,
      `Access-log signals available for ${withLogs}/${swept}.`,
      coldStart > 0 ? `${coldStart} site(s) had no prior baseline, so change-detection (REL-*) could not run.` : null,
      pressure.length > 0
        ? `Highest log-derived attack pressure: ${pressure.map(p => `${p.name} (${p.m.authAttacks.toLocaleString()} auth, ${p.m.peakDayDistinctIps} peak-day IPs)`).join('; ')}. ` +
          `Pressure means targeted, not compromised — it scopes where to look, it does not escalate.`
        : null,
      // Deferred work is part of the result, not a footnote. A sweep that escalated eight sites
      // and investigated three has not covered the fleet, and must not read as though it had.
      tier2Deferred.length > 0
        ? `${tier2Deferred.length} escalated site(s) did NOT receive a Tier 2 investigation this sweep ` +
          `(cap ${MAX_TIER2_PER_SWEEP}): ${tier2Deferred.join(', ')}.`
        : null,
      `Tier 1 does not inspect the filesystem or database contents; only escalated sites reach Tier 2.`,
    ].filter(Boolean).join(' ');

    return {
      verdict, findings: allFindings, plan: latestPlan ?? undefined, sites, summary,
      attackPressure: pressure,
      tier2: { run: tier2Count, deferred: tier2Deferred, cap: MAX_TIER2_PER_SWEEP },
    };
    } finally {
      sweepInFlight = false;
    }
  },

  // Exported for unit testing only
  _test: { parseSqlResult, getScanScope, collectFleetData, runAbsoluteChecks, llmUserAudit, runExposureChecks, loadBaseline, storeBaseline, runRelativeChecks, runFleetCorrelation, runLogChecks, tier2Investigate, llmSynthesis, tier3Remediate, buildRemediationChecklist, executeChecklist, collectSpecialistData, runContentExamination, runRootFileAnalysis, runObfuscationDecoder, runCoreDiff, runElfStrings, runNetworkIndicators, fmtIntegrity, pushWpContentDeletion, runByteScan, KNOWN_MU_PLUGINS, mapWithConcurrency, resolveScanScope, FLEET_CONCURRENCY, MAX_TIER2_PER_SWEEP, MAX_REFRESH_PER_SWEEP },
};

// ─── Log-backed checks (LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST) ────────────

// Cap on raw lines carried forward. The point is a representative sample for a human and for
// the Tier 2 synthesizer's context window, not the whole window — which can be millions of
// lines and would blow both.
const LOG_EVIDENCE_LINES = 40;

/**
 * Pull raw log lines as evidence for a log-backed finding.
 *
 * Three things were wrong with the call this replaces:
 *
 *   1. It discarded the result. `await tools.invoke('fetch_log_window', ...)` assigned nothing,
 *      and the tool persists nothing by design — so the "forensic fetch" streamed the window,
 *      paid the cost, and dropped every line on the floor. The log said it "completed".
 *   2. It skipped phase 1 of the tool's two-phase contract by passing confirm:true immediately,
 *      so the cost estimate that exists precisely to stop an unbounded scan was never read.
 *   3. It fired on a second, stricter set of hardcoded numbers (>500 auth, >200 IPs) rather
 *      than on the findings. A site with a confirmed LOG-AUTH just under the line produced a
 *      finding with no supporting lines, which is the case where a human most needs them.
 *
 * Returns null when evidence could not be obtained — never throws, because failing to collect
 * corroboration must not lose the signal that prompted it.
 */
async function fetchLogEvidence(siteId, from, to, filter, tools, log) {
  const params = { siteId, from, to, ...filter };
  try {
    // Phase 1 — estimate. Advisory: an unparseable estimate proceeds, matching prior behaviour.
    const est = await tools.invoke('fetch_log_window', params);
    const estText = typeof est === 'string' ? est : est?.content?.[0]?.text ?? JSON.stringify(est ?? '');
    const gb = Number(estText.match(/([\d.]+)\s*GB/i)?.[1] ?? 0);
    if (gb > 5) {
      log.warn(`[LOG] Declining forensic fetch for ${siteId}: estimate ${gb} GB exceeds the 5 GB cap`);
      return null;
    }

    // Phase 2 — stream and filter.
    const raw = await tools.invoke('fetch_log_window', { ...params, confirm: true });
    const text = typeof raw === 'string' ? raw : raw?.content?.[0]?.text ?? '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      log.info(`[LOG] Forensic fetch for ${siteId} returned no lines`);
      return null;
    }
    const sample = lines.slice(0, LOG_EVIDENCE_LINES);
    log.info(`[LOG] Forensic fetch for ${siteId}: ${lines.length} line(s), keeping ${sample.length}`);
    return { lines: sample, totalLines: lines.length, truncated: lines.length > sample.length };
  } catch (err) {
    log.warn(`[LOG] Forensic fetch failed for ${siteId}: ${err.message}`);
    return null;
  }
}

async function runLogChecks(siteId, tools, log) {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  let rawResult;
  try {
    rawResult = await tools.invoke('get_log_aggregates', { siteId, from, to: today });
  } catch (err) {
    log.info(`[LOG] get_log_aggregates unavailable for ${siteId}: ${err.message} — skipping log checks`);
    return { signals: [], attackSummary: null, available: false };
  }

  // NexusToolProvider auto-parses JSON — rawResult may already be the parsed object
  let parsed;
  if (rawResult && typeof rawResult === 'object' && ('aggregates' in rawResult || 'siteId' in rawResult)) {
    parsed = rawResult;
  } else {
    const text = typeof rawResult === 'string' ? rawResult : rawResult?.content?.[0]?.text;
    if (!text) {
      log.info(`[LOG] get_log_aggregates returned empty response for ${siteId} — skipping log checks`);
      return { signals: [], attackSummary: null, available: false };
    }
    try { parsed = JSON.parse(text); } catch { return { signals: [], attackSummary: null }; }
  }

  const aggregates = Object.values(parsed?.aggregates ?? {});
  if (aggregates.length === 0) {
    log.info(`[LOG] No log data for ${siteId} — skipping log checks`);
    return { signals: [], attackSummary: null, available: false };
  }

  // Fold 30-day totals
  let totalLoginPosts = 0;
  let totalXmlrpcPosts = 0;
  const probePathCounts = {};
  let userRestApiHits = 0;
  let authorScanHits = 0;
  // Peak single-day distinct attacker IPs — log-processor aggregates per-day cardinality,
  // not a running unique set across all days, so we can only report the worst day.
  // Thresholds (>50, >200) are calibrated to peak-day semantics, not 30-day cumulative.
  let peakDayDistinctIps = 0;

  // Successful logins redirect (302/303) — exclude from attack counts
  const SUCCESSFUL_AUTH = new Set(['302', '303']);
  for (const agg of aggregates) {
    for (const hourData of Object.values(agg.attack?.authAttack ?? {})) {
      for (const [status, count] of Object.entries(hourData.loginPosts  ?? {})) {
        if (!SUCCESSFUL_AUTH.has(status)) totalLoginPosts  += count;
      }
      for (const [status, count] of Object.entries(hourData.xmlrpcPosts ?? {})) {
        if (!SUCCESSFUL_AUTH.has(status)) totalXmlrpcPosts += count;
      }
    }
    for (const [path, data] of Object.entries(agg.attack?.probes ?? {})) {
      probePathCounts[path] = (probePathCounts[path] ?? 0) + (data.hits ?? 0);
    }
    userRestApiHits += Object.values(agg.attack?.enumeration?.userRestApi ?? {}).reduce((s, n) => s + n, 0);
    authorScanHits  += Object.values(agg.attack?.enumeration?.authorScan  ?? {}).reduce((s, n) => s + n, 0);
    peakDayDistinctIps = Math.max(peakDayDistinctIps, agg.attack?.ipCardinality?.distinct ?? 0);
  }

  const totalAuthAttacks = totalLoginPosts + totalXmlrpcPosts;
  const topProbes = Object.entries(probePathCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const highProbes = topProbes.filter(([, hits]) => hits > 50);
  const totalEnum  = userRestApiHits + authorScanHits;

  log.info(`[LOG] ${siteId}: ${aggregates.length} days — auth=${totalAuthAttacks} probes=${topProbes.length} enum=${totalEnum} peakDayDistinctIps=${peakDayDistinctIps}`);

  const signals = [];

  // LOG-AUTH: >100 total auth POSTs in 30 days
  if (totalAuthAttacks > 100) {
    signals.push({
      id: 'LOG-AUTH', severity: 'high', category: 'active-compromise',
      title: `Active brute-force: ${totalAuthAttacks.toLocaleString()} auth probes in 30 days (${totalLoginPosts} login, ${totalXmlrpcPosts} xmlrpc)`,
    });
  }

  // LOG-PROBE: any single path >50 hits
  if (highProbes.length > 0) {
    signals.push({
      id: 'LOG-PROBE', severity: 'medium', category: 'pre-breach',
      title: `Reconnaissance probes: ${highProbes.map(([p, h]) => `${p} (${h})`).join(', ')}`,
    });
  }

  // LOG-ENUM: >20 enumeration hits
  if (totalEnum > 20) {
    signals.push({
      id: 'LOG-ENUM', severity: 'medium', category: 'pre-breach',
      title: `User enumeration: ${userRestApiHits} REST API hits, ${authorScanHits} author scans`,
    });
  }

  // LOG-DIST: >50 distinct attacker IPs
  if (peakDayDistinctIps > 50) {
    signals.push({
      id: 'LOG-DIST', severity: 'high', category: 'active-compromise',
      title: `Distributed attack campaign: ${peakDayDistinctIps} distinct attacker IPs observed`,
    });
  }

  // Raw-line evidence, attached to whichever finding prompted it. Driven by the signals rather
  // than by a second set of thresholds: if a check was confident enough to raise a finding, that
  // finding deserves its supporting lines.
  let evidence = null;
  if (signals.length > 0) {
    // Narrow the window to whatever the strongest signal is about, so the sample is on-topic.
    const has = id => signals.some(s => s.id === id);
    let filter = {};
    if (has('LOG-AUTH')) {
      filter = { pathContains: totalLoginPosts >= totalXmlrpcPosts ? '/wp-login.php' : '/xmlrpc.php' };
    } else if (has('LOG-PROBE') && highProbes.length > 0) {
      filter = { pathContains: highProbes[0][0] };
    } else if (has('LOG-ENUM')) {
      filter = { pathContains: '/wp-json/wp/v2/users' };
    }
    // LOG-DIST alone stays unfiltered — the finding is about breadth of source IPs, and
    // constraining by path would hide exactly the spread that is the evidence.

    evidence = await fetchLogEvidence(siteId, from, today, filter, tools, log);
    if (evidence) {
      for (const sig of signals) {
        sig.evidence = {
          sampleLines: evidence.lines,
          totalMatched: evidence.totalLines,
          truncated: evidence.truncated,
          window: { from, to: today },
          filter,
        };
      }
    }
  }

  // Build attack summary string for the Tier 2 synthesizer
  const summaryLines = [
    `Log corroboration (last 30 days, ${aggregates.length} of 30 days available):`,
    totalAuthAttacks > 0
      ? `- Auth attacks: ${totalLoginPosts} login POSTs, ${totalXmlrpcPosts} xmlrpc POSTs`
      : null,
    topProbes.length > 0
      ? `- Top probe paths: ${topProbes.map(([p, h]) => `${p} (${h} hits)`).join(', ')}`
      : null,
    totalEnum > 0
      ? `- Enumeration: user REST API (${userRestApiHits} hits), author scan (${authorScanHits} hits)`
      : null,
    `- Distinct attacker IPs (peak day): ${peakDayDistinctIps}`,
    evidence
      ? `- Raw sample (${evidence.lines.length} of ${evidence.totalLines} matching lines):\n` +
        evidence.lines.map(l => `    ${l}`).join('\n')
      : `- No raw log lines could be retrieved; the counts above are aggregates only.`,
  ].filter(Boolean);

  const attackSummary = signals.length > 0 ? summaryLines.join('\n') : null;

  // Folded metrics are returned, not just the signals derived from them. Access logs are the
  // only compromise evidence obtainable for a remote WPE install without building a local
  // sandbox, so they are the cheapest input the fleet has for deciding where to look next —
  // but that scoping happens at the fleet level, and the caller cannot rank what it cannot see.
  const metrics = {
    daysAvailable: aggregates.length,
    authAttacks: totalAuthAttacks,
    loginPosts: totalLoginPosts,
    xmlrpcPosts: totalXmlrpcPosts,
    enumerationHits: totalEnum,
    peakDayDistinctIps,
    topProbePath: topProbes[0]?.[0] ?? null,
    topProbeHits: topProbes[0]?.[1] ?? 0,
  };

  return { signals, attackSummary, available: true, evidence, metrics };
}

// ─── Byte-level filesystem check (Tier 1) ───────────────────────────────────

/**
 * Read the install's mu-plugins directory as bytes.
 *
 * This is the first Tier 1 check that looks at the filesystem at all. Until now Tier 1 declared
 * `filesystem: false` in its own coverage literal and meant it: a webshell was invisible unless
 * something else escalated the site to Tier 2, and Tier 2 would then *execute* it on the way to
 * finding it — `--skip-plugins` filters `active_plugins` and does nothing about mu-plugins.
 *
 * Cheap enough to run on every site in a sweep: measured at 54 ms for 33 installs, against
 * stopped sites, with no clone and no PHP.
 *
 * Local sites only for now. A WPE install has no local bytes to read until the SSH FileSource
 * lands, and claiming coverage we do not have is the failure this whole effort is about.
 */
async function runByteScan(install, tools, log, { deep = false } = {}) {
  if (install.source !== 'local') return { signals: [], available: false };

  let text;
  try {
    const result = await tools.invoke('scan_site_files', { site: install.name, deep });
    text = typeof result === 'string' ? result : result?.content?.[0]?.text ?? '';
  } catch (err) {
    log.warn(`[bytes] scan_site_files failed for ${install.name}: ${err.message}`);
    return { signals: [], available: false };
  }

  if (!text || /^NOT SCANNED/m.test(text)) {
    log.info(`[bytes] ${install.name} not scannable: ${String(text).slice(0, 160)}`);
    return { signals: [], available: false };
  }

  const signals = [];
  const section = text.match(/### Unexpected mu-plugins \((\d+)\)([\s\S]*?)(?=\n### |$)/);
  if (section) {
    const files = [...section[2].matchAll(/^- `([^`]+)` — (\d+) bytes/gm)]
      .map(m => ({ path: m[1], bytes: Number(m[2]) }));
    if (files.length > 0) {
      signals.push({
        id: 'FS-01', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `PHP file(s) in mu-plugins/: ${files.map(f => f.path.split('/').pop()).join(', ')}`,
        detail:
          `Read as bytes with the site stopped — nothing was executed. mu-plugins load on every ` +
          `request and cannot be deactivated from wp-admin: ${files.map(f => `${f.path} (${f.bytes} bytes)`).join(', ')}`,
        evidence: files.map(f => f.path),
      });
    }
  }
  if (deep) {
    // Each deep section is `### <title> (<n>)` followed by `- \`path\` — detail` lines.
    const sectionItems = (heading) => {
      const m = text.match(new RegExp(`### ${heading} \\((\\d+)\\)([\\s\\S]*?)(?=\\n### |$)`));
      if (!m) return [];
      return [...m[2].matchAll(/^- `([^`]+)`(?: — (.*))?$/gm)].map(x => ({ path: x[1], detail: x[2] ?? '' }));
    };

    const push = (id, severity, heading, title, detail) => {
      const items = sectionItems(heading);
      if (items.length === 0) return;
      signals.push({
        id, severity, category: 'active-compromise', installName: install.name,
        title: title(items),
        detail: `${detail} Read as bytes with the site stopped — nothing was executed.`,
        evidence: items.map(i => i.detail ? `${i.path} ${i.detail}` : i.path),
      });
    };

    push('FS-02', 'critical', 'Obfuscation chains \\(FS-02\\)',
      (i) => `Obfuscation chains in ${i.length} file(s)`,
      'Encoded payloads or eval of a variable inside plugin, mu-plugin or theme code.');
    push('FS-03', 'critical', 'Unexpected web-root / content PHP \\(FS-03\\)',
      (i) => `Unexpected PHP: ${i.length} file(s)`,
      'PHP in the web root that is not part of WordPress, or obfuscated code under languages/ or uploads/.');
    push('FS-04', 'critical', 'PHP under uploads \\(FS-04\\)',
      (i) => `${i.length} PHP file(s) under uploads/`,
      'The uploads directory is writable by the web server and should never contain executable PHP.');
    push('FS-06', 'critical', 'ELF binaries \\(FS-06\\)',
      (i) => `${i.length} ELF binary/binaries in wp-content`,
      'Native executables under wp-content. Note that legitimate image-optimiser plugins ship these.');
    push('ABS-09', 'critical', 'Suspicious filenames in plugins \\(ABS-09\\)',
      (i) => `Suspicious internal filenames in plugins: ${i.map(x => x.path.split('/').pop()).join(', ')}`,
      'Files with names matching known attacker tool patterns were found inside plugin directories.');
    push('ABS-08', 'critical', 'Anti-forensics timestamp manipulation \\(ABS-08\\)',
      (i) => `Anti-forensics tool detected: timestamp manipulation code in ${i.length} file(s)`,
      'PHP code combining touch() with directory enumeration was found. This is used by attackers to backdate planted files.');
    push('FS-05', 'critical', 'Directive files — \\.htaccess \\(FS-05\\) / \\.user\\.ini / php\\.ini',
      (i) => `Suspicious directive file(s) in ${i.length} location(s)`,
      '.htaccess, .user.ini or php.ini contents that re-enable PHP execution, redirect externally, or override disable_functions/open_basedir.');

    if (/^### Database — NOT EXAMINED/m.test(text)) {
      // A database section that could not be read is a distinct partial-coverage case, not the
      // all-or-nothing "not scannable" one above — the filesystem was scanned fine, only the
      // dump was not trustworthy (site running, stale, or no completion marker). Surfaced, not
      // silently absorbed into an otherwise-clean-looking signal list.
      const reasonLine = text.match(/^### Database — NOT EXAMINED\n- (.+)$/m);
      log.info(`[bytes] ${install.name} database not examined: ${reasonLine ? reasonLine[1] : 'unknown reason'}`);
    } else {
      push('DB-01', 'high', 'Suspicious post content \\(DB-01\\)',
        (i) => `Suspicious post content: ${i.length} post(s) flagged`,
        'Posts contain injected scripts or blackhat SEO spam content (casino/gambling keywords), read from the database dump.');
      push('DB-02', 'critical', 'Suspicious autoloaded options \\(DB-02\\)',
        (i) => `Suspicious code in wp_options: ${i.length} autoloaded option(s) contain eval/exec/script`,
        'Autoloaded options containing code patterns that execute on every page load, read from the database dump.');
      push('DB-03', 'high', 'Serialized objects in admin usermeta \\(DB-03\\)',
        (i) => `Serialized PHP objects in admin user meta: ${i.length} entry(ies)`,
        'Serialized objects in wp_usermeta can execute code on deserialization. Used for persistence. Read from the database dump.');
      push('DB-04', 'medium', 'Spam content in comments \\(DB-04\\)',
        (i) => `Spam content in comments: ${i.length} comment(s) flagged`,
        'Approved comments with casino/gambling keywords or long URLs — common SEO spam injection vector. Read from the database dump.');
    }
  }

  return { signals, available: true };
}

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
  // Known-good short slugs from WordPress.org — add here when ABS-07 false-positives on legitimate plugins
  const ABS07_ALLOWLIST = new Set([
    'wp-2fa',      // WP 2FA (Melapress) — two-factor authentication
    'leadin',      // HubSpot (formerly Leadin) — CRM/marketing
    'jetpack',     // Jetpack by Automattic
    'akismet',     // Akismet Anti-Spam
    'ewwwio',      // EWWW Image Optimizer
    'yoast',       // Yoast SEO (legacy slug)
    'wc-aelia',    // Aelia WooCommerce extensions
    'wp-ses',      // WP Offload SES
    'w3tc',        // W3 Total Cache
    'wprss',       // WP RSS Aggregator
    'backwpup',    // BackWPup
    'wpseo',       // Yoast SEO (alternate slug)
    'sucuri',      // Sucuri Security
    'cf7',         // Contact Form 7 (alias)
    'wpforms',     // WPForms (exceeds 6 chars, but belt-and-suspenders)
  ]);
  const lowEntropyPlugins = plugins.filter(p => {
    if (ABS07_ALLOWLIST.has(p.slug)) return false;           // known-good short slug
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

  const schema = {
    type: 'object',
    properties: {
      suspicious: { type: 'boolean', description: 'true if any accounts appear attacker-created' },
      accounts: {
        type: 'array',
        description: 'Flagged accounts with reasoning',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['username', 'reason'],
        },
      },
      summary: { type: 'string', description: 'One-sentence explanation of findings, or empty if clean' },
    },
    required: ['suspicious', 'accounts', 'summary'],
  };

  const result = await ai.generateObject({
    prompt: `Examine these WordPress administrator accounts and identify any that appear to be attacker-created.

Administrator accounts:
${userList}

Attacker-created accounts typically look like:
- Programmatically generated suffixes: admin_MT6ZqT, admin_ABC123
- Random strings: oxhuhafz, xkzpqrst
- Misspellings of system words: adminbockup (backup), adminsysem (system)
- Generic placeholders with no legitimate purpose

Set suspicious=true only if you find accounts matching these patterns. Legitimate usernames (real names, company names, clear roles) should not be flagged.`,
    schema,
    schemaName: 'UserAuditResult',
    noTools: true,
  });

  if (!result.suspicious || result.accounts.length === 0) return { signals: [] };

  const flagged = result.accounts.map(a => `${a.username}: ${a.reason}`).join('; ');
  return {
    signals: [{
      id: 'LLM-USER-01',
      severity: 'critical',
      category: 'active-compromise',
      installName: adminUsers[0]?.installName ?? 'unknown',
      title: 'LLM identified synthetic/attacker-pattern administrator usernames',
      detail: result.summary ? `${result.summary} — ${flagged}` : flagged,
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
/**
 * Render a CHK-01/CHK-02 verdict for a specialist prompt.
 *
 * The distinction that has to survive into the prompt is unavailable-vs-clean. A specialist told
 * "no failures" reasons very differently from one told "no manifest existed, so nothing was
 * compared" — and CHK-01 returns exactly that second case for any WordPress build wordpress.org
 * does not publish (release candidates, nightlies, custom builds).
 */
function fmtIntegrity(kind, result) {
  if (!result) return `(${kind} integrity check did not run)`;
  if (result.status === 'unavailable') {
    return `NOT VERIFIED — ${result.reason || 'no checksum manifest available'}. `
         + `Zero ${kind} files were compared. This is not evidence of integrity.`;
  }
  const failures = Array.isArray(result.failures) ? result.failures : [];
  if (failures.length === 0) {
    const n = kind === 'core' ? (result.verified ?? 0) : (result.verified ?? 0);
    const scope = kind === 'core'
      ? `${n} core file(s) matched wordpress.org`
      : `${n} of ${result.activeTotal ?? '?'} active plugin(s) matched wordpress.org`;
    const gap = kind === 'plugin' && (result.unverifiable?.length || result.capped)
      ? ` NOT verified: ${(result.unverifiable || []).length} plugin(s) publish no manifest`
        + (result.capped ? `, ${result.capped} beyond the scan cap` : '') + '.'
      : '';
    return `${scope}, no mismatches.${gap}`;
  }
  return `${failures.length} ${kind} file(s) FAILED checksum:\n` + failures.slice(0, 40).join('\n');
}

async function collectSpecialistData(sandboxName, siteUrl, tools, integrity = {}) {
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

    // Obfuscation pattern scan (specialist LLM context — not a detection gate). Synced to the
    // retuned set in filesystem.ts's OBFUSCATION_PATTERNS; this had the same stale assert($/
    // create_function( patterns as Step 8 (236 and 5 false-positive hits, 0 real catches).
    tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
        $patterns = [
          '/eval\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*gzuncompress\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*str_rot13/',
          '/base64_decode\\s*\\(\\s*(base64_decode|gzinflate|gzuncompress|str_rot13|strrev|rawurldecode)\\s*\\(/',
          '/(eval|assert|preg_replace|create_function|call_user_func|system|exec|passthru|shell_exec)\\s*\\([^;]{0,80}base64_decode/',
          '/eval\\s*\\(\\s*\\$/',
        ];
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

    // Database: wp_posts content sample — specialist LLM context, not a detection signal.
    // Still wp_eval against the sandbox, deliberately deferred: Tier 2 already starts and
    // clones the site for CHK-01/02, content examination and ELF strings, so this collector
    // adds no new detonation risk beyond what already happens. Porting it to read the dump
    // (like DB-01..04) is a smaller follow-up, not done in this pass.
    tools.invoke('wp_eval', {
      site: sandboxName,
      skip_plugins: true, skip_themes: true, // raw $wpdb query — do not detonate live plugin code
      code: `
        global $wpdb;
        /* content_preview was selected here and never rendered — fmtPosts formats only status, type and title. 200 rows x 500 chars fetched and discarded every scan. DB-01 scans post content properly; this collector only needs the inventory. */
        $posts = $wpdb->get_results("SELECT ID, post_title, post_status, post_type FROM {$wpdb->posts} LIMIT 200", ARRAY_A);
        echo json_encode($posts);
      `,
    }),

    // Database: autoloaded options + critical options — specialist LLM context, same deferral
    // as the collector above. NOTE: `autoload='yes'` here has the identical vocabulary bug
    // DB-02 had before this port — WordPress 6.6 widened autoload to ('yes','on','auto-on',
    // 'auto'), so this list is empty on any 6.6+ site. Left as-is: fixing it belongs to the
    // same follow-up that ports this collector off wp_eval, not a standalone patch to a query
    // that will be replaced anyway.
    tools.invoke('wp_eval', {
      site: sandboxName,
      skip_plugins: true, skip_themes: true, // raw $wpdb query — do not detonate live plugin code
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

    // Behavioral: external HTTP checks
    (async () => {
      // siteUrlFor() returns null when it cannot determine a real host. Probing anyway would
      // send six requests — one of them spoofing Googlebot — to a guessed hostname that may
      // belong to someone else. Return empty and let the caller report the probes as unavailable.
      if (!siteUrl) return {};
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
  // Index 6 was a duplicate core-checksum collector; it is gone and behavioral moved up.
  // If you add a collector, append it — these indices are positional and a test pins them.
  const behavioral  = typeof get(6) === 'object' && get(6) !== null ? get(6) : {};

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
    // Reuse CHK-01/CHK-02's already-parsed verdicts. Previously this was a second, redundant
    // `wp core verify-checksums` truncated to 1000 chars, and pluginChecksums was a hardcoded
    // string telling the specialist to treat every plugin as unverifiable — even though CHK-02
    // had, in the same run, verified them.
    coreChecksums:          fmtIntegrity('core', integrity.core),
    pluginChecksums:        fmtIntegrity('plugin', integrity.plugin),
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

    // Authoritative sampling figures derived from what was actually returned.
    // The model cannot know the query LIMITs (they live here), so asking it to
    // "state sampling limits" without supplying them invited invented numbers.
    // When returned < limit the full table was examined — say so definitively.
    samplingLimits: (() => {
      const POSTS_LIMIT = 200;
      const AUTOLOAD_LIMIT = 50;
      // Read `posts` (collector 4), not `dbData` (collector 5 — options and tables). dbData.posts
      // is always undefined, so postsGot was always 0, so this always reported "fewer than the
      // limit, so the full set was examined" — a completeness claim that was never checked.
      const postsGot = (posts || []).length;
      const autoloadGot = (dbData.autoloaded || []).length;
      const line = (label, got, limit) => got >= limit
        ? `- ${label}: ${got} rows returned (query limit ${limit}) — table may contain more; the remainder was NOT examined.`
        : `- ${label}: ${got} rows returned (query limit ${limit}) — fewer than the limit, so the full set was examined.`;
      return [
        line('wp_posts', postsGot, POSTS_LIMIT),
        line('wp_options (autoloaded)', autoloadGot, AUTOLOAD_LIMIT),
        '- wp_usermeta: not collected in this run.',
        '- wp_comments: not collected in this run.',
        '- post_content is NOT provided to this specialist; DB-01 scans it separately.',
      ].join('\n');
    })(),
  };
}

async function runContentExamination(fsSignals, sandboxName, tools, log) {
  const DANGEROUS_FNS = ['eval', 'system', 'exec', 'passthru', 'shell_exec',
    'base64_decode', 'gzinflate', 'str_rot13', 'create_function', 'assert',
    'preg_replace', 'move_uploaded_file', 'curl_exec'];

  const toExamine = [];
  for (const signal of fsSignals) {
    if (!['FS-01', 'FS-03', 'ABS-09'].includes(signal.id)) continue;
    for (const ev of (signal.evidence || [])) {
      const p = ev.split(' ')[0];
      if (p && p.endsWith('.php') && !p.startsWith('  ')) {
        toExamine.push({ path: p, signal });
      }
    }
  }
  if (toExamine.length === 0) return;

  const paths = [...new Set(toExamine.map(f => f.path))].slice(0, 10);
  const pathsPhp = phpJson(paths);
  const fnsJson = JSON.stringify(DANGEROUS_FNS);

  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${pathsPhp};
        $dangerous = ${fnsJson};
        $out = [];
        try {
          foreach ($paths as $rel) {
            if (strpos($rel, 'wp-content/') === 0) {
              $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
            } else {
              $full = ABSPATH . $rel;
            }
            if (!file_exists($full)) { $out[$rel] = ['error' => 'not found']; continue; }
            $content = @file_get_contents($full, false, null, 0, 3000);
            // PHP 8: file_get_contents returns false on failure; passing false to
            // string functions throws TypeError — guard here instead.
            if ($content === false) { $out[$rel] = ['error' => 'unreadable']; continue; }
            $found_fns = [];
            foreach ($dangerous as $fn) {
              if (stripos($content, $fn) !== false) $found_fns[] = $fn;
            }
            preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $content, $ips);
            preg_match_all('/https?:\\/\\/[^\\s\\x27"<>]+/', $content, $urls);
            // Sanitize to valid UTF-8 so json_encode never returns false
            $safe = mb_convert_encoding(substr(preg_replace('/\\s+/', ' ', $content), 0, 200), 'UTF-8', 'UTF-8');
            $out[$rel] = [
              'preview' => $safe,
              'functions' => $found_fns,
              'ips' => array_values(array_unique($ips[0])),
              'urls' => array_values(array_unique($urls[0])),
              'md5' => md5($content),
              'size' => filesize($full),
            ];
          }
        } catch (\\Throwable $e) { $out['__error'] = $e->getMessage(); }
        echo json_encode($out, JSON_PARTIAL_OUTPUT_ON_ERROR);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');

    for (const { path, signal } of toExamine) {
      const info = parsed[path];
      if (!info || info.error) continue;
      if (info.functions.length > 0) {
        signal.evidence.push(`  → dangerous functions: ${info.functions.join(', ')}`);
      }
      if (info.ips.length > 0) {
        signal.evidence.push(`  → hardcoded IPs: ${info.ips.join(', ')}`);
      }
      if (info.urls.length > 0) {
        signal.evidence.push(`  → external URLs: ${info.urls.slice(0, 3).join(', ')}`);
      }
      signal.evidence.push(`  → preview: ${info.preview}`);
    }

    log.info(`[Tier 2] Content examination: ${Object.keys(parsed).length} file(s) read`);
  } catch (err) {
    log.warn(`[Tier 2] Content examination failed: ${err.message}`);
  }
}

async function runRootFileAnalysis(fsSignals, sandboxName, tools, log) {
  const fs03 = fsSignals.find(s => s.id === 'FS-03');
  if (!fs03 || !fs03.evidence || fs03.evidence.length === 0) return;

  const rootFiles = fs03.evidence
    .map(e => e.split(' ')[0])
    .filter(p => p && p.endsWith('.php') && !p.includes('/') && !p.startsWith('  '));
  if (rootFiles.length === 0) return;

  const rootFilesPhp = phpJson(rootFiles);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $files = ${rootFilesPhp};
        $out = [];
        try {
          foreach ($files as $f) {
            $full = ABSPATH . $f;
            if (!file_exists($full)) continue;
            $raw = @file_get_contents($full);
            if ($raw === false) continue;
            $size = strlen($raw);

            // Attempt one-level decode for obfuscated files
            $decoded = null;
            preg_match_all('/base64_decode\\s*\\(\\s*[\\x27"]([A-Za-z0-9+\\/=]{20,})[\\x27"]/',$raw, $m);
            foreach ($m[1] as $b64) {
              $d = @base64_decode($b64);
              if ($d !== false && strlen($d) > 10) {
                $ungz = @gzinflate($d);
                $decoded = substr($ungz ?: $d, 0, 500);
                break;
              }
            }

            // Classify attack category
            $category = 'unknown-php';
            if (preg_match('/eval\\s*\\(\\s*(\\$_POST|\\$_REQUEST|\\$_GET|\\$_COOKIE)/', $raw) ||
                preg_match('/(system|exec|passthru|shell_exec)\\s*\\(\\s*(\\$_POST|\\$_GET|\\$_REQUEST)/', $raw)) {
              $category = 'webshell';
            } elseif (preg_match('/\\$_FILES|move_uploaded_file/', $raw)) {
              $category = 'file-uploader';
            } elseif (preg_match('/eval\\s*\\(\\s*(base64_decode|gzinflate|str_rot13|goto)/', $raw) ||
                      preg_match('/goto\\s+[a-zA-Z_]/', $raw)) {
              $category = 'obfuscated-dropper';
            } elseif (preg_match('/casino|gambling|slots|poker|\\bbet\\b|wagering/i', $raw)) {
              $category = 'seo-spam-injector';
            } elseif (preg_match('/\\bmail\\s*\\(|header\\s*\\(\\s*[\\x27"]Location:/i', $raw)) {
              $category = 'mailer';
            }

            // Extract IOCs: IPs and external URLs
            preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $raw, $ips);
            preg_match_all('/https?:\\/\\/[^\\s\\x27"<>]+/', $raw, $urls);

            $out[$f] = [
              'content' => mb_convert_encoding(substr($raw, 0, 1000), 'UTF-8', 'UTF-8'),
              'size' => $size,
              'category' => $category,
              'iocs' => array_values(array_unique(array_merge($ips[0], $urls[0]))),
              'decodedPayload' => $decoded,
            ];
          }
        } catch (\\Throwable $e) { $out['__error'] = $e->getMessage(); }
        echo json_encode($out, JSON_PARTIAL_OUTPUT_ON_ERROR);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');

    for (const [file, info] of Object.entries(parsed)) {
      if (!info) continue;
      fs03.evidence.push(`  → ${file} [${info.category}] (${info.size} bytes)`);
      if (info.decodedPayload) {
        fs03.evidence.push(`  → decoded: ${info.decodedPayload.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      if (info.content && !info.decodedPayload) {
        fs03.evidence.push(`  → content: ${info.content.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      if (info.iocs && info.iocs.length > 0) {
        fs03.evidence.push(`  → IOCs: ${info.iocs.slice(0, 5).join(', ')}`);
      }
    }
    log.info(`[Tier 2] Root file analysis: ${Object.keys(parsed).length} file(s) classified`);
  } catch (err) {
    log.warn(`[Tier 2] Root file analysis failed: ${err.message}`);
  }
}

async function runObfuscationDecoder(fsSignals, sandboxName, tools, log) {
  const fs02 = fsSignals.find(s => s.id === 'FS-02');
  if (!fs02) return;

  const filesToDecode = (fs02.evidence || [])
    .map(e => e.split(' ')[0])
    .filter(p => p && p.includes('.php') && !p.startsWith('  '))
    .slice(0, 3);
  if (filesToDecode.length === 0) return;

  const fileToDecodePhp = phpJson(filesToDecode);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${fileToDecodePhp};
        $out = [];
        foreach ($paths as $rel) {
          if (strpos($rel, 'wp-content/') === 0) {
            $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
          } else {
            $full = ABSPATH . $rel;
          }
          if (!file_exists($full)) continue;
          $content = @file_get_contents($full, false, null, 0, 20000);
          if ($content === false) continue;
          preg_match_all('/base64_decode\\s*\\(\\s*[\\x27"]([A-Za-z0-9+\\/=]{20,})[\\x27"]/',$content, $matches);
          $decoded = [];
          foreach ($matches[1] as $b64) {
            $d = @base64_decode($b64);
            if ($d === false || strlen($d) < 10) continue;
            $ungz = @gzinflate($d);
            $payload = substr(preg_replace('/\\s+/', ' ', $ungz ?: $d), 0, 300);
            if (strlen($payload) > 10) $decoded[] = mb_convert_encoding($payload, 'UTF-8', 'UTF-8');
          }
          if (!empty($decoded)) $out[$rel] = $decoded;
        }
        echo json_encode($out, JSON_PARTIAL_OUTPUT_ON_ERROR);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    for (const [path, payloads] of Object.entries(parsed)) {
      for (const payload of payloads) {
        fs02.evidence.push(`  → decoded payload in ${path.split('/').pop()}: ${payload}`);
      }
    }
    if (Object.keys(parsed).length > 0) {
      log.info(`[Tier 2] Obfuscation decoder: ${Object.keys(parsed).length} file(s) decoded`);
    }
  } catch (err) {
    log.warn(`[Tier 2] Obfuscation decoder failed: ${err.message}`);
  }
}

async function runCoreDiff(fsSignals, sandboxName, tools, log) {
  const chk01 = fsSignals.find(s => s.id === 'CHK-01');
  if (!chk01) return;

  const coreFiles = (chk01.evidence || [])
    .map(e => e.replace(/^Error: File doesn't verify against checksum:\s*/, '').trim())
    .filter(f => !f.startsWith('wp-content/') && f.endsWith('.php') && f.length < 60)
    .slice(0, 3);

  const coreFilesPhp = phpJson(coreFiles);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        global $wp_version;
        $files = ${coreFilesPhp};
        $out = [];
        foreach ($files as $rel) {
          $full = ABSPATH . $rel;
          if (!file_exists($full)) continue;
          $url = "https://core.svn.wordpress.org/tags/{$wp_version}/{$rel}";
          $resp = wp_remote_get($url, ['timeout' => 15]);
          if (is_wp_error($resp) || wp_remote_retrieve_response_code($resp) !== 200) {
            $out[$rel] = ['svn_error' => 'could not fetch original'];
            continue;
          }
          $original = wp_remote_retrieve_body($resp);
          $local = @file_get_contents($full);
          if ($local === $original) { $out[$rel] = ['injected' => []]; continue; }
          $orig_lines = explode("\\n", $original);
          $local_lines = explode("\\n", $local);
          $added = array_values(array_diff($local_lines, $orig_lines));
          $out[$rel] = ['injected' => array_slice($added, 0, 10)];
        }
        echo json_encode($out);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    for (const [file, data] of Object.entries(parsed)) {
      if (data.svn_error) {
        chk01.evidence.push(`  → ${file}: ${data.svn_error}`);
      } else if (data.injected && data.injected.length > 0) {
        chk01.evidence.push(`  → ${file} injected lines: ${data.injected.map(l => l.trim()).filter(Boolean).slice(0, 5).join(' | ').slice(0, 300)}`);
      } else if (data.injected && data.injected.length === 0) {
        chk01.evidence.push(`  → ${file}: no line-level diff detected (binary or encoding difference)`);
      }
    }
    if (Object.keys(parsed).length > 0) {
      log.info(`[Tier 2] Core diff: ${Object.keys(parsed).length} file(s) compared`);
    }
  } catch (err) {
    log.warn(`[Tier 2] Core diff failed: ${err.message}`);
  }
}

async function runElfStrings(fsSignals, sandboxName, tools, log) {
  const fs06 = fsSignals.find(s => s.id === 'FS-06');
  if (!fs06 || !fs06.evidence || fs06.evidence.length === 0) return;

  const firstElf = fs06.evidence
    .map(e => e.split(' ')[0])
    .find(p => p && p.startsWith('wp-content/') && !p.startsWith('  '));
  if (!firstElf) return;

  const elfPhp = phpJson(firstElf);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $rel = ${elfPhp};
        $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
        if (!file_exists($full)) { echo json_encode(['error' => 'not found']); exit; }
        $md5 = md5_file($full);
        $output = shell_exec('strings ' . escapeshellarg($full) . ' 2>/dev/null');
        if ($output === null) { echo json_encode(['error' => 'strings not available', 'md5' => $md5]); exit; }
        $patterns = [
          '/https?:\\/\\//', '/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/',
          '/\\/bin\\/(sh|bash|dash)/', '/curl|wget|\\bnc\\b|ncat|netcat/',
          '/root|passwd|shadow/', '/chmod|chown|setuid/',
          '/\\/proc\\//', '/connect|socket|bind|listen/',
          '/cmd|command|shell|backdoor|reverse/',
        ];
        $interesting = [];
        foreach (explode("\\n", $output) as $line) {
          $line = trim($line);
          if (strlen($line) < 4 || strlen($line) > 200) continue;
          foreach ($patterns as $pat) {
            if (@preg_match($pat, $line)) { $interesting[] = $line; break; }
          }
        }
        echo json_encode([
          'md5' => $md5,
          'indicators' => array_values(array_unique(array_slice($interesting, 0, 30))),
          'analyzed' => basename($rel),
        ]);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    if (parsed.error) {
      fs06.evidence.push(`  → strings analysis unavailable: ${parsed.error}`);
      return;
    }
    if (parsed.indicators && parsed.indicators.length > 0) {
      const elfCount = fs06.evidence.filter(e => e.startsWith('wp-content/')).length;
      fs06.evidence.push(`  → strings analysis of ${parsed.analyzed} (MD5: ${parsed.md5}, ~${elfCount} total ELF files assumed identical):`);
      for (const ind of parsed.indicators.slice(0, 15)) {
        fs06.evidence.push(`    ${ind}`);
      }
    }
    log.info(`[Tier 2] ELF strings: ${parsed.indicators?.length ?? 0} indicator(s) from ${parsed.analyzed}`);
  } catch (err) {
    log.warn(`[Tier 2] ELF strings failed: ${err.message}`);
  }
}

// Infrastructure domains — WordPress core, CDNs, package registries. Safe to
// trust even inside an already-flagged file, because legitimate-but-flagged code
// legitimately references these.
const TRUSTED_INFRA_DOMAINS = [
  'wordpress.org', 'wp.com', 'w.org', 'gravatar.com',
  'jquery.com', 'googleapis.com', 'gstatic.com', 'bootstrapcdn.com',
  'github.com', 'github.io', 'githubusercontent.com', 'gitlab.com',
  'php.net', 'php.org', 'phpunit.de', 'phar.phpunit.de',
  'packagist.org', 'getcomposer.org', 'artifex.com',
];

// Plugin-vendor domains. Deliberately NOT trusted inside runNetworkIndicators:
// that function only scans files ALREADY flagged as suspicious (FS-01/02/03/ABS-09),
// and several of these are file-manager vendors — the exact category ABS-04 treats
// as high-risk. A flagged file phoning its vendor is precisely the call we want to
// surface, so these are kept out of the network-indicator trust set. Retained here
// only for reference / potential use by non-security contexts.
const PLUGIN_VENDOR_DOMAINS = [
  'elrte.org', 'studio-42.github',
  'filemanagerpro.io', 'webdesi9.com', 'wpexpertsio.com',
  'softaculous.com', 'ninjateam.org',
];

// Back-compat alias — some call sites may still reference the old name.
const TRUSTED_DOMAINS = TRUSTED_INFRA_DOMAINS;

async function runNetworkIndicators(fsSignals, installName, sandboxName, tools, log) {
  const phpPaths = [];
  for (const sig of fsSignals) {
    if (!['FS-01', 'FS-02', 'FS-03', 'ABS-09'].includes(sig.id)) continue;
    for (const ev of (sig.evidence || [])) {
      const p = ev.split(' ')[0];
      if (p && p.endsWith('.php') && !p.startsWith('  ')) phpPaths.push(p);
    }
  }
  if (phpPaths.length === 0) return;

  const uniquePaths = [...new Set(phpPaths)].slice(0, 20);
  const uniquePathsPhp = phpJson(uniquePaths);
  const trustedJson = JSON.stringify(TRUSTED_INFRA_DOMAINS);

  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${uniquePathsPhp};
        $trusted = ${trustedJson};
        $all_ips = []; $all_urls = [];
        foreach ($paths as $rel) {
          if (strpos($rel, 'wp-content/') === 0) {
            $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
          } else {
            $full = ABSPATH . $rel;
          }
          if (!file_exists($full)) continue;
          $content = @file_get_contents($full, false, null, 0, 100000);
          preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $content, $m);
          $all_ips = array_merge($all_ips, $m[0]);
          preg_match_all('/https?:\\/\\/[a-zA-Z0-9._\\-\\/\\?&=%#]+/', $content, $m);
          $all_urls = array_merge($all_urls, $m[0]);
        }
        $filtered_ips = array_values(array_unique(array_filter($all_ips, function($ip) {
          $long = ip2long($ip);
          if ($long === false) return false;
          // Filter RFC-1918 private ranges, loopback, link-local, broadcast
          $private = [
            [ip2long('10.0.0.0'), ip2long('10.255.255.255')],
            [ip2long('172.16.0.0'), ip2long('172.31.255.255')],
            [ip2long('192.168.0.0'), ip2long('192.168.255.255')],
            [ip2long('127.0.0.0'), ip2long('127.255.255.255')],
            [ip2long('169.254.0.0'), ip2long('169.254.255.255')],
            [ip2long('0.0.0.0'), ip2long('0.255.255.255')],
            [ip2long('255.0.0.0'), ip2long('255.255.255.255')],
          ];
          foreach ($private as [$lo, $hi]) {
            if ($long >= $lo && $long <= $hi) return false;
          }
          return true;
        })));
        $filtered_urls = array_values(array_unique(array_filter($all_urls, function($u) use ($trusted) {
          // Host-suffix match, not substring: parse the host once, then trust only
          // if it EQUALS a trusted domain or ends with "." + domain. Blocks the
          // bypass where "evil-filemanagerpro.io.attacker.com" matched "filemanagerpro.io".
          $host = strtolower((string) parse_url($u, PHP_URL_HOST));
          if ($host === '') return true; // couldn't parse a host → keep it (surface it)
          foreach ($trusted as $d) {
            $d = strtolower($d);
            if ($host === $d || substr($host, -(strlen($d) + 1)) === '.' . $d) return false;
          }
          return true;
        })));
        echo json_encode(['ips' => $filtered_ips, 'urls' => array_slice($filtered_urls, 0, 20)]);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    const ips = parsed.ips || [];
    const urls = parsed.urls || [];

    if (ips.length === 0 && urls.length === 0) return;

    const evidence = [
      ...ips.map(ip => `IP: ${ip}`),
      ...urls.map(url => `URL: ${url}`),
    ];

    fsSignals.push({
      id: 'FS-07', severity: 'critical', category: 'active-compromise',
      installName,
      title: `Hardcoded network indicators in suspicious PHP: ${ips.length} IP(s), ${urls.length} URL(s)`,
      detail: 'Suspicious PHP files contain hardcoded network indicators — likely C2 addresses, exfiltration endpoints, or attacker infrastructure.',
      fix: 'Investigate each indicator. Block at network/firewall level. Check server access logs for requests to these addresses.',
      evidence,
    });

    log.info(`[Tier 2] Network indicators: ${ips.length} IP(s), ${urls.length} URL(s) found`);
  } catch (err) {
    log.warn(`[Tier 2] Network indicator scan failed: ${err.message}`);
  }
}

async function tier2Investigate(install, tier1Signals, tools, ai, log, state, _pollIntervalMs = 20000, autonomy = 'auto', attackSummary = null, preflightSignals = []) {
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

    // We started this site ourselves, above, purely so local_clone_site had something running
    // to copy. Once the clone exists, the original does not need to stay running for anything
    // that follows — the rest of Tier 2 works entirely against the sandbox. Leaving it running
    // is the same problem the sandbox-stop below exists for, except worse: this is the actual
    // known-compromised site, not a copy, and reproduced twice live in one session — a scan
    // starts it, nothing stops it again, and the next scan's pre-flight byte scan then refuses
    // to trust its own database dump because the data files raced ahead of it (resolveDbSource
    // correctly reports 'stale', but only because this left the site running for no reason).
    try {
      await tools.invoke('local_stop_site', { site: install.name });
      log.info(`[Tier 2] Source site ${install.name} stopped (was only started to enable the clone)`);
    } catch (err) {
      log.warn(`[Tier 2] Could not stop source site ${install.name} after cloning: ${err.message} — it is still running`);
    }
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

  log.info(`[Tier 2] Sandbox ready.`);
  // Register sandbox with the tool provider so wp_eval site-scope enforcement allows it.
  // This is a no-op when running outside the agent runtime (unit tests, etc.).
  if (typeof tools.registerSandbox === 'function') tools.registerSandbox(sandboxName);

  // THE SANDBOX IS NOT A CONTAINMENT BOUNDARY. Do not add hardening here without reading this.
  //
  // Two attempts previously lived at this point and both have been removed, because both were
  // measured and neither worked:
  //
  // 1. Appending `disable_functions` to php.ini. This never applied even once — but NOT for the
  //    reason first recorded here. It wrote to the *compiled* file under
  //    Local/run/<siteId>/conf/php/, which Local regenerates from the site's php.ini.hbs on
  //    every start, and then called `local_restart_site` to apply it — the same operation that
  //    erased it. Measured: 20 failures to 10 believed successes, zero php.ini anywhere carrying
  //    its marker, ~30s per scan wasted on a pointless restart.
  //
  //    CORRECTION (measured 2026-08-05). This comment previously claimed the CLI SAPI "loads no
  //    php.ini at all". That is false and it matters. Local's WpCliService sets PHPRC to the
  //    site's PHP config dir (flywheel-local app/main/sites/WpCliService.ts:144-151), so wp-cli
  //    *does* load it: with PHPRC set, php_ini_loaded_file() returns
  //    run/<siteId>/conf/php/php.ini; without it, false. The durable write target is the
  //    per-site template ~/Local Sites/<site>/conf/php/php.ini.hbs, where line 49 already
  //    carries `disable_functions =` unset behind a Handlebars comment.
  //
  //    So hardening IS reachable on a Local sandbox — and constrains these checks too, which is
  //    a cost, not a bonus: an egress-tight blocklist removes curl_exec, and CHK-01's
  //    wordpress.org fetch dies with it.
  //
  // 2. Defining WP_HTTP_BLOCK_EXTERNAL in the sandbox's wp-config.php. This applied, but only
  //    constrains WordPress's own wp_remote_* API, which malware has no reason to use — and it
  //    mutated the evidence, which is worse than useless when the sandbox is meant to be a
  //    forensic artifact.
  //
  // Even a correctly delivered blocklist would not contain this. The list above left 5 of 8
  // egress channels open (stream_socket_client, file_get_contents and fopen on URLs,
  // gethostbyname, mail). A maximal block does reach 0 of 8, packet-verified, with the WordPress
  // front end byte-identical — but two holes are structural and neither closes:
  //
  //   * `new mysqli(...)` / PDO open arbitrary outbound TCP and cannot be disabled without
  //     breaking WordPress. Verified round-tripping a payload to a listener on 127.0.0.1:13399
  //     under otherwise-complete hardening.
  //   * `proc_open` must stay callable or WP-CLI cannot run at all ("Cannot do 'Process::run'"),
  //     and proc_open is itself a complete exec primitive.
  //
  // CORRECTION (measured 2026-08-05): this comment previously said `disable_classes` is inert
  // for statically compiled extensions "so new SoapClient(...) gets out under any
  // configuration". False for SoapClient — `disable_classes=SoapClient` genuinely kills it and
  // no packet arrives. Since SoapClient bypasses allow_url_fopen=0 entirely, disable_classes is
  // the only control for it. The claim holds in effect for mysqli, but for a different reason:
  // it cannot be disabled without breaking WordPress, not because the directive is ignored.
  // See docs/planning/2026-08-03-php-ini-scan-dir-hardening.md.
  //
  // The real fix is not to execute the code at all: 21 of 22 Tier 2 units need only bytes and
  // belong in Node. See docs/planning/2026-08-03-sentinel-execution-model.md.

  log.info(`[Tier 2] Running filesystem checks...`);

  const fsSignals = [];

  // Filesystem detection reads the ORIGINAL install as bytes, and it already happened — before
  // this function created the sandbox, in the pre-flight above. That ordering is the point.
  //
  // What it replaces: FS-01, FS-02, FS-03, FS-04 and FS-06 as wp_eval against the clone. Every
  // one of those booted WordPress on a possibly-compromised copy in order to ask it about
  // itself, and `skip_plugins` does not skip mu-plugins — WP-CLI implements it as four filters
  // on `active_plugins` while wp-settings.php includes mu-plugins from disk unconditionally. A
  // harness demonstrated the consequence: code loaded at mu-plugin time installed an ob_start()
  // rewriter and turned a correct BACKDOOR-PRESENT result into "clean".
  //
  // They also inspected a MUTATED copy: local_clone_site runs isMultisite plus four
  // wp search-replace passes, and local_wpe_pull runs installWP + updateWPConfig + changeDomain.
  //
  // Verified equivalent before the swap: a golden baseline captured from the wp_eval semantics
  // across 33 installs and 82,068 PHP files matched the byte implementation on 33 of 33 sites.
  fsSignals.push(...preflightSignals);

  // FS-05 (.htaccess), ABS-08 and ABS-09 now run through the pre-flight byte scan above
  // (preflightSignals), not wp_eval — ported so Tier 2 no longer needs to detonate the
  // site just to compute them. The sandbox (start + clone) below still exists for the
  // database, checksum, and content-examination checks that follow, which do still need it.

  // FS-MISMATCH: intentionally runs WITH plugins loaded to detect account-hiding hooks
  const dbCountResult = await tools.invoke('wp_eval', {
    site: sandboxName,
    code: `
      global $wpdb;
      // The capabilities meta_key is PREFIXED — it is "{$wpdb->prefix}capabilities", not the
      // literal 'wp_capabilities'. WP Engine installs use randomized table prefixes, so
      // hardcoding 'wp_' made this query return 0 on every production target and the check
      // silently never fired. Derive it.
      $capKey = $wpdb->prefix . 'capabilities';
      $count = $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT u.ID) FROM {$wpdb->users} u JOIN {$wpdb->usermeta} m ON u.ID = m.user_id WHERE m.meta_key = %s AND m.meta_value LIKE '%administrator%'", $capKey));
      $wpCount = count(get_users(['role' => 'administrator']));
      echo json_encode(['db' => (int)$count, 'wp' => (int)$wpCount]);
    `,
  });
  let adminMismatch = false;
  try {
    const counts = JSON.parse(extractResult(dbCountResult) || '{}');
    // Guard on PRESENCE, not truthiness. The previous `counts.db && counts.wp` swallowed the
    // worst case: a backdoor hiding *every* admin makes counts.wp === 0, which is falsy, so the
    // check discarded exactly the evidence it exists to find. counts.db === 0 is a different
    // matter — it means the DB query found no admins at all, which is a broken query rather
    // than a finding, so that one stays excluded.
    const haveCounts = typeof counts.db === 'number' && typeof counts.wp === 'number';
    if (haveCounts && counts.db > 0 && counts.db !== counts.wp) {
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

  // DB-01 through DB-04 now run through the pre-flight byte scan above (preflightSignals),
  // reading app/sql/local.sql instead of querying wp_posts/wp_options/wp_usermeta/wp_comments
  // via wp_eval against this sandbox — ported for the same reason FS-05/ABS-08/09 were:
  // --skip-plugins does not stop mu-plugins from executing on a `wp eval` call.

  // Hoisted so collectSpecialistData can reuse them instead of re-running the same work.
  // Collector 6 used to shell out to `wp core verify-checksums` inside this very function,
  // duplicating CHK-01 below — a second full core hash of the same tree, a nested wp-cli
  // process, and a result truncated to 1000 chars before the specialist ever saw it.
  let coreIntegrity = null;
  let pluginIntegrity = null;

  // CHK-01: WP core file integrity via wordpress.org checksums API (no nested wp-cli)
  log.info(`[Tier 2] Running core integrity checks...`);
  try {
    const coreCheckResult = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        global $wp_version;
        $locale = get_locale();
        $url = "https://api.wordpress.org/core/checksums/1.0/?version={$wp_version}&locale={$locale}";
        $response = wp_remote_get($url, ['timeout' => 20]);
        if (is_wp_error($response)) {
          echo json_encode(['status' => 'unavailable', 'failures' => []]);
          exit;
        }
        $data = json_decode(wp_remote_retrieve_body($response), true);
        $checksums = $data['checksums'] ?? [];
        // api.wordpress.org answers HTTP 200 with {"checksums":false} for any version it does
        // not publish — release candidates, nightlies, and any locally-built core. `?? []` does
        // NOT rescue that: false is not null, so $checksums stays false, foreach iterates zero
        // times, $failures stays empty, and the check reports 'passed' having verified nothing.
        // Measured live: version 7.0-RC4-62365 returns exactly that body, and one site on this
        // machine runs it. A core-integrity check that cannot obtain a manifest has not passed;
        // it has not run.
        if (!is_array($checksums) || count($checksums) === 0) {
          echo json_encode(['status' => 'unavailable', 'failures' => [], 'verified' => 0,
                            'reason' => "wordpress.org publishes no checksum manifest for version {$wp_version}"]);
          exit;
        }
        $failures = [];
        $verified = 0;
        $abspath = ABSPATH;
        foreach ($checksums as $file => $expected_md5) {
          // Skip wp-content/ — themes/plugins are user territory, not core
          if (strpos($file, 'wp-content/') === 0) continue;
          $full_path = $abspath . $file;
          if (!file_exists($full_path)) continue;
          $verified++;
          if (md5_file($full_path) !== $expected_md5) {
            $failures[] = "Error: File doesn't verify against checksum: {$file}";
          }
        }
        // Zero files compared against a non-empty manifest means ABSPATH is wrong or the tree is
        // unreadable — also not a pass.
        if ($verified === 0) {
          echo json_encode(['status' => 'unavailable', 'failures' => [], 'verified' => 0,
                            'reason' => 'manifest obtained but no core file could be read']);
          exit;
        }
        echo json_encode([
          'status' => count($failures) > 0 ? 'failed' : 'passed',
          'failures' => $failures,
          'verified' => $verified,
        ]);
      `,
    });
    const coreCheck = JSON.parse(extractResult(coreCheckResult) || '{"status":"unavailable","failures":[]}');
    coreIntegrity = coreCheck;
    if (coreCheck.status === 'unavailable') {
      // Surfaced as a finding, not swallowed. Silence here reads as "core is intact", which is
      // the single most misleading thing this agent can imply about a site it never checked.
      fsSignals.push({
        id: 'CHK-01-SKIPPED', severity: 'medium', category: 'coverage-gap',
        installName: install.name,
        title: `Core integrity NOT verified: ${coreCheck.reason || 'checksum manifest unavailable'}`,
        detail: 'No core file was compared against WordPress.org. This is not evidence that core is intact — it is the absence of evidence either way. Release candidates, nightlies and custom builds have no published manifest.',
        fix: 'Compare against a known-good copy of the same build, or update to a released version and re-scan.',
      });
    }
    if (coreCheck.status === 'failed' && coreCheck.failures.length > 0) {
      fsSignals.push({
        id: 'CHK-01', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `WordPress core file tampering detected: ${coreCheck.failures.length} file(s) fail checksum`,
        detail: 'Core file checksums do not match WordPress.org — files may have been injected or modified by the attacker.',
        fix: 'Run: wp core download --skip-content --force to re-download core files. Then re-verify.',
        evidence: coreCheck.failures.map(f => f.trim()),
      });
    }
    log.info(
      `[Tier 2] Core integrity: ${coreCheck.status}` +
      (coreCheck.status === 'unavailable'
        ? ` — 0 files verified (${coreCheck.reason || 'no manifest'})`
        : ` — ${coreCheck.verified ?? 0} file(s) verified`),
    );
  } catch (err) {
    log.warn(`[Tier 2] CHK-01 failed: ${err.message}`);
  }

  // CHK-02: Active plugin integrity via downloads.wordpress.org checksums API (no nested wp-cli)
  log.info(`[Tier 2] Running plugin integrity checks...`);
  try {
    const pluginCheckResult = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $active = get_option('active_plugins', []);
        $failures = [];
        $unverifiable = [];
        $verified = [];
        // The cap is a cost control, but a silent cap reports a partial scan as a complete one.
        // Count what it drops so the verdict can say so.
        $capped = max(0, count($active) - 30);
        foreach (array_slice($active, 0, 30) as $plugin_file) {
          $slug = explode('/', $plugin_file)[0];
          $data = get_plugins("/{$slug}");
          $version = !empty($data) ? array_values($data)[0]['Version'] ?? '' : '';
          if (!$version) { $unverifiable[] = $slug; continue; }
          $url = "https://downloads.wordpress.org/plugin-checksums/{$slug}/{$version}.json";
          $resp = wp_remote_get($url, ['timeout' => 10]);
          if (is_wp_error($resp) || wp_remote_retrieve_response_code($resp) !== 200) {
            $unverifiable[] = "{$slug} ({$version})";
            continue;
          }
          $checksums = json_decode(wp_remote_retrieve_body($resp), true);
          $files = $checksums['files'] ?? [];
          // Same false-rescues-null trap as CHK-01: a body of {"files":false} leaves $files
          // false, foreach runs zero times, and the plugin counts as verified having compared
          // nothing.
          if (!is_array($files) || count($files) === 0) {
            $unverifiable[] = "{$slug} ({$version}) — empty manifest";
            continue;
          }
          $verified[] = $slug;
          $plugin_dir = WP_PLUGIN_DIR . '/' . $slug . '/';
          foreach ($files as $file => $hashes) {
            $expected = $hashes['md5'] ?? null;
            if (!$expected) continue;
            $full_path = $plugin_dir . $file;
            if (!file_exists($full_path)) continue;
            if (md5_file($full_path) !== $expected) {
              $failures[] = "Error: {$slug}/{$file} doesn't verify against checksum";
            }
          }
        }
        echo json_encode([
          'status' => count($failures) > 0 ? 'failed' : 'passed',
          'failures' => $failures,
          'unverifiable' => $unverifiable,
          'verified' => count($verified),
          'activeTotal' => count($active),
          'capped' => $capped,
        ]);
      `,
    });
    const pluginCheck = JSON.parse(extractResult(pluginCheckResult) || '{"status":"unavailable","failures":[]}');
    pluginIntegrity = pluginCheck;
    if (pluginCheck.failures.length > 0) {
      fsSignals.push({
        id: 'CHK-02', severity: 'critical', category: 'active-compromise',
        installName: install.name,
        title: `Plugin file tampering: ${pluginCheck.failures.length} plugin(s) fail checksum verification`,
        detail: 'Plugin files do not match WordPress.org checksums — the attacker may have injected code into a legitimate plugin file.',
        fix: 'For each failing plugin: wp plugin install <slug> --force to reinstall from WordPress.org.',
        evidence: pluginCheck.failures.map(f => f.trim()),
      });
    }
    // Coverage, as a finding rather than an info line. Premium and custom plugins have no
    // wordpress.org manifest, so on a real site most of the plugin surface can be unverifiable
    // while the check still reports 'passed' — which reads as "your plugins are intact".
    const unverifiable = pluginCheck.unverifiable ?? [];
    const capped = pluginCheck.capped ?? 0;
    if (unverifiable.length > 0 || capped > 0) {
      const parts = [];
      if (unverifiable.length) parts.push(`${unverifiable.length} plugin(s) have no wordpress.org manifest`);
      if (capped) parts.push(`${capped} active plugin(s) beyond the 30-plugin cap were not examined`);
      fsSignals.push({
        id: 'CHK-02-PARTIAL', severity: 'medium', category: 'coverage-gap',
        installName: install.name,
        title: `Plugin integrity only partially verified: ${parts.join('; ')}`,
        detail:
          `Verified ${pluginCheck.verified ?? 0} of ${pluginCheck.activeTotal ?? '?'} active plugin(s) against ` +
          `wordpress.org. Premium, custom and bundled plugins publish no checksums, so an attacker editing a ` +
          `file inside one is invisible to this check.`,
        fix: 'Compare unverifiable plugins against a known-good copy, or a fresh download from the vendor.',
        evidence: unverifiable.slice(0, 20),
      });
    }
    log.info(
      `[Tier 2] Plugin integrity: ${pluginCheck.status} — ` +
      `${pluginCheck.verified ?? 0}/${pluginCheck.activeTotal ?? '?'} verified, ` +
      `${unverifiable.length} unverifiable, ${capped} beyond cap`,
    );
  } catch (err) {
    log.warn(`[Tier 2] CHK-02 failed: ${err.message}`);
  }

  log.info(`[Tier 2] Database scan complete: ${fsSignals.length} total finding(s) (FS + DB + CHK)`);

  log.info(`[Tier 2] Examining suspicious file content...`);
  await runContentExamination(fsSignals, sandboxName, tools, log);

  await runRootFileAnalysis(fsSignals, sandboxName, tools, log);

  log.info(`[Tier 2] Decoding obfuscated payloads...`);
  await runObfuscationDecoder(fsSignals, sandboxName, tools, log);

  log.info(`[Tier 2] Comparing core files to SVN originals...`);
  await runCoreDiff(fsSignals, sandboxName, tools, log);

  log.info(`[Tier 2] Analyzing ELF binary strings...`);
  await runElfStrings(fsSignals, sandboxName, tools, log);

  log.info(`[Tier 2] Scanning for hardcoded network indicators...`);
  await runNetworkIndicators(fsSignals, install.name, sandboxName, tools, log);

  // Collect raw data for all specialists in parallel
  log.phase('Data collection', `Gathering filesystem, DB and behavioral data for ${install.name}`);
  const siteUrl = siteUrlFor(install, log);
  const specialistData = await collectSpecialistData(sandboxName, siteUrl, tools,
    { core: coreIntegrity, plugin: pluginIntegrity });

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
        logCorroboration: attackSummary,
      }),
      schemaName: 'SynthesizerResult',
      noTools: true,
    });
    log.warn(`[Tier 2 Synthesis] ${install.name}: ${synthesis.verdict} — ${(synthesis.attackSummary || '').slice(0, 120)}...`);
  } catch (err) {
    log.warn(`[Tier 2 Synthesis] LLM call failed for ${install.name}: ${err.message} — defaulting to escalate`);
    synthesis = { verdict: 'active-compromise', attackSummary: '(synthesis unavailable)', entryPoint: 'unknown', temporalNarrative: '', attackerItems: [], legitimateItems: [], blindSpots: ['Synthesis failed'], remediationSteps: [] };
  }

  // Remediation is always produced by the deterministic checklist builder
  // (tier3Remediate → buildRemediationChecklist). The synthesizer's
  // remediationSteps are advisory context for the human, not the executed plan,
  // so we do NOT branch on them here — doing so previously dropped the
  // synthesizer enrichment whenever the LLM happened to return zero steps.

  if (autonomy === 'ask') {
    // Ask mode: build the checklist but don't execute it. Return a pending plan
    // so the user can review and approve before anything is deleted or modified.
    log.phase('Tier 3', `Plan ready — awaiting approval before execution (${install.name})`);
    const checklist = buildRemediationChecklist(install, tier1Signals.concat(fsSignals), sandboxName);
    return {
      site: install.name,
      sandbox: sandboxName,
      verified: false,
      verdict: 'pending',
      pendingApproval: true,
      checklist,
      signals: tier1Signals.concat(fsSignals),
      summary: synthesis.attackSummary,
      entryPoint: synthesis.entryPoint,
      blindSpots: synthesis.blindSpots,
      attackerItems: synthesis.attackerItems,
      steps: checklist.map((item, i) => ({
        id: `step-${item.step ?? i + 1}`,
        label: item.action,
        command: item.executableCommand ?? '',
        tier: 3,
        requiresApproval: item.requiresApproval ?? false,
        verificationResult: 'pending',
        verificationOutput: '',
      })),
      reportPath: '',
    };
  }

  log.phase('Tier 3', `Preparing remediation plan for ${install.name}`);
  const plan = await tier3Remediate(install, synthesis.attackSummary, tier1Signals.concat(fsSignals), sandboxName, tools, log);
  if (plan) {
    // Enrich plan with synthesizer's attacker items and blind spots
    plan.summary = synthesis.attackSummary;
    plan.entryPoint = synthesis.entryPoint;
    plan.blindSpots = synthesis.blindSpots;
    plan.attackerItems = synthesis.attackerItems;
    plan.synthesizerSteps = synthesis.remediationSteps; // advisory, surfaced in UI
  }

  // Sandbox is EVIDENCE — kept on disk so the user can inspect it from the Sentinel Review UI,
  // and because deletion is handled by the nexus:sentinel:execute IPC handler after execution.
  // But keeping the *files* does not require keeping the site *running*: a running sandbox is a
  // live PHP-FPM plus MySQL pair serving a known-compromised site, one per scan, indefinitely.
  // Thirteen of them accumulated on one machine before this was noticed. Stop it; keep the bytes.
  try {
    await tools.invoke('local_stop_site', { site: sandboxName });
    log.info(`[Tier 2] Sandbox ${sandboxName} stopped (files retained as evidence)`);
  } catch (err) {
    log.warn(`[Tier 2] Could not stop sandbox ${sandboxName}: ${err.message} — it is still running`);
  }

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
// > 95: login-disabled (reversible)  |  50-95: demote to subscriber  |  < 50: flag for review
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

// KNOWN_MU_PLUGINS lived here as a second, independent copy of the list FS-01 used — same eight
// names, same omission of nexus-hub-bridge.php. Detection and remediation disagreeing about
// which mu-plugins are legitimate is how a remediation step deletes a file the scan considered
// fine, or spares one it flagged. There is now a single definition; see it for the full note.

const ATTACKER_PLUGIN_SLUGS = [
  'fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
  'noted', 'woocommerce-conversion-tracking', 'wp-file-manager',
];

// Authoritative map: signal ID → the checklist step number that remediates it.
// This is the SINGLE source of truth for "does a signal have a covering step?".
// Verdict coverage is derived from this map intersected with the steps that were
// actually built AND passed — never from a hand-maintained parallel list.
// A critical signal with no entry here (or whose covering step is absent/failed)
// forces NOT SAFE TO PUSH.
const SIGNAL_REMEDIATION_STEP = {
  'FS-01': 1,
  'ABS-01': 2, 'ABS-02': 2, 'ABS-03': 2, 'REL-03': 2, 'LLM-USER-01': 2,
  'ABS-04': 3, 'ABS-05': 3, 'REL-01': 3, 'ABS-08': 3,
  'FS-04': '4b',
  'CHK-01': '5a',
  'FS-03': '5b',
  'ABS-09': '5c',
  'DB-01': '5d',
  'FS-06': '5e',
  'FS-05': '5f',
  'DB-02': '5g',
  // FS-02 (obfuscated code) → Step 8 (final re-scan). The obfuscated files live
  // inside the attacker plugins removed by Step 3; Step 8 verifies they are gone.
  // If Step 8 passes, FS-02 is remediated — no separate file-by-file removal needed.
  'FS-02': 8,
  // Signals with NO remediation step below are intentionally uncovered and will
  // block the push until a step is added or a human clears them:
  //   FS-07 (network indicators — investigative, URLs need human review)
  //   DB-03 (serialized usermeta — needs inspection)
  //   FS-MISMATCH (hidden admin — remediated indirectly via step 2/3, but the
  //                hiding hook must be confirmed gone by a human)
};

// Attach to the test surface now that the const is initialized (avoids the
// temporal-dead-zone error that would occur if module.exports referenced it
// eagerly — object-literal const values, unlike function declarations, are not
// hoisted).
module.exports._test.SIGNAL_REMEDIATION_STEP = SIGNAL_REMEDIATION_STEP;

/**
 * Build a checklist step that deletes the files named in a signal's evidence, scoped to
 * wp-content. Shared by 5c (ABS-09) and 5e (FS-06), which were duplicate implementations of
 * byte-identical PHP.
 *
 * The realpath prefix check is the containment: evidence strings are attacker-influenced — they
 * are paths found on the compromised site — so a `../../` escape must not reach unlink.
 *
 * NOTE: executableCommand is null, so neither step reaches production; it runs against the
 * sandbox copy only. That is a pre-existing coverage gap, not a property of this refactor.
 */
function pushWpContentDeletion(checklist, allSignals, sandboxName, { step, signalId, label }) {
  const signal = allSignals.find(s => s.id === signalId);
  if (!signal || !Array.isArray(signal.evidence) || signal.evidence.length === 0) return;

  const paths = signal.evidence
    .map(e => String(e).split(' ')[0])
    .filter(f => f && f.startsWith('wp-content/'));
  if (paths.length === 0) return;

  checklist.push({
    step,
    action: label(paths.length),
    executableCommand: null,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `$paths = ${phpJson(paths)}; $base = rtrim(WP_CONTENT_DIR, '/'); foreach ($paths as $rel) { $full = realpath(ABSPATH . $rel); if ($full === false || strpos($full, $base . '/') !== 0) continue; @unlink($full); } $remaining = array_values(array_filter($paths, fn($rel) => file_exists(ABSPATH . $rel))); echo json_encode($remaining);`,
    },
    expectedEmpty: true,
  });
}

function buildRemediationChecklist(install, allSignals, sandboxName, options = {}) {
  // Protected admin accounts must be pinned to a value that comes from OUTSIDE the
  // scanned site — the WPE portal account owner / agent config — never from the
  // site's own wp_options (admin_email is attacker-writable once a site is
  // compromised, so trusting it lets an attacker mark their own account
  // un-disableable). Resolved on the JS side and injected as a literal; the PHP
  // never reads it from the database.
  const protectedEmails = Array.isArray(options.protectedEmails)
    ? options.protectedEmails.filter(e => typeof e === 'string' && e.includes('@')).map(e => e.toLowerCase())
    : [];
  const protectedJson = JSON.stringify(protectedEmails);
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
  // > 95 → DISABLE LOGIN (reversible) | 50-95 → demote to subscriber + REVIEW | < 50 → flag
  // Does NOT delete: deletion is irreversible and destroys the forensic record. A high-scoring
  // account is locked across every auth path (password, role, session, app passwords) but left
  // in place for human review. Every action is reversible before the push.
  if (allSignals.some(s => ['REL-03', 'ABS-03', 'LLM-USER-01', 'ABS-01', 'ABS-02'].includes(s.id))) {
    checklist.push({
      step: 2,
      action: 'Disable login on attacker-scored admin accounts (reversible)',
      executableCommand: null,
      requiresApproval: true,
      toolName: 'wp_eval',
      toolArgs: {
        site: sandboxName,
        code: `global $wpdb; /* prefixed meta_key — the literal 'wp_capabilities' finds nobody on a randomised prefix, which silently made this remediation step a no-op that still reported success */ $capKey = $wpdb->prefix . 'capabilities'; $admins = $wpdb->get_results($wpdb->prepare("SELECT u.ID, u.user_login, u.user_email, u.user_registered FROM {$wpdb->users} u JOIN {$wpdb->usermeta} m ON u.ID = m.user_id WHERE m.meta_key = %s AND m.meta_value LIKE '%administrator%'", $capKey), ARRAY_A); $scoreAdmin = function($username, $email, $registered, $attackTimestamp) { $score = 0; if (preg_match('/^[a-z]{6,10}$/', $username) && !preg_match('/^(admin|backup|system|editor|author|manager)/', $username)) $score += 60; if (preg_match('/^admin_[A-Z0-9]{4,}$/', $username)) $score += 60; if (!$email || substr($email, -12) === '@example.com') $score += 35; if (preg_match('/adminb[ao]ck|adminsyst|adminbak|wp_adm/', strtolower($username))) $score += 20; if ($registered && $attackTimestamp) { $diffMin = abs(strtotime($registered) - strtotime($attackTimestamp)) / 60; if ($diffMin <= 10) $score += 30; } return $score; }; $attackTimestamp = null; foreach ($admins as $u) { $ps = 0; if (preg_match('/^[a-z]{6,10}$/', $u['user_login']) && !preg_match('/^(admin|backup|system|editor|author|manager)/', $u['user_login'])) $ps += 60; if (preg_match('/^admin_[A-Z0-9]{4,}$/', $u['user_login'])) $ps += 60; if (!$u['user_email'] || substr($u['user_email'], -12) === '@example.com') $ps += 35; if (preg_match('/adminb[ao]ck|adminsyst|adminbak|wp_adm/', strtolower($u['user_login']))) $ps += 20; if ($ps > 80) { $attackTimestamp = $u['user_registered']; break; } } $loginDisabled = []; $demoted = []; $appKeysDeleted = []; $flagged = []; $protected = array_map('strtolower', ${protectedJson}); /* allowlist injected from agent config — NOT read from the scanned site's DB */ foreach ($admins as $u) { $score = $scoreAdmin($u['user_login'], $u['user_email'], $u['user_registered'], $attackTimestamp); if (in_array(strtolower((string) $u['user_email']), $protected, true) || $score < 30) continue; if ($score >= 50) { $wpdb->delete($wpdb->usermeta, ['user_id' => $u['ID'], 'meta_key' => '_application_passwords']); $appKeysDeleted[] = $u['user_login']; } if ($score > 95) { wp_set_password(wp_generate_password(64, true, true), $u['ID']); $wpuser = new WP_User($u['ID']); $wpuser->set_role(''); delete_user_meta($u['ID'], 'session_tokens'); $loginDisabled[] = ['username' => $u['user_login'], 'score' => $score, 'note' => 'LOGIN DISABLED — reversible; approve before push']; } elseif ($score >= 50) { wp_update_user(['ID' => $u['ID'], 'role' => 'subscriber']); delete_user_meta($u['ID'], 'session_tokens'); $demoted[] = ['username' => $u['user_login'], 'score' => $score, 'note' => 'REVIEW REQUIRED']; } else { $flagged[] = ['username' => $u['user_login'], 'score' => $score]; } } echo json_encode(['login_disabled' => $loginDisabled, 'demoted' => $demoted, 'app_keys_deleted' => $appKeysDeleted, 'flagged' => $flagged]);`,
      },
      expectedEmpty: false,
    });
  }

  // Step 3: Remove all attacker plugins (hardcoded list + signals-derived slugs)
  // Sanitize signal-derived slugs to [a-z0-9-] — valid plugin slugs never contain
  // other characters, and anything that does is attacker-controlled data that
  // must not reach a filesystem path operation unsanitized.
  const VALID_SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  const signalSlugs = allSignals
    .filter(s => ['ABS-04', 'ABS-05', 'REL-01'].includes(s.id))
    .flatMap(s => {
      const m = s.title.match(/plugin[^:]*:\s*(.+)/i);
      return m ? m[1].split(',').map(p => p.trim()).filter(p => VALID_SLUG_RE.test(p)) : [];
    });
  const allSlugs = [...new Set([...ATTACKER_PLUGIN_SLUGS, ...signalSlugs])];
  const slugsPhp = phpJson(allSlugs);

  checklist.push({
    step: 3,
    action: 'Remove attacker plugins',
    executableCommand: `wp plugin delete ${allSlugs.join(' ')}`,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      code: `$slugs = ${slugsPhp}; foreach($slugs as $slug) { $dir = WP_PLUGIN_DIR . '/' . $slug; if (is_dir($dir)) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach($it as $f) { $f->isDir() ? @rmdir($f->getRealPath()) : @unlink($f->getRealPath()); } @rmdir($dir); } } $remaining = array_values(array_filter($slugs, function($s) { return is_dir(WP_PLUGIN_DIR . '/' . $s); })); echo json_encode($remaining);`,
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

  // Step 4b: Remove PHP files from uploads/ — only if FS-04 fired.
  // Step 4 above only *verifies* uploads are clean; without this, a real FS-04
  // hit would fail verification forever with nothing ever deleting the files.
  if (allSignals.some(s => s.id === 'FS-04')) {
    checklist.push({
      step: '4b',
      action: 'Remove PHP files from uploads/',
      executableCommand: 'find wp-content/uploads -name "*.php" -delete',
      toolName: 'wp_eval',
      toolArgs: {
        site: sandboxName, skip_plugins: true, skip_themes: true,
        code: `$d = wp_upload_dir()['basedir']; $removed = []; if (is_dir($d)) { foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)) as $f) { if ($f->getExtension() === 'php') { $p = $f->getPathname(); if (@unlink($p)) $removed[] = $p; } } } $remaining = []; if (is_dir($d)) { foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)) as $f) { if ($f->getExtension() === 'php') $remaining[] = $f->getPathname(); } } echo json_encode($remaining);`,
      },
      expectedEmpty: true,
    });
  }

  // Step 5f: Neutralize malicious .htaccess rules — only if FS-05 fired.
  // Rewrites each flagged .htaccess to strip PHP-execution and external-redirect
  // rules. Conservative: only removes lines matching the malicious patterns,
  // leaving legitimate rules intact.
  const fs05Signal = allSignals.find(s => s.id === 'FS-05');
  if (fs05Signal && fs05Signal.evidence && fs05Signal.evidence.length > 0) {
    const htaccessPaths = fs05Signal.evidence
      .map(e => e.split(':')[0].trim())
      .filter(p => p && p.endsWith('.htaccess'));
    if (htaccessPaths.length > 0) {
      const htaccessPhp = phpJson(htaccessPaths);
      checklist.push({
        step: '5f',
        action: `Neutralize malicious .htaccess rules: ${htaccessPaths.length} file(s)`,
        executableCommand: null,
        toolName: 'wp_eval',
        toolArgs: {
          site: sandboxName, skip_plugins: true, skip_themes: true,
          code: `$paths = ${htaccessPhp}; $host = $_SERVER['HTTP_HOST'] ?? 'localhost'; $badLine = ['/auto_prepend_file/i','/auto_append_file/i','/AddType\\\\s+application\\\\/x-httpd-php/i','/SetHandler\\\\s+application\\\\/x-httpd-php/i','/RewriteRule.*https?:\\\\/\\\\//i']; $still = []; foreach ($paths as $rel) { $full = ABSPATH . ltrim($rel, '/'); if (!file_exists($full)) continue; $lines = explode(\"\\n\", @file_get_contents($full)); $kept = []; foreach ($lines as $ln) { $bad = false; foreach ($badLine as $p) { if (preg_match($p, $ln)) { $bad = true; break; } } if (!$bad) $kept[] = $ln; } @file_put_contents($full, implode(\"\\n\", $kept)); $after = @file_get_contents($full); foreach ($badLine as $p) { if (preg_match($p, $after)) { $still[] = $rel; break; } } } echo json_encode(array_values(array_unique($still)));`,
        },
        expectedEmpty: true,
      });
    }
  }

  // Step 5g: Clear code-bearing autoloaded options — only if DB-02 fired.
  // DB-02 flags autoloaded options containing eval/exec/script that run on every
  // page load. Emptying the option value neutralizes the payload; the option row
  // is preserved so plugins expecting it don't fatal.
  const db02Signal = allSignals.find(s => s.id === 'DB-02');
  if (db02Signal && db02Signal.evidence && db02Signal.evidence.length > 0) {
    const optionNames = db02Signal.evidence
      .map(e => e.split(':')[0].trim())
      .filter(Boolean);
    if (optionNames.length > 0) {
      const namesPhp = phpJson(optionNames);
      checklist.push({
        step: '5g',
        action: `Clear malicious autoloaded option(s): ${optionNames.join(', ')}`,
        executableCommand: null,
        toolName: 'wp_eval',
        toolArgs: {
          site: sandboxName,
          code: `global $wpdb; $names = ${namesPhp}; $patterns = ['/eval\\\\s*\\\\(/i','/base64_decode/i','/<script/i','/exec\\\\s*\\\\(/i','/system\\\\s*\\\\(/i']; $still = []; foreach ($names as $n) { $wpdb->update($wpdb->options, ['option_value' => ''], ['option_name' => $n]); $v = $wpdb->get_var($wpdb->prepare(\"SELECT option_value FROM {$wpdb->options} WHERE option_name = %s\", $n)); foreach ($patterns as $p) { if ($v !== null && preg_match($p, $v)) { $still[] = $n; break; } } } wp_cache_flush(); echo json_encode(array_values(array_unique($still)));`,
        },
        expectedEmpty: true,
      });
    }
  }

  // Step 5a: Restore tampered core files — download fresh from wordpress.org SVN
  // and replace each failing file, then re-verify checksums.
  if (allSignals.some(s => s.id === 'CHK-01')) {
    checklist.push({
      step: '5a',
      action: 'Restore tampered WordPress core files',
      executableCommand: 'wp core download --skip-content --force',
      toolName: 'wp_eval',
      toolArgs: {
        site: sandboxName, skip_plugins: true, skip_themes: true,
        code: `
          global $wp_version;
          $locale = get_locale();
          $url = "https://api.wordpress.org/core/checksums/1.0/?version={$wp_version}&locale={$locale}";
          $response = wp_remote_get($url, ['timeout' => 20]);
          if (is_wp_error($response)) { echo json_encode(['still_failing' => [], 'error' => 'Could not fetch checksums']); exit; }
          $data = json_decode(wp_remote_retrieve_body($response), true);
          $checksums = $data['checksums'] ?? [];
          // Same trap as CHK-01, and more dangerous here: this is the step that RESTORES core.
          // api.wordpress.org answers HTTP 200 with {"checksums":false} for any unpublished
          // version, `?? []` does not rescue false, foreach runs zero times, $restored and
          // $still_failing both come back empty — and an empty still_failing is how this step
          // reports success. It would claim to have cleaned core without reading one file.
          if (!is_array($checksums) || count($checksums) === 0) {
            echo json_encode(['still_failing' => [],
                              'error' => "No checksum manifest published for version {$wp_version} — core could NOT be restored or verified"]);
            exit;
          }
          $abspath = ABSPATH;

          // Pass 1: find tampered files and download fresh copies from SVN
          $restored = []; $restore_failed = [];
          foreach ($checksums as $file => $expected_md5) {
            if (strpos($file, 'wp-content/') === 0) continue;
            $full_path = $abspath . $file;
            if (!file_exists($full_path)) continue;
            if (md5_file($full_path) === $expected_md5) continue;
            // File is tampered — fetch fresh from wordpress.org SVN
            $svn_url = "https://core.svn.wordpress.org/tags/{$wp_version}/{$file}";
            $fresh = wp_remote_get($svn_url, ['timeout' => 15]);
            if (is_wp_error($fresh) || wp_remote_retrieve_response_code($fresh) !== 200) {
              $restore_failed[] = $file;
              continue;
            }
            $content = wp_remote_retrieve_body($fresh);
            if (@file_put_contents($full_path, $content) !== false) {
              $restored[] = $file;
            } else {
              $restore_failed[] = $file;
            }
          }

          // Pass 2: verify — any file still failing after restore is a hard failure
          $still_failing = [];
          foreach ($checksums as $file => $expected_md5) {
            if (strpos($file, 'wp-content/') === 0) continue;
            $full_path = $abspath . $file;
            if (!file_exists($full_path)) continue;
            if (md5_file($full_path) !== $expected_md5) {
              $still_failing[] = $file;
            }
          }
          echo json_encode(['restored' => $restored, 'restore_failed' => $restore_failed, 'still_failing' => $still_failing]);
        `,
      },
      expectedEmpty: false,
      verifyKey: 'still_failing',
    });
  }

  // Step 5b: Remove web root PHP files — only if FS-03 fired
  const fs03Signal = allSignals.find(s => s.id === 'FS-03');
  if (fs03Signal && fs03Signal.evidence && fs03Signal.evidence.length > 0) {
    const rootPhpFiles = fs03Signal.evidence
      .map(e => e.split(' ')[0])
      .filter(f => f && f.endsWith('.php') && !f.includes('/'));
    if (rootPhpFiles.length > 0) {
      const rootPhpFilesPhp = phpJson(rootPhpFiles);
      checklist.push({
        step: '5b',
        action: `Remove suspicious web root PHP files: ${rootPhpFiles.join(', ')}`,
        executableCommand: `rm ${rootPhpFiles.map(f => `${f}`).join(' ')}`,
        toolName: 'wp_eval',
        toolArgs: {
          site: sandboxName, skip_plugins: true, skip_themes: true,
          code: `$files = ${rootPhpFilesPhp}; $abspath = rtrim(ABSPATH, '/'); $removed = []; $failed = []; foreach ($files as $f) { $path = $abspath . '/' . basename($f); $real = realpath($path); if ($real === false || strpos($real, $abspath . '/') !== 0) continue; if (file_exists($real)) { @unlink($real) ? $removed[] = $f : $failed[] = $f; } } $remaining = array_values(array_filter($files, fn($f) => file_exists($abspath . '/' . basename($f)))); echo json_encode($remaining);`,
        },
        expectedEmpty: true,
      });
    }
  }

  // Steps 5c and 5e: delete evidence-listed files under wp-content.
  // These were two copies of byte-identical PHP differing only in the input array and the
  // label. One builder now serves both, so a fix to the realpath containment check cannot land
  // in one and miss the other.
  pushWpContentDeletion(checklist, allSignals, sandboxName, {
    step: '5c', signalId: 'ABS-09',
    label: (n) => `Remove injected files in plugins: ${n} file(s)`,
  });

  // Step 5d: Delete spam posts — only if DB-01 fired
  const db01Signal = allSignals.find(s => s.id === 'DB-01');
  if (db01Signal && db01Signal.evidence && db01Signal.evidence.length > 0) {
    const spamIds = db01Signal.evidence
      .map(e => { const m = e.match(/ID:(\d+)/); return m ? m[1] : null; })
      .filter(Boolean);
    if (spamIds.length > 0) {
      const idsJson = JSON.stringify(spamIds.map(Number));
      checklist.push({
        step: '5d',
        action: `Delete ${spamIds.length} spam post(s)`,
        executableCommand: `wp post delete ${spamIds.join(' ')} --force`,
        toolName: 'wp_eval',
        toolArgs: {
          site: sandboxName,
          code: `$ids = ${idsJson}; foreach ($ids as $id) { wp_delete_post($id, true); } $remaining = array_values(array_filter($ids, fn($id) => get_post($id) !== null)); echo json_encode($remaining);`,
        },
        expectedEmpty: true,
      });
    }
  }

  pushWpContentDeletion(checklist, allSignals, sandboxName, {
    step: '5e', signalId: 'FS-06',
    label: (n) => `Remove ${n} ELF binaries from wp-content`,
  });

  // Step 6: Shuffle authentication salts
  //
  // This had no verification mode (expectedEmpty: false, no verifyKey/verifyContains), so
  // executeChecklist's bare `else` branch made it unconditional: stepPassed = true no matter
  // what shell_exec returned. Live on theawfulpm-test, PHP itself failed to load ("Failed
  // loading .../php-8.2.29") and the step still reported "✅ ... verified" with the failure
  // text sitting in its own detail. wp config shuffle-salts's own success text is not a stable
  // string to match against across WP-CLI versions, so verify the one fact that actually
  // matters — ABS-06's placeholder salts are gone from wp-config.php — the same source ABS-06
  // itself reads.
  checklist.push({
    step: 6,
    action: 'Shuffle authentication salts',
    executableCommand: 'wp config shuffle-salts',
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      code: `
        $output = shell_exec('wp config shuffle-salts 2>&1');
        clearstatcache();
        $after = @file_get_contents(ABSPATH . 'wp-config.php');
        $stillDefault = $after === false || strpos($after, 'put your unique phrase here') !== false;
        echo $stillDefault
          ? ('SALTS_SHUFFLE_FAILED: ' . trim(substr((string) $output, 0, 300)))
          : 'SALTS_SHUFFLE_OK';
      `,
    },
    verifyContains: 'SALTS_SHUFFLE_OK',
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
  // Combines two checks: unexpected mu-plugin files (FS-01) + obfuscation patterns (FS-02).
  // FS-02 scans plugins/, mu-plugins/, AND themes/ — Step 8 must cover all three or the
  // coverage claim is unsound (e.g. eval(base64_decode()) in themes/functions.php survives).
  checklist.push({
    step: 8,
    action: 'Final re-scan (mu-plugins and obfuscation)',
    executableCommand: null,
    toolName: 'wp_eval',
    toolArgs: {
      site: sandboxName,
      skip_plugins: true,
      skip_themes: true,
      code: `
        $remaining = [];
        // FS-01 check: unexpected files in mu-plugins
        $mu = glob(WPMU_PLUGIN_DIR . '/*.php') ?: [];
        $known = ${knownListJson};
        foreach ($mu as $f) {
          if (!in_array(basename($f), $known)) $remaining[] = 'mu-plugin:' . basename($f);
        }
        // FS-02 check: obfuscation patterns across plugins/, mu-plugins/, themes/.
        // Synced to the retuned set in filesystem.ts's OBFUSCATION_PATTERNS — this was a SEPARATE,
        // unsynced copy that still carried assert($ and create_function(, the two patterns
        // measured at 236 and 5 hits with ZERO real catches on a clean fleet (both target PHP
        // constructs removed in PHP 8, so neither can execute on any target this scanner runs
        // against). Live consequence: a commented-out create_function() call in a legitimate
        // plugin (economic-market-news) blocked this exact step's push verdict.
        $dirs = [WP_CONTENT_DIR . '/plugins', WP_CONTENT_DIR . '/mu-plugins', WP_CONTENT_DIR . '/themes'];
        $patterns = [
          '/eval\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*gzinflate\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*gzuncompress\\s*\\(\\s*base64_decode/',
          '/eval\\s*\\(\\s*str_rot13/',
          '/base64_decode\\s*\\(\\s*(base64_decode|gzinflate|gzuncompress|str_rot13|strrev|rawurldecode)\\s*\\(/',
          '/(eval|assert|preg_replace|create_function|call_user_func|system|exec|passthru|shell_exec)\\s*\\([^;]{0,80}base64_decode/',
          '/eval\\s*\\(\\s*\\$/',
        ];
        foreach ($dirs as $dir) {
          if (!is_dir($dir)) continue;
          foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->getExtension() !== 'php' || $file->getSize() > 5 * 1024 * 1024) continue;
            $content = @file_get_contents($file->getPathname());
            if ($content === false) continue;
            foreach ($patterns as $p) {
              if (@preg_match($p, $content)) {
                $remaining[] = 'obf:' . str_replace(ABSPATH, '', $file->getPathname());
                break;
              }
            }
          }
        }
        echo json_encode(array_values($remaining));
      `,
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

      // A step that could not run is not a step that succeeded. Every verification below infers
      // success from *absence* — an empty array, a missing filename — so a step which bailed out
      // before doing any work produces exactly the same evidence as one that finished cleanly.
      // Step 5a is the live example: given a WordPress version wordpress.org publishes no
      // manifest for, it restores nothing, reports `still_failing: []`, and scores ✅ for having
      // cleaned core files it never read. An explicit `error` in the payload overrides every
      // verification mode and fails the step.
      let payloadError = null;
      try {
        const p = JSON.parse(resultStr);
        if (p && typeof p === 'object' && p.error) payloadError = String(p.error);
      } catch { /* not JSON — the modes below handle it */ }

      if (payloadError) {
        stepPassed = false;
        detail = `could not run: ${payloadError.slice(0, 150)}`;
      } else if (item.verifyKey) {
        // verifyKey: parse JSON and check that result[verifyKey] is an empty array
        let parsed;
        try { parsed = JSON.parse(resultStr); } catch { parsed = {}; }
        const arr = parsed[item.verifyKey] ?? [];
        stepPassed = Array.isArray(arr) && arr.length === 0;
        detail = stepPassed ? `${item.verifyKey}: none remaining` : `${item.verifyKey}: ${JSON.stringify(arr).slice(0, 150)}`;
      } else if (item.verifyContains) {
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
  // Group signals by category for structured report sections
  const groupBy = (arr, fn) => arr.reduce((acc, x) => { const k = fn(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
  const byCategory = groupBy(allSignals, s => s.id.startsWith('DB-') ? 'database' :
                                             s.id.startsWith('CHK-') ? 'integrity' :
                                             s.id.startsWith('FS-') ? 'filesystem' :
                                             s.id.startsWith('TC-') ? 'temporal' : 'plugins_users');

  // A signal's evidence is either a plain string array, or — for the four LOG-* signals once
  // runLogChecks attaches real log corroboration — an object shaped
  // { sampleLines, totalMatched, truncated, window, filter }. Reproduced live: rendering a
  // NitroPack Production run (real attack traffic, so LOG-AUTH/LOG-PROBE/LOG-ENUM/LOG-DIST all
  // got the object form attached) crashed with "(s.evidence || []).map is not a function" —
  // truthy objects skip the `|| []` fallback and have no .map. The crash happened deep inside an
  // agent run with no top-level catch wired to the per-run log file, so it looked identical to a
  // silent hang: the process was genuinely idle (confirmed via a live CDP inspector attach — clean
  // Debugger.pause into processTimers, zero active libuv requests) while agent_runs.status had
  // already recorded 'error' — the crash just never reached the log a human was watching.
  const evidenceLines = (s) => Array.isArray(s.evidence) ? s.evidence
    : (s.evidence && Array.isArray(s.evidence.sampleLines)) ? s.evidence.sampleLines
    : [];

  const renderCategory = (title, signals) => {
    if (!signals || signals.length === 0) return '';
    const lines = signals.map(s => {
      const sev = (s.severity || 'unknown').toUpperCase();
      const evidence = evidenceLines(s).map(e => `  - ${e}`).join('\n');
      return evidence
        ? `- [${sev}] **${s.id}:** ${s.title}\n${evidence}`
        : `- [${sev}] **${s.id}:** ${s.title}`;
    }).join('\n');
    return `### ${title}\n${lines}`;
  };

  const findingsBody = [
    renderCategory('Plugin / User Anomalies', byCategory.plugins_users),
    renderCategory('Filesystem Findings', byCategory.filesystem),
    renderCategory('Temporal Cluster', byCategory.temporal),
    renderCategory('Database Findings', byCategory.database),
    renderCategory('Core / Plugin Integrity', byCategory.integrity),
  ].filter(Boolean).join('\n\n');

  const blindSpots = [
    allSignals.some(s => s.id === 'ABS-08')
      ? '- **File timestamps are unreliable as forensic evidence**: anti-forensics timestamp manipulation was detected (ABS-08) — temporal cluster analysis may be compromised'
      : null,
    '- **Runtime-assembled payloads**: code that fetches and assembles its payload at request time leaves no local trace',
    '- **Time-triggered or IP-conditional code**: only fires under specific conditions invisible to static analysis',
    '- **Upstream compromised plugins**: if a plugin was backdoored before installation, its checksum matches the backdoored version',
    '- **Image EXIF data**: not scanned for embedded PHP',
    '- **Premium / non-wordpress.org plugins**: cannot verify checksums',
    '- **Network-fetched payloads**: malware that downloads itself at runtime',
    allSignals.some(s => s.id === 'DB-02') ? null : '- **Full wp_options table**: only autoloaded options were scanned',
  ].filter(Boolean).join('\n');

  const criticalCount = allSignals.filter(s => s.severity === 'critical').length;
  const highCount     = allSignals.filter(s => s.severity === 'high').length;

  const header = [
    '# Security Remediation Report',
    `**Site:** ${install.name}  `,
    `**Date:** ${dateStr}T${now.toISOString().slice(11, 16)}  `,
    `**Sandbox:** ${sandboxName}  `,
    `**Signals:** ${allSignals.length} total — ${criticalCount} critical, ${highCount} high`,
    '',
    '## What the Sentinel Found',
    '',
    findingsBody || '(no signals detected)',
    '',
    '## Synthesis',
    synthesis || '(no synthesis)',
    '',
    '## Coverage Gaps (Blind Spots)',
    blindSpots,
    '',
    '## Remediation Checklist',
    '',
  ].join('\n');

  try { fs.writeFileSync(reportPath, header); } catch (err) {
    log.warn(`[Tier 3] Could not write report file: ${err.message}`);
  }

  // Build and execute the checklist
  // protectedEmails should be populated from the WPE portal account owner / agent
  // config on the `install` object — sourced outside the scanned site. Falls back
  // to an empty list (protect nothing by email; the score threshold + the human
  // approval gate on this step still apply).
  const checklist = buildRemediationChecklist(install, allSignals, sandboxName, {
    protectedEmails: Array.isArray(install.protectedEmails) ? install.protectedEmails : [],
  });
  const results   = await executeChecklist(checklist, install, sandboxName, tools, log, reportPath);

  // Verdict — BLOCKED if any step failed OR if any critical signal is not
  // genuinely remediated. Coverage is DERIVED, not hand-maintained:
  // a signal is covered only if its mapped step (a) was actually built into this
  // checklist and (b) passed verification. This prevents the verdict from ever
  // reporting READY-TO-PUSH while a critical finding sits un-remediated.
  const failCount = results.filter(r => !r.passed).length;

  // Which step numbers were built, and which of those passed.
  const passedSteps = new Set(
    results.filter(r => r.passed).map(r => r.step)
  );

  const uncoveredCritical = allSignals.filter(s => {
    if (s.severity !== 'critical') return false;
    const step = SIGNAL_REMEDIATION_STEP[s.id];
    if (step === undefined) return true;        // no remediation step exists → uncovered
    return !passedSteps.has(step);              // step exists but didn't pass → uncovered
  });

  const isBlocked = failCount > 0 || uncoveredCritical.length > 0;
  const verdictStr = isBlocked
    ? `**NOT SAFE TO PUSH** — ${failCount} step(s) failed${uncoveredCritical.length > 0 ? `, ${uncoveredCritical.length} critical finding(s) not remediated (${uncoveredCritical.map(s => s.id).join(', ')})` : ''}.`
    : `**READY TO PUSH** — all ${results.length} steps passed verification.`;

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

  // A plan is safe ONLY when no step failed AND every critical signal is covered
  // by a step that passed. Previously this used only step-pass state (allPassed),
  // so a site with an un-remediated critical could return verdict:'ready'.
  const safeToPush = !isBlocked;

  log.action({
    label: safeToPush
      ? `Remediation complete — sandbox ready for push: ${sandboxName}`
      : `Remediation complete — review required before push (${uncoveredCritical.length > 0 ? uncoveredCritical.map(s => s.id).join(', ') + ' need review' : `${failCount} step(s) failed`})`,
    site: install.name,
    result: safeToPush ? 'ok' : 'failed',
  });

  // Note: actual local_wpe_push requires human confirmation — never auto-pushed
  return {
    site: install.name,
    sandbox: sandboxName,
    verified: safeToPush,
    verdict: safeToPush ? 'ready' : 'blocked',
    uncoveredCritical: uncoveredCritical.map(s => s.id),
    summary: synthesis,
    steps,
    reportPath,
  };
}
