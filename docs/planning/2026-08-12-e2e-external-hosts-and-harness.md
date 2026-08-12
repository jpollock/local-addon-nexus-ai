# E2E: Harness Health + External SSH Host Coverage

**Date:** 2026-08-12
**Status:** Approved design, ready for implementation plan
**Slice:** 1 of 4 (B + A). Slices C (fleet/data invariants) and D (ops surfaces)
are separate specs, not covered here.

---

## Problem

Two real-world E2E suites exist. Neither covers any functionality shipped since
March 2026, and one of them destroys the developer's working environment when
run.

| | `tests/e2e/` | `tests/e2e-cli/` |
|---|---|---|
| Tests | 347 (28 suites) | 361 (27 suites) |
| Drives | MCP / JSON-RPC over HTTP | `nexus` CLI → GraphQL |
| Local lifecycle | Kills the running Local, launches the `flywheel-local` dev build | Uses the already-running production Local |
| Last touched | March 2026 | July 2026 |
| Coverage of post-March features | none | none |

Measured 2026-08-12: grepping all 28 `tests/e2e/` suites for `external`,
`ssh:`, `nexusHost`, `TRUST_EXTERNAL`, `inbox`, `SettingsShell`, `DockedPanel`,
`sentinel` and `logSources` returns **zero files for every term**.
`tests/e2e-cli/` has no `host` or `ssh:` coverage either.

Feature commits since 2026-04-01, by area: docked-panel 22, settings 21,
credentials 21, external 19, sentinel 16, agents 15, agent-runtime 13, cli 15,
transport 14, sdk 14, fleet 14, chat 14, ui 10, twin 10, logging 9, graphql 9,
log-processor 8, inbox 8.

### The harness defect, observed live

`startLocal()` (`tests/e2e/helpers/environment.ts:232`) documents itself as
"Returns the child process, or **null if Local was already running**." That
check does not exist. The function:

1. calls `killExistingLocal()` unconditionally (line 234), which runs
   `pkill -f "Local.app"` and `pkill -f "local-lightning"`;
2. unlinks both connection-info files (lines 239-240);
3. spawns `flywheel-local/node_modules/.bin/electron build/` — the Local **dev
   build**, which shares `~/Library/Application Support/Local` and therefore
   opens the developer's real sites;
4. sets `NEXUS_E2E_STARTED_LOCAL=true`, so teardown kills it.

`globalSetup` additionally rebuilds `better-sqlite3` for Electron, and teardown
rebuilds it back for system Node.

Net effect of running any `tests/e2e/` test: the developer's Local is killed,
replaced by a differently-branded dev build, then killed again at teardown,
leaving no Local running and an addon that cannot load (wrong native ABI).
Observed 2026-08-12 during a three-suite probe. No site data was lost — the
suite creates and deletes only its own `nexus-e2e-test` site — but the session
was destroyed.

---

## Decisions

Locked during design review:

- **D1 — Headless now, renderer later.** Coverage targets CLI, MCP and GraphQL
  surfaces. Driving Local's renderer over CDP is a separate, later project.
  This is a scope decision, not a claim that UI does not need coverage.
- **D2 — New coverage lives in `tests/e2e-cli/`.** It uses the running Local,
  never seizes it, and is the more recently maintained suite. `tests/e2e/` gets
  the lifecycle fix and MCP-only cases.
- **D3 — A Docker fixture is the SSH target.** Not the developer's registered
  third-party production hosts.
- **D4 — One container, two WordPress installs, one alias.** This is the shape
  CLAUDE.md confirms live (a single Hostinger login hosting two installs) and
  the only shape that reproduces the `vectorSiteId` `/` collision.
- **D5 — Orphaned sites are left alone.** `nexus-e2e-mcp-clone-tmp`
  (`NGPsxnOHC`) and `nexus-e2e-cli-test-site` (`8zxKpo0Vj`) predate this work.
  Tracked-id cleanup applies going forward only; nothing sweeps existing rows.
- **D6 — `wp health` is asserted in `tests/e2e/`, not the CLI suite.** It is
  MCP-only with no GraphQL fallback (`src/cli/commands/wp.ts`), so the CLI suite
  cannot guarantee its precondition.

---

## Part B — Harness health

### B1. Adopt, don't seize

`startLocal()` probes before acting: if the MCP server is reachable **and**
GraphQL connection info is present, it returns `null` and adopts the running
instance. It kills nothing, unlinks nothing, spawns nothing.

Only when nothing answers does it launch, and it launches
`/Applications/Local.app` via `open` — matching `dev-reload.sh` — rather than
the `flywheel-local` dev build.

Two escape hatches, both explicit:

- `NEXUS_E2E_LOCAL_PATH` — launch the `flywheel-local` dev build instead, for
  people working on Local itself.
- `NEXUS_E2E_MANAGE_LOCAL=1` — restore today's kill-and-own behaviour
  deliberately, for CI where no human session exists.

`killExistingLocal()` becomes reachable only from the launch path, and only
against a Local that exists but is unreachable.

The docstring is corrected to describe what the function does.

### B2. Drop the native-module rebuild in adopt mode

`tests/e2e/jest.e2e.config.js` states "E2E tests don't import addon source
directly" and sets no `moduleNameMapper`; the jest process talks to the addon
over HTTP. The `better-sqlite3` rebuild in `globalSetup` therefore exists only
to serve a Local that setup is about to launch.

In adopt mode there is nothing to build for: both the Electron rebuild in
`globalSetup` and the system-Node rebuild in `globalTeardown` are skipped. They
run only on the launch path and under `NEXUS_E2E_MANAGE_LOCAL=1`.

This removes the failure mode that left the addon unloadable after a test run.

### B3. Truthful teardown

`globalTeardown` already gates Local shutdown on `NEXUS_E2E_STARTED_LOCAL`.
With B1 that flag becomes truthful rather than always-true, so teardown stops
only a Local the harness itself started.

Site cleanup keeps its current shape: teardown deletes only the site whose id
is recorded in `NEXUS_E2E_CREATED_SITE_ID`, set only when
`discoverEnvironment()` actually created one. Per D5, nothing sweeps
pre-existing rows.

---

## Part A — External SSH host coverage

### A1. The fixture

`tests/e2e-cli/fixtures/ssh-host/`

A single container: `php:8.3-cli` base plus `openssh-server`,
`mariadb-server`, and `wp-cli`, hosting **two** WordPress installs —
`/var/www/alpha` and `/var/www/beta` — under one SSH alias. Container port 22
maps to host port 2222.

Authentication is an ed25519 keypair generated into the fixture directory
(gitignored) and injected as the container user's `authorized_keys`. No key
material is committed.

**Alias registration.** The fixture writes a host block to
`~/.ssh/config.d/nexus-e2e` and adds a single idempotent `Include` line at the
top of `~/.ssh/config`. This mirrors the convention the shipped
`src/main/external/sshConfigWriter.ts` already uses, and the developer's
`~/.ssh/config` already carries an `Include` (line 4, for OrbStack), so the
pattern is established rather than invented.

The fixture never touches `~/.ssh/config.d/nexus` — the file the real Nexus
writer manages.

This indirection is required, not stylistic: `buildExternalSshArgs`
(`src/main/transport/ssh-args.ts:305`) deliberately passes no `-F` and has no
config-path override, because the WPE builder's `-F /dev/null` would break
every `ProxyJump` setup. The alias must therefore resolve through the real ssh
config.

**Two fixture knobs:**

- **Host key rotation** — regenerating the container's host key turns a
  previously-trusted host into `host-key-changed`, making the hard-refusal path
  testable.
- **`disable_functions=proc_open`** — reproduces the shared-hosting case where
  `wp --info` fails with "The PHP functions proc_open() and/or proc_close() are
  disabled." This is a **runtime toggle on the same container**, applied by
  dropping a `.ini` file into the PHP conf.d directory and removing it again —
  not a second container and not a second image build.

**Lifecycle.** `tests/e2e-cli` global setup starts the container and waits for
sshd to accept connections; teardown removes the container, the
`config.d/nexus-e2e` file, and the `Include` line. If the Docker daemon is not
reachable, the external-host suites **skip with an explanatory message** rather
than fail.

### A2. What the fixture cannot cover

The fixture can assert that an unknown host key is **classified**
`host-key-unknown` and that a changed key is **refused**. It cannot **approve**
a key: `TRUST_EXTERNAL_HOST_KEY` is an Electron IPC channel, deliberately never
a GraphQL mutation and never CLI-callable, because the renderer and CLI share
one HTTP endpoint and one bearer token.

For the happy path the fixture writes the container's host key into
`known_hosts` directly — the state a user reaches after clicking approve. The
approval click itself belongs to the later renderer slice (D1).

This limitation is stated here so no future reader mistakes the gap for an
oversight.

### A3. Coverage matrix

Six new files in `tests/e2e-cli/`. Each row pins a rule CLAUDE.md documents as
live; most pin a defect that has actually shipped.

#### `27-external-host-lifecycle.cli-e2e.test.ts`

- `host test <alias>` reports the probe result and both discovered installs.
- `host add <alias> --all --json` registers **both** installs and returns the
  `{registered, sites, error}` envelope.
- `host add --path <dir> --site <name>` registers a single explicit install.
- `host list` shows the registered sites.
- `host remove-site <alias>/<site>` removes one site, leaving the other.
- `host remove <alias> -y` soft-deletes: sets `is_active = 0` and resets
  `domain` to the alias.

**Fence:** after `host remove`, `sites list`, `sites get` and
`fleet site-health` must all stop showing the host. All three lacked an
`is_active = 1` filter, so a removed host kept appearing with a clobbered
domain after `host list` had stopped showing it.

#### `28-external-host-targets.cli-e2e.test.ts`

- `wp core version ssh:<alias>/alpha@production` succeeds.
- Bare `ssh:<alias>@production` **fails** here and names the disambiguated
  forms, because the alias has two sites.
- Every surface that prints a target prints the full `/<site>` form.
- A `@staging` suffix does not loosen the gate on a host registered
  `production` (`mostRestrictiveEnvironment`,
  `src/main/mcp/utils/operation-permissions.ts`).
- `wp core version ssh:unregistered@production` fails with "no registered
  sites" rather than creating a phantom row.
- Five named `nexus wp` subcommands of the 18 that route through
  `resolveTransport` reach the host: `core version`, `plugin list`,
  `theme list`, `option get siteurl`, and `user list`. These are chosen because
  all five are read-only and therefore permitted on `production` by the default
  `wpcli_read` grant, so they exercise routing without depending on a
  permission change.

#### `29-external-host-refresh.cli-e2e.test.ts`

- `host refresh <alias>` populates plugin and theme rows for both installs.
- `php_version` is collected from `wp --info`.
- A host whose refresh fails keeps its previous data.

**Fence:** against the `proc_open`-disabled variant, `php_version` stays
**NULL** — never the fabricated `'8.0'`. An unrefreshed host reports `score`
and `status` as `null`; a refreshed one is scored on `security` and
`performance` only (`externalScoreable = hasPlugins && !!row.php_version`).

#### `30-external-host-index.cli-e2e.test.ts`

- `host index <alias>` indexes both installs.
- `content search` finds content from each install independently.

**Fence:** `ssh:<alias>/alpha` and `ssh:<alias>/beta` must resolve to distinct
sqlite-vec tables. A character-class replace alone maps both to
`ssh_<alias>_<site>`-shaped collisions, which silently merged two hosts'
indexed content until `vectorSiteId()` gained its sha256 suffix. Vector
document metadata must say `source: 'external'`, never `'wpe'`.

#### `31-external-host-fleet.cli-e2e.test.ts`

- `nexus_list_sites`, the `nexus://fleet/state` resource, `fleet summary`,
  `fleet plugins` and `sites list` all include the registered host.

**Fence:** a registered host must never be invisible to fleet-wide discovery —
the gap that had a chat agent confidently reporting a registered host as "not
registered." `fleet_overview`'s coverage line must draw numerator and
denominator from the same source set; the WPE-only denominator printed
`1 of 0` for a user with SSH hosts and no WP Engine account.

#### `32-external-host-safety.cli-e2e.test.ts`

- A never-seen host key is classified `host-key-unknown` and a real fingerprint
  is shown, fetched by connecting through the alias itself (never
  `ssh-keyscan`, which cannot traverse `ProxyJump`).
- After rotation, the host is classified `host-key-changed` and **hard-refused
  on every surface**, with no approval path and no `--yes` bypass.
- An alias of the form `-oProxyCommand=…` is rejected by `assertSafeSshAlias`
  (`^[A-Za-z0-9][A-Za-z0-9._-]*$`).
- `host refresh` and `host index` write entries to `operation-audit.log`; the
  probe does not (its command set is closed and read-only).

### A4. `wp health` — the one MCP-side case

Per D6, `wp health` is the single new case that lands in `tests/e2e/` rather
than the CLI suite. Its `action()` calls `callMcpTool('wp_site_health', …)` and,
on failure, prints "The wp health command requires the MCP server to be
running" and exits 1 — unlike `wp plugin list`, `wp plugin update` and
`wp core version`, it has no GraphQL fallback, so the CLI suite cannot
guarantee its precondition.

One file, `32-wp-site-health-external.e2e.test.ts`, asserts `wp_site_health`
against `ssh:<alias>/alpha@production` through the MCP client the suite already
uses. This is a new file, not a modification of the existing 347 tests, and it
depends on the same Docker fixture — so the fixture lifecycle must be reachable
from both suites' global setup, which the plan will factor into a shared
helper.

### A5. Assertion style

`host add`, `host list` and `host test` support `--json`, so these tests assert
parsed structured fields rather than scraped human output. Where a command has
no JSON mode, the assertion targets a specific documented string, not a
substring that would match unrelated output.

---

## Safety

**Blast radius.** Every destructive operation targets the container or the
fixture alias. `host remove` runs against the fixture alias only; each
destructive step asserts the alias name before executing. Teardown removes the
container, `~/.ssh/config.d/nexus-e2e` and the `Include` line, and nothing
else.

**The developer's real hosts are never contacted.** No test reads
`~/.ssh/config.d/nexus`, and no test enumerates registered non-fixture aliases.

**No key material is committed.** The fixture keypair is generated at setup
into a gitignored path.

---

## Non-vacuity

A test that passes against the bug it names is worse than no test. Each of the
six files carries a header comment naming the exact production line to revert
in order to see it go red, and the implementation plan requires demonstrating
red-then-green for each:

| File | Production line to mutate |
|---|---|
| 27 | the `is_active = 1` predicate in the external lookup |
| 28 | `mostRestrictiveEnvironment` in `operation-permissions.ts` |
| 29 | the `\|\| '8.0'` PHP-version fallback |
| 30 | the sha256 suffix in `vectorSiteId()` |
| 31 | `source IN ('wpe','external')` in the fleet query |
| 32 | the `host-key-changed` branch in `probeExternalHost` |

Mutating the **production** line is the requirement. Stubbing the method that
contains the defect, or asserting on a fixture that encodes the same wrong
value the code does, both produce a green test against a live bug — the exact
failure caught twice already on this branch.

---

## Out of scope

- Driving Local's renderer (Settings shell, Inbox, docked panel, add-host
  wizard, fingerprint approval button). Deferred to the renderer slice.
- Slice C: fleet and data invariants — the three site populations, coverage
  metrics, health-scoring factor gates, `null`-not-`0` for outdated counts,
  audit redaction and `FREEFORM_FIELDS` withholding.
- Slice D: sentinel gating, log-processor bucket/rescan, agent scheduling,
  settings reactivity. Note that agent cadence has no GraphQL mutation and is
  IPC-only, so it is unreachable headlessly.
- Consolidating `tests/e2e/` and `tests/e2e-cli/` into one harness.
- Any modification to `tests/e2e/`'s 347 existing tests. This slice touches
  `tests/e2e/` in exactly two ways: the `startLocal`/rebuild lifecycle fix
  (Part B) and one new file for `wp health` (A4).

---

## Success criteria

1. Running any `tests/e2e/` suite leaves the developer's Local running and the
   addon loadable. No `pkill`, no ABI churn, no dev-build substitution.
2. `npm run test:cli-e2e` starts the Docker fixture, registers the alias,
   passes all six new CLI files, and removes every trace at teardown. The
   seventh new file (`wp health`, A4) passes under `npm run test:e2e`.
3. With the Docker daemon stopped, all seven new files skip with an explanatory
   message and both suites otherwise pass unchanged.
4. Each of the six production-line mutations in the non-vacuity table turns its
   named file red.
5. No pre-existing test in either suite regresses.
