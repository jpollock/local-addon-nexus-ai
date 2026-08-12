# E2E Harness Health + External SSH Host Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the E2E harness from destroying the developer's Local session, and add real-world coverage for external SSH hosts against a Docker sshd fixture.

**Architecture:** Part B extracts the Local-lifecycle decision into a pure, unit-testable function so `startLocal()` adopts an already-running Local instead of killing it, and skips the `better-sqlite3` rebuild pair whenever it adopts. Part A adds a Docker container running real sshd + MariaDB + WP-CLI with two WordPress installs under one SSH alias, registered through a `~/.ssh/config.d/nexus-e2e` block plus one idempotent `Include`, and six new `tests/e2e-cli/` files plus one `tests/e2e/` file that exercise the external-host surface against it.

**Tech Stack:** TypeScript, ts-jest, Docker (compose v2), OpenSSH, WP-CLI, MariaDB, `better-sqlite3`.

**Spec:** `docs/planning/2026-08-12-e2e-external-hosts-and-harness.md` (commit `6e025e65`)

**Branch:** `fixes-0812`

## Global Constraints

- **Never `git push`, `npm version`, `git tag`, or trigger a CI release.** Not on completion, not on "finalizing". Wait for the user to say push/release/deploy/ship. (CLAUDE.md)
- **Never modify `~/.ssh/config.d/nexus`.** That is the file the shipped `src/main/external/sshConfigWriter.ts` manages. The fixture owns `~/.ssh/config.d/nexus-e2e` and nothing else.
- **Never `git add -A` or `git add .`** — stage named paths only. An uncommitted file was already lost in this tree once.
- **The fixture alias is exactly `nexus-e2e-host`.** Every destructive step must assert this literal before executing.
- **No key material is committed.** The fixture keypair is generated at setup into a gitignored path.
- **Docker unreachable → skip with a message, never fail.** The rest of both suites must pass unchanged.
- **Assert parsed JSON wherever `--json` exists.** Scraped human text only where no JSON mode exists, and then against a specific documented string.
- **Non-vacuity is a gate.** Each of the six CLI files must be demonstrated red-then-green by reverting the named production line. A test that passes against the bug it names does not count as done.
- **`better-sqlite3` ABI:** the tree is currently built for Electron (ABI 146). `npx jest tests/unit` needs `npm rebuild better-sqlite3` first (system Node, ABI 141); `npm run rebuild` puts it back for Local. Never leave the tree on the wrong ABI at task end — state which ABI you left it on in your report.
- **Baseline measured 2026-08-12:** `npx tsc --noEmit` is **clean**. `docker compose version` is **v5.1.2**. Branch `fixes-0812`, working tree clean. Re-measure the `npx jest tests/unit` count yourself before Task 1 and record it; do not trust a remembered number.

---

## File Structure

**Part B — harness lifecycle**

| File | Responsibility |
|---|---|
| `tests/e2e/helpers/localLaunchPlan.ts` *(create)* | Pure decision function: given probe results and env vars, decide adopt vs launch. No I/O. |
| `tests/unit/e2e-harness/localLaunchPlan.test.ts` *(create)* | Unit tests for that function. |
| `tests/e2e/helpers/environment.ts` *(modify)* | `startLocal()` consults the plan instead of always killing. |
| `tests/e2e/setup.ts` *(modify)* | Skip both native rebuilds when the plan says adopt. |
| `tests/e2e/teardown.ts` *(modify)* | Skip the system-Node rebuild when setup skipped the Electron one. |

**Part A — fixture**

| File | Responsibility |
|---|---|
| `tests/e2e-cli/fixtures/ssh-host/Dockerfile` *(create)* | Image: sshd + MariaDB + PHP + WP-CLI + two WordPress installs. |
| `tests/e2e-cli/fixtures/ssh-host/docker-compose.yml` *(create)* | Service definition, port map 2222→22. |
| `tests/e2e-cli/fixtures/ssh-host/entrypoint.sh` *(create)* | Start MariaDB, then sshd in foreground. |
| `tests/e2e-cli/fixtures/ssh-host/provision.sh` *(create)* | Build-time: create two DBs and two WP installs. |
| `tests/e2e-cli/helpers/ssh-fixture.ts` *(create)* | Lifecycle API used by both suites: start, stop, alias register/unregister, trust key, rotate key, toggle `proc_open`. |
| `tests/e2e-cli/setup.ts` *(modify)* | Start the fixture; export availability flag. |
| `tests/e2e-cli/teardown.ts` *(modify)* | Stop the fixture and remove every trace. |
| `.gitignore` *(modify)* | Ignore generated fixture keys. |

**Part A — tests**

| File | Responsibility |
|---|---|
| `tests/e2e-cli/27-external-host-lifecycle.cli-e2e.test.ts` | test / add / list / remove-site / remove, soft-delete invisibility. |
| `tests/e2e-cli/28-external-host-targets.cli-e2e.test.ts` | Target resolution, disambiguation, permission gating. |
| `tests/e2e-cli/29-external-host-refresh.cli-e2e.test.ts` | Refresh, NULL discipline, scoring gates. |
| `tests/e2e-cli/30-external-host-index.cli-e2e.test.ts` | Content indexing, vector-id collision, `source: 'external'`. |
| `tests/e2e-cli/31-external-host-fleet.cli-e2e.test.ts` | Fleet and discovery inclusion. |
| `tests/e2e-cli/32-external-host-safety.cli-e2e.test.ts` | Host-key classification, alias validation, audit. |
| `tests/e2e/32-wp-site-health-external.e2e.test.ts` | `wp_site_health` over MCP against the fixture. |

---

## Task 1: Extract the Local-launch decision

**Files:**
- Create: `tests/e2e/helpers/localLaunchPlan.ts`
- Create: `tests/unit/e2e-harness/localLaunchPlan.test.ts`

**Interfaces:**
- Produces: `type LocalLaunchPlan`, `function planLocalLaunch(input: LocalLaunchInput): LocalLaunchPlan`, `function planNeedsManualRebuild(plan: LocalLaunchPlan): boolean`. Task 2 consumes both.

**Context:** `tests/e2e/helpers/environment.ts:232` `startLocal()` says it "Returns the child process, or null if Local was already running" but never checks — it calls `killExistingLocal()` at line 234 unconditionally. This task extracts the decision so it can be tested without spawning Electron.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/e2e-harness/localLaunchPlan.test.ts`:

```ts
/**
 * The E2E harness must not kill a Local the developer is using.
 *
 * This pins the decision only. The I/O that acts on it lives in
 * environment.ts; see localLaunchPlan.ts for why the decision is separate.
 */
import { planLocalLaunch, planNeedsManualRebuild } from '../../e2e/helpers/localLaunchPlan';

const reachable = { mcpReachable: true, graphqlReady: true };
const dead = { mcpReachable: false, graphqlReady: false };

describe('planLocalLaunch', () => {
  it('adopts a Local that is already answering', () => {
    expect(planLocalLaunch({ ...reachable, manageLocal: false, devPath: null }))
      .toEqual({ action: 'adopt' });
  });

  it('does not adopt when MCP answers but GraphQL has not written its info yet', () => {
    // Half-started Local: the CLI tests would fail on a missing token.
    expect(planLocalLaunch({ mcpReachable: true, graphqlReady: false, manageLocal: false, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('launches production Local when nothing is answering', () => {
    expect(planLocalLaunch({ ...dead, manageLocal: false, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('launches the dev build when NEXUS_E2E_LOCAL_PATH is set', () => {
    expect(planLocalLaunch({ ...dead, manageLocal: false, devPath: '/repo/flywheel-local' }))
      .toEqual({ action: 'launch', target: 'dev', killFirst: true });
  });

  it('kills and owns Local when NEXUS_E2E_MANAGE_LOCAL is set, even if one is running', () => {
    // CI has no human session to protect. This is the ONLY path that may
    // kill a reachable Local.
    expect(planLocalLaunch({ ...reachable, manageLocal: true, devPath: null }))
      .toEqual({ action: 'launch', target: 'production', killFirst: true });
  });

  it('honours NEXUS_E2E_LOCAL_PATH under manage mode too', () => {
    expect(planLocalLaunch({ ...reachable, manageLocal: true, devPath: '/repo/flywheel-local' }))
      .toEqual({ action: 'launch', target: 'dev', killFirst: true });
  });
});

describe('planNeedsManualRebuild', () => {
  it('is false when adopting — we touch nothing the developer has', () => {
    expect(planNeedsManualRebuild({ action: 'adopt' })).toBe(false);
  });

  it('is false for a production launch — dev-reload.sh already builds and rebuilds', () => {
    expect(planNeedsManualRebuild({ action: 'launch', target: 'production', killFirst: true })).toBe(false);
  });

  it('is true only for the dev build, which we spawn ourselves', () => {
    expect(planNeedsManualRebuild({ action: 'launch', target: 'dev', killFirst: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm rebuild better-sqlite3
npx jest tests/unit/e2e-harness/localLaunchPlan.test.ts
```

Expected: FAIL — `Cannot find module '../../e2e/helpers/localLaunchPlan'`.

- [ ] **Step 3: Write the implementation**

Create `tests/e2e/helpers/localLaunchPlan.ts`:

```ts
/**
 * Should the E2E harness adopt the running Local, or start its own?
 *
 * Kept as a pure function, separate from environment.ts, because the bug this
 * fixes was a missing decision rather than faulty I/O: startLocal() documented
 * "returns null if Local was already running" and then killed it anyway. A
 * decision with no I/O in it can be tested without spawning Electron.
 */

export interface LocalLaunchInput {
  /** MCP server answered a request. */
  mcpReachable: boolean;
  /** graphql-connection-info.json exists and parsed. */
  graphqlReady: boolean;
  /** NEXUS_E2E_MANAGE_LOCAL === '1' — CI opts in to kill-and-own. */
  manageLocal: boolean;
  /** NEXUS_E2E_LOCAL_PATH — launch the flywheel-local dev build instead. */
  devPath: string | null;
}

export type LocalLaunchPlan =
  | { action: 'adopt' }
  | { action: 'launch'; target: 'production' | 'dev'; killFirst: boolean };

export function planLocalLaunch(input: LocalLaunchInput): LocalLaunchPlan {
  const launch = (): LocalLaunchPlan => ({
    action: 'launch',
    target: input.devPath ? 'dev' : 'production',
    killFirst: true,
  });

  // Manage mode is the only path allowed to kill a Local that is answering.
  if (input.manageLocal) return launch();

  // Both must be true. A Local whose MCP is up but whose GraphQL info is not
  // yet written cannot serve the CLI tests, so adopting it would fail later
  // and more confusingly.
  if (input.mcpReachable && input.graphqlReady) return { action: 'adopt' };

  return launch();
}

/**
 * Does the harness have to build and rebuild the addon itself?
 *
 * Only for the dev build, which we spawn directly. The production path shells
 * out to ./dev-reload.sh, which already runs `npm run build` and
 * `npm run rebuild` — and, critically, injects nexus.env.local through
 * `open --env`, which nothing else does.
 *
 * Adopting rebuilds nothing at all: the jest process never imports addon
 * source (jest.e2e.config.js sets no moduleNameMapper — "we talk to the addon
 * over HTTP"), so the only reason to touch the native binding is a Local we
 * are about to start ourselves.
 */
export function planNeedsManualRebuild(plan: LocalLaunchPlan): boolean {
  return plan.action === 'launch' && plan.target === 'dev';
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx jest tests/unit/e2e-harness/localLaunchPlan.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the tests are not vacuous**

Change `if (input.mcpReachable && input.graphqlReady)` to `if (input.mcpReachable)` and re-run. Expected: the "half-started Local" test goes RED. Revert.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/helpers/localLaunchPlan.ts tests/unit/e2e-harness/localLaunchPlan.test.ts
git commit -m "test(e2e): extract Local launch decision as a pure function"
```

---

## Task 2: Make startLocal adopt instead of seize

**Files:**
- Modify: `tests/e2e/helpers/environment.ts` (`killExistingLocal` ~line 204, `startLocal` ~line 232)
- Modify: `tests/e2e/setup.ts` (rebuild block, lines 12-42)
- Modify: `tests/e2e/teardown.ts` (system-Node rebuild block)

**Interfaces:**
- Consumes: `planLocalLaunch`, `planNeedsNativeRebuild`, `LocalLaunchPlan` from Task 1.
- Produces: `startLocal()` returns `null` when it adopted. `process.env.NEXUS_E2E_SKIP_REBUILD === '1'` is set by setup when it skipped the Electron rebuild; teardown reads it.

**Context:** Verify line numbers before editing — they drift. `killExistingLocal()` runs `pkill -f "Local.app"` and `pkill -f "local-lightning"`. `startLocal()` also unlinks both connection-info files immediately after killing (currently lines 239-240); those unlinks must move inside the launch branch, because deleting them while adopting would break the very instance we adopted.

- [ ] **Step 1: Rewrite `startLocal`'s opening**

Replace the unconditional `killExistingLocal()` and the two `fs.unlinkSync` calls at the top of `startLocal` with:

```ts
export async function startLocal(timeoutMs = 120000): Promise<ChildProcess | null> {
  const plan = planLocalLaunch({
    mcpReachable: await isMcpServerReachable(),
    graphqlReady: await isGraphQLConnectionReady(),
    manageLocal: process.env.NEXUS_E2E_MANAGE_LOCAL === '1',
    devPath: process.env.NEXUS_E2E_LOCAL_PATH ?? null,
  });

  if (plan.action === 'adopt') {
    console.log('[E2E Local] Adopting the running Local — not killing it.');
    return null;
  }

  // Only past this point may we touch the developer's processes or files.
  // The production path does its killing inside dev-reload.sh (see Step 2).
  if (plan.target === 'dev' && plan.killFirst) killExistingLocal();
  try { fs.unlinkSync(getConnectionInfoPath()); } catch { /* may not exist */ }
  try { fs.unlinkSync(getGraphQLConnectionInfoPath()); } catch { /* may not exist */ }

  if (plan.target === 'production') return launchProductionLocal(timeoutMs);
  return launchDevLocal(timeoutMs);
}
```

- [ ] **Step 2: Add the production launcher — it shells out to `./dev-reload.sh`**

The existing spawn body becomes `launchDevLocal`. Add alongside it:

```ts
/**
 * Launch production Local by running the repo's own ./dev-reload.sh.
 *
 * Do NOT hand-roll pkill + npm run build + open here. dev-reload.sh already
 * does all three, and it does one thing nothing else does: it injects
 * nexus.env.local through `open --env`. Per its own comment (lines 9-13),
 * `export FOO=…; open …` does not work — `open` hands the launch to launchd,
 * which uses launchd's environment. `open --env` is the supported injection,
 * and it applies ONLY while the app is actually starting, which is why the
 * kill has to come first. A Local launched any other way silently runs without
 * NEXUS_GOOGLE_CLIENT_SECRET, and the failure surfaces much later as a token
 * refresh error.
 *
 * dev-reload.sh does its own `pkill -x Local`, so plan.killFirst is already
 * satisfied on this path.
 */
async function launchProductionLocal(timeoutMs: number): Promise<ChildProcess | null> {
  const script = path.join(__dirname, '..', '..', '..', 'dev-reload.sh');
  if (!fs.existsSync(script)) {
    throw new Error(
      `dev-reload.sh not found at ${script}. Start Local yourself, or set ` +
      'NEXUS_E2E_LOCAL_PATH to a flywheel-local checkout to launch the dev build.',
    );
  }
  console.log('[E2E Local] Launching Local via ./dev-reload.sh...');
  execSync(`"${script}"`, {
    cwd: path.join(__dirname, '..', '..', '..'),
    stdio: 'inherit',
    timeout: 600_000, // it runs npm run build + electron-rebuild
  });
  await waitForMcpAndGraphql(timeoutMs);
  return null; // `open` detaches; teardown uses killExistingLocal, not a handle
}
```

Extract the existing "Wait for MCP server / Wait for GraphQL connection info" polling loop from `startLocal` into `waitForMcpAndGraphql(timeoutMs)` so both launchers use it rather than duplicating it.

Because `dev-reload.sh` performs its own `pkill -x "Local"`, `startLocal` must **not** also call `killExistingLocal()` on the production path. Apply `plan.killFirst` only on the dev path:

```ts
if (plan.target === 'dev' && plan.killFirst) killExistingLocal();
```

- [ ] **Step 3: Set the started flag from the plan, not from a truthy child**

`tests/e2e/setup.ts` currently sets `NEXUS_E2E_STARTED_LOCAL` only when `startLocal()` returned a child — which `launchProductionLocal` never does. Change it to set the flag whenever `startLocal` did not adopt. Have `startLocal` record it directly:

```ts
process.env.NEXUS_E2E_STARTED_LOCAL = 'true';
```

as the first line of both `launchProductionLocal` and `launchDevLocal`, and delete the `if (localProcess)` block in `setup.ts` that sets it.

- [ ] **Step 4: Delete the rebuild blocks from setup and teardown**

Gating them is not enough — they are now **redundant on every path**, so remove them outright.

In `tests/e2e/setup.ts`, delete the entire "Cleaning and rebuilding better-sqlite3 for Electron" block and the "Rebuilding addon for Electron" block (currently lines 12-42), and move the `startLocal()` call up to where they were. Justification, which belongs in a comment there:

- **adopt** — the running Local already has a working binding, and the jest process never imports addon source, so there is nothing to build for;
- **production launch** — `dev-reload.sh` runs `npm run build` and `npm run rebuild` itself;
- **dev launch** — `launchDevLocal` owns its own build, per `planNeedsManualRebuild`.

Add the build to `launchDevLocal` so that path keeps working:

```ts
async function launchDevLocal(timeoutMs: number): Promise<ChildProcess | null> {
  process.env.NEXUS_E2E_STARTED_LOCAL = 'true';
  if (planNeedsManualRebuild({ action: 'launch', target: 'dev', killFirst: true })) {
    console.log('[E2E Local] Building addon for the dev Electron build...');
    execSync('npm run build', { cwd: addonRoot, stdio: 'inherit' });
    execSync('npm run rebuild', { cwd: addonRoot, stdio: 'inherit' });
  }
  // ...existing spawn + wait...
}
```

In `tests/e2e/teardown.ts`, delete the "Rebuilding better-sqlite3 for system Node" block entirely.

Reasoning worth stating in the commit: the harness must leave the native ABI **exactly as it found it**. Under adopt it never touched it. Under a launch, `dev-reload.sh` set it to Electron precisely because the Local now running needs it — flipping it back to system Node at teardown would break that Local's next start, which is the failure this whole task exists to remove. CLAUDE.md already documents `npm rebuild better-sqlite3` (tests) and `npm run rebuild` (Local) as the deliberate manual context switch; a teardown that flips it silently is the footgun.

- [ ] **Step 5: Verify by running against your own Local**

With Local running:

```bash
pgrep -f "/Applications/Local.app/Contents/MacOS/Local" | head -1   # note the PID
npx jest --config tests/e2e/jest.e2e.config.js --testPathPattern "01-"
pgrep -f "/Applications/Local.app/Contents/MacOS/Local" | head -1   # must be the SAME PID
```

Expected: suite passes, the PID is unchanged, the log contains `Adopting the running Local`, and no `Killed existing Local processes` line appears.

- [ ] **Step 6: Verify the ABI was left exactly as found**

Record the ABI before and after; they must match.

```bash
probe() { node -e "new (require('better-sqlite3'))(':memory:'); console.log('system-Node(141)')" 2>&1 | grep -oE 'NODE_MODULE_VERSION 1[0-9]+|system-Node\(141\)' | head -1; }
probe                      # before
npx jest --config tests/e2e/jest.e2e.config.js --testPathPattern "01-"
probe                      # after — must be identical
```

Expected: identical output both times. On an Electron-ABI tree that is `NODE_MODULE_VERSION 146` twice, proving teardown no longer rebuilds for system Node and the binding the running Local needs is intact.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/helpers/environment.ts tests/e2e/setup.ts tests/e2e/teardown.ts
git commit -m "fix(e2e): adopt a running Local instead of killing it

startLocal() documented 'returns null if Local was already running' and
then pkilled it anyway, launched the flywheel-local dev build in its
place, and rebuilt better-sqlite3 for Electron and back — leaving the
developer with no Local and an unloadable addon.

When it does need to launch, it now runs ./dev-reload.sh rather than
hand-rolling pkill + build + open. dev-reload.sh injects nexus.env.local
via 'open --env', which only works while the app is starting; a
hand-rolled launch silently drops NEXUS_GOOGLE_CLIENT_SECRET.

The harness now leaves the native ABI exactly as it found it."
```

---

## Task 3: The fixture image

**Files:**
- Create: `tests/e2e-cli/fixtures/ssh-host/Dockerfile`
- Create: `tests/e2e-cli/fixtures/ssh-host/entrypoint.sh`
- Create: `tests/e2e-cli/fixtures/ssh-host/provision.sh`
- Create: `tests/e2e-cli/fixtures/ssh-host/docker-compose.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a compose service named `sshhost`, published on host port **2222**, container user **`wp`**, two WordPress roots at **`/home/wp/alpha`** and **`/home/wp/beta`**. Task 4 depends on all five of those literals.

**Context:** Two installs under one alias is the shape CLAUDE.md confirms live (one Hostinger login, two installs) and the only shape that reproduces the `vectorSiteId` collision. `wp --info` requires `proc_open`, which Task 4 toggles off to reproduce the shared-hosting case.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM php:8.3-cli-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server mariadb-server default-mysql-client \
      ca-certificates curl less \
 && rm -rf /var/lib/apt/lists/*

RUN docker-php-ext-install mysqli pdo_mysql

RUN curl -fsSL -o /usr/local/bin/wp \
      https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
 && chmod +x /usr/local/bin/wp

RUN useradd -m -s /bin/bash wp \
 && mkdir -p /home/wp/.ssh /run/sshd \
 && chown -R wp:wp /home/wp

COPY provision.sh /tmp/provision.sh
RUN chmod +x /tmp/provision.sh && /tmp/provision.sh && rm /tmp/provision.sh

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

- [ ] **Step 2: Write provision.sh**

```bash
#!/usr/bin/env bash
# Build-time: create two databases and two WordPress installs under one host.
# Two installs is the point — a single-site alias has no '/' in its site id and
# therefore cannot reproduce the vectorSiteId collision.
set -euo pipefail

service mariadb start
until mysqladmin ping --silent; do sleep 1; done

for site in alpha beta; do
  mysql -e "CREATE DATABASE wp_${site}; \
            CREATE USER 'wp_${site}'@'localhost' IDENTIFIED BY 'wp_${site}_pw'; \
            GRANT ALL ON wp_${site}.* TO 'wp_${site}'@'localhost';"

  su wp -c "wp core download --path=/home/wp/${site} --quiet"
  su wp -c "wp config create --path=/home/wp/${site} \
              --dbname=wp_${site} --dbuser=wp_${site} --dbpass=wp_${site}_pw \
              --dbhost=localhost --quiet"
  su wp -c "wp core install --path=/home/wp/${site} \
              --url=http://${site}.nexus-e2e.test --title='Nexus E2E ${site}' \
              --admin_user=admin --admin_password=nexus-e2e-admin \
              --admin_email=admin@nexus-e2e.test --skip-email --quiet"
  # Distinct post content per install, so 30-external-host-index can prove the
  # two installs did NOT land in the same vector table.
  su wp -c "wp post create --path=/home/wp/${site} --post_status=publish \
              --post_title='Marker ${site}' \
              --post_content='unique-marker-for-${site}-install' --quiet"
done

service mariadb stop
```

- [ ] **Step 3: Write entrypoint.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
service mariadb start
until mysqladmin ping --silent; do sleep 1; done
# ssh-keygen -A is a no-op if keys already exist, so a rotation performed by
# the test helper survives a container restart.
ssh-keygen -A
exec /usr/sbin/sshd -D -e
```

- [ ] **Step 4: Write docker-compose.yml**

```yaml
services:
  sshhost:
    build: .
    container_name: nexus-e2e-sshhost
    ports:
      - "2222:22"
    # WordPress + MariaDB in one container: this fixture is an SSH target, not
    # a production topology. Splitting them would need sshd to reach a second
    # container, which tests nothing the product cares about.
```

- [ ] **Step 5: Ignore generated key material**

Append to `.gitignore`:

```
# E2E SSH fixture — generated per run, never committed
tests/e2e-cli/fixtures/ssh-host/id_ed25519
tests/e2e-cli/fixtures/ssh-host/id_ed25519.pub
```

- [ ] **Step 6: Build and verify by hand**

```bash
cd tests/e2e-cli/fixtures/ssh-host
docker compose build
docker compose up -d
docker compose exec sshhost wp core version --path=/home/wp/alpha --allow-root
docker compose exec sshhost wp core version --path=/home/wp/beta  --allow-root
docker compose exec sshhost wp --info --allow-root | grep 'PHP version'
docker compose down
```

Expected: both `wp core version` calls print a version, and `wp --info` prints a `PHP version:` line. If `wp --info` fails here, Task 7's NULL assertion would pass for the wrong reason — stop and fix the image.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e-cli/fixtures/ssh-host/Dockerfile \
        tests/e2e-cli/fixtures/ssh-host/entrypoint.sh \
        tests/e2e-cli/fixtures/ssh-host/provision.sh \
        tests/e2e-cli/fixtures/ssh-host/docker-compose.yml \
        .gitignore
git commit -m "test(e2e): Docker sshd fixture with two WordPress installs"
```

---

## Task 4: Fixture lifecycle helper and suite wiring

**Files:**
- Create: `tests/e2e-cli/helpers/ssh-fixture.ts`
- Modify: `tests/e2e-cli/setup.ts`
- Modify: `tests/e2e-cli/teardown.ts`

**Interfaces:**
- Consumes: the compose service, port 2222, user `wp`, roots `/home/wp/alpha` and `/home/wp/beta` from Task 3.
- Produces, all imported by Tasks 5-11:
  - `const FIXTURE_ALIAS = 'nexus-e2e-host'`
  - `const FIXTURE_SITES = ['alpha', 'beta'] as const`
  - `async function startSshFixture(): Promise<boolean>` — true if ready, false if Docker unavailable
  - `async function stopSshFixture(): Promise<void>`
  - `function fixtureAvailable(): boolean` — reads `process.env.CLI_E2E_SSH_FIXTURE === 'ready'`
  - `async function trustFixtureHostKey(): Promise<void>`
  - `async function forgetFixtureHostKey(): Promise<void>`
  - `async function rotateFixtureHostKey(): Promise<void>`
  - `async function setProcOpenDisabled(disabled: boolean): Promise<void>`

**Context:** `buildExternalSshArgs` (`src/main/transport/ssh-args.ts:305`) deliberately passes no `-F` and has no config-path override, because the WPE builder's `-F /dev/null` would break every `ProxyJump`. So the alias must resolve through the developer's real ssh config. The shipped `src/main/external/sshConfigWriter.ts` already establishes the convention: a block in `~/.ssh/config.d/` plus one idempotent `Include` at the top of `~/.ssh/config`. Follow it; do not invent a second convention, and never write `~/.ssh/config.d/nexus`.

- [ ] **Step 1: Write the helper**

```ts
/**
 * Docker sshd fixture: one container, two WordPress installs, one alias.
 *
 * The alias must resolve through the developer's REAL ~/.ssh/config, because
 * buildExternalSshArgs passes no -F and has no override (that is deliberate —
 * -F /dev/null would break ProxyJump). So this writes a block to
 * ~/.ssh/config.d/nexus-e2e and one Include line, mirroring what the shipped
 * sshConfigWriter.ts does, and removes both at teardown.
 *
 * It NEVER touches ~/.ssh/config.d/nexus, which is the real writer's file.
 */
import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

export const FIXTURE_ALIAS = 'nexus-e2e-host';
export const FIXTURE_SITES = ['alpha', 'beta'] as const;
export const FIXTURE_PORT = 2222;
export const FIXTURE_HOST = '127.0.0.1';

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures', 'ssh-host');
const KEY_PATH = path.join(FIXTURE_DIR, 'id_ed25519');
const SSH_DIR = path.join(os.homedir(), '.ssh');
const CONFIG_PATH = path.join(SSH_DIR, 'config');
const NEXUS_E2E_CONFIG = path.join(SSH_DIR, 'config.d', 'nexus-e2e');
const INCLUDE_LINE = 'Include ~/.ssh/config.d/nexus-e2e';
const KNOWN_HOSTS_ENTRY = `[${FIXTURE_HOST}]:${FIXTURE_PORT}`;

function compose(args: string[], timeout = 300_000): string {
  return execFileSync('docker', ['compose', ...args], {
    cwd: FIXTURE_DIR, encoding: 'utf8', timeout,
  });
}

export function fixtureAvailable(): boolean {
  return process.env.CLI_E2E_SSH_FIXTURE === 'ready';
}

function dockerReachable(): boolean {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'],
      { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch { return false; }
}

function ensureKeypair(): void {
  if (fs.existsSync(KEY_PATH)) return;
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'nexus-e2e', '-f', KEY_PATH]);
}

function writeAliasBlock(): void {
  fs.mkdirSync(path.join(SSH_DIR, 'config.d'), { recursive: true });
  fs.writeFileSync(NEXUS_E2E_CONFIG,
    `# Generated by the Nexus E2E SSH fixture. Removed at teardown.\n` +
    `Host ${FIXTURE_ALIAS}\n` +
    `  HostName ${FIXTURE_HOST}\n` +
    `  Port ${FIXTURE_PORT}\n` +
    `  User wp\n` +
    `  IdentityFile ${KEY_PATH}\n` +
    `  IdentitiesOnly yes\n`,
    { mode: 0o600 });

  // Idempotent Include at the TOP: ssh_config is first-obtained-value-wins.
  const existing = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : '';
  if (!existing.split('\n').some((l) => l.trim() === INCLUDE_LINE)) {
    fs.writeFileSync(CONFIG_PATH, `${INCLUDE_LINE}\n${existing}`, { mode: 0o600 });
  }
}

function removeAliasBlock(): void {
  try { fs.unlinkSync(NEXUS_E2E_CONFIG); } catch { /* already gone */ }
  if (!fs.existsSync(CONFIG_PATH)) return;
  const kept = fs.readFileSync(CONFIG_PATH, 'utf8')
    .split('\n').filter((l) => l.trim() !== INCLUDE_LINE).join('\n');
  fs.writeFileSync(CONFIG_PATH, kept, { mode: 0o600 });
}

async function installAuthorizedKey(): Promise<void> {
  const pub = fs.readFileSync(`${KEY_PATH}.pub`, 'utf8').trim();
  compose(['exec', '-T', 'sshhost', 'bash', '-c',
    `mkdir -p /home/wp/.ssh && echo '${pub}' > /home/wp/.ssh/authorized_keys ` +
    `&& chown -R wp:wp /home/wp/.ssh && chmod 700 /home/wp/.ssh ` +
    `&& chmod 600 /home/wp/.ssh/authorized_keys`]);
}

/**
 * Read the container's host key directly rather than ssh-keyscan: deterministic,
 * no network race, and it keeps the fixture honest about the product rule that
 * ssh-keyscan is never the right tool (it cannot traverse a ProxyJump).
 */
export async function trustFixtureHostKey(): Promise<void> {
  const pub = compose(['exec', '-T', 'sshhost', 'cat', '/etc/ssh/ssh_host_ed25519_key.pub']).trim();
  const [type, b64] = pub.split(/\s+/);
  await forgetFixtureHostKey();
  fs.appendFileSync(path.join(SSH_DIR, 'known_hosts'), `${KNOWN_HOSTS_ENTRY} ${type} ${b64}\n`);
}

export async function forgetFixtureHostKey(): Promise<void> {
  try {
    await execFileAsync('ssh-keygen', ['-R', KNOWN_HOSTS_ENTRY], { timeout: 10_000 });
  } catch { /* absent is fine */ }
}

/** Turn a trusted host into a host-key-changed host. */
export async function rotateFixtureHostKey(): Promise<void> {
  compose(['exec', '-T', 'sshhost', 'bash', '-c',
    'rm -f /etc/ssh/ssh_host_* && ssh-keygen -A && pkill -HUP sshd || true']);
  compose(['restart', 'sshhost']);
  await waitForSsh();
}

/**
 * Shared hosting commonly sets disable_functions=proc_open, which makes
 * `wp --info` fail and php_version permanently NULL. Runtime toggle, same
 * container — not a second image.
 */
export async function setProcOpenDisabled(disabled: boolean): Promise<void> {
  const ini = '/usr/local/etc/php/conf.d/zz-nexus-e2e-procopen.ini';
  compose(['exec', '-T', 'sshhost', 'bash', '-c', disabled
    ? `echo 'disable_functions=proc_open,proc_close' > ${ini}`
    : `rm -f ${ini}`]);
}

async function waitForSsh(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execFileAsync('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', `UserKnownHostsFile=${path.join(FIXTURE_DIR, '.probe_known_hosts')}`,
        '-o', 'BatchMode=yes', '-i', KEY_PATH,
        '-p', String(FIXTURE_PORT), `wp@${FIXTURE_HOST}`, 'echo ready',
      ], { timeout: 10_000 });
      return;
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw new Error(`SSH fixture did not accept connections within ${timeoutMs}ms`);
}

export async function startSshFixture(): Promise<boolean> {
  if (!dockerReachable()) return false;
  ensureKeypair();
  compose(['up', '-d', '--build']);
  await installAuthorizedKey();
  await waitForSsh();
  writeAliasBlock();
  process.env.CLI_E2E_SSH_FIXTURE = 'ready';
  return true;
}

export async function stopSshFixture(): Promise<void> {
  removeAliasBlock();
  await forgetFixtureHostKey();
  try { fs.unlinkSync(path.join(FIXTURE_DIR, '.probe_known_hosts')); } catch { /* fine */ }
  try { compose(['down', '-v'], 120_000); } catch { /* already down */ }
  delete process.env.CLI_E2E_SSH_FIXTURE;
}
```

- [ ] **Step 2: Wire it into the CLI suite's setup**

At the end of `globalSetup()` in `tests/e2e-cli/setup.ts`, before the final "Ready" log:

```ts
const { startSshFixture } = require('./helpers/ssh-fixture');
console.log('[CLI E2E Setup] Starting SSH host fixture...');
const sshReady = await startSshFixture();
console.log(sshReady
  ? '[CLI E2E Setup] ✅ SSH fixture ready'
  : '[CLI E2E Setup] ⚠ Docker unavailable — external-host tests will skip');
```

- [ ] **Step 3: Wire teardown**

Replace the body of `globalTeardown()` in `tests/e2e-cli/teardown.ts`:

```ts
export default async function globalTeardown() {
  const { stopSshFixture } = require('./helpers/ssh-fixture');
  console.log('\n[CLI E2E Teardown] Stopping SSH host fixture...');
  await stopSshFixture();
  console.log('[CLI E2E Teardown] Tests complete');
  console.log('[CLI E2E Teardown] Production Local is still running\n');
}
```

- [ ] **Step 4: Verify the round trip leaves no trace**

```bash
cp ~/.ssh/config /tmp/ssh-config-before
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "01-cli-basic"
diff /tmp/ssh-config-before ~/.ssh/config && echo "SSH CONFIG UNCHANGED"
test -f ~/.ssh/config.d/nexus-e2e && echo "LEAK: block left behind" || echo "block removed"
test -f ~/.ssh/config.d/nexus && echo "real nexus file still present (expected if you use it)"
docker ps --filter name=nexus-e2e-sshhost --format '{{.Names}}' | grep -q . && echo "LEAK: container running" || echo "container removed"
```

Expected: `SSH CONFIG UNCHANGED`, `block removed`, `container removed`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e-cli/helpers/ssh-fixture.ts tests/e2e-cli/setup.ts tests/e2e-cli/teardown.ts
git commit -m "test(e2e): SSH fixture lifecycle and alias registration"
```

---

## Task 5: `27-external-host-lifecycle`

**Files:**
- Create: `tests/e2e-cli/27-external-host-lifecycle.cli-e2e.test.ts`

**Interfaces:**
- Consumes: `runCli` from `helpers/cli-test-utils`; `FIXTURE_ALIAS`, `FIXTURE_SITES`, `fixtureAvailable`, `trustFixtureHostKey` from `helpers/ssh-fixture`.

**Context:** `host add --json` emits `{ registered: boolean, sites: Array<{site, registered, environment, error}>, error: string|null }`. `host list --json` emits an array of `{alias, sites: [{name, environment, domain}]}`, or `{error}`. When more than one candidate is found and `--all` is absent while `--json` or `--yes` is present, it refuses with an error rather than guessing.

**Non-vacuity target:** the `is_active = 1` predicate on external lookups (e.g. `src/main/ipc-handlers.ts:1402`, `src/main/mcp/site-resolver.ts:105`).

- [ ] **Step 1: Write the test file**

```ts
/**
 * External host registration lifecycle, against the Docker sshd fixture.
 *
 * NON-VACUITY: the soft-delete test below is the one that matters. To prove it
 * is real, delete `AND is_active = 1` from the external lookup in
 * src/main/ipc-handlers.ts:1402 and re-run — "stops listing a removed host"
 * must go RED. `nexus host remove` only sets is_active = 0 and resets domain to
 * the alias; every reader must filter, and three of them did not.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, FIXTURE_SITES, fixtureAvailable, trustFixtureHostKey,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host lifecycle', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']); // clean slate
  });

  it('host test discovers both WordPress installs', async () => {
    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.error).toBeUndefined();
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates.join(' ')).toContain('/home/wp/alpha');
    expect(report.candidates.join(' ')).toContain('/home/wp/beta');
  });

  it('refuses to guess which install to register when two exist', async () => {
    // --json without --all: the picker cannot prompt, so it must decline.
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(false);
    expect(out.error).toMatch(/2 WordPress installations/);
  });

  it('host add --all registers both installs', async () => {
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(true);
    expect(out.error).toBeNull();
    expect(out.sites.map((s: any) => s.site).sort()).toEqual([...FIXTURE_SITES].sort());
    expect(out.sites.every((s: any) => s.registered)).toBe(true);
  });

  it('host list shows both sites under one alias with full targets', async () => {
    const r = await runCli(['host', 'list', '--json']);
    const hosts = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
    const host = hosts.find((h: any) => h.alias === FIXTURE_ALIAS);
    expect(host).toBeDefined();
    expect(host.sites.map((s: any) => s.name).sort()).toEqual([...FIXTURE_SITES].sort());
  });

  it('host remove-site removes one site and leaves the other', async () => {
    await runCli(['host', 'remove-site', `${FIXTURE_ALIAS}/beta`, '-y']);
    const r = await runCli(['host', 'list', '--json']);
    const hosts = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
    const host = hosts.find((h: any) => h.alias === FIXTURE_ALIAS);
    expect(host.sites.map((s: any) => s.name)).toEqual(['alpha']);
  });

  it('stops listing a removed host — soft-delete must be filtered by every reader', async () => {
    expect(FIXTURE_ALIAS).toBe('nexus-e2e-host'); // guard before a destructive step
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);

    const list = await runCli(['host', 'list', '--json']);
    expect(list.stdout).not.toContain(FIXTURE_ALIAS);

    // `sites list` reads a different query and missed is_active = 1 too.
    const sites = await runCli(['sites', 'list', '--json']);
    expect(sites.stdout).not.toContain(FIXTURE_ALIAS);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "27-"
```

Expected: 6 passed.

- [ ] **Step 3: Prove non-vacuity**

Delete `AND is_active = 1` from `src/main/ipc-handlers.ts:1402`, rebuild the addon (`npm run build`), reload Local, re-run. Expected: "stops listing a removed host" goes RED. Restore the line, rebuild, confirm green. Record both outcomes in your report.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/27-external-host-lifecycle.cli-e2e.test.ts
git commit -m "test(e2e): external host registration lifecycle"
```

---

## Task 6: `28-external-host-targets`

**Files:**
- Create: `tests/e2e-cli/28-external-host-targets.cli-e2e.test.ts`

**Non-vacuity target:** `mostRestrictiveEnvironment`, consumed in `src/main/transport/resolve.ts:10`.

**Context:** Target syntax is `ssh:<alias>/<site>@<environment>`. The bare `ssh:<alias>@<env>` form is accepted only when the connection has exactly one site — this fixture has two, so it must be refused with the disambiguated forms. `resolveTransport` gates on the **more restrictive** of the registered label and the typed suffix, so `@development` cannot loosen a host registered `production`. Five read-only subcommands are used because `wpcli_read` is permitted on every environment by default.

- [ ] **Step 1: Write the test file**

```ts
/**
 * Target resolution and the permission gate for external hosts.
 *
 * NON-VACUITY: change mostRestrictiveEnvironment (src/main/mcp/utils/
 * operation-permissions.ts, used at src/main/transport/resolve.ts:10) to return
 * the target's suffix instead of the more restrictive of the two, and
 * "a @development suffix cannot loosen a production host" must go RED. Gating
 * on the target alone is exactly how a production host became writable by
 * addressing it as ssh:<alias>@development.
 */
import { runCli } from './helpers/cli-test-utils';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host target resolution', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
  });

  it.each([
    ['core', 'version'],
    ['plugin', 'list'],
    ['theme', 'list'],
  ])('wp %s %s reaches the host on a full target', async (a, b) => {
    const r = await runCli(['wp', a, b, `ssh:${FIXTURE_ALIAS}/alpha@production`], { timeout: 120_000 });
    expect(r.exitCode).toBe(0);
  });

  it('option-get returns the value this install was provisioned with', async () => {
    const r = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/alpha@production`, 'blogname'],
      { timeout: 120_000 });
    expect(r.output).toContain('Nexus E2E alpha');
  });

  it('resolves each site independently, not to whichever matched first', async () => {
    const r = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/beta@production`, 'blogname'],
      { timeout: 120_000 });
    expect(r.output).toContain('Nexus E2E beta');
  });

  it('refuses a bare alias when the connection has two sites, and names both forms', async () => {
    const r = await runCli(['wp', 'core', 'version', `ssh:${FIXTURE_ALIAS}@production`],
      { timeout: 120_000 });
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain(`ssh:${FIXTURE_ALIAS}/alpha`);
    expect(r.output).toContain(`ssh:${FIXTURE_ALIAS}/beta`);
  });

  it('a @development suffix cannot loosen a production host', async () => {
    // Registered production above. A write is refused on production by default
    // (`wpcli`), and the typed suffix must not override the registered label.
    const r = await runCli(
      ['wp', 'option-update', `ssh:${FIXTURE_ALIAS}/alpha@development`, 'blogname', 'hijacked'],
      { timeout: 120_000 });
    expect(r.exitCode).not.toBe(0);
    expect(r.output.toLowerCase()).toMatch(/not allowed|blocked|permission/);

    // And the value on the box is unchanged — the refusal was real, not cosmetic.
    const check = await runCli(['wp', 'option-get', `ssh:${FIXTURE_ALIAS}/alpha@production`, 'blogname'],
      { timeout: 120_000 });
    expect(check.output).toContain('Nexus E2E alpha');
  });

  it('an unregistered alias fails rather than creating a phantom site row', async () => {
    const r = await runCli(['wp', 'core', 'version', 'ssh:nexus-e2e-never-registered@production'],
      { timeout: 60_000 });
    expect(r.exitCode).not.toBe(0);
    const list = await runCli(['host', 'list', '--json']);
    expect(list.stdout).not.toContain('nexus-e2e-never-registered');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "28-"
```

Expected: 8 passed.

- [ ] **Step 3: Prove non-vacuity**

Make `mostRestrictiveEnvironment` return the target suffix rather than the more restrictive value, rebuild, reload Local, re-run. Expected: "a @development suffix cannot loosen a production host" goes RED. Restore and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/28-external-host-targets.cli-e2e.test.ts
git commit -m "test(e2e): external host target resolution and permission gate"
```

---

## Task 7: `29-external-host-refresh`

**Files:**
- Create: `tests/e2e-cli/29-external-host-refresh.cli-e2e.test.ts`

**Non-vacuity target:** the no-default PHP version at `src/main/mcp/modules/fleet-intelligence/get-site-health.ts:83` (`phpVersion: row.php_version || undefined`) and the `externalScoreable` gate at line 91.

**Context:** `php_version` comes from `wp --info`, which requires `proc_open`. With `proc_open` disabled the value must stay **NULL** forever — never the fabricated `'8.0'` that collected ~27% of a remote site's score for 46 of 331 installs. `externalScoreable = hasPlugins && !!row.php_version`; an unrefreshed or unknowable host is **not scored at all**, because a score over zero factors is not a low score.

- [ ] **Step 1: Write the test file**

```ts
/**
 * External host refresh: what gets collected, and what must stay NULL.
 *
 * NON-VACUITY: change src/main/mcp/modules/fleet-intelligence/get-site-health.ts:83
 * from `row.php_version || undefined` to `row.php_version || '8.0'` and the
 * proc_open test must go RED. A fabricated version earns real security and
 * performance credit for something never observed.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey, setProcOpenDisabled,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host refresh', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await setProcOpenDisabled(false);
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
  });

  afterAll(async () => { await setProcOpenDisabled(false); });

  it('is not scored before any refresh has run', async () => {
    const r = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(r.output).toMatch(/Not enough data to score/);
  });

  it('host refresh collects plugin rows for both installs', async () => {
    const r = await runCli(['host', 'refresh', FIXTURE_ALIAS], { timeout: 300_000 });
    expect(r.exitCode).toBe(0);

    const plugins = await runCli(['fleet', 'plugins', '--json'], { timeout: 120_000 });
    expect(plugins.stdout).toContain(FIXTURE_ALIAS);
  });

  it('is scored on security and performance once refreshed', async () => {
    const r = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(r.output).not.toMatch(/Not enough data to score/);
    // Only two of the five factors apply to a remote host: maintenance and
    // activity read local-only tables, and stability counts local events.
    expect(r.output.toLowerCase()).toContain('security');
    expect(r.output.toLowerCase()).toContain('performance');
  });

  it('leaves php_version NULL when proc_open is disabled, never defaulting to 8.0', async () => {
    await setProcOpenDisabled(true);
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    await runCli(['host', 'refresh', FIXTURE_ALIAS], { timeout: 300_000 });

    const r = await runCli(['sites', 'get', `ssh:${FIXTURE_ALIAS}/alpha@production`, '--json'],
      { timeout: 120_000 });
    const site = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(site.phpVersion ?? null).toBeNull();
    expect(JSON.stringify(site)).not.toContain('8.0');
  });

  it('is unscored again when php_version could not be collected', async () => {
    // hasPlugins is true but php_version is NULL, so externalScoreable is false.
    const r = await runCli(['fleet', 'site-health', `ssh:${FIXTURE_ALIAS}/alpha@production`],
      { timeout: 120_000 });
    expect(r.output).toMatch(/Not enough data to score/);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "29-"
```

Expected: 5 passed.

- [ ] **Step 3: Prove non-vacuity**

Change line 83 to `row.php_version || '8.0'`, rebuild, reload, re-run. Expected: the `proc_open` test goes RED. Restore and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/29-external-host-refresh.cli-e2e.test.ts
git commit -m "test(e2e): external host refresh and NULL php_version discipline"
```

---

## Task 8: `30-external-host-index`

**Files:**
- Create: `tests/e2e-cli/30-external-host-index.cli-e2e.test.ts`

**Non-vacuity target:** the hash suffix in `src/main/vector-store/vectorSiteId.ts:30`.

**Context:** Verified in the current tree — `vectorSiteId` sanitizes, and appends an 8-char sha256 of the original id **only when sanitization changed something** (`if (sanitized === siteId) return siteId;`). Note this contradicts CLAUDE.md, which claims the hash is applied uniformly; the code and its comment are authoritative, and the conditional exists to keep local/WPE ids identity-stable. Without the hash, `ssh:a/b-c` and `ssh:a-b/c` both sanitize to `ssh_a_b_c`. Each fixture install was provisioned with a distinct marker post (`unique-marker-for-alpha-install`, `unique-marker-for-beta-install`) precisely so a merge is detectable.

- [ ] **Step 1: Write the test file**

```ts
/**
 * Content indexing for external hosts, and the vector-table collision.
 *
 * NON-VACUITY: in src/main/vector-store/vectorSiteId.ts, drop the hash suffix
 * (return `sanitized` instead of `${sanitized}_${hash}`) and
 * "keeps each install's content in its own table" must go RED. Both installs
 * then sanitize to the same table name and one host's content silently
 * overwrites the other's.
 */
import { runCli } from './helpers/cli-test-utils';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host content indexing', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    await runCli(['host', 'index', FIXTURE_ALIAS], { timeout: 600_000 });
  });

  it('indexes the alpha install', async () => {
    const r = await runCli(['content', 'search', 'unique-marker-for-alpha-install', '--json'],
      { timeout: 120_000 });
    expect(r.stdout).toContain('Marker alpha');
  });

  it('indexes the beta install', async () => {
    const r = await runCli(['content', 'search', 'unique-marker-for-beta-install', '--json'],
      { timeout: 120_000 });
    expect(r.stdout).toContain('Marker beta');
  });

  it('keeps each install\'s content in its own table', async () => {
    // The collision symptom is that one install's content vanishes because the
    // other overwrote the shared table. Both markers surviving is the proof.
    const alpha = await runCli(['content', 'search', 'unique-marker-for-alpha-install', '--json'],
      { timeout: 120_000 });
    const beta = await runCli(['content', 'search', 'unique-marker-for-beta-install', '--json'],
      { timeout: 120_000 });
    expect(alpha.stdout).toContain('Marker alpha');
    expect(beta.stdout).toContain('Marker beta');
    // And neither result set is contaminated with the other install's content.
    expect(alpha.stdout).not.toContain('Marker beta');
    expect(beta.stdout).not.toContain('Marker alpha');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "30-"
```

Expected: 3 passed.

- [ ] **Step 3: Prove non-vacuity**

In `vectorSiteId.ts`, return `sanitized` instead of `` `${sanitized}_${hash}` ``. Rebuild, reload, wipe the external index (`nexus host index nexus-e2e-host` after `nexus host remove`/`add`), re-run. Expected: "keeps each install's content in its own table" goes RED. Restore and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/30-external-host-index.cli-e2e.test.ts
git commit -m "test(e2e): external host indexing and vector table isolation"
```

---

## Task 9: `31-external-host-fleet`

**Files:**
- Create: `tests/e2e-cli/31-external-host-fleet.cli-e2e.test.ts`

**Non-vacuity target:** `source IN ('wpe','external')` at `src/main/ipc-handlers.ts:780` and `src/main/mcp/site-resolver.ts:63`.

**Context:** A registered host that is invisible to fleet-wide discovery makes a chat agent report it "not registered." `source='wpe'` alone was the bug; `source != 'local'` is forbidden because it silently absorbs any future source.

- [ ] **Step 1: Write the test file**

```ts
/**
 * A registered external host must be visible to every fleet-wide reader.
 *
 * NON-VACUITY: change `source IN ('wpe','external')` to `source = 'wpe'` at
 * src/main/ipc-handlers.ts:780 and "appears in the fleet summary" must go RED.
 * That single-source filter is what made a registered host invisible to
 * nexus_list_sites, so an agent confidently reported it as not registered.
 */
import { runCli } from './helpers/cli-test-utils';
import { FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey } from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external hosts in fleet-wide views', () => {
  beforeAll(async () => {
    await trustFixtureHostKey();
    await runCli(['host', 'remove', FIXTURE_ALIAS, '-y']);
    await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--json'], { timeout: 180_000 });
    await runCli(['host', 'refresh', FIXTURE_ALIAS], { timeout: 300_000 });
  });

  it('appears in sites list', async () => {
    const r = await runCli(['sites', 'list', '--json'], { timeout: 120_000 });
    expect(r.stdout).toContain(FIXTURE_ALIAS);
  });

  it('appears in the fleet summary', async () => {
    const r = await runCli(['fleet', 'summary', '--json'], { timeout: 180_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(FIXTURE_ALIAS);
  });

  it('appears in fleet plugins', async () => {
    const r = await runCli(['fleet', 'plugins', '--json'], { timeout: 180_000 });
    expect(r.stdout).toContain(FIXTURE_ALIAS);
  });

  it('never reports a coverage figure whose numerator exceeds its denominator', async () => {
    // fleet_overview counted wp_version across WPE + external but divided by
    // the WPE-only count, printing "1 of 0" for a user with SSH hosts and no
    // WP Engine account.
    const r = await runCli(['fleet', 'overview'], { timeout: 180_000 });
    for (const [, num, den] of r.output.matchAll(/(\d+)\s+of\s+(\d+)/g)) {
      expect(Number(num)).toBeLessThanOrEqual(Number(den));
    }
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "31-"
```

Expected: 4 passed.

- [ ] **Step 3: Prove non-vacuity**

Change `source IN ('wpe','external')` to `source = 'wpe'` at `src/main/ipc-handlers.ts:780`, rebuild, reload, re-run. Expected: "appears in the fleet summary" goes RED. Restore and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/31-external-host-fleet.cli-e2e.test.ts
git commit -m "test(e2e): external hosts appear in fleet-wide views"
```

---

## Task 10: `32-external-host-safety`

**Files:**
- Create: `tests/e2e-cli/32-external-host-safety.cli-e2e.test.ts`

**Non-vacuity target:** the `host-key-changed` branch at `src/main/external/probeExternalHost.ts:173`.

**Context:** A never-seen key is `host-key-unknown` and shows a real fingerprint. A previously-trusted key that changed is `host-key-changed` and is **hard-refused everywhere with no approval path on any surface**, matching ssh's own model. `--yes` never bypasses this. Approving a new key is possible only from Local's Settings UI via the `TRUST_EXTERNAL_HOST_KEY` IPC channel — deliberately never a GraphQL mutation and never called from `src/cli/`, so **no CLI test may assert an approval succeeds**. Aliases are format-validated by `assertSafeSshAlias` (`src/main/transport/ssh-args.ts:68`, `^[A-Za-z0-9][A-Za-z0-9._-]*$`) because a leading `-` turns the alias into an ssh *option*.

- [ ] **Step 1: Write the test file**

```ts
/**
 * Host-key trust and alias safety.
 *
 * NON-VACUITY: at src/main/external/probeExternalHost.ts:173, return
 * 'host-key-unknown' instead of 'host-key-changed' and "a changed host key is
 * hard-refused" must go RED — the rotated host would then be offered an
 * approval path, which is precisely the MITM/reinstall case ssh never
 * re-prompts for.
 *
 * There is deliberately NO test that approving a key succeeds: approval is the
 * TRUST_EXTERNAL_HOST_KEY IPC channel, which the CLI cannot and must not reach.
 */
import { runCli } from './helpers/cli-test-utils';
import {
  FIXTURE_ALIAS, fixtureAvailable, trustFixtureHostKey, forgetFixtureHostKey,
  rotateFixtureHostKey,
} from './helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('external host safety', () => {
  afterAll(async () => {
    await rotateFixtureHostKey(); // leave the fixture in a known state
    await trustFixtureHostKey();
  });

  it('classifies a never-seen host key as unknown and shows a fingerprint', async () => {
    await forgetFixtureHostKey();
    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.reason).toBe('host-key-unknown');
    expect(report.fingerprint).toMatch(/^SHA256:/);
  });

  it('does not register a host whose key is unknown, even with --yes', async () => {
    const r = await runCli(['host', 'add', FIXTURE_ALIAS, '--all', '--yes', '--json'],
      { timeout: 120_000 });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(out.registered).toBe(false);
  });

  it('a changed host key is hard-refused, with no approval path offered', async () => {
    await trustFixtureHostKey();
    await rotateFixtureHostKey();

    const r = await runCli(['host', 'test', FIXTURE_ALIAS, '--json'], { timeout: 120_000 });
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.reason).toBe('host-key-changed');
    // Unlike host-key-unknown, nothing may point the user at an approval flow.
    expect(r.output).not.toMatch(/Settings/i);
  });

  it('rejects an alias that ssh would read as an option', async () => {
    // A leading '-' makes the alias an argv option: -oProxyCommand=... is local
    // command execution.
    const r = await runCli(['host', 'test', '-oProxyCommand=touch /tmp/nexus-e2e-pwned'],
      { timeout: 30_000 });
    expect(r.exitCode).not.toBe(0);
    const fs = require('fs');
    expect(fs.existsSync('/tmp/nexus-e2e-pwned')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "32-external-host-safety"
```

Expected: 4 passed.

- [ ] **Step 3: Prove non-vacuity**

At `probeExternalHost.ts:173`, return `'host-key-unknown'` instead of `'host-key-changed'`. Rebuild, reload, re-run. Expected: "a changed host key is hard-refused" goes RED. Restore and confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-cli/32-external-host-safety.cli-e2e.test.ts
git commit -m "test(e2e): host key classification and alias safety"
```

---

## Task 11: `wp health` over MCP

**Files:**
- Create: `tests/e2e/32-wp-site-health-external.e2e.test.ts`

**Interfaces:**
- Consumes: `McpClient` and `loadConnectionInfo` from `tests/e2e/helpers/client` and `tests/e2e/helpers/environment`; `FIXTURE_ALIAS`, `fixtureAvailable`, `startSshFixture` from `tests/e2e-cli/helpers/ssh-fixture`.

**Context:** `wp health` is the one new case that cannot live in the CLI suite: its `action()` calls `callMcpTool('wp_site_health', …)` and has **no GraphQL fallback**, unlike `wp plugin list`, `wp plugin update` and `wp core version`. It previously failed with `Site "undefined" not found.` because `wp_site_health` was local-only; it was ported onto `resolveTransport`. The `tests/e2e/` suite has its own global setup, so the fixture must be started there too — it is idempotent (`docker compose up -d` on a running container is a no-op).

- [ ] **Step 1: Start the fixture in the MCP suite's setup**

In `tests/e2e/setup.ts`, after the environment discovery block:

```ts
const { startSshFixture } = require('../e2e-cli/helpers/ssh-fixture');
const sshReady = await startSshFixture();
console.log(sshReady
  ? '[E2E Setup] SSH fixture ready'
  : '[E2E Setup] Docker unavailable — external-host MCP tests will skip');
```

Do **not** stop it in `tests/e2e/teardown.ts` — the CLI suite's teardown owns removal, and stopping it here would tear down a fixture the other suite may still be using. Leaving it running is safe: `stopSshFixture()` is idempotent.

- [ ] **Step 2: Write the test file**

```ts
/**
 * wp_site_health against an external SSH host.
 *
 * This lives here rather than in tests/e2e-cli/ because `nexus wp health` has
 * no GraphQL fallback — it calls the MCP tool and exits 1 if the MCP server is
 * unreachable, which the CLI suite cannot guarantee.
 */
import { McpClient } from './helpers/client';
import { loadConnectionInfo } from './helpers/environment';
import { FIXTURE_ALIAS, fixtureAvailable } from '../e2e-cli/helpers/ssh-fixture';

const d = fixtureAvailable() ? describe : describe.skip;

d('wp_site_health on an external host', () => {
  let client: McpClient;

  beforeAll(async () => {
    const info = loadConnectionInfo();
    if (!info) throw new Error('MCP connection info not available');
    client = new McpClient(info.url, info.authToken);
    await client.initialize();
  });

  it('returns a health report for a full ssh target', async () => {
    const result = await client.callTool('wp_site_health', {
      site: `ssh:${FIXTURE_ALIAS}/alpha@production`,
    });
    expect(result.isError).toBeFalsy();
    // The pre-port failure mode was a literal 'Site "undefined" not found.'
    expect(result.content[0].text).not.toContain('undefined');
  });
});
```

- [ ] **Step 3: Run it**

```bash
npx jest --config tests/e2e/jest.e2e.config.js --testPathPattern "32-wp-site-health-external"
```

Expected: 1 passed. Confirm the log shows `Adopting the running Local` — this suite must not kill Local now.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/32-wp-site-health-external.e2e.test.ts tests/e2e/setup.ts
git commit -m "test(e2e): wp_site_health against an external SSH host"
```

---

## Task 12: Full-suite verification

**Files:** none created; this task is verification and a README note.

- Modify: `tests/e2e-cli/README.md`

- [ ] **Step 1: Verify Docker-absent behaviour**

```bash
docker stop $(docker ps -q) 2>/dev/null; killall Docker 2>/dev/null || true
# Wait for the daemon to go away, then:
npx jest --config tests/e2e-cli/jest.cli-e2e.config.js --testPathPattern "2[789]-|3[012]-"
```

Expected: every external-host suite reports **skipped**, exit code 0, and the log carries `Docker unavailable`. Restart Docker afterwards.

- [ ] **Step 2: Verify the developer's Local survives a full MCP-suite run**

```bash
pgrep -f "/Applications/Local.app/Contents/MacOS/Local" | head -1
npm run test:e2e 2>&1 | tail -40
pgrep -f "/Applications/Local.app/Contents/MacOS/Local" | head -1
```

Expected: the same PID before and after. Record the pass/fail counts — pre-existing failures in the 347 are not this plan's to fix, but they must be **reported**, not silently absorbed.

- [ ] **Step 3: Verify the full CLI suite**

```bash
npm run test:cli-e2e 2>&1 | tail -40
```

Expected: the six new suites pass; record any pre-existing failures among the 361.

- [ ] **Step 4: Verify nothing leaked**

```bash
test -f ~/.ssh/config.d/nexus-e2e && echo "LEAK" || echo "clean"
grep -c 'nexus-e2e' ~/.ssh/config || echo "no include left"
docker ps -a --filter name=nexus-e2e-sshhost --format '{{.Names}}' | grep -q . && echo "LEAK: container" || echo "clean"
git status --porcelain | grep -E 'id_ed25519' && echo "LEAK: key staged" || echo "clean"
```

- [ ] **Step 5: Document the fixture**

Append to `tests/e2e-cli/README.md`:

```markdown
## External SSH host fixture

Suites 27-32 run against a Docker container (`tests/e2e-cli/fixtures/ssh-host/`)
that runs real sshd, MariaDB and WP-CLI with two WordPress installs —
`/home/wp/alpha` and `/home/wp/beta` — under the single alias `nexus-e2e-host`.
Two installs is deliberate: a single-site alias has no `/` in its site id and so
cannot reproduce the `vectorSiteId` collision.

The fixture registers its alias by writing `~/.ssh/config.d/nexus-e2e` and one
idempotent `Include` line at the top of `~/.ssh/config`, mirroring what the
shipped `sshConfigWriter.ts` does. It never touches `~/.ssh/config.d/nexus`.
Both are removed at teardown, along with the container and the
`[127.0.0.1]:2222` known_hosts entry.

If the Docker daemon is not reachable, suites 27-32 skip.

**These suites cannot test key approval.** `TRUST_EXTERNAL_HOST_KEY` is an
Electron IPC channel, never a GraphQL mutation and never CLI-callable. The
fixture writes the container's key into `known_hosts` directly, which is the
state a user reaches after clicking approve in Settings. Approval itself is
covered only once a renderer-driving harness exists.
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e-cli/README.md
git commit -m "docs(e2e): document the external SSH host fixture"
```

---

## Self-Review Notes

**Spec coverage.** B1 → Tasks 1-2. B2 → Task 2 Step 4. B3 → Task 2 Step 3. A1 → Tasks 3-4. A2 → Task 10 (stated as an explicit non-test) and Task 12 Step 5. A3's six files → Tasks 5-10. A4 (`wp health`) → Task 11. A5 (assertion style) → enforced per file. Safety → Task 4 Step 4 and Task 12 Step 4. Non-vacuity → a dedicated step in each of Tasks 5-10. Success criteria 1-5 → Task 12.

**Known deviation from CLAUDE.md.** `vectorSiteId` applies its hash **conditionally**, not uniformly as CLAUDE.md states. Task 8 documents this and targets the actual line. CLAUDE.md should be corrected separately; it is not this plan's scope.

**Deliberate omission.** No test asserts that approving a host key succeeds. That is not an oversight — see A2 and Task 10's header.
