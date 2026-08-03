# pressproto as the Sentinel's Containment Model — Evaluation

**Question:** can `@pressproto/engine`'s WASM site engine serve as the containment substrate for the security-sentinel's Tier 2 sandbox? **How it was tested:** by reading both codebases and by running two live egress canaries — S1 against Local's own PHP 8.2.27 with the sentinel's hardening applied verbatim, and S2 against pressproto's installed `@php-wasm/node` runtime, booted option-for-option against `product/engine/src/php-worker.mjs:104-121`, with a listener on `127.0.0.1:19999` corroborating every hit.

---

## Verdict

**Conditionally yes — but not this quarter, and not as a dependency.** The containment hypothesis is correct and the experiment supports it: php-wasm closes filesystem escape and native execution *structurally*, and unlike Local it can be hardened at all, because the WASM SAPI genuinely loads `/internal/shared/php.ini` and `phpIniEntries` reaches it at boot. That is a real answer to Fork 7 and it is the strongest part of the idea. But pressproto **cannot load a real WordPress database** — there is no MySQL import path anywhere in `product/` (`src/turso-provisioner.mjs:56-81` seeds only `fresh` or `sqld-dump`), and `src/turso/class-wp-turso-query-translator.php` is 158 lines of `str_ireplace` that corrupts string literals on `SELECT`, which is exactly the query shape a malware hunt uses. So today it would contain a sandbox that cannot be populated. The condition, stated precisely: **build `ctx.env` with a `LocalEnv` backend first, then revisit `PressprotoEnv` only after (a) a MySQL-dump→SQLite ingest exists (abandon the Turso driver for the already-bundled `sqlite-database-integration.zip`, `php-worker.mjs:13`), and (b) the wasm32 hydration ceiling is measured and lands above ~1 GB of `wp-content`.** Neither is true now, and (b) is a half-day experiment nobody has run.

---

## The experiment

### Egress, native PHP (S1) versus php-wasm (S2)

Both columns ran the same eight probes against the same local listener. "Sentinel's list" is `agent.js:1767` applied verbatim. "Hardened" for php-wasm is `disable_functions` + `allow_url_fopen=0` + `disable_classes=SoapClient,SoapVar,SoapHeader` passed as `phpIniEntries` at boot.

| Channel | Local PHP 8.2.27, no hardening | Local + sentinel's list (`agent.js:1767`) | php-wasm 8.3, pressproto boot as shipped | php-wasm 8.3, hardened |
|---|---|---|---|---|
| `curl_exec` | OPEN | blocked | **OPEN** (listener hit) | blocked |
| `fsockopen` | OPEN | blocked | **OPEN** (listener hit) | blocked |
| `stream_socket_client` | OPEN | **STILL OPEN** | **OPEN** (listener hit) | blocked |
| `file_get_contents(url)` | OPEN | **STILL OPEN** | **OPEN** (listener hit) | blocked (`allow_url_fopen=0`) |
| `fopen(url)` | OPEN | **STILL OPEN** | **OPEN** (listener hit) | blocked (`allow_url_fopen=0`) |
| `gethostbyname` (DNS) | OPEN | **STILL OPEN** | polyfill, no packet — but real DNS via socket hostnames | blocked |
| `mail()` | OPEN | **STILL OPEN** | callable, returns false (no MTA) | blocked |
| `exec` / `shell_exec` | OPEN | blocked | **already dead** — `rc=127`, `shell_exec('id')` → `NULL` | blocked |
| **Total genuinely open** | **8 of 8** | **5 of 8** | **6 real channels** | **0 of 8 by this canary** |

Three results that the summary table cannot carry:

- **The canary gives a false all-clear.** Under the "0 of 8" configuration, `SoapClient` still POSTed a stolen salt to the listener (`ua=PHP-SOAP/8.3.31`) and returned a real `405` from example.com, proving the request left the machine. `disable_classes` closes it. Under the *full* set including `disable_classes`, `mysqli_real_connect` to `127.0.0.1:19999` still produced a bare TCP connect. **Containment cannot be a function blocklist** — it needs a host allowlist in `withNetworking` (`@php-wasm/node/index.js:372-397`), which does not exist; today's only validation is `0 < port <= 65535` at `index.js:195`.
- **The as-shipped baseline is worse than Local's.** Playground's own hardening list (`@wp-playground/wordpress/index.js:3263`) is gated behind `isLegacyPHPVersion`, and pressproto passes `'8.3'` (`php-worker.mjs:108-109`), so it never runs. `ini_get('disable_functions')` returned `[]`. From that guest, the canary reached Local's GraphQL on 4000, the Nexus gateway on 13000, `AiProxyServer` on 13100, Ollama on 11434, an nginx site on 10075 and a **93-byte MariaDB handshake on 10073**. Production malware has none of that reach.
- **But it is fixable here and not there.** The three structural reasons the Local approach failed are all absent: `php_ini_loaded_file()` is non-null in WASM (Local's CLI SAPI returns empty, which is why the guard at `agent.js:1766` silently skips); `phpIniEntries` applies at boot with no restart to erase it (`agent.js:1772`'s `local_restart_site` regenerates the very file it just wrote from `php.ini.hbs`); and it governs the same SAPI the checks run on. It also sticks: `ini_set('disable_functions','')` → `false`, and `ini_restore()` then `function_exists('curl_exec')` → `false`.

### Filesystem escape — closed

Every host path attempted was unreachable. `scandir('/')` returns `. .. dev home internal proc request tmp wordpress`. `/Users`, `~/.ssh/id_rsa`, `/etc/passwd`, `~/Local Sites`, `~/PW-Local-Functional-Sites`, the addon's own `package.json` and `~/Library/Application Support/Local/nexus-ai` all return `MISSING`, `read=false`, `scandir=false`. `realpath('/wordpress/../..')` clamps to `/`; `glob('/*')` returns only VFS roots. This is MEMFS with nothing beneath it, so traversal has nowhere to go — a categorically stronger property than `open_basedir`. It holds **only because pressproto does not use `createNodeFsMountHandler`**; the comment at `php-worker.mjs:32-34` says it was tried and abandoned because it collided with WP core extraction. Adopting a live host mount would reopen this.

### Native binary / ELF — closed by construction

A real 132-byte static x86-64 Linux ELF (`magic=7f454c46`, `_start: exit(42)`) was written into the VFS. `chmod` succeeded and `is_executable` returned true — the FS lies, nothing enforces it — but `exec()` returned `rc=127` and `shell_exec` returned `NULL`. `rc=42` never appeared. This is not binary-specific: `sandboxedSpawnHandlerFactory` (`@php-wasm/universal/index.js:~4300`) dispatches on **basename** before touching the file, allowlisting `["php","ls","pwd"]` and `exit(127)`ing everything else, and there is no `execve` in WASM to reach. The ELF-dropper scenario dies outright. One availability bug: renaming the ELF to `php` wedges the PHP instance (120 s watchdog fired) — a hang, not an escape, and pressproto's `killable-worker.mjs:27-32` reaps it.

**Fidelity caveat, stated plainly:** S2 booted in the main thread, not inside `KillableWorker`. Networking is established per-runtime inside `loadNodeRuntime` (`@php-wasm/node/index.js:1977`, unconditional), so thread placement cannot change the result — but it was not re-verified through `killable-worker.mjs`. Artifacts are in `/tmp/sentinel-s2-wasm/`.

---

## What it would solve

- **Fork 7 / SEC-02 evaporate.** The review's contradiction was that the containing list and the working list are mutually exclusive on Local — the sentinel needs `shell_exec` for `strings` and checksum verify (`agent.js:1494`, `:1050`) and `curl` for `wp_remote_get` (`agent.js:1441, 2343, 2398, 2896, 2911`). In WASM `exec`/`shell_exec` are **already gone before you harden anything**, so hardening costs only `curl_exec` — and the review's own Fork 7 answer already moves those calls to Node. Hardening becomes strict *and* assertable, which is what SEC-02 asked for and could not get.
- **SEC-01's blast radius shrinks to nothing.** S1's finding was that `--skip-plugins` never skips mu-plugins, so a webshell in `mu-plugins/index.php` runs before every scan, with reach to the unencrypted SSH key at `~/Library/Application Support/Local/ssh/wpe-connect` (`local-services-bridge.ts:848`) and a live multiplexed master socket. In WASM that key is not addressable at any path, and the socket cannot be dialled without a network transport. The mu-plugin still executes — but into a box with no host FS and no exec.
- **Structural resource control the sentinel currently lacks.** Per-request `worker.terminate()` (`killable-worker.mjs:27-32`), per-site concurrency caps, per-site instance caps (`pool.mjs:20`), boot gating. `local_delete_site` appears **zero** times in `agent.js` — measured. A killable worker makes cleanup a property of the substrate rather than a `finally` block someone forgot.
- **Detection loss is smaller than expected.** 12 of 21 in-sandbox detection units are pure `glob`/`RecursiveDirectoryIterator`/`preg_match`/`fread`/`base64_decode` and were confirmed working under maximal hardening. Notably the ELF *finder* (FS-06, `agent.js:2020`, a 4-byte magic read) survives; only the ELF *analyzer* breaks. 13 of 15 remediation checklist steps survive, and the checklist's job is to prove the command sequence before replay over SSH, not to mutate the sandbox.

---

## What it would cost

**The database. This is the whole bill.** There is no MySQL import path in `product/`. `ensureProvisioned` (`turso-provisioner.mjs:56-81`) seeds `fresh` — a hardcoded WP-7.0 core schema, 12 tables, `prefix='wp_'` hardcoded — or `sqld-dump`, which clones another running sqld. Neither ingests a dump. The artifact manifest reserves a `database: {format:'sql-dump'}` field (`state/src/artifact-format.mjs:30,46`) that nothing produces or consumes.

And the query path is not trustworthy even if you populated it. `WP_Turso_DB` overrides only `query/insert/update/delete` (`class-wp-turso-db.php:90-174`), so every `get_var`/`get_results`/`prepare` funnels through `translate()`. `translate_boolean_operators` (`:120-125`) rewrites `TRUE`/`FALSE` **inside string literals** — `LIKE '%true%'` becomes `'%1%'`, and the test at `query-translator.test.mjs:106-110` codifies the bug. `function_map` (`:21-41`) `str_ireplace`s `now()`/`rand()`/`length(` across the whole query including serialized option content. `ALTER TABLE` is an explicit no-op (`:78-82`). `ON DUPLICATE KEY UPDATE` becomes `INSERT OR REPLACE` with the update clause deleted (`:105-110`). No `SHOW`/`DESCRIBE`, so `dbDelta` silently fails — and `agent.js:1039` issues `SHOW TABLES` for non-standard-table detection. DB-01/02/03 (`agent.js:2176, 2216, 2258`) all use `LEFT(col,n)`, absent from SQLite and absent from `function_map`. **A malware-hunting DB scan through this returns wrong answers quietly.** Closing it is a dump converter plus a tokenizing translator plus `SHOW` emulation — months, unless the Turso driver is abandoned for the already-bundled `sqlite-database-integration.zip` (`php-worker.mjs:13`), which still needs the MySQL→SQLite converter nobody has written.

**Memory and size.** Boot reads the entire tree into the Node heap (`readHostTree`, `php-worker.mjs:54-69`) and then writes every file into wasm32 linear memory (`:123-129`), against a 4 GiB spec cap. `engine.mjs:13` budgets 290 MB/site — a WP-core baseline, not a real site. `newsroom-demo` is 4.1 GB. **The exact failure threshold is UNKNOWN and is the single number that decides viability**; settle it by pointing a worker at a `mutableDir` with 0.5/1/2/4 GB of synthetic uploads and recording RSS plus the first `php.writeFile` that throws. Half a day.

**Mount allowlist loses forensically load-bearing files.** `WP_CONTENT_DIRS` (`php-worker.mjs:48-53`) mounts only `mu-plugins, plugins, themes, uploads, languages, turso`, and at the wp-content root drops anything that is not a known dir or `*.php` (`:59-63`). So `wp-config.php`, webroot `.htaccess`, `wp-content/.htaccess`, and `wp-admin`/`wp-includes` (needed for checksum work) are simply absent. That degrades FS-05 (`agent.js:1979`) and breaks the persistence of remediation steps 6 and 7 (`agent.js:3038`, `:3048-3068`).

**mtimes are destroyed.** `php.writeFile(path, data)` writes content only; there is no `utime` in the boot path. Every file carries a boot-time mtime, which kills collector 1 and 2 (`agent.js:948-960`, `:966-985`), ABS-09's mtime evidence (`:2077`), and **TC-01 temporal clustering** (`:2508-2514`) — a `critical`-severity signal the agent itself calls "the primary signal of an automated attack." This is *worse* than Local's clone, which preserves mtimes on a native FS. Fixing it is a sidecar mtime manifest replayed after hydration — a pressproto engine change, and nothing like it exists.

**Integration.** Embedding in Electron main is out: `fs-ext-extra-prebuilt/load-prebuilt.js:53-91` matches `electron-<exact version>` and ships prebuilds for `electron-39.2.7`; Local runs 42.2.0. That is the better-sqlite3 pain squared, plus `@libsql/darwin-arm64`. Consuming `mcp-server.mjs` is also out: Nexus has **no MCP client** (`McpServer.ts:1-22` is hand-rolled JSON-RPC; `@modelcontextprotocol/sdk` is not a dependency), `createMcpServer` requires `engine.branchManager` (`mcp-server.mjs:65`) so "bare engine" and "MCP tools" are either/or, its file tools are `wp-content`-relative and read the *host* branch dir, `run_php` has an anti-exfil filter (`:635-640`) that will false-positive on malware analysis, and `main()` `pkill`s sqld process-wide (`:824-832`) — hostile inside a long-lived Local process. The only sane shape is a Nexus-owned ~200-line host script spawned against **system Node** (not `fork()`, which uses `process.execPath` = Electron). ~90-110 MB of `@php-wasm` pruned to one version; 10-20 s cold boot.

**Coupling two prototypes with one owner.** The containment fix pressproto needs lives in `@php-wasm`, a third repo. **UNKNOWN whether a `withNetworking` host-allowlist option would be accepted upstream**; settled by opening the PR. Egress control is also entangled with the Turso-over-HTTP driver (`class-wp-turso-http-client.php:61-81` uses `curl_exec`) and with the `TURSO_AUTH_TOKEN`/`MCP_EVAL_TOKEN` handed to the guest as PHP constants (`php-worker.mjs:116-119`) — kill curl and Turso mode dies, leave it and a compromised guest owns its own database.

---

## The case against

Four arguments, all fair, none dismissed:

1. **Cost per scan goes up, not down.** You still pay the same pull (`agent.js:1713-1717`, files + DB) because pressproto has no import. Then you add whole-tree-into-heap plus whole-tree-into-linear-memory per cold boot, a 39 MB out-of-tree `sqld` binary and a second supervised process (`mcp-server.mjs:847`), and 10-20 s boots. The only genuine saving — dropping per-sandbox PHP-FPM and MySQL — is available today by calling `local_stop_site` when a scan ends.
2. **The threat model is narrower than the effort.** The adversary is commodity WordPress malware: webshells and SEO spam injectors that execute on *page load*. The sentinel never serves a page — it runs `wp_eval`, **54 call sites** (measured). Static webshells in `wp-content` do not execute unless invoked. The real execution risk is a malicious mu-plugin or poisoned `wp-config.php` firing on WP bootstrap, which is SEC-01, and which is bounded.
3. **A cheaper delivery mechanism for hardening exists and has not been tried.** S1 proved the failure was *delivery*, not concept. Local spawns `phpService.bin.php` with `[wpCliPhar, --path=…, …args]` and builds `env` as `{...phpService.env, ...opts.env, PHPRC, PATH, …}` (`flywheel-local/app/main/sites/WpCliService.ts:144-172`). `opts.env` is spread and **`PHP_INI_SCAN_DIR` is not set by Local**, so a Nexus-owned scan directory containing `zz-sentinel.ini` would be delivered per-invocation, to the CLI SAPI the checks actually use, with no restart to erase it. That is `env?: Record<string,string>` added to `WpCliRunOpts` (`local-services-bridge.ts:40-47`) and passed through at `:468` — roughly three lines. **UNKNOWN whether Local's PHP build honours `PHP_INI_SCAN_DIR`** (it requires `--with-config-file-scan-dir`, which most builds have); settled by one `wp eval 'echo php_ini_scanned_files();'`. Note this only closes the PHP-function surface, and S1 showed 5 of 8 channels survive a function blocklist — so it is a partial fix, but it is a partial fix costing an afternoon.
4. **The cheapest option is not executing the code at all.** 12 of 21 detection units are Node functions over a directory the pull already put on disk, and the DB scans are content grep — run them on the `.sql` dump. That gives perfect containment (no PHP executes, ever), no runtime dependency, no wasm ceiling, faster than WASM boot, and **mtimes preserved**. On the majority of what the sentinel does, a Node parser is strictly better than a WASM sandbox.

**Where I land.** Arguments 1, 2 and 3 are correct and should change the ordering, not the conclusion. Argument 4 is the strongest and is the one I'd act on — but it does not fully retire the idea, because a mu-plugin or drop-in *must* execute for FS-MISMATCH (`agent.js:2132`, which deliberately runs with plugins loaded to catch account-hiding hooks) and for any remediation step you want to verify before replay. For that residual set, a contained runtime is genuinely the right tool, and php-wasm is the only one on the table that contains. So: the WASM substrate is a good idea aimed at the *last* 20% of the problem while the first 80% is unwritten Node code and the DB blocker is unsolved. That is a reason to sequence it later, not to reject it.

One methodological note in the same spirit: three deep spikes have now run on containment — the fun part — and the one experiment that could kill the idea outright (the hydration ceiling) has not. That ordering is itself the confirmation-bias signal.

---

## Impact on the seven decision forks

| Fork | Effect | Why |
|---|---|---|
| **1** — detection substrate vs remediation workspace | **Complicates** | Does not restore local depth: `shell_exec` and `wp_remote_get` die either way, and the DB path returns wrong answers. Its real contribution is showing the fork is falsely binary — pull the artifact, analyse it in Node, never boot it. |
| **2** — sandbox lifecycle | **Sharpens, doesn't cheapen** | Killable workers are the right primitive, but the CAS/blob store is written and **not exported** from `state/src/index.mjs`; the live format is a tarball buffered whole (`archive.mjs:6-15`). Option C (stop the site) is still the highest-value change available today and pressproto is irrelevant to it. |
| **3** — cheap deterministic tier | **Not affected** | Every candidate is a CAPI call, a graph.db query or a Node `fetch`. No site PHP executes. |
| **4** — replay vs fix-then-push | **Pushes further toward replay** | Fix-then-push needs a shippable end state; the persist allowlist (`php-worker.mjs:48-53`) excludes `wp-config.php`, which the salt shuffle mutates. The artifact is structurally incomplete. |
| **5** — trigger scope | **Not affected** | Orthogonal. |
| **6** — unwind Local coupling for Atlas | **Relocates it; code does not support the claim** | `atlas-server.mjs` instantiates engine + state with **no BranchManager**, and `createMcpServer` requires one (`mcp-server.mjs:65`), so `run_php`/`read_file`/`run_wp_query` do not exist on Atlas today. Atlas FS is ephemeral (`docs/atlas-deploy.md:75-77`) and first boot fetches WordPress from wordpress.org (`:87-89`) — it *requires* the egress you are closing. Last Atlas commit 2026-06-09 vs engine work through late July. The genuine effect is indirect: pressproto is a credible second `ctx.env` backend, which raises the value of building the abstraction. |
| **7** — the hardening contradiction | **Resolves** | Measured. Hardening applies, sticks, and governs the right SAPI; it costs only `curl_exec`, which the host already owns. Replaced by a narrower real requirement: a host allowlist in `withNetworking`, because `SoapClient` and `mysqli` survive any function blocklist. |

---

## What it does NOT solve

**Containing a copy is not containing the source.** Jeremy's stated goal — a hacked site cannot further leak data or credentials — is untouched by any of this. The leaking asset is the production install: live, internet-facing, still holding its DB credentials, SSH keys and application passwords, and completely unaffected by what happens in Local or in a WASM worker. Containment of the clone contains nothing about the origin.

What containment actually buys is narrower and worth stating precisely: **it stops the sentinel's own act of investigation from creating a second, differently-privileged leak.** That leak is real and measured — the S2 canary reached Local's MariaDB handshake on 10073, the Nexus gateway on 13000, Ollama on 11434 and arbitrary internet hosts, and thirteen `sentinel-*` sandboxes totalling **6.5 GB** are on disk right now (`~/PW-Local-Functional-Sites/sentinel-*`, 92-202 MB each, containing live webshells and ELF binaries), with `local_delete_site` appearing zero times in `agent.js`. Production malware has none of that reach into your machine. But that is a self-inflicted wound, and the honest framing is that pressproto (hardened) would make the *analysis* safe, not the *site*.

Making the site stop leaking is remediation — take it offline, rotate salts and passwords, revoke SSH keys and application passwords — i.e. Fork 4's replay-over-SSH path, which none of this touches. **That is the S3 question: what cuts egress on the live production install**, and it is still open. Conflating the two is the single place confirmation bias would bite hardest here.

---

## Recommended next step

**Two moves, in this order.**

1. **This afternoon (≈2 hours).** Add a `finally` to `tier2Investigate` that calls `local_stop_site` and — behind a retention policy — `local_delete_site`, and delete the dead php.ini block at `agent.js:1760-1810` rather than leaving code that logs "Sandbox PHP hardened" while doing nothing. Separately, try the `PHP_INI_SCAN_DIR` delivery path: add `env?: Record<string,string>` to `WpCliRunOpts` (`local-services-bridge.ts:40-47`), pass it through at `:468`, and verify with `php_ini_scanned_files()`. If it works you get a real, per-invocation partial hardening on the current substrate for three lines — and if it doesn't, you have eliminated the cheapest option honestly instead of by assumption.

2. **Half a day, and do it before any further pressproto work.** Run the hydration-ceiling experiment: point a worker at a `mutableDir` containing 0.5 / 1 / 2 / 4 GB of synthetic uploads, record RSS and the first `php.writeFile` that throws. This is the one number that decides whether the WASM path can ever hold a real customer site. If it lands under ~1 GB, `PressprotoEnv` only ever serves small sites and the answer is Local plus real egress control — or Atlas-side containment — instead.

Everything after that is gated on the database, and the database is a quarter of work, not a sprint. Build `ctx.env` with a `LocalEnv` backend (≈1 week including migrating the 54 `wp_eval` sites, most of which get *simpler* as host-side `readFile`/`listFiles`) so that when the DB question is answered, `PressprotoEnv` is a backend rather than a rewrite. Note that migration is not a mechanical rename: `exec` alone is insufficient on any WASM backend, so `fetch` and host-side file reads have to be first-class verbs in the interface, and `import` and `destroy` are the load-bearing new ones.
