# WP Engine SSH gateway — limits hit and experienced

Research date: 2026-09-24. Read-only review of five sources: the code and docs, git history (4,971 commits, all branches), Nexus event and audit logs, Local's logs, `ledger.db`/`graph.db`, session memory, and past Claude Code transcripts.

**Legend:**
- **OBSERVED** means the limit was hit or measured live.
- **DESIGNED** means we built a defensive bound, and no incident is recorded.
- **OUR BUG** means a failure in our own code that looked like an SSH limit.

## Summary

WP Engine enforces one hard limit on the SSH gateway that we have actually hit: **5 concurrent SSH connections per user, counted across the whole account.** We have hit it three times:

- 2026-04-07
- 2026-08-22
- **2026-09-18, which went unnoticed and is not fixed**

Each time the cause was the same: `ControlPersist` kept connections open after the work was done, and several callers each limited their own concurrency without knowing about the others. Almost every other SSH failure in our history was one of three things: our own timeout, a local network drop, or a bug in our code.

---

## 1. Limits WP Engine enforces

### 1.1 Concurrent connection cap: 5 per user, account-wide (OBSERVED ×3)

The server's exact message, recovered by rerunning a failed command by hand on 2026-08-23 01:19Z:

> The concurrent connection limit of 5 connections per user has been reached. If you are using ControlPersist, check your ControlPath and delete any persisting connections that are no longer needed.

| When | Evidence | Cause | Fix |
|---|---|---|---|
| 2026-04-07 | Commit `6569d848` | Metadata sync ran 20 installs in parallel. `ControlPersist=10m` kept a connection open per install. 124 stale `/tmp/ssh-nexus-*` sockets were cleared by hand. | Persist 10m → 5s; concurrency 20 → 4 |
| 2026-04-08 | Commit `9d33be6d` | 3 parallel WP-CLI calls raced to create the same control socket, so each opened a real connection. Result: "all 3 return empty instantly". | The calls in each install now run one after another |
| 2026-04-16 | Commit `89c9252d` | `fleet refresh --deep` had no concurrency limit and failed with "exit 255". | Limited to 3 |
| 2026-08-22/23 | D14 in `docs/planning/2026-08-21-fleet-tool-defects.md:705-762`; commits `5a3e972d`, `e62ed86d`, `dd4ab43e`/`3b528423` | A content-index sweep ran clean for about 10 minutes, then failures climbed: 0 → 5 → 101 per 10-minute window. **82 live sockets were measured against the limit of 5.** `BulkOperationManager.MAX_CONCURRENCY` was 5 (the whole quota), and `ControlPersist` was 600s. | `closeMaster()` (`ssh -O exit`) in the `finally` of `syncContent`; bulk concurrency 5 → 3. The rerun had zero cap errors. |
| **2026-09-18** | **33 refusals** in `~/Library/Logs/local-lightning-verbose*.log` (verified 2026-09-24) | See below | **Not fixed** |

**The 2026-09-18 recurrence:**
- The refusals came in three bursts, each a few minutes into the hourly metadata sync:
  - 05:35–05:40Z: 13
  - 06:39–06:42Z: 7
  - 07:37–07:39Z: 13
- The runs covered 71, 75 and 58 installs, so about 16% of installs failed. Each refusal came back in 3.3–4.6s.
- Sample line: `[WPESyncService] andonovm core version: success=false stdout="Command exited with code 1 — output: The concurrent connection limit of 5 connec" ms=3614`.
- **Likely cause (inferred from the code, not reproduced):**
  - `closeMaster()` has exactly one caller, `WPESyncService.ts:877` in `syncContent`.
  - The metadata sweep (`pLimit(4)` at `WPESyncService.ts:340`), `WpeRefreshScheduler.refreshInstall` and deep-refresh never close their connections. They rely on the 600s persist, so held connections pile up the same way they did in D14.
  - `WpeRefreshScheduler` was refreshing installs on the same account at the same time.
- **The failure was hidden.** The Nexus event log recorded those runs as `pipeline.run layer=l2 … outcome=ok`. Only Local's own debug log shows the refusals.

**The structural gap:** nothing enforces the cap across the whole process. Each caller limits itself independently, and all of them share one per-user quota:

| Caller | Concurrency | Where |
|---|---|---|
| `BulkOperationManager` | 3 | `src/main/bulk/BulkOperationManager.ts:96-112` (test: `tests/unit/bulk/bulk-outcome-honesty.test.ts:405-418`) |
| `WPESyncService` metadata sweep | 4 | `src/main/events/WPESyncService.ts:338-340` |
| `indexAllWpeContent` | 2 | `src/main/events/WPESyncService.ts:912-913` |
| Deep refresh (`PQueue`) | 3 | `src/main/graphql/resolver-utils.ts:191-192`. The CLI `--concurrency` flag has no upper limit (`src/cli/commands/fleet.ts:1175,1208`). |
| `WpeRefreshScheduler` | one install at a time, with a guard against overlapping cycles | `src/main/startup/WpeRefreshScheduler.ts:78-79, 267-298` |
| Agents, CLI, chat | uncoordinated | — |

Within a single install, fan-out uses more sessions over the one connection:
- Up to 12 parallel `remoteWpCliRun` calls (`WpeRefreshScheduler.ts:356-417`, `deep-refresh.ts:172-215`).
- Up to 25 more calls, one per post type (`WpeRefreshScheduler.ts:474-480`).
- Deep-refresh's own post-type fan-out has no cap (`deep-refresh.ts:156-162`).

WP Engine's per-connection `MaxSessions` value is not documented anywhere, and no incident has been attributed to it.

### 1.2 No SSH gateway on an account (OBSERVED, D15, 2026-08-23)

- 73 of 365 active WPE rows return NXDOMAIN for `<name>.ssh.wpengine.net`. All are on the `AutoscaleAlpha` account, which apparently has no SSH gateway. This was confirmed against an outside DNS resolver.
- Fix: `src/main/transport/wpeGatewayStatus.ts`. It makes one DNS check per account, repeats it every 24h (`SSH_GATEWAY_RECHECK_MS`), and treats only `ENOTFOUND`/`ENODATA` as proof. The logs show 58 `outcome=skip reason="no SSH gateway on account…"` entries in September.
- Newly created installs also failed DNS lookup on 2026-09-18 (5 cases, e.g. `sep18607dev`, `rw20260914dst`). The hostname had probably not been set up yet; this is not verified.

### 1.3 "PHP version is not supported by SSH Gateway" (OBSERVED)

One install, `newsite042`, gets this on every attempt from 2026-08-23 to 2026-09-18, in transcripts, Nexus logs, `ledger.db` (3 entries) and Local's log. WP Engine's gateway refuses the install because of its PHP version.

### 1.4 SSH not ready after an install is created (OBSERVED, no date)

`src/main/mcp/modules/wpe/wait-for-ssh.ts:1-24` says: "CAPI's status="active" is unreliable for SSH readiness… Typically succeeds within 3–8 minutes." The tool polls every 30s, with a default limit of 10 minutes.

### 1.5 `wp eval` / `eval-file` / `shell`: disputed, never re-tested

- On 2026-04-08, commit `3b7131a0` blamed shell quoting through the gateway: `bash: syntax error near unexpected token '('`.
- On 2026-05-27, commit `4ab91c89` said "WPE's SSH gateway blocks wp eval". No stderr was recorded. At that commit there was no blocklist on our side, so the refusal really did come from the remote end.
- Today our own `REMOTE_POLICY.blocked` (`src/main/transport/policy.ts:35-37`) refuses `eval` before WP Engine is asked, so the gateway's behaviour has not been checked since. Code comments disagree about which layer blocks it (`WpeRefreshScheduler.ts:393,412,518` vs `wxr-postmeta.ts:16-17`).

---

## 2. Measured characteristics (constraints, not limits)

**Cold start** (OBSERVED; `ssh-args.ts:16`, commits `4c126bf4`, `10cc1c59`, `14740125`, `2dd417c5`):
- The first command on a new connection takes 13–30s or more. One measurement was 21.9s.
- Commands on an already-open connection take 1–3s.

**`ControlPersist` history** (`SSH_CONTROL_PERSIST`, `src/main/mcp/utils/remoteFailure.ts:43-54`): 10m → 5s → 30s → **600s**.
- The move to 600s (`fcc80d2c`/`a4c7d4cd`, 2026-08-10) was measured: `auth-probe` runs every 2 minutes, so with a 30s persist every call paid the full cold start.
- The 600s value then caused D14. The chosen fix was to close the connection after one-pass work rather than lower the persist.

**Timeout history** (`REMOTE_SSH_TIMEOUT_MS`, `remoteFailure.ts:41`): 60 → 12 → 30 → 20 → 35 (+1 retry) → **60s**. Every change came from real calls being killed. The latest (`ff1567c5`/`19f70c0e`, 2026-08-09) followed a `wp plugin list` killed at 35.07s.

**Retry** (`WPESyncService.ts:461-475`): 1 retry after 2s, on the first call only. The retry reuses the still-open connection. The worst case is now 60 + 2 + 60 = 122s per install.

**Warm-up:**
- Refresh and deep-refresh make one throwaway `wp core version` call before the parallel batch (`WpeRefreshScheduler.ts:319-325`, `deep-refresh.ts:101-108`).
- Reasons given: "the first SSH call always hits ControlSocket stale-socket warnings", and it keeps concurrency under the cap.

**Throughput** (OBSERVED):

| Operation | Cost |
|---|---|
| One SSH call per post (Apr) | 65s for 32 posts; replaced by one `wp post list` per post type, about 3s |
| One 200-post page | 3.1s, 545 KB (`RemoteContentExtractor.ts:40-45`) |
| `wp export --stdout --post__in=<200 ids>` | 5.1s, 1.26 MB (`wxr-postmeta.ts:18-20`) |
| `wp post meta list <id>` | 2.9s per post, too slow to use (about 24h for 30k posts) |
| Re-index an 800-post install | about 39s; about 4 min for one at the 5000-post cap |
| Full 413-site sweep | about 4h (`docs/planning/2026-08-23-incremental-indexing-design.md:9-11`) |
| 2026-03-11, 251 sites at concurrency 10 | 25 min, 0 failures. This was before the cap was identified; it passed because of timing. |

**Our own paging bounds** (DESIGNED): `REMOTE_PAGE_SIZE = 200`, `REMOTE_MAX_POSTS = 5000`. The 5000 cap is described as "a memory decision, not a correctness one".

**OpenSSH post-quantum warning** (OBSERVED, cosmetic): OpenSSH prints this roughly 230-character warning on every WPE connection. Our 400-character limit on error text cut off the real error behind it. It is now stripped (`remoteFailure.ts:68-83`).

---

## 3. Failures that looked like SSH limits but weren't

| Symptom | Reality | Evidence |
|---|---|---|
| 1,337 `auth-probe` failures (07-14 → 08-19), each showing OpenSSH's post-quantum warning as the error | Our own **35s timeout**. 324 of 330 sampled ran for about 35s; the warning just happened to be on stderr. Zero failures after the move to 60s, and the median successful call dropped from 6–8s to about 3s. | `agent.log*`, `audit.log*`, commit `1c876bad` |
| 8 content-index failures reported as `Command exited with code 255`, no output | All took 60–65s, so almost certainly our 60s timeout. OpenSSH exits with 255 when killed, and `describeRemoteFailure` reports the exit code instead of "timed out". This is inferred, not confirmed. | `ledger.db`, 08-23 and 09-16/17 |
| 5 "Timed out after 60s" with 70–150s of wall time | Probably the laptop was asleep | `audit.log*`, 08-12/17/18 |
| 399 `ssh: connect to host theawfulproduc.ssh.wpengine.net port 22: Undefined error: 0` | **Local network outages.** 393 of 399 happened in the same run as a failed WPE API call, and they failed in 17–30ms. | `agent.log*`, 07-14 → 08-23 |
| `mux_client_request_session: … Broken pipe` (8) | Control connections left stale after a network drop | same |
| 365 installs failed within 3.8s (D10) | Our code used the graph ID as the install name | `d07ea42f` |
| `Could not resolve hostname <uuid>.ssh.wpengine.net` | Our code used a site UUID as the SSH hostname | `fab5125a` |
| 106 installs showed "no content" (D12) | Failed reads, mostly from the D14 connection-cap exhaustion | `da2118ff` |
| Remote extraction stopped at 200 posts (D7) | Our own `--posts_per_page=200` (qwerky: 2 of 30,628 posts indexed) | `37cdf5e3` |
| JSON parse failures (D19) | PHP notices printed before the JSON on 2 staging installs | `8530bf82` |
| `Permission denied (publickey)` on 08-11 | Manual testing with the developer's own key, which has a passphrase and wasn't loaded in ssh-agent. Not the addon. | transcripts |
| Plugin fatals and deprecation noise (`WPE\AITK … Unsupported_Property_Type_Exception` ×8, ACF deprecation ×2) | Errors on the installs themselves, not the gateway | `ledger.db` |

---

## 4. Never observed

None of the following appear in code, docs, history, logs or transcripts:
- `kex_exchange_identification`
- MaxStartups or MaxSessions errors
- "Connection closed by" or "Connection reset by"
- Too many authentication failures
- Rate limiting, throttling or bans
- ENOBUFS or `maxBuffer` on the WPE path
- Argument-length errors (a 200-ID `--post__in` argument works)
- PHP memory or execution-time limits
- A CAPI 429

`docs/analysis/post-impl/01-requirements-coverage.md:223` marks "✅ WPE CAPI rate limit (429) → Wait 60s", but **there is no 429 or Retry-After handling in `src/`**.

Still unknown, as `docs/planning/2026-08-03-sentinel-execution-model.md:435-439` itself says: whether WPE allows `mysqldump`, long `grep -r` runs, or `find -printf` without throttling or being killed.

---

## 5. Stale comments and doc claims

- `WPESyncService.ts:819`: "ControlPersist keeps it alive for 30s". It is 600s.
- `ssh-args.ts:187`: "Shorter than WPE's 35s". It is 60s.
- `docs/superpowers/specs/2026-08-05-external-content-indexing-design.md:58-61`: says ControlPersist is 30s.
- `deep-refresh.ts:141-142`: says `--post_type=any` can't be used, then uses it at `:185,197`.
- `sync-sites.ts:25-27`: line references into `WPESyncService.ts` no longer match.
- `docs/analysis/post-impl/01-requirements-coverage.md:223`: the CAPI 429 claim above.
- Commit `acdecc29`'s "40–55s DB operations" claim exists only on an unmerged worktree branch.

---

## 6. Recommendations

1. **Fix the 2026-09-18 recurrence at the structural level.** Add one semaphore for the whole process that every WPE SSH caller acquires: metadata sweep, refresh scheduler, deep-refresh, bulk, content index, agents and CLI. Use 4 slots, leaving 1 for interactive use. Also close the connection at the end of every one-pass path, not just `syncContent`. The per-caller limits are why this has happened three times.
2. **Make connection-cap refusals a distinct failure the pipeline can see.** The 09-18 runs reported `outcome=ok`.
3. **Report a 255 exit near the timeout as "timed out"** in `describeRemoteFailure`.
4. **Re-test `wp eval` directly against the gateway once**, bypassing `REMOTE_POLICY`, and record the answer so the code comments can say which layer actually blocks it.
5. **Retest D6** (`get_site_structure` hanging for 20 minutes, "likely resolved by D14").
6. **Correct the stale comments and the CAPI 429 claim** listed in §5.

## Where the evidence lives

- **Code:** `src/main/transport/ssh-args.ts`, `src/main/transport/WpeSshTransport.ts`, `src/main/mcp/utils/remoteFailure.ts`, `src/main/events/WPESyncService.ts`, `src/main/startup/WpeRefreshScheduler.ts`, `src/main/mcp/modules/wpe/deep-refresh.ts`, `src/main/bulk/BulkOperationManager.ts`, `src/main/transport/wpeGatewayStatus.ts`, `src/main/transport/policy.ts`
- **Defects log:** `docs/planning/2026-08-21-fleet-tool-defects.md` (D6, D7, D10, D12, D14, D15, D19)
- **Runtime:**
  - `~/Library/Logs/local-lightning-verbose*.log`: rotated, and only covers 09-18 03:33Z → 14:35Z plus 09-24
  - `~/Library/Application Support/Local/nexus-ai/agents/auth-probe/logs/agent.log*`: 07-14 → 09-18, the longest SSH record
  - `~/Library/Application Support/Local/nexus-ai/audit.log*`: 08-05 → 09-18
  - `~/Library/Application Support/Local/nexus-ai/ledger.db`: 49 failed pipeline runs
- **Transcripts:** nearly all the D14 live evidence is in session `d2a5677b` (08-22/23). No transcript mentions the 09-18 recurrence.
