# Spec 4a — External host metadata refresh (L1 + L2)

**Status:** approved
**Branch:** `feat/non-wpe-host-support`
**Depends on:** Spec 0 (transport abstraction), Spec 1 (external host registration), Spec 3 (WP
surface unification), the fleet-visibility plan
**Followed by:** Spec 4b — external content indexing (L3)

---

## 1. Problem

External SSH hosts have a row in graph `sites` and nothing else. Zero rows in `plugins`, zero
in `themes`, no `php_version`, no `site_url`. Nothing populates them: the only writer is the
lazy "sighting" upsert in `mcp/tool-registry.ts:45`, which records alias, path, environment and
a timestamp when a command happens to run against the host.

The visible consequences today:

- `nexus fleet site-health ssh:<alias>@production` returns
  `— not enough data to score`, because the scorer has no plugins, no PHP version and no
  `site_url` for the HTTPS check.
- Fleet plugin and theme totals exclude the host entirely.
- The Data Completeness widget queries `source='local'` and `source='wpe'` only
  (`ipc-handlers.ts:1794`), so a registered external host is not even in the denominator.

WP Engine installs do not have this problem because `WpeRefreshScheduler` refreshes them over
SSH on an interval. External hosts need the equivalent.

## 2. Goal, in the project's own terms

The canonical model is L1/L2/L3 — Scanned, Configured, Searchable — as surfaced by the Data
Completeness widget.

| Level | Meaning | Local | WPE | External, after this spec |
|---|---|---|---|---|
| L1 Scanned | WP version, installed plugins/themes | filesystem scan | SSH WP-CLI | **SSH WP-CLI** |
| L2 Configured | active plugins, active theme, users, post counts, PHP version, site URL, admin email | WP-CLI, site running | SSH WP-CLI + CAPI | **SSH WP-CLI** |
| L3 Searchable | post content extracted, embedded, indexed | MySQL + ONNX | SSH + ONNX | **Spec 4b** |

The L1/L2 split is a Local concept — it distinguishes what a filesystem scan can see from what
requires a running site. For a remote host both levels arrive over the same SSH WP-CLI
transport, exactly as they do for WP Engine. This spec brings external hosts to parity with a
WP Engine install through L2.

**Why two specs.** WP Engine already separates metadata refresh
(`wpeRefreshAutoEnabled` → `WpeRefreshScheduler`) from content indexing
(`wpeContentIndexAutoEnabled` → its own scheduler): two settings, two intervals, two
schedulers. Being consistent with WP Engine therefore *means* two subsystems. Spec 4b covers
L3.

## 3. Scope

**In:**
- `ExternalRefreshScheduler` — opt-in, interval-driven, settings-reactive
- Batched SSH collection of WP Engine's exact L1/L2 data set
- Writes to graph `sites`, `plugins`, `themes`
- Two new settings, wired into `onSettingsUpdated`
- Data Completeness widget counts external hosts
- External hosts become health-scoreable once they have data
- `nexus host refresh <alias>` — run one cycle against a single host on demand

**Out:**
- L3 content indexing — Spec 4b
- `ControlMaster` on external SSH — see §6
- Any write to the user's remote server — see §10
- Storing SSH key material — see §10

## 4. Component

`src/main/startup/ExternalRefreshScheduler.ts`, mirroring `WpeRefreshScheduler`'s shape:

- `start()` — idempotent; a second call while running is a no-op and logs
- `stop()`
- `restart(intervalMs: number)` — stop, adopt new interval, start
- `stalenessThresholdMs` defaults to `intervalMs`
- Never throws; a failure in one host does not abort the cycle

**Selection.** Rows where `source='external' AND is_active=1`, whose `ssh_last_sync_at` is NULL
or older than `stalenessThresholdMs`.

`ssh_last_sync_at` is the same column `WpeRefreshScheduler` uses, deliberately distinct from
`last_sync_at` — the latter is bumped by the lazy sighting upsert on every command, so keying
staleness off it would mean a host used regularly never refreshes.

`is_active = 1` is load-bearing. `nexusHostRemove` soft-deletes (`is_active: false`); a removed
host must never be connected to again.

**Concurrency.** At most 3 hosts in parallel, via the project's existing p-queue pattern. Unlike
WP Engine's cap of 5, this bounds local resource use rather than a remote connection limit —
these are unrelated servers.

## 5. Transport

Through `resolveTransport({ ssh_target: 'ssh:<alias>@<environment>' }, services, 'wpcli_read')`.

`resolveTransport` is the only router (Spec 3). It already reads the probe's stored `wpPath` and
`wpCliPath` back from the external profile. The scheduler must not construct SSH invocations,
resolve targets, or apply its own command policy.

`wpcli_read` is the correct operation class: every command in §6 is read-only, and `wpcli_read`
is permitted on every environment including production by default
(`operation-permissions.ts:22`). A host with a `remoteSiteExceptions` entry denying it is
refused by the gate, and the scheduler must treat that as a skip, not an error.

## 6. Collection — four connections, not seventeen

`buildExternalSshArgs` sets no `ControlMaster`, so every WP-CLI call is a full SSH handshake.
Copying WP Engine's 16 sequential calls would mean 16 handshakes per host.

**`ControlMaster` is deliberately not added.** WP Engine is a uniform platform whose SSH
configuration the addon can assume. Arbitrary hosts are not: shared hosting commonly caps
`MaxSessions`, where `ControlMaster=auto` causes multiplexed sessions to fail; and
`ControlPersist` would hold an open socket to a third party's production server after the work
finished. A command-line `-o` also overrides whatever the user configured for that host in
`~/.ssh/config`, which is the file this whole feature defers to. This is the same asymmetry as
the documented `-F /dev/null` rule.

**Instead, batch.** A new `buildExternalWpCliBatch(commands, wpPath, wpCliBin)` in
`transport/ssh-args.ts` joins several `wp` invocations into one remote command with indexed
delimiters:

```
wp --path=X core version; echo '<<<NEXUS:1>>>'; wp --path=X option get siteurl; echo '<<<NEXUS:2>>>'; …
```

- Every argument goes through the existing `escapeShellArg`. No caller-supplied string reaches
  the shell unescaped; the command set is fixed and closed, the same safety class as
  `probeExternalHost`.
- Delimiters are **indexed**, so a sub-command that fails or prints nothing cannot shift the
  parse onto the wrong field.
- A compound command's exit status is only the last sub-command's. **Correctness comes from
  parsing, never from the exit code.**

Four batches per host:

| Batch | Contents |
|---|---|
| A — scalars | `core version`, `--info` (PHP version), `option get siteurl`, `option get admin_email`, `option get stylesheet`, the 11 settings options (`blogname`, `blogdescription`, `blog_public`, `show_on_front`, `posts_per_page`, `default_comment_status`, `permalink_structure`, `timezone_string`, `users_can_register`, `default_role`, `WPLANG`), `config get DISALLOW_FILE_EDIT`, `config get WP_DEBUG` |
| B | `plugin list --format=json --fields=name,title,version,status` |
| C | `theme list --format=json --fields=name,title,version,status` |
| D — counts | `post list --post_status=publish --format=count`, `post list --post_type=post --post_status=publish --format=count`, `post list --post_status=publish --orderby=modified --posts-per-page=1 --fields=post_modified --format=json`, `user list --format=count`, `user list --role=administrator --format=count`, `user list --role=editor --format=count` |

This is the exact set `WpeRefreshScheduler` collects, with one addition and one substitution:

- **`wp --info` for PHP version.** WP Engine reads `php_version` from CAPI, which has no
  external equivalent, and `wp eval` is blocked by `REMOTE_POLICY`. `wp --info` reports it in
  one read-only call. This also closes the `php_version` gap left open by the fleet-visibility
  plan.

  Parse `wp --info --format=json` and read the `php_version` key. Older WP-CLI builds do not
  accept `--format` on `--info`; when the output is not JSON, fall back to the plain-text form
  and take the value after `PHP version:`. If neither parses, `php_version` is NULL (§7) — do
  not substitute the WP-CLI version, the `PHP binary` path, or a default.

  `wp --info` does not bootstrap WordPress, so it still answers on a host whose WordPress
  install is broken, and it reports the version of the PHP binary WP-CLI itself runs under —
  which is the same thing `wp eval 'echo phpversion();'` would have returned.
- Plugins and themes are parsed as JSON, so batches B and C stay separate — mixing JSON with
  delimited scalars invites a parser that is clever instead of obvious.

## 7. Storage

Same destinations as `WpeRefreshScheduler`.

**`sites` row:** `wp_version`, `php_version`, `site_url`, `admin_email`, `active_theme`,
`post_count`, `post_count_by_type`, `user_count`, `user_count_by_role`, `last_post_at`,
`settings_json`, `ssh_last_sync_at`.

**`plugins`:** via `GraphService.upsertPlugin`. **`themes`:** via `GraphService.upsertTheme`
(`GraphService.ts:703`).

**The honesty rule.** A field whose sub-command returned nothing is written **NULL — never a
default, never a zero**. Specifically:

- `php_version` stays NULL if `wp --info` did not parse. It must not become `'8.0'`; that
  fabrication was removed from the health path and must not re-enter through the writer.
- A count that did not parse is NULL, not `0`. Zero posts and unknown posts are different
  facts.
- `domain` is never overwritten with the alias. The lazy upsert already protects this
  (`tool-registry.ts:53`); the scheduler must too.

**A failed host keeps its existing data.** An unreachable server must not zero or NULL rows
that a previous successful cycle wrote. Only fields that parsed in *this* cycle are written.

## 8. Settings

| Setting | Default | Notes |
|---|---|---|
| `externalRefreshAutoEnabled` | **`false`** | Opt-in, matching `wpeRefreshAutoEnabled`. Nexus does not connect to a third party's server on a timer unless asked. |
| `externalRefreshIntervalHours` | `24` | Matches the WP Engine default. |

Both must be added to `UpdateSettingsSchema` in `mcp/schemas.ts`. That schema is `.strict()`,
which silently strips unlisted fields — a setting that appears to save and never persists is a
failure mode this project has already hit.

Wire into the `onSettingsUpdated` block in `src/main/index.ts` (~`:998`) alongside the existing
schedulers: restart on an interval change, `stop()` when disabled.

## 9. Surfaces that change

**Data Completeness widget** (`ipc-handlers.ts:1794`). Add external to all three counts:
Scanned, Configured (`wp_version IS NOT NULL`), Searchable (IndexRegistry). External hosts will
show honestly at 0% Searchable until Spec 4b — that is correct, not a defect to paper over.

**Per-site health.** `nexusFleetSiteHealth` currently declines to score external hosts
outright. It becomes conditional: evaluate `['security','performance']` — the same subset WP
Engine gets — when the host has plugin rows and a PHP version, and continue returning
`score: null` with the existing message when it does not. `stability` stays excluded for all
remote targets: it counts `event_queue` rows, which only the Local MU-plugin webhook writes.

**CLI.** `nexus host refresh <alias>` to run one cycle against a single host on demand, and
`nexus fleet deep-refresh` gains no external flag — deep-refresh is a separate mechanism and
conflating them would imply a capability that does not exist.

## 10. Constraints

- **Nothing is ever written to the user's remote server.** Every command in §6 is read-only.
  No `wp option update`, no file writes, no plugin installs.
- **No SSH key material is stored.** The `~/.ssh/config` alias remains the only credential path.
- **`ssh-args.ts` remains the only place an SSH invocation is constructed.** The batch builder
  lives there for that reason.
- **No `-F /dev/null` on external builders**, per the documented inverted rule.
- **Read-only paths are not audited.** This scheduler mutates nothing remote and must not call
  `auditDirectOperation`.
- **`resolveTransport` is the only router.** No target resolution or command policy in the
  scheduler.

## 11. Error handling

- The scheduler never throws. Each host is wrapped individually; one failure does not abort the
  cycle or the timer.
- An unreachable host is logged at warn and leaves its stored data untouched (§7).
- A host refused by `isOperationAllowed` is skipped, logged at info, and is not an error.
- A malformed batch response — missing delimiters, wrong count — writes only the sections that
  parsed unambiguously and logs the rest. It must not guess alignment.
- `getDb()` can return null during startup; the scheduler must tolerate it and try again next
  cycle rather than throwing.

## 12. Testing

**Batch builder** (`buildExternalWpCliBatch`): argument escaping; indexed delimiters; parsing
when a middle sub-command emits nothing; parsing when a sub-command emits multiple lines;
refusal to misalign on a short response.

**Scheduler selection:** skips `is_active = 0`; skips hosts fresher than the threshold; includes
hosts with NULL `ssh_last_sync_at`; respects the concurrency cap.

**Writes:** `php_version` NULL when `--info` did not parse — asserted explicitly, since this is
the regression that matters most; a count that did not parse is NULL rather than `0`; a failed
cycle leaves prior data intact; `domain` is never clobbered to the alias.

**Settings:** both fields survive `UpdateSettingsSchema` round-tripping; disabling stops the
scheduler; an interval change restarts it.

**Health:** an external host with plugins and a PHP version scores on
`['security','performance']`; one without still returns `score: null`.

**Live verification, against the registered host:** run one cycle and confirm the graph gains
plugin and theme rows, `php_version` and `site_url` become non-empty, `nexus fleet site-health
ssh:<alias>@production` returns a real score naming its factors, and Data Completeness counts
the host. Record the verbatim output — every task in the preceding plan that skipped live
verification shipped something that unit tests passed and reality did not.
