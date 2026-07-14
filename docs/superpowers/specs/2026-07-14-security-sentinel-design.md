# Security Sentinel Agent — Design Spec

**Date:** 2026-07-14
**Status:** Draft for review
**Exemplar:** `theawfulpmtest` (WPE production, confirmed compromised state)

---

## 1. Problem

A WP Engine production site was compromised on June 17, 2026. The attacker enumerated the `admin` username via the WordPress REST API, brute-forced the password over XML-RPC, installed file manager plugins to reach the filesystem, deployed a PHP webshell in `mu-plugins/` (loads on every request, cannot be deactivated via WP Admin), and created four hidden administrator accounts via a fabricated backdoor plugin (`wp-compat`). The compromise went undetected for **26 days** — discovered only because a PHP 8.4 incompatibility caused an HTTP 500.

Every individual signal was detectable. Their combination was unambiguous. Nothing was watching.

This is not an exotic attack. Most compromised WordPress sites use the same three-door entry: enumerate usernames via REST API, brute-force via XML-RPC, inject code via the built-in theme/plugin editor. These doors ship open on every default WordPress install. At scale — forty client sites, two hundred installs — something always gets skipped.

The security sentinel exists to close that gap: continuous fleet-wide surveillance that detects both pre-breach exposure and active compromise, and escalates autonomously through investigation to human-confirmed remediation.

---

## 2. Design Principles

**Never ask a compromised site to report on itself.**
The `wp-compat` backdoor hooked WordPress to hide admin users from WordPress-based views. Anything running inside the WordPress runtime can be suppressed. Tier 1 reads from the Nexus graph DB — no WordPress cooperation required. Tier 2 analysis runs on an isolated Local sandbox copy, not the live site.

**Graph-first. SSH is the exception.**
The Nexus metadata sync already SSHes to every WPE install every 4 hours and writes plugin/user/version data to `graph.db`. Tier 1 queries that graph — milliseconds, no SSH, no OAuth dependency. SSH fires only in Tier 2 when signals warrant deep investigation.

**Absolute checks first, baseline diffs second.**
On cold start (no prior baseline), absolute checks fire: `admin` username, admin count anomaly, known backdoor plugin slugs, suspicious email domains, open attack doors. Baseline-relative checks (new plugin appeared, new admin created) are suppressed on first run and enabled after the first clean scan is stored.

**Activity log as cold-start signal.**
If an activity log plugin is installed (Simple History, WP Activity Log, WP Umbrella), query it directly. "5 admin accounts created within 2 minutes" is unambiguous without any baseline.

**The LLM synthesizes; it does not collect.**
All data collection is deterministic tool calls. The LLM receives structured signal data and reasons about severity, cross-signal meaning, and remediation — it calls no tools in Phase 2.

**Always use an isolated sandbox. Never touch an existing local copy.**
When Tier 2 escalates, the agent creates a new local site (`sentinel-{installName}-{timestamp}`) and pulls into it. An existing linked local copy (e.g. `the-awful-pm`) is preserved untouched. Before any push, the agent reconciles the remediated sandbox against the existing local copy to surface content that would be lost.

---

## 3. Architecture

### Three tiers

```
Tier 1 — Detect       graph.db query, no SSH, runs every 15 min + on events
Tier 2 — Investigate  new Local sandbox, filesystem + content analysis, LLM synthesis
Tier 3 — Remediate    fix in sandbox, reconcile with existing local copy, human-confirmed push
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
    'local_create_site',           // Tier 2 — create isolated sandbox
    'local_wpe_pull',              // Tier 2 — pull compromised site into sandbox
    'local_wpe_push',              // Tier 3 — push remediated site to production
    'compare_sites',               // Tier 3 — reconcile sandbox vs existing local copy
    'wp_plugin_list',              // Tier 2 corroboration
    'wp_eval',                     // Tier 2 — filesystem/DB queries inside Local sandbox only
  ],
});
```

**Note on `wpe:sync.completed`:** requires a new event emit from the WPE metadata sync scheduler in `main/index.ts`. When the 4-hour sync cycle completes for an install, emit `{ namespace: 'wpe', type: 'sync.completed', payload: { installName, installId } }` to the agent event bus.

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

### Absolute checks — active compromise indicators (no baseline, fire on run one)

| ID | Check | Severity | Signal source |
|---|---|---|---|
| ABS-01 | `admin` username exists on any admin account | High | `fleet_sql` users |
| ABS-02 | Admin count > 3 on a site with < 100 posts | High | `fleet_sql` users + sites |
| ABS-03 | Admin account with `@example.com` email | Critical | `fleet_sql` users |
| ABS-04 | Known file manager slugs active: `fileorganizer`, `filester`, `file-manager-advanced`, `wp-file-manager`, `wp-filemanager` | High | `fleet_sql` plugins |
| ABS-05 | `wp-compat` slug present (known backdoor from the incident) | Critical | `fleet_sql` plugins |
| ABS-06 | Default auth salts (`put your unique phrase here`) in `settings_json` | High | `fleet_sql` sites |

### Absolute checks — pre-breach exposure (attack doors left open)

These don't indicate active compromise but enable the most common attack vectors. Flag on every production site.

| ID | Check | Severity | What it enables if open |
|---|---|---|---|
| EXP-01 | User enumeration enabled — REST API returns usernames unauthenticated (`/wp-json/wp/v2/users`) | High | Attacker gets username list without brute-forcing; turns N×M password attack into 1×M |
| EXP-02 | XML-RPC accessible — `xmlrpc.php` responds to unauthenticated requests | High | Enables credential stuffing with amplification (1 request = 1000 login attempts) |
| EXP-03 | Theme/plugin editor enabled — `DISALLOW_FILE_EDIT` not set | Medium | A compromised admin account can inject PHP from WP Admin without touching the filesystem |
| EXP-04 | WP version exposed — `readme.txt` publicly accessible or version in page headers | Low | Version-targeted exploits can self-select the right payload |
| EXP-05 | `WP_DEBUG = true` on production | Medium | Leaks file paths, DB queries, internal errors to HTTP response |
| EXP-06 | `wp-config.php` or `debug.log` publicly accessible (HTTP 200 without auth) | High | Credentials and internals exposed directly |

### LLM-assisted user audit (Phase 1.5)

When ABS-01 or ABS-02 fires, pass the full admin user list to the LLM for pattern analysis before deciding escalation tier. The LLM checks for:

- **Programmatically generated usernames:** `admin_[A-Z0-9]{6}` pattern, random lowercase strings (`oxhuhafz`)
- **Attacker persistence naming:** misspellings of system words (`adminbockup` = backup)
- **Suspicious email patterns:** placeholder emails (`@example.com`), no email set, disposable domains

If the LLM flags ≥1 username as synthetic/attacker-pattern, severity escalates High → Critical and Tier 2 triggers.

### Activity log as cold-start signal

If the site has Simple History, WP Activity Log, or WP Umbrella installed (detectable from `fleet_sql` plugins), query the log directly via SSH. Even without a baseline, the activity log can surface:

- Multiple admin accounts created within minutes of each other
- Plugin installs immediately followed by file manager activation
- Admin login from an unexpected IP preceding a plugin install

This bridges the cold-start gap for sites that have been logging activity before the sentinel was deployed.

### Relative checks (baseline-required — suppress on cold start)

| ID | Check | Severity | How detected |
|---|---|---|---|
| REL-01 | New plugin appeared since last scan | High | diff `plugins` hash vs `ctx.state` baseline |
| REL-02 | Previously-inactive plugin activated | High | diff active state vs baseline |
| REL-03 | New admin user created | Critical | diff user ID list vs baseline |
| REL-04 | Admin user count increased | Critical | diff count vs baseline |
| REL-05 | `wp-config.php` hash changed | High | diff hash vs baseline |

**Cold-start baseline:** after the first Tier 1 run with no Critical findings, store the current state as baseline. Mark it `unverified` until one full metadata sync cycle passes.

### Fleet correlation (cross-site, post-Tier-1)

- Same unknown plugin slug on ≥2 installs in same account → Critical (account-level compromise)
- New admin accounts with matching email domains across ≥2 installs → Critical
- File manager plugin appearing across ≥3 installs within 7 days → High
- EXP-01/EXP-02 open across entire account → High (systemic hardening gap)

---

## 5. Tier 2 — Investigation

### Escalation gate

Tier 2 triggers when any install has:
- ≥1 Critical signal, OR
- ≥2 High signals, OR
- LLM-assisted user audit flags ≥1 synthetic username

### Isolated sandbox (always new — never existing local copy)

```
1. local_create_site('sentinel-{installName}-{timestamp}')
2. local_wpe_pull(site: 'sentinel-...', remote_install_id: installId, include_database: true)
```

The agent never pulls into an existing linked local copy (`the-awful-pm`, etc.). That copy may represent a clean pre-breach state and must be preserved. The sandbox is disposable — delete after push or after user dismisses findings.

### Filesystem checks (Tier 2 only — run inside Local sandbox)

| ID | Check | Severity |
|---|---|---|
| FS-01 | PHP files present in `mu-plugins/` — unexpected; loads on every request, can't be deactivated | Critical |
| FS-02 | Obfuscation chains: `eval(base64_decode(...))`, `eval(gzinflate(base64_decode(...)))`, `eval(str_rot13(...))`, double `base64_decode` — execution chain only, NOT standalone `base64_decode` | Critical |
| FS-03 | Shell execution from user input: `shell_exec($_`, `system($_`, `passthru($_`, `exec($_` | Critical |
| FS-04 | PHP files in `wp-content/uploads/` | Critical |
| FS-05 | `wp core verify-checksums` failure | Critical |
| FS-06 | `.htaccess` contains unexpected redirects or PHP execution directives | High |
| FS-07 | mtime clustering: ≥5 files modified within same 5-minute window outside a known update window | High |
| FS-08 | `wp-config.php` code appended after the "stop editing" line | Critical |
| FS-09 | `wp_posts` injection: `<script>` tags in post content, SEO spam posts | High |
| FS-10 | Dangerous functions: `eval($var)`, `assert($var)`, `create_function()`, `preg_replace('/…/e')` | Medium |

### Admin count mismatch

Query MySQL directly on the sandbox copy (bypasses any WordPress runtime hooks):

```sql
SELECT COUNT(*) FROM wp_users u
JOIN wp_usermeta m ON u.ID = m.user_id
WHERE m.meta_key = 'wp_capabilities'
AND m.meta_value LIKE '%administrator%'
```

Compare against `wp_user_list` SSH count. Divergence = accounts hidden from WP Admin Users screen. This is how `wp-compat` evaded detection.

### LLM synthesis (Phase 2)

LLM receives all Tier 1 + Tier 2 signals, full admin user list, fleet correlation findings, site metadata (post count, environment, domain, activity log if available).

LLM produces:
- **Classification:** `active-compromise` | `high-risk` | `misconfiguration` | `false-positive`
- **Ranked findings** with specific remediation steps per finding
- **Escalation recommendation:** Tier 3 or monitor only
- **Gaps:** what wasn't checked that the signal combination suggests investigating

Synthesis logged in full alongside signal list — reasoning is auditable.

---

## 6. Tier 3 — Remediation

**Human-confirmed. The agent prepares and verifies; the user approves the push.**

### Step 1: Remediation in sandbox

Agent prepares and executes in the isolated sandbox:

1. Remove malicious files — prefer quarantine over delete: move to `wp-content/quarantine/{timestamp}/` with a manifest (enables one-click restore if false positive)
2. `wp plugin delete {malicious-slugs}` — remove backdoor and attacker-installed plugins
3. `wp user delete {id} --reassign={legitimate_admin_id}` — for each backdoor admin
4. `wp config shuffle-salts` — invalidate all active sessions
5. Apply hardening (close the doors that enabled entry):
   - Add `define('DISALLOW_FILE_EDIT', true)` to wp-config.php
   - Add `.htaccess` rules to block unauthenticated XML-RPC and user enumeration via REST API
   - Block direct access to `wp-config.php` and `debug.log`
6. Re-run Tier 1 + Tier 2 checks on sandbox — must pass clean before proceeding

### Step 2: Reconcile against existing local copy

Before pushing, check whether a local site already linked to this WPE install exists. If yes, run `compare_sites(sandbox, existingLocalSite)` and present the diff:

```
Content in the-awful-pm not in sandbox (would be lost if not merged):
  - Draft post: "My Next Post" (unpublished, created 2026-07-10)
  - Plugin settings: WooCommerce tax config

Content in sandbox not in the-awful-pm (legitimate production content):
  - 5 posts published since last local sync
  - 12 media uploads
```

User decides how to handle the diff before approving push. Agent does not resolve content conflicts automatically.

### Step 3: Push gate (human-confirmed)

```
local_wpe_push(sandbox, { include_database: true })
```

Requires explicit user confirmation. Uses the existing Nexus Tier 3 confirmation pattern. After push, the sandbox site is marked for deletion (user can keep it via a setting).

---

## 7. Delivery

| Severity | Delivery |
|---|---|
| Critical | Desktop notification + log entry + email (if configured) |
| High | Log entry + Nexus AI panel badge |
| Medium/Low | Log entry only |

Email is settings-driven opt-in. v1: log + notification. Email is a follow-on. The Nexus AI panel shows a "Security" section with fleet posture (count of sites with open doors, count with active findings) and a chronological finding log.

---

## 8. State Schema

Per install, stored in `ctx.state`:

```typescript
interface InstallBaseline {
  installId: string;
  capturedAt: number;            // timestamp of baseline creation
  syncedAt: number;              // ssh_last_sync_at at baseline time
  verified: boolean;             // false until one full sync cycle passes
  pluginListHash: string;        // hash of slug+version+active triples
  adminUserIds: number[];
  adminCount: number;
  wpConfigHash: string;
  coreChecksumsClean: boolean;
  hardeningState: {              // track which exposure checks pass
    userEnumerationBlocked: boolean;
    xmlRpcRestricted: boolean;
    fileEditDisabled: boolean;
  };
}
```

---

## 9. What v1 Excludes

- **Auto-remediation without confirmation** — agent prepares, human approves
- **`wp:plugin.activated` / `wp:user.created` on WPE production** — no WPE→Nexus webhook today; `wpe:sync.completed` is the WPE real-time trigger
- **HIBP / password strength checking** — privacy overhead, out of scope
- **WooCommerce card skimmer JS inspection** — Tier 2 v2 extension
- **The wordpress.org 404 check** — ACF Pro and NitroPack premium would false-positive; omitted
- **Cloaked redirect detection** — valid vector, out of scope for v1
- **Automatic content conflict resolution** — reconciliation is presented to user, not auto-merged

---

## 10. Demo Acceptance Test

> **26 days → 30 seconds. On the real breach. In our own fleet.**

Run against `theawfulpmtest` (confirmed: `wp-compat` active, `fileorganizer` + `filester` active, 5 admins including `admin`, `adminbockup`, `oxhuhafz`, user enumeration and XML-RPC open).

Passing criteria:
1. Tier 1 fleet sweep detects `theawfulpmtest` as Critical within one sweep interval — no baseline required
2. LLM-assisted user audit flags `adminbockup` and `oxhuhafz` as synthetic without prior baseline
3. EXP-01 and EXP-02 flag user enumeration and XML-RPC as open on the same site
4. Agent autonomously escalates to Tier 2: creates `sentinel-theawfulpmtest-{ts}`, pulls, runs filesystem analysis
5. FS-01 finds PHP file in `mu-plugins/`, FS-02 finds obfuscation chain
6. Admin count mismatch detects hidden accounts if `wp-compat` hook is still active
7. Phase 2 synthesis classifies `active-compromise` with ranked, specific remediation steps
8. Tier 3 prepares remediation plan including hardening (close EXP-01/EXP-02) as part of the fix
9. Clean sites short-circuit before LLM call — verify on ≥5 known-clean production installs
10. Fleet correlation surfaces `wp-compat` across `theawfulpmtest` + `theawfulproduc` as account-level pattern

---

## 11. Open Questions

1. **`wpe:sync.completed` event wiring** — which file emits it, what payload shape?
2. **Tier 2 pull cost gate** — ≥1 Critical fires a pull automatically; recommend adding a pull-size estimate check first for installs > 2GB
3. **Baseline cold-start on already-compromised fleet** — absolute and exposure checks catch the major indicators; known gap is novel malware with no matching slug
4. **Pre-hack backup as test fixture** — import the pre-June-17 backup of `theawfulproductmanager.com` as a local site; run sentinel against it to confirm clean baseline, then against `theawfulpmtest` to confirm detection
5. **Multiple local sites linked to same WPE install** — needs confirmation that Local supports this before the sandbox creation pattern can be relied upon
