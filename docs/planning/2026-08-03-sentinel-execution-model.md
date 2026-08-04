# Sentinel Execution Model — What Actually Needs To Run

The question: for each thing the security-sentinel does, what does it *actually* require — bytes,
rows, a shell, a network request, WP Engine's API, the cache, or PHP genuinely executing inside a
WordPress bootstrap? Method: every unit was read at source, classified, then attacked — each
classification was given to a second pass whose job was to break it by finding a hidden dependency
on a WordPress runtime (option filtering, `wp_upload_dir()` resolution, the active-plugins list as
WordPress computes it, serialized-PHP handling, the table prefix). Corrections that pass found are
footnoted in the table.

---

## The answer, in one number

**One unit out of 83 genuinely requires PHP to execute.**

That unit is FS-MISMATCH (`agent.js:2133-2156`). Everything else the sentinel does — all seven FS
checks, both checksum checks, all four DB checks, all six HTTP probes, all seven collectors, all
five analysis helpers, all fifteen remediation steps, and the entire Tier 1 fleet tier — needs
bytes, rows, a network request that targets wordpress.org rather than the site, or nothing at all.

Narrowed to the units that currently run inside the Tier 2 sandbox via `wp_eval` — the 22 checks and
helpers the sandbox exists to host — the count is **1 of 22**. The prior evaluation
(`2026-08-03-pressproto-containment-eval.md`) put it at 12 of 21 not needing PHP. That was an
undercount by roughly a factor of two. The sandbox is being maintained, hardened, restarted, and
polled to host a single check.

Two secondary counts matter:

- **Three units are classified SHELL only because of how they were written**, not what they need:
  `runElfStrings` (`shell_exec('strings …')`, `:1494`), collector 6 (`shell_exec('wp core
  verify-checksums')`, `:1048-1051`), and remediation step 6 (`shell_exec('wp config
  shuffle-salts')`, `:3031-3041`). All three reduce to a Buffer scan, an md5 sweep, and eight
  regex substitutions respectively. One of them, `shell_exec`, is on the sandbox's own
  `disable_functions` list at `:1767` — so the containment story and the working sentinel are in
  direct contradiction today, and porting removes the contradiction rather than resolving it.
- **One transport branch is PHP-EXEC as written**: `executeSentinelCommands`'s WP-CLI path
  (`SentinelExecutor.ts:93-107`) bootstraps WordPress on the production install for `wp plugin
  delete` / `wp post delete` / `wp config`. That is a choice, not a requirement — the sibling
  `remoteSshRaw` branch (`:19-54`) reaches the same filesystem with no bootstrap at all, which is
  precisely why it was written (`:16-18`).

The implication is direct. A Local sandbox is not a containment boundary and cannot fully become one
(spike S1: 5 of 8 egress channels open under the sentinel's blocklist; 0 of 8 under a maximal
blocklist but `SoapClient` and `mysqli` still egress; and the hardening never applies at all because
`php_ini_loaded_file()` returns empty on the CLI SAPI at `agent.js:1765`, `php.ini` is regenerated
from `php.ini.hbs` on every start erasing the write at `:1772`, and it would govern PHP-FPM while
every check runs through `wp_eval` = CLI SAPI). The question is therefore not *how do we make the
sandbox safe* but *is one check worth a sandbox*. Stated that way it answers itself.

---

## Classification table

83 units. Ordered by requirement, then by detection value descending within each band.

### PHP-EXEC — 1 unit

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| FS-MISMATCH `:2133` | T2 DB | PHP-EXEC | no | no [^1] | high | Raw `$wpdb` admin count vs `count(get_users(['role'=>'administrator']))` with plugins deliberately loaded — catches account-hiding hooks |

### SHELL — 3 units, all incidental

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| `remoteSshRaw` `SentinelExecutor.ts:19` | transport | SHELL | n/a | yes | — | Spawns `ssh` against `<install>.ssh.wpengine.net`; the transport everything else can build on |
| `executeSentinelCommands` rm branch `:77-92` | transport | SHELL | n/a | yes | low | Prefixes `/nas/content/live/<install>/`, single-quotes the whole remainder, runs `rm -f` |
| `executeSentinelCommands` WP-CLI branch `:93-107` | transport | PHP-EXEC [^2] | n/a | yes | low | Every non-`rm` command → `remoteWpCliRun`, i.e. a WordPress bootstrap on production |

### NETWORK — 11 units

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| probe 6 `/wp-json/wp/v2/users` `:1071` | T2 behavioral | NETWORK [^3] | no | yes | high | Status + 500-byte body; ground truth for EXP-01 |
| CHK-01 `:2334` | T2 integrity | NETWORK + BYTES [^4] | no | yes | high | Fetches wordpress.org core manifest, `md5_file`s every core file |
| step 5a `:2884` | remediation | NETWORK + BYTES [^4] | no | yes | high | Manifest fetch, md5 compare, download clean file, rewrite, re-verify — the only cryptographic verification in the checklist |
| CHK-02 `:2383` | T2 integrity | NETWORK + BYTES [^4] | no | yes | medium | Same for up to 30 plugins via `downloads.wordpress.org/plugin-checksums` |
| `runCoreDiff` `:1420` | T2 helper | NETWORK + BYTES [^4] | no | yes | medium | Fetches originals from `core.svn.wordpress.org`, set-diffs lines |
| probe 3 Google referer `:1068` | T2 behavioral | NETWORK [^3] | no | yes | medium | Catches redirect-on-search-referral cloaking — best single cloaking probe |
| probe 2 Googlebot UA `:1067` | T2 behavioral | NETWORK [^3] | no | yes | medium | The cloaking comparison leg |
| probe 1 browser GET `/` `:1066` | T2 behavioral | NETWORK [^3] | no | yes | low | Cloaking baseline |
| probe 4 `/wp-login.php` `:1069` | T2 behavioral | NETWORK [^3] | no | yes | low | Status only; 200 is the normal state of nearly every site |
| probe 5 `/xmlrpc.php` `:1070` | T2 behavioral | NETWORK [^3] | no | yes | low | Status only; cannot detect what it claims — a live xmlrpc answers GET with 405 |
| LOG escalation `fetch_log_window` `:571` | T1 | CACHE (NETWORK ingest) | no | yes | low | Fetches a 30-day raw window and discards it at `:576` |

### SQL — 8 units

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| DB-02 `:2216` | T2 DB | SQL | no | yes | high | Greps first 500 chars of every `autoload='yes'` option for `eval`/`base64_decode`/`<script`/`exec`/`system` |
| DB-05 (proposed) | T2 DB | SQL + BYTES [^5] | no | yes | high | Diff scheduled cron hooks against hooks any file on disk registers — not implemented, best value-per-line addition available |
| DB-01 `:2163` | T2 DB | SQL | no | yes | medium | 200 recent posts, first 1000 chars, injected-script and spam-keyword regexes |
| step 2 lock attacker admins `:2759` | remediation | SQL | no | yes | medium | Score admins on username/email/registration clustering, then wipe app passwords / demote / randomise password |
| collector 5 options + tables `:1032` | T2 collector | SQL | no | yes | medium | Autoloaded option names, four critical option values, `SHOW TABLES` minus the 12 core tables |
| DB-03 `:2252` | T2 DB | SQL | no | yes | low | Serialized PHP objects (`O:<n>:"…"`) in admin usermeta |
| DB-04 `:2294` | T2 DB | SQL | no | yes | low | 50 recent approved comments, casino keywords and long URLs — **delete, do not port** |
| collector 4 posts sample `:1021` | T2 collector | SQL | no | yes | low | 200 posts; broken as wired — `content_preview` is fetched at `:1026` and discarded by `fmtPosts` at `:1121` |
| step 5d delete spam posts `:2987` | remediation | SQL | no | yes | low | `wp_delete_post($id, true)` per DB-01 evidence ID |
| step 5g clear autoloaded options `:2861` | remediation | SQL | no | yes | low | `option_value=''` per DB-02 evidence name, re-read, `wp_cache_flush()` |

### BYTES — 27 units

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| FS-01 mu-plugins allowlist `:1817` | T2 FS | BYTES | no | yes | high | Unexpected `*.php` directly in `mu-plugins/` against an 8-name allowlist — top persistence location |
| FS-02 obfuscation scan `:1850` | T2 FS | BYTES | no | yes | high | Recursive scan of plugins/mu-plugins/themes for 9 obfuscation-chain regexes |
| FS-03 web-root PHP `:1900` | T2 FS | BYTES | no | yes | high | Unknown `*.php` at the doc root against a 15-name core allowlist, plus 3 regexes over languages/ and uploads/ |
| FS-04 PHP in uploads `:1950` | T2 FS | BYTES + SQL [^6] | no | yes | high | Any `.php` anywhere under the uploads dir |
| FS-06 ELF finder `:2018` | T2 FS | BYTES | no | yes | high | First 4 bytes of every non-text file in wp-content vs `\x7fELF` — the most literally byte-only unit here |
| TC-01 temporal clustering `:2506` | T2 behavioral | BYTES | **yes** | yes | high | >3 files sharing an mtime window; the agent calls it "the primary signal of an automated attack" |
| collector 1 recent files `:960` | T2 collector | BYTES | **yes** | yes | high | Files modified in 30 days under ABSPATH minus wp-admin/wp-includes; sole input to TC-01 |
| collector 3 obfuscation scan `:996` | T2 collector | BYTES | no | yes | high | Duplicates FS-02 with a 5-pattern subset — collapse into one Node function |
| step 8 final clean re-scan `:3085` | remediation | BYTES | no | yes | high | The only end-to-end "is it clean now" check; `executableCommand` is null so it never runs on production |
| `runRootFileAnalysis` `:1275` | T2 helper | BYTES | no | yes | high | One-level base64+gzinflate decode, classify into webshell / uploader / dropper / spam / mailer — never evals the payload |
| verdict + coverage derivation `:3292` | remediation | BYTES | no | yes | high | Intersects critical signals against `SIGNAL_REMEDIATION_STEP`; emits READY / NOT SAFE TO PUSH |
| `steps[].command` mapping `:3328` | remediation | BYTES | no | yes | high | Maps checklist items to the production command set — the joint where the architecture's central claim fails |
| FS-05 .htaccess rules `:1978` | T2 FS | BYTES | no | yes | medium | Every `.htaccess` under the root, 3 regexes (PHP-in-uploads, external RewriteRule, auto_prepend/append) |
| FS-07 network indicators `:1563` | T2 helper | BYTES [^7] | no | yes | medium | Extracts IPs and URLs from already-flagged files, filters RFC-1918 and a trusted-suffix list. Makes no network request |
| `runElfStrings` `:1476` | T2 helper | BYTES [^8] | no | yes | medium | md5s the first ELF, extracts printable runs, filters against 9 IOC regexes |
| `runContentExamination` `:1190` | T2 helper | BYTES | no | yes | medium | First 3000 bytes of up to 10 flagged files; 13 dangerous function names, IPs, URLs, md5, preview |
| `runObfuscationDecoder` `:1365` | T2 helper | BYTES | no | yes | medium | Decodes long base64 literals in up to 3 FS-02 files; duplicates `runRootFileAnalysis:1300-1310` |
| collector 0 plugin dirs + mtimes `:945` | T2 collector | BYTES | **yes** | yes | medium | Per-plugin-dir name, mtime, recursive file count |
| step 4 verify no PHP in uploads `:2801` | remediation | BYTES | no | yes | medium | Runs unconditionally, so it can newly discover an uploads webshell Tier 2 missed; `executableCommand` null |
| `executeChecklist` `:3128` | remediation | BYTES | no | no [^9] | medium | Step runner and pass/fail arbiter; coupled to PHP only because `toolName` is hardcoded to `wp_eval` |
| ABS-08 timestamp backdating `:2095` | T2 FS | BYTES | no | yes | low | Plugin PHP containing both `touch(` and one of `scandir\|glob\|RecursiveIterator` — highest FP rate in the group |
| ABS-09 attacker filenames `:2055` | T2 FS | BYTES | **yes** [^10] | yes | low | 14 hardcoded attacker-tool basenames; size and mtime as evidence |
| collector 2 .htaccess contents `:981` | T2 collector | BYTES | no | yes | low | Every `.htaccess` and its full contents. Misses `.user.ini`, which is what actually executes on a PHP-FPM platform |
| step 1 remove mu-plugin webshells `:2737` | remediation | BYTES | no | yes | low | Deletes non-allowlisted `*.php` from mu-plugins; production replay is a hardcoded single filename |
| step 3 remove attacker plugins `:2788` | remediation | BYTES | no | yes | low | `rm -rf` on 7 hardcoded slugs plus slugs regexed out of signal titles; runs unconditionally |
| step 4b delete PHP from uploads `:2818` | remediation | BYTES | no | yes | low | Same walk plus unlink; production replay is not a WP-CLI command and fails every time |
| step 5b remove web-root PHP `:2943` | remediation | BYTES | no | yes | low | Deletes FS-03 evidence at ABSPATH with a realpath containment check |
| step 5c remove injected plugin files `:2965` | remediation | BYTES | no | yes | low | Deletes ABS-09 evidence under wp-content; `executableCommand` null |
| step 5e remove ELF binaries `:3009` | remediation | BYTES | no | yes | low | Byte-identical to 5c — collapse them |
| step 5f neutralise .htaccess `:2836` | remediation | BYTES | no | yes | low | Drops lines matching 5 patterns, rewrites the file |
| step 6 shuffle salts `:3031` | remediation | BYTES [^11] | no | yes | low | Eight `define()` rewrites in wp-config.php, currently `shell_exec('wp config shuffle-salts')` |
| step 7 DISALLOW_FILE_EDIT `:3044` | remediation | BYTES | no | yes | low | Greps mu-plugins, splices a `define()` after the opening `<?php` |
| collector 6 core checksums `:1048` | T2 collector | SHELL [^12] | no | yes | low | `shell_exec('wp core verify-checksums')` — a strictly worse duplicate of CHK-01, which ran in the same function |

### CACHE — 26 units (all of Tier 1)

| ID | group | requires | mtime? | remote? | value | what |
|---|---|---|---|---|---|---|
| LLM-USER-01 `:790` | T1 | CACHE | no | yes | high | LLM audit of cached admin usernames/emails — the only unit that catches `admin_MT6ZqT` on the first scan with no baseline |
| REL-01 new plugin slug `:874` | T1 | CACHE [^13] | no | yes | high | Slug present now, absent from baseline |
| REL-03 new admin username `:906` | T1 | CACHE [^14] | no | yes | high | Username present now, absent from baseline |
| `collectFleetData` `:44` | T1 | CACHE | no | yes | medium | Three `fleet_sql` calls per site; `wpe_site_deep_refresh` only for never-synced installs |
| LOG-DIST `:564` | T1 | CACHE | no | yes | medium | Peak single-day distinct attacker IPs > 50 — the most genuinely informative of the four LOG checks |
| `storeBaseline` / `loadBaseline` `:850` | T1 | CACHE | no | yes | medium | Single per-install baseline, written unconditionally at `:437` *including after critical signals* |
| ABS-04 file managers `:653` | T1 | CACHE | no | yes | medium | 5-entry file-manager slug list — best-reasoned of the ABS checks, wrong category |
| EXP-01 user enumeration `:774` | T1 | CACHE [^15] | no | yes | low | Fires when none of 7 security-plugin slugs is active. Inspects nothing about the REST API |
| EXP-03 DISALLOW_FILE_EDIT `:748` | T1 | CACHE [^16] | no | yes | low | Fires on absence of a key only an opt-in scheduler ever writes |
| EXP-05 WP_DEBUG `:762` | T1 | CACHE [^16] | no | yes | low | Fires on presence, so silent in exactly the default-config case where the key is missing |
| ABS-06 default salts `:679` | T1 | CACHE [^17] | no | yes | low | Scans `settings_json` for `put your unique phrase here`. **Unconditionally dead** — salts are wp-config constants and no writer puts them there |
| LOG-AUTH `:469` | T1 | CACHE | no | yes | low | >100 non-302 POSTs to wp-login/xmlrpc over 30 days = 3.3/day, a constant on every public site |
| LOG-PROBE `:548` | T1 | CACHE | no | yes | low | >50 hits on any single probe path over 30 days — baseline internet weather |
| LOG-ENUM `:556` | T1 | CACHE | no | yes | low | >20 enumeration attempts — measures that attackers tried, not whether they succeeded |
| FLEET-01 shared suspicious slug `:166` | T1 | CACHE | no | yes | low | Tautological as wired — reduces to "`wp-compat` appears on 2+ installs" |
| FLEET-02 shared admin email domain `:189` | T1 | CACHE | no | yes | low | Confirmed logic bug: gates on REL-03 then iterates **all** admins at `:194`, not the new ones |
| ABS-01 `admin` username `:616` | T1 | CACHE | no | yes | low | A brute-force target, not evidence of compromise; miscategorised as high/active-compromise |
| ABS-02 >3 admins + <100 posts `:628` | T1 | CACHE | no | yes | low | `post_count` is NULL on the default sync path, so the gate is unconditionally true |
| ABS-03 `@example.com` admin `:640` | T1 | CACHE | no | yes | low | Critical severity indefensible — attackers need a deliverable mailbox for the reset link |
| ABS-05 known backdoor slugs `:666` | T1 | CACHE | no | yes | low | `KNOWN_BACKDOOR_SLUGS` is `new Set(['wp-compat'])` — one IOC, no update path |
| ABS-07 short slug "entropy" `:691` | T1 | CACHE | no | yes | low | Measures length, not entropy, with a ceiling at 6 chars — **delete** |
| REL-02 plugin activated `:889` | T1 | CACHE | no | yes | low | `wp:plugin.activated` is a declared trigger at `:317`, so the event that starts the sweep is the event this detects |
| REL-04 admin count without new name `:920` | T1 | CACHE | no | yes | low | Near-unreachable — WordPress forbids duplicate usernames. **Delete as written** |
| `parseSqlResult` `:124` | T1 | CACHE | no | yes | low | Markdown-table parser; drops any row whose column count mismatches — a plugin name containing `\|` evades detection |
| Tier 1 verdict emission `:420` | T1 | CACHE | no | yes | low | Emits `clean` when the signal array is empty. Where the tier's false confidence is delivered |

**Footnotes — classifications the adversarial pass corrected**

[^1]: `remote_capable: false` for a hard reason. `eval` is in `BLOCKED_COMMANDS`
(`remote-exec.ts:12`), enforced inside `remoteWpCliRun` *before* any environment check — so
`eval.ts:17`'s "LOCAL SITES ONLY" is enforced in code, and `wp_eval`'s own remote branch
(`eval.ts:52-57`) is dead.
[^2]: Reclassified from SHELL. The `rm` branch is SHELL; the WP-CLI branch bootstraps WordPress on
production, so mu-plugins load on every one of these calls regardless of flags.
[^3]: Confirmed the URL at `:2463` is `https://<install.name>.wpengine.com` — the **live production
site over the public internet**, not the sandbox. All six probes are therefore entirely independent
of the sandbox question and could run in Tier 1 today. SEC-12 blocks that: for `source==='local'`
sites, `install.name` is a Local site name, so the agent sends UA-spoofed Googlebot traffic to a
*stranger's* production install.
[^4]: The site-facing leg is pure BYTES (md5 over a read stream). The only NETWORK requirement
targets wordpress.org, not the scanned site — so it is unaffected by every containment question, and
moving it to Node removes the reason `WP_ACCESSIBLE_HOSTS` is punched into the sandbox at `:1798`.
[^5]: Looks like PHP-EXEC (`has_action()` / `$wp_filter`) and is not. The cron option is one row a
dump carries in full; "does anything register this hook" is a grep for `add_action('<hook>'`.
Reading raw is *more* trustworthy than the API, because `_get_cron_array()` runs
`apply_filters('cron_array', …)` and a malicious plugin can hide its own event from anything that
reads through WordPress.
[^6]: Corrected from pure BYTES. `wp_upload_dir()` checks `defined('UPLOADS')` **before** the
`upload_path` option, and appends `/sites/{blog_id}` on multisite subsites gated by
`ms_files_rewriting` in `{prefix}sitemeta`. Both are recoverable — one wp-config grep and one more
row — but "at most one row lookup" undercounted it.
[^7]: The name says NETWORK; the code makes no request. `file_get_contents` + two `preg_match_all` +
`ip2long` arithmetic + `parse_url` host matching.
[^8]: Corrected from SHELL. `strings(1)` is a scan for runs of ≥4 printable bytes. On macOS the
`shell_exec` invokes **BSD** strings, which does a raw whole-file byte scan with no ELF-section
awareness — exactly what a naive Node Buffer scan produces, so the port reproduces current runtime
behaviour more faithfully than a GNU-strings model would suggest.
[^9]: `remote_capable: false` only because `item.toolName` is hardcoded to `wp_eval` at every call
site and again in the verify path at `:3165`. Re-pointing it at Node functions is a signature
change, not a capability change.
[^10]: mtime is used only in the evidence string at `:2074`, never in the detection decision — so
losing it degrades a report line, not a signal.
[^11]: Corrected from SHELL. Salt rotation is eight `define()` line replacements with
`crypto.randomBytes`. Note `shell_exec` is on the sandbox's own blocklist at `:1767`, so on the day
hardening is actually delivered this step breaks silently — and with `expectedEmpty:false` and no
verify key, `executeChecklist:3157-3160` marks it passed regardless.
[^12]: SHELL as written; the underlying work is BYTES + NETWORK, and CHK-01 at `:2337` already does
exactly that in-process with an explicit comment saying "no nested wp-cli". **Delete it** and pass
CHK-01's parsed result to the integrity specialist.
[^13]: The *check* is CACHE; its *value* requires SHELL. With `wpeSyncAutoEnabled` and
`wpeRefreshAutoEnabled` both defaulting false and `collectFleetData` refreshing only never-synced
installs, `current == baseline` every sweep and this can never fire.
[^14]: Convertible to an absolute check with no baseline at all. `wp user list --format=json`
returns `user_registered`; `WPESyncService.ts:416-426` receives it and throws it away, setting
`created_at` to the sync timestamp. Persisting the real value turns REL-03 from a diff into
"administrator account created 3 hours ago" — fires on first sight, needs no state, survives a lost
baseline.
[^15]: CACHE as written; the measurement it is guessing at is NETWORK and **already exists in this
file** at `:1071`. The detail string at `:781` reads as a measurement of the REST API; the code
checked a plugin list.
[^16]: CACHE as written; the real requirement is SHELL (two lines in `deep-refresh.ts`'s
`settingsKeys` loop using `wp config get`). EXP-03 additionally cannot distinguish "not defined"
from "never collected", because `deep-refresh.ts:359` *replaces* `settings_json` rather than merging
— so any agent-triggered refresh erases the key permanently.
[^17]: CACHE as written and **never able to fire on any machine**. Verified against all three
writers: `deep-refresh.ts:111-137`, `BulkOperationManager.ts:480-486`,
`WpeRefreshScheduler.ts:290-315` — every one writes `wp_options` values only. Salts are wp-config
constants. Real requirement: SHELL (`wp config get AUTH_SALT`) or BYTES. Wire it or delete it.

---

## The units that genuinely need PHP to execute

**FS-MISMATCH, `agent.js:2133-2156`. That is the entire set.**

It compares two numbers: a raw `$wpdb` count of users whose `capabilities` meta contains
`administrator`, and `count(get_users(['role' => 'administrator']))`. The signal *is* the delta.

The left-hand number is reachable from bytes or a dump exactly — count distinct `user_id` in
`{prefix}usermeta` where `meta_key = '{prefix}capabilities'` and the value contains
`administrator`. No unserialization is needed; the current code substring-matches the serialized
blob.

The right-hand number is not a fact about bytes. `get_users()` builds a `WP_User_Query`, which fires
`pre_get_users` (mutates query args) and `users_pre_query` (returns an arbitrary result set and
skips the SQL entirely). A plugin hooked on `users_pre_query` hands back whatever array it wants and
no query ever runs — so there is no file and no row that records what the answer would have been. A
plugin can also condition its cloaking on runtime state (current user, time, request origin) that
resolves only when the hook executes. Asking "did an executing hook change the answer" is
definitionally an execution-dependent question.

This is why the check is the one `wp_eval` call in the file that omits `skip_plugins` / `skip_themes`
— the omission is deliberate and commented. It is also the one unit that intentionally detonates
attacker code.

Two adjacent claims that do **not** rescue a bytes-only version:

- Recomputing both sides from the same dump produces `db == wp` by construction and permanently
  silences the detector. That is the most likely way a port gets this wrong.
- Hitting the sandbox's live REST `/wp-json/wp/v2/users` instead of `wp_eval` does not change the
  classification — it moves which SAPI runs the same plugin code. The hooks still execute.

A partial static substitute exists: grep plugin and mu-plugin sources for `pre_user_query`,
`users_pre_query`, `pre_get_users`, `users_list_table`, `found_users`. That finds the *mechanism*
without observing the *effect* — strictly weaker, much higher FP, and blind to a hook name assembled
at runtime. It is a reasonable consolation prize, not an equivalent.

**Fix the two live bugs before deciding this unit is worth anything at all.** `meta_key` is
hardcoded `'wp_capabilities'` at `:2138` but the real key is `{$wpdb->prefix}capabilities` — on any
site with a non-`wp_` prefix (common on WPE) `$count` is 0, `counts.db` is falsy at `:2146`, and the
check silently never fires. And that same guard no-ops when a backdoor hides *all* admins
(`wp === 0`), which is the most severe case it exists to catch. As shipped, FS-MISMATCH does not
work on a large fraction of the fleet and does not work at all in its worst case.

**What one unit implies.** The whole Tier 2 apparatus — `local_clone_site` or `local_create_site` +
`local_wpe_pull` (`:1669-1750`), the `disable_functions` write and `local_restart_site` and 15×2 s
readiness poll (`:1755-1789`), the `WP_HTTP_BLOCK_EXTERNAL` wp-config patch (`:1791-1807`) — exists
to host a single check that is currently broken on non-default prefixes. And there is a strictly
better transport for it: run the SQL side over the dump in Node, and get the WordPress side from
`wp user list --role=administrator --format=count` over SSH WP-CLI on the WPE server
(`SentinelExecutor.ts:18-52` proves the raw-SSH channel works against production). The attacker's
code then detonates on WP Engine's box, where it already runs every time someone loads the site,
rather than on Jeremy's laptop. That requires widening `wpeAllowedEnvironments` for reads, and it
carries a time-of-check/time-of-use caveat the single-process version does not have — two reads,
two snapshots, so anything mutating between them (cron, the implant itself) produces a false
positive.

---

## Getting the bytes

### The minimum byte set is far smaller than the sandbox

Measured on three real sites on this machine:

| site | total | PHP in plugins+mu-plugins+themes | files under webroot | wp-admin + wp-includes |
|---|---|---|---|---|
| `newsroom-demo` | 4.1 GB (4.0 GB uploads) | **11.1 MB** / 5,634 files | 18,375 | — |
| `myloop` | 210 MB | 22.1 MB | 9,224 | 3,485 |
| `alpine-outfitters` | 242 MB | 42.2 MB | 14,855 | 3,485 |

PHP volume tracks plugin count, not site size — the 4.1 GB site has the *least* PHP. Every byte the
BYTES units read falls into five buckets:

- **A. PHP text** under `plugins/`, `mu-plugins/`, `themes/`, `languages/`, `uploads/`, and webroot
  `*.php` — 11–42 MB. Read by FS-02, FS-03, ABS-08, ABS-09, collector 3, step 8, and the three
  content helpers.
- **B. Config text** — `wp-config.php`, `wp-includes/version.php`, every `.htaccess`, and (missing
  today) every `.user.ini`. Kilobytes.
- **C. A metadata manifest** — path, size, mtime, ctime for every file under the webroot minus
  `wp-admin`/`wp-includes`. 18,375 lines ≈ 1.8 MB raw, **~300 KB gzipped**. Serves TC-01,
  collectors 0 and 1, ABS-09's evidence, FS-01, FS-03's root-file half, and FS-04.
- **D. 4 bytes per non-text file** in wp-content for FS-06 — ~60 KB of payload if computed at the
  source, ~4 GB if you ship the files.
- **E. md5 per core file** for CHK-01 — 3,485 hashes ≈ 150 KB, plus md5 per plugin file for CHK-02.

`uploads/` is 97% of `newsroom-demo`, and the only thing FS-04 asks of it is *"is there a `.php` in
here"* — a filename question. **No unit needs the uploads bytes.** Honest minimum: **A+B+C+D+E ≈
15–45 MB**, against sandboxes of 92 MB to 4.1 GB. And if the greps run at the source, A collapses to
only the flagged files — kilobytes on a clean site.

### The transport already exists

`remoteSshRaw` (`SentinelExecutor.ts:19-54`) spawns `ssh` with `-i ~/Library/Application
Support/Local/ssh/wpe-connect`, `local+ssh+<install>@<install>.ssh.wpengine.net`, and multiplexing
(`ControlMaster=auto`, `ControlPath=/tmp/ssh-nexus-%C`, `ControlPersist=30s` at `:35-37`) — so N
commands per install cost one handshake. It takes an arbitrary command string and returns stdout.
Install root is `/nas/content/live/<install>/` (`:87`).

The shape that matters is **compute at the source, ship only the answer**:

- Manifest (C): `find . -path ./wp-admin -prune -o -path ./wp-includes -prune -o -type f -printf
  '%P\t%T@\t%C@\t%s\n'` — one round trip, ~300 KB gzipped.
- Detection (A): `grep -rlE '<the nine FS-02 patterns>' --include='*.php'
  wp-content/{plugins,mu-plugins,themes}` returns **filenames only**. On a clean site that is zero
  bytes. Then `head -c 3000` / `cat` only the hits — which is exactly what `runContentExamination`
  (`:1190`) and `runRootFileAnalysis` (`:1275`) already want as input.
- ELF (D): `find wp-content -type f -exec head -c4 {} +`, source-side.
- Integrity (E): `find wp-admin wp-includes -type f -print0 | xargs -0 md5sum` — hashes over the
  wire, compared in Node against the api.wordpress.org manifest Node fetched itself.
- Database: `mysqldump` over the same channel, credentials parsed from wp-config.php bytes, streamed
  to stdout. `wp db export` is **not** an option remotely — `db export` is absent from
  `ALLOWED_REMOTE_COMMANDS` and `db query`/`db cli` are explicitly blocklisted
  (`remote-exec.ts:12-33`). Selective: `--tables options users usermeta comments` is a few MB;
  `posts` is the bulk and can be a second, opt-in call.

None of this executes PHP or bootstraps WordPress, so the mu-plugin problem (`--skip-plugins` does
not skip mu-plugins, so a malicious mu-plugin executes on every `wp_eval`) does not apply. That is a
**strictly stronger containment position than the sandbox**: today FS-01 scans `mu-plugins/` using a
PHP process that already loaded the mu-plugin webshell.

**Does `wpeAllowedEnvironments` block it? No — and that is itself a finding.**
`SentinelExecutor.ts` imports no environment filter; `checkWpeInstallEnvironmentAccess`
(`environment-filter.ts:33-52`) is consulted only on `remoteWpCliRun` paths. `remoteSshRaw` reaches
production today with no gate. Making that *legitimate* rather than accidental needs two things:
(a) a `wpeReadOnlySshAllowed` setting distinct from the WP-CLI gate, defaulting on for production —
the risk model genuinely differs, `find`/`grep`/`md5sum` cannot mutate; and (b) replacing
`remoteSshRaw`'s arbitrary-string interface with an allowlisted verb set
(`find|grep|head|cat|md5sum|mysqldump`) plus real argument escaping. Today it single-quotes one
concatenated path (`:85-86`), which is the same weakness behind the multi-file `rm` false-success
bug at `:81-92`.

### mtime preservation, per transport

| transport | mtime | ctime | note |
|---|---|---|---|
| `find -printf '%T@ %C@'` over SSH | **exact, source-side** | **exact** | the only option that yields ctime |
| `tar -c` piped over SSH → Node tar parser | preserved (1 s granularity) | lost | also preserves modes |
| `rsync -a` (what `local_wpe_pull` resolves to, `wpe-pull.ts:158`) | preserved | lost | UNKNOWN whether Local passes `-a`/`-t` |
| `scp` without `-p`, plain `cat`, `grep` output | **destroyed** | lost | |
| `local_export_site` zip round-trip | 2 s granularity, timezone-dependent | lost | |

Two consequences. First, **the current sandbox path degrades mtime evidence twice**: the clone/pull
may or may not preserve it, and then `:1791-1807` rewrites `wp-config.php` *before any check runs*,
resetting the mtime of the single file most relevant to credential exfiltration. A source-side
`find` has neither problem, and TC-01 is the highest-value behavioral signal in the agent.

Second, **ctime is the upgrade nobody has taken.** `touch()` backdating — ABS-08's target, and the
reason the report carries a "timestamps are unreliable" caveat at `:3242` — rewrites mtime and
cannot rewrite ctime. No copy transport carries ctime; only a source-side stat does. `mtime << ctime`
on a plugin file is a far higher-precision anti-forensics signal than ABS-08's `touch( && glob(`
conjunction, and it costs one extra `%C@` in a format string.

### The `.sql` dump versus live queries

A dump substitutes for all four implemented DB units plus DB-05, and is a net **detection gain**:

- DB-01 truncates at `LEFT(post_content,1000)` (`:2169`) — so an injection appended at the *end* of
  a long post, the most common placement for hidden spam divs, is invisible today. DB-02 truncates
  at `LEFT(option_value,500)` (`:2222`) against option payloads that are routinely multi-kilobyte
  serialized blobs. Collector 5 truncates the `cron` option twice (`LEFT(…,300)` at `:1038`, then
  `.slice(0,100)` at `:1126`). A dump has the full column in every case.
- DB-02's self-declared `autoload='yes'` blind spot (`:3251`) disappears for free — scanning all
  options costs nothing extra on a dump.
- **The table prefix stops being a problem.** The dump carries ``CREATE TABLE `xyz_options` ``, so
  the prefix is self-evident from the bytes. That is *more* robust than the current code, which
  hardcodes `'wp_capabilities'` at `:2138` and `:2260` and silently returns zero on any randomized-
  prefix WPE install.
- Raw reads cannot be lied to by a hook, which live WordPress reads can (`cron_array`,
  `pre_user_query`).
- Serialized parsing is needed only for DB-05's cron diff.
  `src/main/content/extractors/php-unserialize.ts` already exists and is tested — but its `s:N:"…"`
  handling slices by JS characters where PHP's length prefix counts UTF-8 **bytes**, and there is no
  multi-byte test case. Fix before reuse.

### What this means for a cheap fleet-wide tier that must not pull

The constraint is satisfiable. Tier 1's real problem is not transport — it is that
`signals.length === 0` prints "clean" (`:420-422`, `:456-460`) while as many as nine checks silently
did nothing: ABS-06 always, EXP-03/EXP-05 under the default configuration, the whole LOG-* family
when no log source is configured (`:477`, `:488`, `:496` all return empty with only a `log.info`),
and every content-derived check because it lives behind the escalation gate at `:423`.

**Zero-byte, zero-SSH additions:** STALE-01 (`now − ssh_last_sync_at`, already SELECTed at `:62`,
captured at `:106`, never compared); REL-03 as an absolute check by persisting the real
`user_registered` that `WPESyncService.ts:416-426` already receives; and the EXP-01 conversion — one
unauthenticated GET of `/wp-json/wp/v2/users`, where the fetch helper exists at `:1058-1064` and the
probe exists at `:1071`. Fix SEC-12 first, or fleet-wide scheduling means continuously sending
UA-spoofed traffic to strangers' installs.

**One SSH round trip per site buys the three highest-value content signals with no pull:**
`ls wp-content/mu-plugins/*.php` (FS-01), `grep -rl` over the three code dirs (FS-02), `find
wp-content/uploads -name '*.php'` (FS-04). On a clean site the combined response is **tens of
bytes** — less data than the markdown table `fleet_sql` already returns. Multiplexing makes it one
handshake.

**Budget honestly.** The full manifest (~300 KB gzipped) and the md5 sweep are a *daily* per-install
cost, not a `*/15` one. At 96 sweeps/day the grep-only trio is fine; the manifest is not. Split the
schedule. Likewise the six HTTP probes at `*/15` are 576 requests/site/day — daily, or
event-triggered.

**UNKNOWN, and what settles each:** (1) whether Local's `local_wpe_pull` passes `rsync -a` — `stat`-
compare one pulled file against `find %T@` on the install, ten minutes; (2) whether WPE's SSH
environment permits `mysqldump` and long `grep -r` runs without throttling or a CPU kill — run both
against one staging install and time them; (3) whether `find -printf` is available (GNU coreutils
assumed on WPE's Linux, unverified) — one `ssh <install> 'find --version'`.

---

## What this means for the open forks

| fork | what this classification settles | what remains the owner's call |
|---|---|---|
| **1. Is a sandbox needed at all?** | Settled to one unit. 82 of 83 units need no PHP execution; the sandbox exists to host FS-MISMATCH, which is broken on non-default table prefixes (`:2138`) and silent in its worst case (`:2146`). | Whether one high-value-in-principle signal justifies keeping a PHP execution path, or whether the `pre_user_query`/`users_pre_query` grep substitute is enough. If you keep it, whether to run it over SSH WP-CLI on WPE's box rather than in a local sandbox — which needs `wpeAllowedEnvironments` widened for reads and accepts a TOCTOU window. |
| **2. Containment approach** | Settled, and it dissolves rather than resolves. A function blocklist is a partial fix at best (spike S1: maximal blocklist reaches 0/8 by the canary but `SoapClient` and `mysqli` still egress), and per-sandbox OS isolation is unavailable because PHP-FPM, nginx and MySQL all run as the user's own account. Node-over-bytes gives *perfect* containment because no PHP runs. | Nothing about which containment mechanism — that question stops existing for 82 units. What remains: whether to deliver `PHP_INI_SCAN_DIR` hardening anyway as a cheap belt for whatever `wp_eval` survives. Verified deliverable: `WpCliService.ts:144-146` merges `{...phpService?.env, ...opts?.env}` and passes it at `:173`; the addon's `WpCliRunOpts` (`local-services-bridge.ts:40-48`) has no `env` field, so the gap is adding one and threading it through `eval.ts`. |
| **3. Give the cheap tier a content-derived signal** | Settled, and cheaper than expected. Three signals (FS-01, FS-02, FS-04) cost one multiplexed SSH round trip and tens of bytes on a clean site. EXP-01→NETWORK costs one HTTP GET and needs no bytes at all. | Scheduling: which signals go at `*/15`, which go daily, which are event-triggered. And whether `wpeReadOnlySshAllowed` is a setting worth introducing or whether `remoteSshRaw`'s existing ungated production access is left as-is (it is currently an accidental bypass, not a decision). |
| **4. Remediation: sandbox rehearsal or direct?** | **Settles nothing about whether rehearsal is valuable, but destroys the claim that it currently happens.** `executableCommand` is a hand-written parallel string, not a rendering of what the sandbox executed. Of 15 steps only 8 carry one; of those, step 1's is a hardcoded single filename, 4b's is not a WP-CLI command at all, 5a's uses a different mechanism, 5b's multi-file form silently no-ops (`SentinelExecutor.ts:81-84`). Steps where the sandbox-proven command is the production command: approximately two (3 and 5d), under different flags. | Whether to build real rehearsal (which needs a post-remediation page-load probe that does not exist — step 5g, emptying an option a live plugin dereferences, is the one genuine fatal-error risk and nothing catches it), or drop the pretence and make remediation a reviewed diff plus direct SSH execution with per-step verification. |
| **5. Report honesty** | Settled: the fix is transport-independent and costs one string. Enumerate what was actually checked instead of printing `clean` on an empty signal array. | Nothing. This is unambiguous and should ship regardless of every other fork. |
| **6. Atlas deployment path** | Partially settled. CACHE, SQL, NETWORK and SSH-sourced BYTES units all work identically from Atlas; the six HTTP probes already target live production over the public internet (`:2463`). PHP-EXEC and anything requiring a local sandbox do not. | Whether losing FS-MISMATCH is acceptable as the price of a deployment target that needs no Local install — which is the same question as Fork 1, arriving from the other direction. |

---

## Sequenced moves

Order and rough size only. Not an implementation plan.

**Wave 0 — cheap, independent, ship regardless of every fork (hours)**

1. **Call `local_stop_site` when a Tier 2 scan ends.** *Tiny.* Verified: `agent.js` invokes
   `local_start_site`, `local_clone_site`, `local_create_site`, `local_wpe_pull` and
   `local_restart_site` — and never `local_stop_site`. Every sandbox is left running with PHP-FPM,
   nginx and MySQL serving a known-compromised site under the user's own account, indefinitely,
   accumulating one per scan. Unblocks: removes the worst live consequence of the current
   architecture while the architecture is being decided.
2. **Deliver hardening via `PHP_INI_SCAN_DIR` through `opts.env`.** *Small.* Verified deliverable:
   `WpCliService.ts:144-146` merges `{...phpService?.env, ...opts?.env}` into the spawn env at
   `:173`. The addon's `WpCliRunOpts` (`local-services-bridge.ts:40-48`) declares no `env` field, so
   the work is adding one, threading it through `eval.ts`, and writing a Nexus-owned scan-dir ini.
   This replaces the entire `php_ini_loaded_file()` + append + `local_restart_site` + 30 s poll block
   at `:1755-1789`, which never applies for three structural reasons and costs 30 seconds per scan
   to accomplish nothing. Note this makes hardening *real*, which will break step 6 and collector 6
   (both `shell_exec`) — fix or delete those in the same change. Unblocks: honest containment for
   whatever PHP survives; removes a 30 s no-op from every Tier 2 run.
3. **Tier 1 verdict honesty.** *Tiny.* Replace `clean` with an enumeration of what was actually
   checked, plus `graph.db last synced N days ago` and `log data unavailable`. Unblocks: stops the
   tool lying 96 times a day while everything below is built.
4. **Delete the units that should not be ported.** *Tiny.* ABS-07 (measures length not entropy, with
   a 6-char ceiling, and is the fastest route to an operator who stops reading HIGH findings),
   REL-04 (near-unreachable and its fix text describes work it never did), DB-04 (50 comments cannot
   support medium severity), collector 6 (a strictly worse duplicate of CHK-01 in the same
   function), ABS-06 (unconditionally dead — wire it to `wp config get` or remove it). Unblocks:
   the porting surface shrinks before anyone starts porting.

**Wave 1 — Tier 1 gets ground truth without touching a site (days)**

5. **STALE-01.** *Tiny.* `now − ssh_last_sync_at`, already SELECTed at `:62`. The signal that says
   the verdict is worthless. Unblocks: every other Tier 1 signal becomes interpretable.
6. **Fix SEC-12, then promote probe 6 and convert EXP-01 to NETWORK.** *Small.* Resolve the URL from
   the install's primary domain (CAPI) or `siteurl`, and skip `source==='local'` sites entirely
   before doing anything else. Unblocks: converts Tier 1's loudest permanent false positive into a
   measurement; the same trip can carry probes 2/3/5 at daily cadence.
7. **Persist real `user_registered` in `WPESyncService.syncInstall`.** *Small.* One field in an
   existing sync path (`:416-426`). Unblocks: REL-03 becomes an absolute first-scan check that needs
   no baseline and survives a lost one — the single highest-value fix in Tier 1.
8. **Make baselines append-only and refuse to baseline a compromised sweep.** *Small.* Currently
   written unconditionally at `:437-438`, so the compromised state overwrites the clean state within
   15 minutes and the pre-compromise plugin and admin lists — the most useful forensic artifact the
   tier holds — are destroyed. Unblocks: REL-01..04 fire in more than one window per intrusion.

**Wave 2 — the SSH read channel (a week or two)**

9. **Settle the three UNKNOWNs.** *Hours.* `find --version`, one `mysqldump` timing run, one `stat`
   comparison of a pulled file against `find %T@`. Unblocks: everything below, and cheaply falsifies
   the plan if WPE's SSH environment refuses.
10. **`wpeReadOnlySshAllowed` + an allowlisted verb interface on `remoteSshRaw`.** *Medium.* Replace
    the arbitrary-string interface with `find|grep|head|cat|md5sum|mysqldump` plus real argument
    escaping (which also fixes the multi-file `rm` false-success bug at `:81-92`). Unblocks: turns
    an accidental production bypass into a deliberate, auditable read channel — and this path must
    be wired through `auditDirectOperation`, since raw SSH against production reaches neither
    chokepoint.
11. **The three-grep Tier 1 content trio.** *Small, given 10.* FS-01, FS-02, FS-04 as source-side
    `ls`/`grep -rl`/`find`, one multiplexed round trip, tens of bytes on a clean site. Unblocks:
    Fork 3, delivered — the cheap tier gets a content-derived signal with no pull.
12. **The manifest + TC-01 in Node, on a daily schedule.** *Medium.* `find -printf '%P\t%T@\t%C@\t%s'`
    (~300 KB gzipped), then a deterministic sort-and-sliding-window in Node — replacing the current
    path where 500 files are collected in directory-iteration order (`:974`), truncated to the first
    60 unsorted (`:1105`), and handed to an LLM to bucket timestamps. Add the `mtime << ctime`
    check — free, and the one timestamp signal `touch()` cannot rewrite. Unblocks: the agent's
    self-declared "primary signal of an automated attack" starts working.

    **CORRECTION (measured 2026-08-03).** This line previously called `mtime << ctime` "strictly
    better than ABS-08" and concluded "ABS-08 becomes deletable". Both were wrong. Measured on
    `markshare`, **167 of 974** PHP files show >30d skew, and every one is a bundled theme or
    boilerplate `index.php` — archive extraction preserves the upstream mtime while setting a
    fresh ctime, so the skew is an artifact of *installation*, not of tampering. Ship it only
    scoped to files that fail, or are absent from, a checksum manifest. Do not delete ABS-08 on
    the strength of it.

    Same correction applies to the variable-variable pattern (`\$\$[a-zA-Z_]`) recorded elsewhere
    as zero-false-positive: that measurement covered only two sites' `wp-content`. Over full
    docroots, `myloop` returns **45 hit files**, all from one legitimate plugin
    (`press-permit-core`, which uses variable variables throughout). It needs a per-site learned
    baseline; it is not a hard signal.

**Wave 3 — port the rest, decide the sandbox (weeks)**

13. **One Node walk serving FS-02, FS-03, ABS-09, collector 3 and step 8.** *Medium.* These
    currently traverse the same tree separately and duplicate the same nine regexes in three places
    (`:1850`, `:996`, `:3102`). Watch the porting traps: read as Buffer/latin1 not utf8, carry the
    `/s` flag on pattern 5, replicate or knowingly fix the case-sensitive `getExtension()`, guard
    symlink cycles, and resolve `WP_CONTENT_DIR` from wp-config rather than assuming.
14. **`mysqldump` + a streaming INSERT parser; port DB-01, DB-02, DB-03 and add DB-05.** *Medium —
    the one non-trivial piece of engineering in the whole plan.* Escaping, extended inserts, binary
    blobs, byte-vs-character length in the existing `php-unserialize.ts`. Unblocks: removes every
    truncation limit, closes DB-02's acknowledged non-autoload blind spot, kills the hardcoded
    prefix bug, and makes DB-05 — the best value-per-line addition identified anywhere in this
    analysis — a small increment rather than a project.
15. **Move CHK-01/CHK-02 and the wordpress.org fetches to Node.** *Medium.* Parallelise, cache by
    version and by `slug@version` across the fleet, walk the filesystem as well as the manifest (a
    deleted core file is invisible today at `:2354`, and an *extra* file like `wp-includes/wp-tmp.php`
    is never detected at all). Unblocks: removes the reason `WP_ACCESSIBLE_HOSTS` is punched into
    the sandbox at `:1798` — the last hole in the containment story disappears with the sandbox.
16. **Decide FS-MISMATCH, then delete the sandbox or keep it for one check.** *The fork.* Fix the
    prefix and zero-admin bugs first so the decision is made about a working check. Unblocks:
    `:1669-1810` — clone/pull, hardening, restart, poll, wp-config patch — either goes away entirely
    or becomes a documented single-purpose cost.
17. **Rebuild remediation around real production actions.** *Large.* Add the second axis to
    `SIGNAL_REMEDIATION_STEP` — "has a production action" as well as "has a sandbox step" — so
    ABS-01/02/03, REL-03, LLM-USER-01, ABS-09, FS-06, FS-05 and DB-02 stop reading as covered while
    the live install is untouched. Fix `executeChecklist`'s else branch at `:3157-3160`, where steps
    2 and 6 cannot fail. Make step 8 run over SSH against production and make a clean result the
    definition of done.

---

## What this does not solve

**None of this stops a compromised production site from continuing to leak data and credentials.**

Everything above makes the sentinel *see* better and *contain itself* better. It does not shorten
the window between compromise and containment by a single second, because nothing in the design
takes the site off the internet, rotates what the attacker has already taken, or blocks the
attacker's next request. A site that FS-02 correctly flags at 09:00 is still serving the webshell at
09:01, and every one of the credentials in its `wp-config.php` — database, SMTP, any API key an
attacker dropped into an option or read out of the file — is still valid and still exfiltrating. The
scan is a smoke detector with no sprinkler. That is the owner's actual stated goal and this analysis
does not reach it.

Four narrower things it also does not solve:

- **A bytes-only sentinel is evadable by anyone who reads it.** Detection is regex over source and
  filenames against hardcoded lists: `KNOWN_BACKDOOR_SLUGS` is one entry; ABS-09 is 14 filenames
  defeated by `mv shell.php x.php`; FS-06's extension skip-list means an ELF renamed to `.png` is
  skipped by design (`:2023`); FS-01's glob is non-recursive so `mu-plugins/<dir>/payload.php` loaded
  by a stub is invisible. Porting to Node makes these faster and safer to run, not harder to evade.
  It also does not give the IOC lists an update path, which is the actual constraint on ABS-05 and
  FLEET-01.
- **Static analysis cannot see a hook's effect, and that gap is larger than FS-MISMATCH.** DB-05's
  `add_action('<hook>'` grep misses any hook name assembled at runtime; the `pre_user_query` grep
  substitute finds registration, not concealment. The class of attack that hides itself by executing
  is exactly the class bytes cannot reach — FS-MISMATCH is the only place the sentinel currently
  even tries.
- **Nothing here verifies the site still works after remediation.** No step issues an HTTP request
  to the site after the checklist runs. Step 5g empties an option a live plugin may dereference;
  step 7 splices a `define()` into wp-config.php with a `preg_replace('/^<?php/')` that has no `/m`
  and no BOM handling. Both can white-screen a production site, and the current architecture would
  report READY TO PUSH.
- **The escalation arithmetic is still miscalibrated, and no transport fixes it.** `LOG-AUTH` at
  3.3 failed logins/day and `LOG-DIST` at 50 peak-day IPs are both constants on any publicly
  reachable site, both categorised active-compromise, and together they alone satisfy
  `compromiseHighCount >= 2` at `:423` — so every site escalates to a sandbox pull on every sweep,
  forever. Recategorisation and threshold re-derivation from measured fleet data are severity
  decisions, not architecture decisions, and this document does not make them.
