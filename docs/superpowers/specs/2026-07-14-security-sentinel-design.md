# Security Sentinel Agent — Design Spec

**Date:** 2026-07-14
**Status:** Draft for review
**Exemplar:** `theawfulpmtest` (WPE production, confirmed compromised state)

---

## 1. Problem

A WP Engine production site was compromised on June 17, 2026. The attacker brute-forced the `admin` account, installed file manager plugins to reach the filesystem, deployed a PHP webshell in `mu-plugins/` (loads on every request, cannot be deactivated), and created four hidden administrator accounts via a fabricated backdoor plugin (`wp-compat`). The compromise went undetected for **26 days** — discovered only because a PHP 8.4 incompatibility caused an HTTP 500.

Every individual signal was detectable. Their combination was unambiguous. Nothing was watching.

The security sentinel exists to close that gap: continuous fleet-wide surveillance that detects both active compromise and pre-breach risk factors, and escalates autonomously through investigation to human-confirmed remediation.

---

## 2. Design Principles

**Never ask a compromised site to report on itself.**
The `wp-compat` backdoor hooked WordPress to hide admin users from WordPress-based views. Anything running inside the WordPress runtime can be suppressed. Tier 1 reads from the Nexus graph DB — no WordPress cooperation required. Tier 2 analysis runs on a Local sandbox copy, not the live site.

**Graph-first. SSH is the exception.**
The Nexus metadata sync already SSHes to every WPE install every 4 hours and writes plugin/user/version data to `graph.db`. Tier 1 queries that graph — milliseconds, no SSH, no OAuth dependency. SSH fires only in Tier 2 when signals warrant deep investigation.

**Absolute checks first, baseline diffs second.**
On cold start (no prior baseline), absolute checks fire: `admin` username, admin count anomaly, known backdoor plugin slugs, suspicious email domains. Baseline-relative checks (new plugin appeared, new admin created) are suppressed on first run and enabled after the first clean scan is stored.

**The LLM synthesizes; it does not collect.**
All data collection is deterministic tool calls. The LLM receives structured signal data and reasons about severity, cross-signal meaning, and remediation — it calls no tools in Phase 2.

---

## 3. Architecture

### Three tiers

```
Tier 1 — Detect       graph.db query, no SSH, runs every 15 min + on events
Tier 2 — Investigate  local_wpe_pull sandbox, filesystem + content analysis, LLM synthesis
Tier 3 — Remediate    fix in Local, human-confirmed push to production
```

### Agent definition (illustrative)

```typescript
export default defineAgent({
  name: 'security-sentinel',
  version: '1.0.0',
  triggers: [
    cron('*/15 * * * *'),          // WPE fleet sweep fallback
    on('wpe:sync.completed'),      // immediate check when fresh graph data arrives
    on('wp:plugin.activated'),     // local sites — real-time on plugin install
    on('wp:user.created'),         // local sites — real-time on new user
    on('local:site.started'),      // local sites — scan on boot
  ],
  tools: [
    'fleet_sql',                   // graph queries — primary Tier 1 data source
    'wpe_site_deep_refresh',       // populate graph for unsynced installs
    'wp_user_list',                // corroborating SSH read for admin mismatch check
    'local_wpe_pull',              // Tier 2 escalation — pull to Local sandbox
    'local_wpe_push',              // Tier 3 — push remediated site to production
    'wp_plugin_list',              // Tier 2 corroboration
    'wp_eval',                     // Tier 2 — filesystem/DB queries inside Local sandbox only
  ],
});
```

**Note on `wpe:sync.completed`:** requires a new event emit from the WPE metadata sync scheduler in `main/index.ts`. When the 4-hour sync cycle completes for an install, emit `{ namespace: 'wpe', type: 'sync.completed', payload: { installName, installId } }` to the agent event bus. This is the primary real-time trigger for WPE production.

---

## 4. Tier 1 — Detection

### Data sources

| Source | What it provides | Freshness |
|---|---|---|
| `fleet_sql` on `plugins` table | Plugin slugs, versions, active state per install | Updated by 4h metadata sync |
| `fleet_sql` on `users` table | Usernames, emails, roles, created_at per install | Updated by 4h metadata sync |
| `fleet_sql` on `sites` table | WP version, PHP version, post count, settings_json | Updated by 4h metadata sync |
| `wpe_site_deep_refresh` | On-demand SSH sync for unsynced installs | Called on first encounter |
| `ctx.state` (agent SQLite KV) | Per-install baseline snapshots for diff checks | Written after each clean scan |

### Unsynced install handling

Before running checks on any install, verify `ssh_last_sync_at IS NOT NULL`. If null, call `wpe_site_deep_refresh(installName)` to populate graph, then proceed. This ensures new installs are covered on first sentinel run.

### Absolute checks (no baseline — fire on run one)

| ID | Check | Severity | Signal source |
|---|---|---|---|
| ABS-01 | `admin` username exists on any admin account | High | `fleet_sql` users |
| ABS-02 | Admin count > 3 on a site with < 100 posts | High | `fleet_sql` users + sites |
| ABS-03 | Admin account with `@example.com` email | Critical | `fleet_sql` users |
| ABS-04 | Known file manager slugs active: `fileorganizer`, `filester`, `file-manager-advanced`, `wp-file-manager`, `wp-filemanager` | High | `fleet_sql` plugins |
| ABS-05 | `wp-compat` slug present (the incident backdoor plugin) | Critical | `fleet_sql` plugins |
| ABS-06 | Plugin slug not matching any known WP.org or known-premium pattern — single PHP file, no readme, suspicious name | High | `fleet_sql` plugins + LLM |
| ABS-07 | Default auth salts (`put your unique phrase here`) in `settings_json` | High | `fleet_sql` sites |
| ABS-08 | `WP_DEBUG = true` on a production environment | Medium | `fleet_sql` sites |
| ABS-09 | `DISALLOW_FILE_EDIT` not set on production | Medium | `fleet_sql` sites |
| ABS-10 | mtime clustering: ≥5 files modified within the same 5-minute window (outside a known WP update) | High | Tier 2 only (filesystem) |

### LLM-assisted user audit (Phase 1.5)

When ABS-01 or ABS-02 fires, pass the full admin user list to the LLM for pattern analysis before deciding escalation tier. The LLM checks for:

- **Programmatically generated usernames:** `admin_[A-Z0-9]{6}` pattern, random lowercase strings (`oxhuhafz`), obvious fake names
- **Attacker persistence naming:** misspellings of system words (`adminbockup` = backup, `adminsystem`, `wp_admin`)
- **Suspicious email patterns:** placeholder emails, disposable domains, no email set

This step runs locally (no tools, LLM-only reasoning) and upgrades severity: if the LLM flags ≥1 username as synthetic/attacker-pattern, the finding is escalated from High → Critical and Tier 2 is triggered.

### Relative checks (baseline-required — suppress on cold start)

| ID | Check | Severity | How detected |
|---|---|---|---|
| REL-01 | New plugin appeared since last scan | High | diff `plugins` hash vs `ctx.state` baseline |
| REL-02 | Previously-inactive plugin activated | High | diff active state vs baseline |
| REL-03 | New admin user created | Critical | diff user ID list vs baseline |
| REL-04 | Admin user count increased | Critical | diff count vs baseline |
| REL-05 | `wp-config.php` hash changed | High | diff hash vs baseline |

**Cold-start baseline:** after the first Tier 1 run with no Critical findings, store the current state as baseline. Mark it `unverified` until one full metadata sync cycle passes. Surface the `unverified` state in any findings that reference it.

### Fleet correlation (cross-site, post-Tier-1)

After sweeping all installs, query across the full results:

- Same unknown plugin slug on ≥2 installs in same account → Critical (account-level compromise)
- New admin accounts with matching email domains across ≥2 installs → Critical
- File manager plugin appearing across ≥3 installs within 7 days → High (contractor/shared-access pattern)

Fleet correlation runs after per-install checks complete and feeds into the same LLM synthesis step.

---

## 5. Tier 2 — Investigation

### Escalation gate

Tier 2 triggers when any install has:
- ≥1 Critical signal, OR
- ≥2 High signals, OR
- LLM-assisted user audit flags ≥1 synthetic username

### Sandbox pull

```
local_wpe_pull(installName, { include_database: true })
```

Pulls files + database into a new Local site. All subsequent analysis runs on this copy. Zero load on the live site. The copy is disposable — aggressive analysis is safe.

### Filesystem checks (Tier 2 only — run inside Local sandbox via `wp_eval`)

| ID | Check | Severity |
|---|---|---|
| FS-01 | PHP files present in `mu-plugins/` (unexpected — loads on every request, cannot be deactivated) | Critical |
| FS-02 | Obfuscation chains: `eval(base64_decode(...))`, `eval(gzinflate(base64_decode(...)))`, `eval(str_rot13(...))`, double `base64_decode` — only the execution chain, NOT standalone `base64_decode` | Critical |
| FS-03 | Shell execution from user input: `shell_exec($_`, `system($_`, `passthru($_`, `exec($_` | Critical |
| FS-04 | PHP files in `wp-content/uploads/` | Critical |
| FS-05 | `wp core verify-checksums` failure (modified core files) | Critical |
| FS-06 | `.htaccess` contains unexpected redirect rules or PHP execution directives | High |
| FS-07 | mtime clustering: burst of files modified within same minute outside a known update window | High |
| FS-08 | Dangerous functions: `eval($var)`, `assert($var)`, `create_function()`, `preg_replace('/…/e')` | Medium |
| FS-09 | `wp_posts` injection: `<script>` tags in post content, SEO spam posts | High |
| FS-10 | `wp-config.php` code appended after the "stop editing" line | Critical |

### Admin count mismatch (Tier 2 corroboration)

Query MySQL directly (via `wp_eval` on the Local copy, bypassing WordPress runtime):

```sql
SELECT COUNT(*) FROM wp_users u
JOIN wp_usermeta m ON u.ID = m.user_id
WHERE m.meta_key = 'wp_capabilities'
AND m.meta_value LIKE '%administrator%'
```

Compare against `wp_user_list` count from SSH. Divergence = accounts hidden from WordPress Users screen by a hook. This is how `wp-compat` evaded detection.

### LLM synthesis (Phase 2)

LLM receives:
- All Tier 1 signals with severity and detail
- All Tier 2 filesystem findings
- The full admin user list (for username pattern reasoning)
- Fleet correlation findings if any
- Site metadata: post count, environment, domain

LLM produces:
- **Classification:** `active-compromise` | `high-risk` | `misconfiguration` | `false-positive`
- **Ranked findings:** each signal with severity and specific remediation step
- **Escalation recommendation:** proceed to Tier 3 or monitor only
- **What to check next:** anything Phase 1/2 didn't cover that the signal combination suggests

The synthesis is logged in full alongside the signal list. The reasoning is auditable.

---

## 6. Tier 3 — Remediation

**Human-confirmed. The agent prepares; the user approves.**

### Remediation actions (prepared by agent, executed after confirmation)

For the incident scenario, the agent would prepare:

1. `wp plugin delete wp-compat` — remove backdoor plugin
2. `wp plugin delete fileorganizer filester file-manager-advanced` — remove file managers
3. `rm wp-content/mu-plugins/index.php` — remove webshell (via `wp_eval` or direct file delete)
4. `wp user delete {id} --reassign={legitimate_admin_id}` — for each backdoor admin
5. `wp config shuffle-salts` — invalidate all active sessions
6. Re-run Tier 1 + Tier 2 checks on Local copy — verify clean before push

### Push gate

Only after verification passes:

```
local_wpe_push(installName, { include_database: true })
```

This uses the path the customer already trusts (Nexus push flow). It is a Tier 3 destructive operation — requires explicit user confirmation via the existing Nexus confirmation pattern.

### Quarantine (alternative to delete)

For files, prefer quarantine over delete in v1: move to `wp-content/quarantine/{timestamp}/` with a manifest. Allows restore if a finding was a false positive. Offer one-click restore from the Nexus UI.

---

## 7. Delivery

**Findings must reach the user even when Local is closed.**

| Severity | Delivery |
|---|---|
| Critical | Desktop notification (Local if open) + log entry + email (if configured) |
| High | Log entry + Nexus AI panel badge |
| Medium/Low | Log entry only |

Email delivery is a settings-driven opt-in. v1 ships with log + notification; email is a follow-on. The Nexus AI panel shows a "Security" section with current fleet status and recent findings.

---

## 8. State Schema

Per install, stored in `ctx.state`:

```typescript
interface InstallBaseline {
  installId: string;
  installedAt: number;           // timestamp of baseline creation
  syncedAt: number;              // ssh_last_sync_at at baseline time
  verified: boolean;             // false until one full sync cycle passes
  pluginListHash: string;        // hash of slug+version+active triples
  adminUserIds: number[];        // list of admin user IDs
  adminCount: number;
  wpConfigHash: string;
  coreChecksumsClean: boolean;
}
```

---

## 9. What v1 Excludes

- **Auto-remediation without confirmation** — agent prepares, human approves
- **`wp:plugin.activated` / `wp:user.created` on WPE production** — structurally impossible today (no WPE→Nexus webhook); `wpe:sync.completed` is the WPE real-time trigger
- **HIBP / password strength checking** — privacy overhead, not needed
- **Cloaked redirect detection** — valid attack vector but out of scope for v1
- **WooCommerce card skimmer detection** — Tier 2 extension for v2
- **The wordpress.org 404 check** — ACF Pro and NitroPack premium would both fail it; demoted to low-confidence contributing signal, never fires standalone

---

## 10. Demo Acceptance Test

> **26 days → 30 seconds. On the real breach. In our own fleet.**

Run the sentinel against `theawfulpmtest` (confirmed compromised state: `wp-compat` active, `fileorganizer` + `filester` active, 5 admins including `admin`, `adminbockup`, `oxhuhafz`).

Passing criteria:
1. Tier 1 fleet sweep detects `theawfulpmtest` as Critical within one sweep interval
2. LLM-assisted user audit flags `adminbockup` and `oxhuhafz` as synthetic without a baseline
3. Agent autonomously escalates to Tier 2, pulls site to Local, runs filesystem analysis
4. FS-01 finds PHP file in `mu-plugins/`, FS-02 finds obfuscation chain — both Critical
5. Admin count mismatch check detects hidden accounts (if `wp-compat` is still hooking)
6. Phase 2 synthesis classifies as `active-compromise` with ranked, specific remediation steps
7. Clean sites short-circuit before LLM call — verify on ≥5 known-clean production installs
8. Fleet correlation: if `theawfulpmtest` and `theawfulproduc` are checked together, same `wp-compat` slug surfaces as cross-site pattern

---

## 11. Open Questions

1. **`wpe:sync.completed` event wiring** — which file emits it, what payload shape, does the agent filter to only installs with changed data?
2. **Tier 2 pull cost gate** — is ≥1 Critical sufficient to trigger a 4GB pull, or should the gate be ≥2 Critical? Recommend: ≥1 Critical with an estimated pull size check first.
3. **Baseline cold-start on an already-compromised fleet** — if the agent runs for the first time on a fleet that's been compromised for months, relative checks miss it. Absolute checks catch the major indicators, but this is a known coverage gap.
4. **Pre-hack backup as test fixture** — the pre-June-17 backup of `theawfulproductmanager.com` can be imported as a Local site to establish what "clean baseline" looks like for the demo. Import it and run the sentinel against it first to confirm clean, then against `theawfulpmtest` to confirm detection.
