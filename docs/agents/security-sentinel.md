# Nexus AI Security Sentinel — Reference Document

**Version:** 2.2  
**Branch:** `feat/sentinel-review-ui`  
**Status:** Active development — pending human security review before fleet production deployment  
**Last updated:** July 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture — Three Tiers](#2-architecture--three-tiers)
3. [Signal Catalog](#3-signal-catalog)
4. [Tier 2: Deep Investigation](#4-tier-2-deep-investigation)
5. [Specialist AI Agents](#5-specialist-ai-agents)
6. [Remediation Checklist](#6-remediation-checklist)
7. [Verdict Logic](#7-verdict-logic)
8. [Report Format](#8-report-format)
9. [Security Hardening — Fable Review Summary](#9-security-hardening--fable-review-summary)
10. [Isolation Guarantees](#10-isolation-guarantees)
11. [Known Limitations and Open Items](#11-known-limitations-and-open-items)
12. [UX Safeguards and Human Review Gates](#12-ux-safeguards-and-human-review-gates)
13. [Test Coverage](#13-test-coverage)
14. [File Inventory](#14-file-inventory)

---

## 1. Overview

The Security Sentinel is a three-tier security scanning agent embedded in the **Nexus AI** addon for Local by WP Engine. It answers a single operational question: *is this WordPress site safe to push to production?*

### Threat Model

A WordPress site has been compromised. The attacker has:

- Installed backdoor plugins with innocuous-looking names
- Injected code into WordPress core files (`wp-blog-header.php`, `index.php`)
- Hidden ELF binaries inside plugin subdirectories with filenames like `themeimgform`, `mediasize`, `fbratings`
- Manipulated file timestamps (`touch()`) to obscure the attack timeline
- Poisoned the database with casino spam across multiple posts and option values
- Created admin accounts with programmatically-generated credentials

The user is working with a local development copy — either a native Local site or a site pulled from WP Engine production — and wants to know if it is safe to deploy.

### What the Sentinel Does

1. **Tier 1 (seconds):** Queries the local graph database for known-bad patterns across the entire fleet without touching live sites.
2. **Tier 2 (minutes):** Clones the site into an isolated sandbox and runs filesystem, database, integrity, and deep content checks against the clone.
3. **Tier 3 (minutes):** Executes a signal-driven remediation checklist inside the sandbox, verifies each step, writes a structured forensic report, and surfaces the result for human review before any production push.

The live site is never modified during investigation. All destructive operations run in the sandbox. The user must explicitly approve before the sandbox state is pushed to production.

### Trigger Conditions

From `nexus.agent.yaml`:

| Trigger | Details |
|---------|---------|
| Cron | Daily at 03:00 (`0 3 * * *`) |
| `wp:plugin.activated` event | A plugin was activated on a local site |
| `wp:user.created` event | A user was created on a local site |

> The original `wpe:sync.completed` trigger and 15-minute cron were **removed
> deliberately** — they caused overlapping fleet sweeps (the 6.5 GB sandbox
> incident). The authoritative trigger list is `module.exports.triggers` in
> `agent.js`, with the rationale beside it.

### Escalation Criterion (Tier 1 → Tier 2)

≥1 CRITICAL signal **OR** ≥2 HIGH active-compromise signals.

---

## 2. Architecture — Three Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1: Fleet-wide signal detection                            │
│  Source: graph.db (pre-populated by sync events)               │
│  Cost:   seconds, zero live site access                         │
│  Output: list of signals with severities                        │
│                     │                                           │
│          ≥1 CRITICAL or ≥2 HIGH active-compromise signals       │
│                     ↓                                           │
├─────────────────────────────────────────────────────────────────┤
│  TIER 2: Deep investigation in isolated sandbox                 │
│  Source: sandbox clone (local_clone_site or wpe pull)           │
│  Cost:   minutes                                                │
│  Output: enriched signals + specialist narratives               │
│                     │                                           │
│                     ↓                                           │
├─────────────────────────────────────────────────────────────────┤
│  TIER 3: Remediation checklist execution                        │
│  Source: sandbox (same clone as Tier 2)                         │
│  Cost:   minutes                                                │
│  Output: pass/fail checklist + forensic report                  │
│                     │                                           │
│          Human review gate — approve before push                │
│                     ↓                                           │
│  local_wpe_push (if approved)                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Sandbox Creation

| Site type | Method | Typical duration |
|-----------|--------|-----------------|
| Local site | `local_clone_site` | 20–60 seconds |
| WPE production | `local_create_site` + `local_wpe_pull` (with database) | 2–5 minutes |

All Tier 2 checks run against the clone. The sandbox name format is `sentinel-{siteName}-{timestamp}`.

---

## 3. Signal Catalog

Signals are the currency of the system. Each signal has an ID, category, severity, and `evidence: string[]`. Evidence lines carry specific artifacts — file paths with sizes, decoded payload previews, injected core file lines, C2 addresses — not summary counts.

### 3.1 Absolute Checks (ABS) — known-bad regardless of history

| ID | Check | Severity | Source |
|----|-------|----------|--------|
| ABS-04 | File manager plugins active: `fileorganizer`, `filester`, `wp-file-manager`, `file-manager-advanced` | HIGH | graph.db plugin list |
| ABS-05 | Known backdoor plugin slugs (hardcoded list) | CRITICAL | graph.db plugin list |
| ABS-06 | Authentication salts at default or missing values | HIGH | wp-config.php content |
| ABS-07 | Low-entropy plugin names: single dictionary word, ≤6 chars, not in whitelist of known-legitimate short slugs | HIGH | graph.db plugin list |
| ABS-08 | Anti-forensics code: `touch()` + `scandir()` patterns in close proximity (excluding known file manager plugins) | CRITICAL | filesystem scan |
| ABS-09 | Suspicious internal filenames in plugin directories: `check_file.php`, `shell.php`, `Eval.php`, `PHP.php`, etc. | CRITICAL | filesystem scan |

**ABS-07 design note:** Attacker-created plugins frequently use names like `noted`, `index`, `ranktool`, `ads` to blend in. The whitelist covers common legitimate short slugs (`pods`, `akismet`, etc.). Severity is HIGH (not CRITICAL) because false-positive rate requires human review.

**ABS-08 design note:** The combination of `touch()` (timestamp manipulation) and `scandir()` (directory enumeration) in non-file-manager plugin files is the indicator. File manager plugins legitimately use both; the check targets their presence elsewhere or alongside other suspicious patterns.

### 3.2 Relative Checks (REL) — anomalies vs. baseline

| ID | Check | Severity | Trigger |
|----|-------|----------|---------|
| REL-01 | New plugins added since last scan | HIGH | plugin count delta |
| REL-02 | Plugin count spike (>5 new plugins) | HIGH | absolute delta |
| REL-03 | New admin users added since last scan | CRITICAL | user count delta |
| REL-04 | File count spike in `wp-content/` | HIGH | file count delta |

### 3.3 Exposure Checks (EXP)

| ID | Check | Severity |
|----|-------|----------|
| EXP-01 | Debug log (`wp-content/debug.log`) publicly accessible via HTTP | MEDIUM |

### 3.4 LLM Admin Audit (LLM-USER-01)

Each admin user account is scored 0–100 for attacker-creation likelihood using an LLM call.

**Scoring factors:**
- Username entropy: random 6–10 char lowercase strings score high
- Default placeholder email (`@example.com`)
- Programmatic suffixes (`admin_XXXX`, `wp_XXXX`)
- Proximity to attack timestamp

**Score thresholds:**

| Score | Action | Step |
|-------|--------|------|
| >95 | Login-disabled (reversibly) | Step 2 (`requiresApproval: true`) |
| 50–95 | Demoted to subscriber + session killed | Step 2 (`requiresApproval: true`) |
| <50 | Flagged for human review only | No automated action |

### 3.5 Fleet Correlation

Cross-site signal: the same backdoor slug appearing on multiple sites in the same fleet indicates a coordinated attack, not an isolated incident. Evidence: list of affected site names.

### 3.6 Tier 2 Signals (added during deep investigation)

| ID | Check | Severity | Section |
|----|-------|----------|---------|
| FS-01 | PHP files in `mu-plugins/` not in the known-good list | HIGH | Filesystem |
| FS-02 | Obfuscated code patterns (9 patterns) | CRITICAL | Filesystem |
| FS-03 | Unexpected PHP files in web root (not part of WP core file list) | HIGH | Filesystem |
| FS-04 | PHP files in `wp-content/uploads/` | CRITICAL | Filesystem |
| FS-05 | Malicious `.htaccess` directives | HIGH | Filesystem |
| FS-06 | ELF binaries in `wp-content/` (magic bytes `\x7fELF`) | CRITICAL | Filesystem |
| FS-07 | Hardcoded network indicators (IPs/URLs) in suspicious PHP files | CRITICAL | Content examination (v2.2) |
| DB-01 | Spam/malicious content in `wp_posts` | HIGH | Database |
| DB-02 | Suspicious payloads in autoloaded `wp_options` | CRITICAL | Database |
| DB-03 | Suspicious serialized objects in `wp_usermeta` | HIGH | Database |
| DB-04 | Casino/spam patterns in `wp_comments` | MEDIUM | Database |
| CHK-01 | WordPress core file checksum failures | CRITICAL | Integrity |
| CHK-02 | Active plugin checksum failures (wordpress.org plugins only) | CRITICAL | Integrity |

---

## 4. Tier 2: Deep Investigation

All Tier 2 checks run inside `tier2Investigate()` against the isolated sandbox. The live site is not touched.

### 4.1 Filesystem Checks

#### FS-01: PHP files in mu-plugins/

Scans `wp-content/mu-plugins/` for PHP files not in the known-good list (WP Engine's own mu-plugins). Any unexpected file in mu-plugins is a persistent backdoor — mu-plugins load unconditionally on every WordPress request with no activation required.

#### FS-02: Obfuscated code patterns

Scans `plugins/`, `mu-plugins/`, `themes/` for 9 patterns via `grep -rn`:

| Pattern | Technique |
|---------|-----------|
| `eval\s*\(\s*base64_decode` | Base64-encoded payload |
| `eval\s*\(\s*gzinflate\s*\(\s*base64_decode` | Double-layer compression + base64 |
| `eval\s*\(\s*str_rot13` | ROT13 obfuscation |
| `assert\s*\(\s*\$` | Variable-based code execution |
| `create_function\s*\(` | Dynamic function creation (deprecated, abused) |
| `eval\s*\(\s*\$` | Direct variable eval |
| `preg_replace\s*\(\s*['"].*\/e` | `/e` modifier (executes replacement as PHP) |
| `base64_decode.*base64_decode` | Double decode chain |
| `exec\s*\(` | Shell execution |

Evidence is capped at 30 files to avoid overwhelming the report.

#### FS-03: Unexpected PHP files in web root

Identifies `.php` files in `ABSPATH` that are not part of the WordPress core file list. Web root PHP files that WP didn't ship are a common dropper pattern (e.g., `goods.php`, `shop.php`, `local-xdebuginfo.php`).

#### FS-04: PHP files in uploads/

Recursive scan of `wp-content/uploads/` for `.php` files. PHP in uploads is always a webshell or dropper — there is no legitimate use case.

#### FS-05: .htaccess analysis

Reads all `.htaccess` files in the install and flags:

- `RewriteRule` redirecting to external domains (cloaking)
- `php_value auto_prepend_file` (prepends PHP to every request)
- `Options +ExecCGI` (enables CGI execution)
- `AddType application/x-httpd-php` (PHP-as-any-extension execution)

Cloaking pattern: redirect search engine traffic (Googlebot UA) to spam while serving normal pages to regular visitors.

#### FS-06: ELF binary detection

Scans all of `wp-content/` for files containing the ELF magic bytes `\x7fELF`. Linux executables have no legitimate purpose in a WordPress installation. Evidence includes path and size. In the canonical test case, 45 ELF binaries (~2.5MB each) were found hidden inside plugin subdirectories with innocuous filenames (`themeimgform`, `mediasize`, `fbratings`, `handlevirus`, etc.).

### 4.2 Database Content Checks

All six DB `wp_eval` calls use `skip_plugins: true, skip_themes: true` — they read `$wpdb` directly and do not need live plugin code. This prevents attacker-installed plugins from running during database inspection.

#### DB-01: wp_posts content scan

Scans all published posts for:
- Casino/gambling keyword patterns (top 20 terms across 5 languages)
- Base64-encoded content
- `eval(` in post content
- External iframe injections
- Script tag injections

Evidence: post ID, title, date, classification.

#### DB-02: wp_options autoloaded values

Reads all autoloaded options (`autoload='yes'` — these load on every WordPress request). Flags:
- Serialized PHP objects containing `eval`
- Base64-encoded blobs
- External URLs in unexpected option keys

Evidence: option name + flagged content snippet.

#### DB-03: wp_usermeta objects

Scans `wp_usermeta` for serialized objects containing suspicious PHP. Attackers store backdoors in user capabilities or session tokens.

#### DB-04: wp_comments spam patterns

Checks `wp_comments` for:
- Casino keyword patterns
- External link density
- Comment author email patterns used by spam campaigns

### 4.3 Integrity Checks

#### CHK-01: WordPress core file checksums

Fetches official checksums from `https://api.wordpress.org/core/checksums/1.0/?version={wp_version}&locale={locale}`. MD5-compares every core file. Explicitly excludes `wp-content/` (themes and plugins are user territory). Flags root PHP files (`index.php`, `wp-blog-header.php`, `wp-config.php`, etc.) and files in `wp-admin/` and `wp-includes/`.

CHK-01 is a **required** check, not deferred — this is a Batch 1 hardening change. The endpoint is on the `WP_ACCESSIBLE_HOSTS` allowlist so it works under sandbox isolation.

#### CHK-02: Active plugin checksums

For each active plugin (capped at 30), fetches checksums from `https://downloads.wordpress.org/plugin-checksums/{slug}/{version}.json`. MD5-compares every plugin file.

Results are separated:
- **Failures** (file tampered) → CRITICAL signal
- **Unverifiable** (plugin not on wordpress.org — premium/private plugins) → log only, no signal

### 4.4 Deep File Examination (v2.2)

These run after all detection checks complete but before the specialist agents. They enrich existing signals with more specific evidence.

#### runContentExamination

For every file path in FS-01, FS-03, and ABS-09 evidence (files already known to be suspicious):

- Reads first 3000 bytes via `wp_eval`
- Checks for 13 dangerous PHP functions: `eval`, `system`, `exec`, `passthru`, `shell_exec`, `base64_decode`, `gzinflate`, `str_rot13`, `create_function`, `assert`, `preg_replace`, `move_uploaded_file`, `curl_exec`
- Extracts hardcoded IPv4 addresses
- Extracts external URLs (`http://`, `https://`)
- Appends to the original signal's evidence: function list, IPs, URLs, 200-char content preview

#### runObfuscationDecoder

For the first 3 FS-02 matches, attempts one level of deobfuscation:

1. Extracts base64 strings from `base64_decode('...')` calls (≥20 chars)
2. Decodes the base64
3. Attempts `gzinflate` on the result
4. Appends the decoded payload (capped at 300 bytes) to FS-02 evidence

**Safety note:** Only `base64_decode()` and `gzinflate()` are called — pure decode operations. The `eval()` that would execute the result is never called.

#### runCoreDiff

For CHK-01 failures that are non-`wp-content` PHP files:

1. Downloads the fresh original from `https://core.svn.wordpress.org/tags/{version}/{file}` (WP SVN — on the `WP_ACCESSIBLE_HOSTS` allowlist)
2. Compares line by line using PHP's `array_diff($local_lines, $orig_lines)`
3. Lines present in the local file but absent from the original are the injected code
4. Appends injected lines (first 10) to CHK-01 evidence

#### runElfStrings

Takes the first FS-06 binary (all same-MD5 binaries assumed identical):

1. Runs `strings <binary> 2>/dev/null` via `shell_exec`
2. Filters output through 9 regex patterns:

| Pattern | What it finds |
|---------|---------------|
| URLs (`https?://`) | C2 callback addresses |
| IP addresses | C2 server IPs |
| `/bin/(sh\|bash\|dash)` | Shell invocation |
| `curl\|wget\|nc` | Download/connect tools |
| `root\|passwd\|shadow` | Credential targeting |
| `chmod\|chown\|setuid` | Privilege escalation |
| `/proc/` | Process filesystem access |
| Socket operations | Network binding |
| Attack keywords (`cmd`, `shell`, `backdoor`, `reverse`) | Behavioral fingerprint |

Appends matching strings (up to 15) to FS-06 evidence.

#### runNetworkIndicators → FS-07

Scans all PHP files referenced in FS-01, FS-02, FS-03, and ABS-09 evidence (up to 20 unique paths):

1. Extracts all IPv4 addresses via regex
2. Extracts all `http://` and `https://` URLs via regex
3. Filters against `TRUSTED_INFRA_DOMAINS` (not `PLUGIN_VENDOR_DOMAINS` — see Section 9, Batch 3 hardening A)
4. Trusted infra: `wordpress.org`, `wp.com`, `w.org`, `gravatar.com`, `jquery.com`, `googleapis.com`, `gstatic.com`, `bootstrapcdn.com`
5. Trivial IPs filtered: `127.0.0.1`, `0.0.0.0`, `255.255.255.255`
6. Domain matching uses **host-suffix** check (`parse_url` + equals-or-`.`-suffix), not substring — prevents `wordpress.org.attacker.com` from passing

If any indicators remain → creates FS-07 CRITICAL signal: "Hardcoded network indicators in suspicious PHP". Evidence: `IP: x.x.x.x` and `URL: https://...` entries.

---

## 5. Specialist AI Agents

After all detection checks complete, five specialist AI agents run **concurrently** over the collected evidence. Each receives a focused data dump, not a full site dump.

All specialists use `ai.generateObject({ noTools: true })` with a forced `__output__` tool call (`tool_choice: { type: 'any', function: { name: '__output__' } }`). This pattern ensures structured output across both Anthropic and Google Gemini providers. Plain JSON-in-text was unreliable — models returned markdown or prose even when instructed otherwise.

### Specialist Roster

| Specialist | File | Input | Output schema |
|-----------|------|-------|---------------|
| Enumerator | `specialists/enumerator.js` | Plugin directory listing with mtimes + file counts | Anomalous directories, unexpected files, `.htaccess` files, non-standard DB tables |
| Integrity | `specialists/integrity.js` | Core checksum results, `wp-config.php` content | Core verification status, config modifications, plugin verification |
| Pattern | `specialists/pattern.js` | FS-02 obfuscation scan results, `.htaccess` content | Obfuscation patterns, htaccess findings, behavioral anomalies |
| Database | `specialists/database.js` | `wp_posts`/`wp_options`/`wp_usermeta`/`wp_comments` data | Database anomalies, suspicious content |
| Behavioral | `specialists/behavioral.js` | HTTP responses: normal UA, Googlebot UA, Google-referred UA (login page, xmlrpc.php, REST API) | Cloaking detection, response anomalies, redirect behavior |

### Behavioral Specialist Detail

The behavioral specialist is the most sophisticated. It sends real HTTP requests to the site URL (via `wp_remote_get` inside PHP) with different User-Agents and Referer headers:

- Normal browser UA → baseline response
- Googlebot UA → cloaking check
- Google-referred UA (Referer: `https://www.google.com/`) → cloaking check

If the site returns different content for Googlebot vs. a regular browser, it is cloaking — serving spam to search engines while appearing normal to visitors. Cloaking is detected but not auto-remediated (the specific `.htaccess` rule or PHP responsible is not auto-removed).

### Synthesizer Agent

After all five specialists complete, `specialists/synthesizer.js` combines their results into a narrative:

- **Compromise classification:** `active-compromise` / `high-risk` / `misconfiguration` / `false-positive`
- **Attack summary:** what happened, in plain language
- **Entry point theory:** how the attacker got in
- **Temporal narrative:** approximate attack timeline
- **Attacker-created vs. legitimate items:** which signals are likely noise vs. confirmed malicious
- **Blind spots:** what this scan could not see

---

## 6. Remediation Checklist

`buildRemediationChecklist()` builds a signal-conditional step list. Steps are included only when their trigger signal fired, and are intended to be executed via `wp_eval` with per-step verification written to the report as ✅/❌.

> **Known finding (WP-25 live smoke, registered):** a real run produced a
> report whose remediation checklist was **fabricated by the template** — the
> ✅ marks did not correspond to executed steps, and the model reviewing the
> ledger caught it unprompted. Until the report-template finding is fixed,
> treat checklist ticks as template output, not as evidence of execution.

### SIGNAL_REMEDIATION_STEP Map

The map replaces the former hardcoded `coveredByChecklist` Set. It defines which signal IDs are covered by which remediation step. Verdict logic derives coverage from this map — signals with no entry produce an automatic BLOCKED verdict.

### Step Catalog

| Step | Condition | Action | Verification |
|------|-----------|--------|-------------|
| 1 | FS-01 fired | Delete non-standard `mu-plugins/` PHP files (exact paths from evidence) | Expected empty: `mu-plugins/` contains no unexpected PHP |
| 2 | Admin signals fired (LLM-USER-01) | Confidence-scored admin remediation — login-disable (>95) or demote to subscriber + kill session (50–95) | `requiresApproval: true` — surfaced for human sign-off before push |
| 3 | Always | Delete attacker plugins — hardcoded backdoor list + slugs derived from signal evidence | Plugin list re-check |
| 4 | Always | Verify no PHP in `uploads/` | Expected empty: `find wp-content/uploads -name "*.php"` |
| 4b | FS-04 fired | Remove PHP files from `uploads/` (exact paths from evidence) | Expected empty after deletion |
| 5a | CHK-01 fired | Re-verify core checksums (confirms restoration) | Zero checksum failures |
| 5b | FS-03 fired | Delete web root PHP files (exact paths from evidence) | Files absent |
| 5c | ABS-09 fired | Delete injected plugin files (exact paths from evidence) | Files absent |
| 5d | DB-01 fired | `wp_delete_post()` for each spam post ID from evidence | Posts absent |
| 5e | FS-06 fired | Delete ELF binaries (exact paths from evidence) | Files absent |
| 5f | FS-05 fired | Rewrite malicious `.htaccess` rules | `.htaccess` re-verification |
| 5g | DB-02 fired | Delete flagged autoloaded option keys | Options absent |
| 6 | Always | Shuffle authentication salts via `wp config shuffle-salts` | Salt values changed |
| 7 | Always | Set `DISALLOW_FILE_EDIT` in `wp-config.php` | `define('DISALLOW_FILE_EDIT', true)` present |
| 8 | Always | Final re-scan: `mu-plugins/` + obfuscation patterns | Clean scan result |

### Step 2 — Admin Account Remediation Detail

Login-disable neutralizes every WordPress authentication path:

1. `wp_set_password(wp_generate_password(64,true,true), id)` — sets an unknowable password hash, blocking password login
2. `WP_User->set_role('')` — strips all capabilities; blocks SSO/social-login plugins from doing anything even if they authenticate
3. `delete_user_meta(id, 'session_tokens')` — force-logs-out any active session
4. `_application_passwords` deleted — blocks application password auth path
5. (Auth cookies invalidated globally by salt shuffle in step 6)

**Reversal:** reset password and restore role. Nothing is destroyed. The user record and all associated metadata are preserved for forensic analysis.

**Caveats (disclosed):**
- An attacker who controls the account's email could request a password reset. The role strip contains this — after reset they have no capabilities.
- The 50–95 "demote" tier leaves login working. Demotion removes admin caps but the account can still authenticate (session kill added in Batch 3).

### Verification Mode per Step

| Mode | What it checks |
|------|----------------|
| `expected-empty` | Output of a verification command must be empty (e.g., no files found, no rows returned) |
| `contains-string` | Output must contain a specific string (e.g., `WP_ACCESSIBLE_HOSTS` in `wp-config.php`) |
| `json-key` | JSON output must contain a specific key with a specific value |

---

## 7. Verdict Logic

```
isBlocked = (failCount > 0) || (uncoveredCritical.length > 0)
```

Where:
- `failCount` = number of remediation steps that returned ❌
- `uncoveredCritical` = CRITICAL signals with no entry in `SIGNAL_REMEDIATION_STEP`

**BLOCKED** when:
- Any remediation step failed
- Any CRITICAL signal has no corresponding remediation step (this prevents a false READY TO PUSH verdict when critical findings exist but the checklist doesn't cover them)

**NOT BLOCKED** when:
- All steps passed
- Every CRITICAL signal maps to at least one passing step

**Verdict labels:**

| State | Label |
|-------|-------|
| Not blocked, no critical signals | READY TO PUSH |
| Not blocked, critical signals covered | READY TO PUSH (with caveats) |
| Blocked by step failure | NOT SAFE TO PUSH — N step(s) failed |
| Blocked by uncovered critical | NOT SAFE TO PUSH — uncovered critical signals |

---

## 8. Report Format

The report is a markdown document written to the sandbox during Tier 3 execution. It is opened via `shell.openPath` from the "View Report" button in `SentinelReviewOverlay`.

```markdown
# Security Remediation Report
**Site:** {siteName}
**Date:** {ISO timestamp}
**Sandbox:** {sandboxName}
**Signals:** {total} total — {critical} critical, {high} high

## What the Sentinel Found

### Plugin / User Anomalies
- [HIGH] **ABS-04:** File manager plugin(s) active: fileorganizer, filester
  - fileorganizer v1.2.0
  - filester v2.1.1
- [CRITICAL] **ABS-05:** Known backdoor plugin detected: wp-compat
  - wp-compat (version: 1.3.3, active: 1)
- [CRITICAL] **ABS-09:** Suspicious internal filenames in plugins: check_file.php (×5)
  - wp-content/plugins/ranktool/check_file.php (1665 bytes)
  → dangerous functions: eval, base64_decode, system
  → preview: <?php $k='...'; $f=base64_decode($k); eval($f);

### Filesystem Findings
- [CRITICAL] **FS-06:** ELF binary found in wp-content: 45 file(s)
  - wp-content/plugins/noted/vendor/top_referrals (2512.2 KB)
  → strings analysis of top_referrals (MD5: abc123, ~45 total ELF files assumed identical):
    http://185.220.101.5/gate.php
    /bin/sh
    connect
    passwd

### Core / Plugin Integrity
- [CRITICAL] **CHK-01:** WordPress core file tampering: 2 file(s)
  - Error: File doesn't verify against checksum: wp-blog-header.php
  → wp-blog-header.php injected lines: <?php eval(base64_decode('REDACTED')); ?>
  - Error: File doesn't verify against checksum: index.php
  → index.php injected lines: <?php @include($_SERVER['DOCUMENT_ROOT'].'/goods.php'); ?>

## Synthesis
{narrative from synthesizer agent}

## Coverage Gaps (Blind Spots)
- **File timestamps are unreliable**: anti-forensics timestamp manipulation detected (ABS-08)
- **Runtime-assembled payloads**: code that fetches/assembles payload at request time
- **Time-triggered or IP-conditional code**
- **Upstream compromised plugins**: backdoored before installation → checksum matches
- **Image EXIF data**: not scanned for embedded PHP
- **Premium / non-wordpress.org plugins**: cannot verify checksums (CHK-02)
- **Network-fetched payloads**
- **Full wp_options table**: only autoloaded options were scanned

## Remediation Checklist
✅ Step 1: Remove mu-plugins webshell(s)
✅ Step 3: Remove attacker plugins
✅ Step 4: Verify no PHP in uploads/
✅ Step 5b: Remove suspicious web root PHP files: goods.php, shop.php, local-xdebuginfo.php
✅ Step 5c: Remove injected files in plugins: 5 file(s)
✅ Step 5d: Delete 12 spam post(s)
✅ Step 5e: Remove 45 ELF binaries from wp-content
✅ Step 6: Shuffle authentication salts
✅ Step 7: Apply hardening (DISALLOW_FILE_EDIT)
✅ Step 8: Final re-scan
❌ Step 5a: Core files still failing checksum: wp-blog-header.php, index.php

## Verdict
**NOT SAFE TO PUSH** — 1 step failed, restore tampered core files manually
```

### Report Section Names (structured artifacts)

In v2.2, report sections are named artifacts for downstream tooling:
- `plugin-user-anomalies`
- `filesystem-findings`
- `integrity-findings`
- `database-findings`
- `synthesis`
- `blind-spots`
- `remediation-checklist`
- `verdict`

---

## 9. Security Hardening — Fable Review Summary

Three rounds of external security review by Fable (a Claude AI security agent specializing in agent system hardening). Changes are applied to `agent.js`.

### Batch 1

Focus: remediation coverage and signal-step traceability.

| Change | Detail |
|--------|--------|
| `SIGNAL_REMEDIATION_STEP` map | Replaces the former hardcoded `coveredByChecklist` Set. Coverage is now derived from the map, not maintained as a parallel static list. New signal IDs that have no map entry automatically produce a BLOCKED verdict. |
| Steps 4b/5f/5g added | Real removal steps for FS-04 (PHP in uploads), FS-05 (malicious `.htaccess`), and DB-02 (flagged autoloaded options). Previously these signals were detected but had no corresponding remediation action. |
| Admin accounts: login-disable, not delete | Score >95 accounts are login-disabled reversibly (4 auth paths blocked). Hard deletion was removed because: (1) a false-positive deletion presents a "clean" sandbox → human approves push → legitimate admin deleted from production irreversibly; (2) deletion destroys registration time, email, and meta needed for forensic analysis. |
| Six `$wpdb` scans: `skip_plugins: true` | DB-01 through DB-04 and the two specialist data-collection `wp_eval` calls (posts and options) now set `skip_plugins: true, skip_themes: true`. These read the database directly and never needed live plugin code. After this change, only 2 of 28 `wp_eval` calls still load plugins. |

### Batch 2

Focus: injection-seam hardening — preventing attacker-controlled data from affecting the agent's own operations.

| Change | Detail |
|--------|--------|
| `parseSqlResult` drops malformed rows with warning | `parseSqlResult(result, onDrop)` now reports rows dropped for column-count mismatch. `collectFleetData` logs dropped rows. A malicious plugin whose name contains `\|` (the delimiter) can no longer silently vanish from the scan. |
| `protectedEmails` from JS, not `get_option('admin_email')` | Step 2 no longer reads `get_option('admin_email')` from the site being scanned — that option is attacker-writable. The never-touch email list is supplied from JS via `buildRemediationChecklist(..., { protectedEmails })`, threaded from `install.protectedEmails`, injected as a literal. |
| Slug sanitization to `[a-z0-9-]` | Plugin slugs are sanitized before any filesystem operation. Characters outside `[a-z0-9-]` are stripped. |
| `realpath()` + prefix checks in Steps 5b/5c/5e | Before deleting any file, `realpath()` resolves the path and a prefix check confirms it is under `ABSPATH` (for 5b) or the expected plugin/theme directory (for 5c, 5e). This prevents path traversal via crafted evidence strings. |
| Host-suffix URL matching in FS-07 | `runNetworkIndicators` now uses PHP `parse_url` + host-suffix matching (equals-or-`.`-suffix) instead of substring. Prevents `wordpress.org.attacker.com` from passing the trusted domain filter. |

### Batch 3

Focus: sandbox network and execution isolation.

| Change | Detail |
|--------|--------|
| `disable_functions` in sandbox php.ini | `php_ini_loaded_file()` locates the sandbox's loaded `php.ini`. The agent appends `disable_functions = fsockopen,curl_exec,exec,passthru,shell_exec,system,proc_open,popen` to it, then calls `local_restart_site` to reload. This kills raw socket and exec paths in the sandbox before any scan begins. |
| `WP_HTTP_BLOCK_EXTERNAL` + `WP_ACCESSIBLE_HOSTS` in sandbox wp-config.php | Injected into sandbox `wp-config.php` before scanning begins. Allowlist: `api.wordpress.org`, `core.svn.wordpress.org`, `downloads.wordpress.org`. CHK-01 core restore and `runCoreDiff` fetch from exactly these endpoints — remediation still works under isolation. |
| `tools.registerSandbox(sandboxName)` | Called before the first `wp_eval`. Scopes all subsequent `wp_eval` calls to the named sandbox only. No-op outside the agent runtime. |
| `TRUSTED_INFRA_DOMAINS` / `PLUGIN_VENDOR_DOMAINS` split | `TRUSTED_DOMAINS` split into two sets. `runNetworkIndicators` trusts infra domains only — so a flagged file phoning home to a file-manager vendor's domain is no longer suppressed. Plugin vendor domains (e.g., `fileorganizer.com`) are not on the infra allowlist. |

### Isolation Ordering Invariant

A test asserts that the `php.ini` hardening runs *before* the filesystem checks begin. Isolation must precede any plugin-loading scan. The isolation sequence is:

1. Create sandbox (`local_clone_site` or `local_create_site` + `local_wpe_pull`)
2. Locate sandbox `php.ini` via `php_ini_loaded_file()`
3. Append `disable_functions`
4. Restart sandbox site (`local_restart_site`)
5. Inject `WP_HTTP_BLOCK_EXTERNAL` + `WP_ACCESSIBLE_HOSTS` into `wp-config.php`
6. Call `tools.registerSandbox(sandboxName)`
7. Begin FS/DB/CHK checks

---

## 10. Isolation Guarantees

### What Is Isolated

| Protection | Mechanism | Scope |
|------------|-----------|-------|
| Live site untouched | All operations run on sandbox clone | Tier 2 + Tier 3 |
| Outbound network blocked | `WP_HTTP_BLOCK_EXTERNAL` + `disable_functions` (fsockopen, curl_exec) | Sandbox PHP runtime |
| Allowlisted endpoints only | `WP_ACCESSIBLE_HOSTS`: `api.wordpress.org`, `core.svn.wordpress.org`, `downloads.wordpress.org` | Sandbox PHP runtime |
| Shell execution blocked | `disable_functions`: exec, passthru, shell_exec, system, proc_open, popen | Sandbox PHP runtime |
| wp_eval scoped to sandbox | `tools.registerSandbox(sandboxName)` | Agent runtime |
| Plugin code minimized | 26 of 28 `wp_eval` calls use `skip_plugins: true` | Sandbox PHP runtime |

### Remaining Detonation Points

Only two `wp_eval` calls still load plugins:

1. **FS-MISMATCH** (hidden admin detection) — intentional. Detecting an account-hiding hook *requires* the hook to run. This is the primary argument for sandbox isolation.
2. **`executeChecklist` verify snippets** — verification code after a remediation step sometimes needs live plugin state. Bounded by `tools.registerSandbox` scope.

### Network Isolation Coverage

`WP_HTTP_BLOCK_EXTERNAL` blocks WordPress's `WP_Http` class from making outbound requests. `disable_functions` blocks PHP-level sockets. Together they cover:

- `wp_remote_get` / `wp_remote_post` → blocked by `WP_HTTP_BLOCK_EXTERNAL`
- `curl_exec` → blocked by `disable_functions`
- `fsockopen` → blocked by `disable_functions`
- `file_get_contents` (remote) → blocked by `WP_HTTP_BLOCK_EXTERNAL` (WordPress wraps this for URLs)

Exception: `shell_exec` used in `runElfStrings` is blocked by `disable_functions`. `runElfStrings` is therefore only callable when isolation is not active, or must be refactored to use a different mechanism.

---

## 11. Known Limitations and Open Items

### Disclosed in Every Report (Structural Limitations)

1. **Timestamp evidence is unreliable.** ABS-08 proves the attacker had timestamp manipulation capability. Temporal cluster analysis may be wrong.

2. **Premium plugin checksums impossible.** CHK-02 cannot verify plugins not on wordpress.org. These are logged as "unverifiable" — not signaled, not remediated.

3. **Only autoloaded `wp_options` scanned.** DB-02 reads `autoload='yes'` options only. A full `wp_options` scan would be slow (potentially thousands of rows). A full scan was deliberately excluded.

4. **Image EXIF not scanned.** PHP code can be embedded in JPEG EXIF data and executed via certain server configurations (e.g., `php_value auto_prepend_file`).

5. **Runtime-assembled payloads leave no local trace.** Code that issues an HTTP request at runtime and evals the response is invisible to static analysis. ELF binary strings analysis partially mitigates this by finding C2 URLs, but the actual payload is never seen.

6. **Cloaking detected but not remediated.** The behavioral specialist can detect that the site serves different content to Googlebot, but the specific `.htaccess` rule or PHP responsible is not auto-removed.

### Open Engineering Items

| Item | Current state | Full fix |
|------|---------------|----------|
| `protectedEmails` source | Currently reads `admin_email` from `graph.db` (synced before scan, more trusted than the live option but still site-controlled). Batch 2 hardening threads the value from `install.protectedEmails` in JS. | Populate `install.protectedEmails` from WPE portal account owner via `wpe_get_account_users` filtered to role `owner`. Those MCP tools currently return markdown, not JSON. `s.account_id` is in the `fleet_sql` SELECT ready for when a JSON-returning lookup exists. Empty is a safe default — score threshold + human approval still gate Step 2. |
| Tier 2 cooldown | 24-hour gate is **commented out in dev mode**. | Must re-enable before fleet production deployment. The gate prevents repeated deep scans of the same site within 24 hours. |
| IPv6 network indicators | `runNetworkIndicators` uses `ip2long` for IP range filtering — IPv4 only. | IPv6 literals in suspicious files are not range-filtered. Safe direction: they surface unfiltered (appear in evidence). Not silently dropped. Full fix: IPv6 address range library. |
| `fleet_sql` parameterization | `params?: (string\|number\|null)[]` field exists on the tool schema. Two `site_id` queries already use it. | Remaining queries use internal UUIDs only (low risk, no user input). Full parameterization tracked for future hardening. |
| Human security review | Agent can disable admin accounts, rewrite core files, and mutate sandbox `php.ini`. | 143-test suite is a strong basis but not a substitute for human security review of remediation paths and isolation guarantees before live fleet deployment. |
| `local_restart_site` in manifest | `local_restart_site` is called during isolation setup (Batch 3 `php.ini` hardening) but was not in the original `nexus.agent.yaml` `tools:` list. | Verified added to the manifest. Confirm it resolves at runtime in the agent tool registry. |
| UX gap: own account not guarded | Step 2 has no check that the authenticated user's own account is not in the disable list. | Add check: if the current user's email matches a scored account, skip or require explicit confirmation. |
| UX gap: minimum admin count | If a site has exactly 1 admin, Step 2 would disable that admin and leave no one with admin access. | Add guard: if remaining admins after Step 2 would be 0, skip Step 2 and surface for manual review. |

---

## 12. UX Safeguards and Human Review Gates

### `SentinelReviewOverlay`

The UI component that surfaces the Sentinel result before any production push. It presents:

- Signal summary with severities
- Checklist pass/fail results
- Verdict banner (READY TO PUSH / NOT SAFE TO PUSH)
- "View Report" button — opens the full markdown report via `shell.openPath`
- "Approve Push" button — only enabled when verdict is READY TO PUSH

### Human Review Points

| Gate | Mechanism | When |
|------|-----------|------|
| Step 2 (admin accounts) | `requiresApproval: true` on the step — surfaced for human sign-off | Before any push, if admin signals fired |
| BLOCKED verdict | Push button disabled | Any step failure or uncovered CRITICAL signal |
| "View Report" | Full forensic markdown via `shell.openPath` | Any time, from the overlay |
| Sandbox lifespan | Sandbox stays alive until user approves the push | Sandbox deleted by `nexus:sentinel:execute` IPC handler only after execution |

### Startup Race Condition (Fixed)

**Problem:** `getAgentSetting()` returned `true` by default before the renderer synced settings to the main process cache. This caused the scheduler to fire before the user's actual settings were applied — the agent could start scanning before the user had enabled it.

**Fix:** `AGENT_SETTINGS_UPDATE` IPC message now persists agent settings to `~/Library/Application Support/Local/nexus-ai/agent-settings.json`. `registerIpcHandlers()` reads this file at startup to pre-populate the main-process settings cache before any scheduler fires. The scheduler now reads the persisted value, not a default.

### Push Execution

The `nexus:sentinel:execute` IPC handler:
1. Receives push approval from the renderer
2. Calls `local_wpe_push` with the sandbox as source
3. Deletes the sandbox after execution completes
4. Reports result to the overlay

The sandbox is not deleted on verdict — only on approved push execution. This allows the user to review the sandbox state, re-run individual steps, or abandon the push without destroying evidence.

---

## 13. Test Coverage

### Suite Summary

| File | Location | Tests | Focus |
|------|----------|-------|-------|
| `sentinel.test.js` | `tests/unit/agents/security-sentinel/` | 102 | Core agent logic |
| `specialists.test.js` | `tests/unit/agents/security-sentinel/` | 5 | Specialist schema validation |
| `batch1.test.js` | `tests/unit/agents/security-sentinel/` | 10 | Verdict soundness + remediation coverage |
| `batch3.test.js` | `tests/unit/agents/security-sentinel/` | 8 | Admin login-disable + detonation reduction |
| `hardening.test.js` | `tests/unit/agents/security-sentinel/` | 8 | Injection-seam hardening (A/B/C) |
| `isolation.test.js` | `tests/unit/agents/security-sentinel/` | 5 | Sandbox isolation (#6/#7) |
| **Total** | | **138** | |

All tests mock `tools.invoke` — no live site, MCP server, or sandbox required.

Run:
```bash
npx jest agents/security-sentinel
```

### What Is Tested

**`sentinel.test.js` describe blocks:**

- `collectFleetData protectedEmails` — email extraction from fleet data
- `runAbsoluteChecks` — ABS-04 through ABS-09 signal generation
- `llmUserAudit` — admin account scoring, threshold application
- `runExposureChecks` — EXP-01 debug log detection
- `baseline management` — delta computation for REL checks
- `runFleetCorrelation` — cross-site backdoor signal
- `tier2Investigate` — FS/DB/CHK check invocation and signal generation
- `llmSynthesis` — synthesizer agent invocation
- `tier3Remediate` — full Tier 3 flow, checklist + report write
- `buildRemediationChecklist` — step conditional inclusion
- `runContentExamination` — file content reading and function detection
- `runObfuscationDecoder` — base64 decode, gzinflate, payload extraction
- `runCoreDiff` — SVN download + line diff
- `runElfStrings` — strings filtering through 9 patterns
- `runNetworkIndicators` — IP/URL extraction, trusted domain filtering, FS-07 signal creation
- `runRootFileAnalysis` — web root unexpected PHP detection

**`batch1.test.js`:**
- New removal steps (4b/5f/5g) are conditional on their signal
- Verdict coverage is derived from `SIGNAL_REMEDIATION_STEP`, not hardcoded

**`batch3.test.js`:**
- Four DB scans (`skip_plugins: true`) — guards against regression
- FS-MISMATCH must *not* use `skip_plugins` (intentional detonation)
- Admin login-disable path produces `login_disabled` key (not `auto_deleted`)

**`hardening.test.js`:**
- (A) Host-suffix domain matching — `wordpress.org.attacker.com` not trusted
- (B) `protectedEmails` is not read from `get_option('admin_email')` on the scanned site
- (C) `parseSqlResult` warns and drops malformed (pipe-containing) rows

**`isolation.test.js`:**
- `php.ini` hardening runs before filesystem checks begin (ordering invariant)
- `WP_ACCESSIBLE_HOSTS` allowlist contains required endpoints
- `tools.registerSandbox` is called before first `wp_eval`

---

## 14. File Inventory

```
agents/security-sentinel/
├── nexus.agent.yaml              Agent manifest: triggers, tools, permissions
│                                 Tools: fleet_sql, wpe_site_deep_refresh,
│                                   wp_user_list, wp_plugin_list, compare_sites,
│                                   local_create_site, local_clone_site,
│                                   local_start_site, local_restart_site,
│                                   local_wpe_pull, local_operation_status,
│                                   wp_eval, local_wpe_push
│                                 Triggers: cron 0 3 * * *, wp:plugin.activated, wp:user.created
│                                 Permissions: tier 3, scope: fleet
│
├── agent.js                      Main agent: CommonJS, ~2,600 lines
│   ├── collectFleetData()        Pulls WPE install data via fleet_sql
│   ├── runAbsoluteChecks()       ABS-04, ABS-05, ABS-06, ABS-07, ABS-08, ABS-09
│   ├── runExposureChecks()       EXP-01
│   ├── llmUserAudit()            Admin account scoring via LLM
│   ├── runRelativeChecks()       REL-01 through REL-04
│   ├── runFleetCorrelation()     Cross-site backdoor correlation
│   ├── tier2Investigate()        Sandbox creation + all Tier 2 checks
│   │   ├── FS-01 through FS-06   Filesystem checks
│   │   ├── DB-01 through DB-04   Database content checks
│   │   ├── CHK-01, CHK-02        Integrity checks
│   │   ├── runContentExamination()   File content reading (v2.2)
│   │   ├── runObfuscationDecoder()   Decode base64/gzinflate (v2.2)
│   │   ├── runCoreDiff()             SVN diff for tampered core (v2.2)
│   │   ├── runElfStrings()           strings on ELF binaries (v2.2)
│   │   ├── runNetworkIndicators()    FS-07 C2 indicator signal (v2.2)
│   │   └── collectSpecialistData()   5 parallel specialist LLM calls
│   ├── llmSynthesis()            Synthesizer agent (narrative)
│   ├── buildRemediationChecklist()   Signal-driven step builder
│   ├── executeChecklist()        Runs each step, verifies result
│   └── tier3Remediate()          Full Tier 3 flow: checklist + report write
│
└── specialists/
    ├── enumerator.js             Plugin directory + file enumeration schema
    ├── integrity.js              Core/plugin integrity analysis schema
    ├── pattern.js                Obfuscation pattern analysis schema
    ├── database.js               Database content analysis schema
    ├── behavioral.js             HTTP behavioral comparison schema
    └── synthesizer.js            Final narrative synthesis schema

tests/unit/agents/security-sentinel/
├── sentinel.test.js              102 tests — core agent logic, all describe blocks
├── specialists.test.js           5 tests — specialist schema validation
├── batch1.test.js                10 tests — remediation coverage (Fable Batch 1)
├── batch3.test.js                8 tests — admin login-disable + skip_plugins guards
├── hardening.test.js             8 tests — injection-seam hardening A/B/C
└── isolation.test.js             5 tests — sandbox isolation ordering + allowlist

Source-of-truth reference (external review artifacts, not in live repo):
/tmp/sot/security-sentinel-SOT/     Fable-produced merged SOT (137 tests, clean load)
/tmp/fable-batch3/BATCH3_CHANGES.md Batch 3 changes documentation
/tmp/sentinel-review/               External review package (SENTINEL_OVERVIEW.md)
```

---

## Appendix: Design Decision Log

### Why a sandbox?

All destructive Tier 3 operations (delete files, delete posts, shuffle salts) run on a clone of the site, not the live site. The user reviews the report and approves before the sandbox state is pushed to production. If remediation is wrong, the live site is untouched.

### Why signal-driven remediation?

A fixed checklist silently passes if it does not cover a finding. The `SIGNAL_REMEDIATION_STEP` map ties every CRITICAL signal to at least one step. Verdict logic explicitly checks that every CRITICAL signal has a corresponding passing step — a signal with no map entry produces an automatic BLOCKED verdict.

### Why PHP via `wp_eval` instead of WP-CLI?

All filesystem and database operations run as PHP inside the WordPress context via `wp_eval`. This gives access to WordPress's own filesystem abstraction (`WP_CONTENT_DIR`, `ABSPATH`, `wp_upload_dir()`), WordPress's HTTP client (`wp_remote_get`) for fetching checksums from wordpress.org, and WordPress's database wrapper (`$wpdb`). WP-CLI commands inside `wp_eval` failed in testing because nested wp-cli execution (`shell_exec` inside a `wp_eval` context) does not inherit correct path resolution.

### Why the `__output__` forced tool call pattern for specialists?

The specialist agents use `generateObject()` which injects a synthetic `__output__` tool and forces `tool_choice: { type: 'any', function: { name: '__output__' } }`. This ensures structured output across Anthropic and Google Gemini providers because both support tool-use forcing. Plain JSON-in-text is unreliable — models return markdown or prose even when instructed otherwise.

### Why evidence as structured strings?

Each signal has `evidence: string[]`. Evidence lines carry specific artifacts: file paths with sizes and timestamps, decoded payload previews, injected lines from core file diffs, strings output from ELF analysis, hardcoded C2 addresses. The report renders these as indented bullets. The specialist agents receive enriched evidence, giving them better data than raw scan counts.

### Why admin login-disable instead of delete?

Hard deletion destroys forensic evidence (registration time, email, associated meta) and creates irreversibility risk: a false-positive deletion presents a clean sandbox → human approves push → legitimate admin deleted from production with no undo path. Login-disable neutralizes all four auth paths (password, SSO/capabilities, active sessions, application passwords) while preserving all data and providing a clear reversal path (reset password, restore role).
