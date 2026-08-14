# Track 2 — `nexusd` Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move everything that does not need Local out of Local's Electron main process into a supervised child process, so a fleet-wide assessment stops freezing the UI and the same binary can later run WPE-side for the paid tier.

**Architecture:** `nexusd` is a Node process spawned and supervised by the addon's remaining in-process shim. It owns `graph.db`, `vectors.db`, embeddings, WPE sync, the tool registry, the agent runtime and the MCP/gateway/proxy servers. Local keeps a `LocalHostAdapter` exposing site provisioning, local WP-CLI and MagicSync push/pull, which `nexusd` calls back into over child-process IPC. The desktop UI talks to `nexusd` over loopback HTTP with a bearer token — the shape `McpServer` already implements.

**Tech Stack:** TypeScript, Node `child_process.fork`, existing loopback HTTP + `McpAuth`, Jest.

**Spec:** `docs/planning/2026-08-13-nexus-native-fleet-workspace-design.md`, section "Process architecture — `nexusd`".

## Status of this plan

**Stages 1–3 are ready to execute. Stages 4–6 are gated on decisions that have not been made.** That distinction is deliberate and is the honest state of the requirements, not an omission. Writing line-by-line code for the gated stages would manufacture false precision; each gated stage names the decision it waits on and what changes depending on the answer.

## Global Constraints

- `nexusd` must contain **zero** Electron imports. This is the load-bearing constraint of the entire track — it is what makes the paid deployment a redeployment rather than a rewrite. Enforce it mechanically (see Stage 1, Task 3), not by review.
- All paths, credentials and identity enter `nexusd` by injection. No `app.getPath()`, no `~/Library/Application Support/Local` literals. There are currently such literals in `AgentRegistry`, `AgentDispatcher` (twice, inline), `index.ts`, `defaultAuditLogPath()` and `scripts/sync-agents.js`.
- Credentials are unlocked by Local and injected at spawn; `nexusd` holds them in memory only and never writes them to disk. Consequence, accepted: closing Local revokes the daemon's ability to act.
- `nexusd` has no independent lifetime in this track. It starts with Local and dies with it.
- Every stage ends green: `npx tsc --noEmit` and `npx jest tests/unit`.

---

## Stage 1 — Prove the boundary before moving anything

The extraction's risk is not the moving; it is discovering mid-move that something you assumed was pure reaches for Electron. Stage 1 makes that discoverable in an afternoon instead of a fortnight.

### Task 1.1 — Inventory the Electron surface

**Files:** create `scripts/check-daemon-purity.js`, `tests/unit/architecture/daemon-purity.test.ts`

Walk the import graph from each intended `nexusd` entry module and report every transitive import of `electron`, `@getflywheel/local`, or `@getflywheel/local/main`. Output a machine-readable list. Run it once and commit the result as a baseline file — that list is the actual work of this track, measured rather than guessed.

Known offenders to expect: `src/main/security/KeyVault.ts` (`safeStorage`), `src/main/index.ts` (`BrowserWindow`, `ipcMain`), anything reaching `LocalMain.getServiceContainer()`.

### Task 1.2 — Define the `LocalHostAdapter` contract

**Files:** create `src/main/host/LocalHostAdapter.ts` (interface only), `src/main/host/types.ts`

The adapter is the subset of `LocalServicesBridge` that genuinely needs Local. Derive it from the bridge by elimination: everything `resolveTransport()` routes to `LocalTransport`, plus provisioning, lifecycle, MagicSync, PHP version, SSL trust and blueprints. Everything else stays with `nexusd`.

Write the interface and a null implementation that throws `HostUnavailableError` on every method. That null implementation is what the WPE deployment uses, and having it from the start stops Local assumptions leaking in.

### Task 1.3 — Make purity enforceable

Turn Task 1.1's script into a failing test with an allowlist seeded from the baseline. Every subsequent task shrinks the allowlist. When it is empty, the extraction is done. **This test is the definition of done for the whole track** — prefer it over a checklist.

---

## Stage 2 — Break the two hard dependencies

Both must land before any code moves, because everything else depends on them.

### Task 2.1 — Replace `safeStorage` in `KeyVault`

`src/main/security/KeyVault.ts` encrypts with Electron `safeStorage`, which `nexusd` will not have.

Introduce a `SecretStore` interface with two implementations: `ElectronSafeStorageSecretStore` (stays in Local, unchanged behaviour) and `InjectedSecretStore` (holds decrypted secrets in memory, populated at spawn). `KeyVault` takes a `SecretStore`. Migration of already-encrypted values is not needed — Local decrypts them and injects the plaintext.

Test that `InjectedSecretStore` never writes to disk, by asserting no `fs` write occurs across its lifecycle.

### Task 2.2 — Config injection

Create `src/main/config/DaemonConfig.ts`: an explicit object carrying `graphDbPath`, `vectorDbPath`, `agentsDir`, `logsDir`, `auditLogPath`, `modelsDir`, and the WPE SSH key path. Local builds it from its Electron paths; the WPE deployment builds it from environment.

Then delete every hardcoded path literal found in Task 1.1, replacing each with a `DaemonConfig` field. Do this as one batched change — they are the same edit repeated, and reviewing them together is cheaper than seven separate rounds.

---

## Stage 3 — Move the process boundary

### Task 3.1 — `nexusd` entry point and supervision

**Files:** create `src/daemon/main.ts`, `src/main/daemon/DaemonSupervisor.ts`

`child_process.fork` with `stdio: ['ipc', 'pipe', 'pipe']`, following the existing `workerFork.ts` pattern in Local for how state is handed over. The supervisor owns spawn, health, restart-on-crash with backoff, and shutdown on `before-quit`.

Deliberate decision to record: **restart-on-crash is bounded at three attempts in five minutes**, after which the addon reports degraded rather than restart-looping. An addon that silently respawns a crashing daemon burns CPU and hides the failure.

### Task 3.2 — Reverse channel

`nexusd` → Local host operations over child-process IPC with a request/response envelope carrying a correlation id. Do not open a second HTTP port for this — the process relationship already gives you an authenticated channel, and a port is attack surface for no gain.

### Task 3.3 — Move the services

Move in dependency order, one commit per group, purity allowlist shrinking each time: graph and vector store → embeddings and content pipeline → WPE sync → tool registry and modules → agent runtime → the three servers.

### Task 3.4 — Re-point the renderer

The renderer's ~135 IPC channels become HTTP calls against `nexusd`. This is mechanical but wide. Batch it by module, not by channel.

### Task 3.5 — Re-point the Playwright suites

The 20 `addons-nexus-ai-*.playwright.ts` suites in **`flywheel-local`** assume in-process IPC and will break. They are in a different repository; coordinate before landing Stage 3.

---

## Gated stages — decisions required before these can be planned properly

### Stage 4 — Bundling and default-on *(gated)*

**Decision needed:** does Nexus ship bundled with Local, and under whose ownership?

The mechanism is small — `BUNDLED_NPM_ADDON_PATH` and `isBundledAddon` already exist, so it is an allowlist entry plus a dependency. What is not small is that it requires the repo to move to WP Engine, a licensing pass including `T-UNBUNDLE-AI`, and Local's release train to take on the addon's size (the ONNX models alone are ~156 MB across two model directories).

### Stage 5 — Renderer disposition *(gated)*

**Decision needed:** is the desktop shell an evolution of Local's renderer or a replacement?

The design records this as open, and the design-team mockups point at replacement while the design handoff README instructs building inside `app/renderer/` with `@getflywheel/local-components`. Those contradict. Under replacement, Stage 3.4 is wasted work and should be skipped in favour of building the new shell directly against `nexusd`'s HTTP surface. Under evolution, 3.4 is required. **This decision should be made before Stage 3.4, not after.**

### Stage 6 — WPE-side deployment *(gated)*

**Decision needed:** the paid tier's identity, secret store, and hosting substrate.

The architecture makes this a redeployment of the same binary with the null host adapter and a different `SecretStore`. It cannot be planned further without knowing where it runs and what it authenticates against. The WP Engine account was chosen as the identity anchor; nothing else is settled.

---

## Sequencing and risk

Stages 1 and 2 are independent of every gated decision and are the right place to start regardless of how they resolve. Stage 3 is safe up to 3.3. **Do not start 3.4 until Stage 5's decision exists.**

The largest risk is not technical. It is that Stage 3 leaves the codebase mid-move for a long stretch, with two process models coexisting. The purity test is the mitigation: it makes "how far through are we" a number rather than an opinion.
