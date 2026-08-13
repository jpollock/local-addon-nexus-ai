# Design: `nexus creds rotate` — lazy, self-healing credential rotation

Part of P1-7. Replaces the "walk every site synchronously" approach (which lies on partial
failure) with a lazy-by-default, self-healing model plus a `--force-now` escape hatch.

## Problem

A leaked provider key is cached in several places (see `docs/incident-response.md`): the encrypted
vault, each non-gateway site's `wp_options`, and each site's MU-plugin config. Overwriting one
place leaves the old key live elsewhere. A synchronous "walk every site" rotation fails the moment
a site is stopped or a remote host is unreachable — and if it reports success anyway, that is
false security.

## Key finding: most of the machinery already exists

Verified in the current tree — the design leans on these, it does not reinvent them:

- **`CredentialSyncBroadcaster.broadcastKeyChange(providerId)`**
  (`src/main/credentials/CredentialSyncBroadcaster.ts`) already syncs the current key to **all
  running sites** configured for that provider, **skips `useLocalGateway` sites**, and tracks a
  per-site `syncStatusMap` exposed via `getStatus()`. It is already invoked on a key change
  (`chat/chat-ipc-handlers.ts:159,206`).
- **`autoSyncCredentials(siteId, …)`** (`src/main/mcp/modules/wp-connector/auto-sync.ts:25`) reads
  the **current** key from the vault (`getApiKey`) and writes it to the site's WP option for WP
  7.0+ sites; it **skips `useLocalGateway` sites**. It runs on **`siteStarted`**
  (`src/main/content/lifecycle-hooks.ts:495`).
- **`useLocalGateway` sites hold no key in their DB** — the gateway MU-plugin reads it from the
  vault at call time (`wp-connector/setup-ai.ts:869`). So rotating the vault key rotates every
  gateway site **for free**, with no per-site action.

Consequence: a **stopped** non-gateway site already self-heals — when it next starts, `siteStarted`
→ `autoSyncCredentials` writes the *current* (rotated) key. And **gateway** sites need nothing.
What's missing is a single command that performs the rotation intentionally and reports honestly.

## The design

1. **Revoke at the source is the real mitigation** (provider console). The command's help and
   output must say this first — it kills abuse of the old key everywhere at once, which is what
   makes deferring the per-site cleanup safe.
2. **Overwrite the vault + bump a credential version.** Instant. The version is the staleness
   oracle (below).
3. **Lazy by default.** Running non-gateway sites are re-synced now (via `broadcastKeyChange`).
   Stopped sites are left to self-heal on next start (already true) — reported as *stale*, not
   *failed*. Gateway sites are already current.
4. **`--force-now`.** Additionally start→sync→stop the stopped local sites. Even here, any site it
   still cannot reach (offline remote host) is reported as stale, never as done.
5. **Honest report always.** "K sites on the current credential version, M stale (will sync on next
   start): [list]" — from the version stamp, not an all-or-nothing exit code.

## What's actually new to build

Small, because the sync paths exist:

1. A **credential version** stamp: bump a counter (or store a hash of the key) in the vault on every
   `setKey`; record per-site `syncedCredVersion` when `autoSyncCredentials` succeeds. `stale = site
   configured for provider && !useLocalGateway && syncedCredVersion < vaultCredVersion`. This makes
   staleness visible for sites the broadcast never touched (stopped ones) — the existing
   `syncStatusMap` tracks success/failure, not which key version.
2. A **`nexusRotateCredentials(provider, force)` GraphQL mutation** (main process) that: sets the
   new key, bumps the version, calls `broadcastKeyChange`, optionally force-syncs stopped sites,
   and returns `{ synced: [...], stale: [...] }`.
3. A thin **`nexus creds rotate <provider> [--force-now]`** CLI command that calls the mutation and
   prints the report (the CLI is a client of the app — the fan-out lives in the mutation).
4. **Webhook-token rotation** as a *separate* opt-in (`--rotate-webhook-token`, or its own command):
   regenerate `http_webhook_auth_token.json` and re-push MU-plugin configs. It's independent of the
   provider key and higher-blast-radius (touches every site's MU config), so keep it distinct.
5. **Surface staleness in `nexus doctor`**: "M sites on an old credential version — start them or run
   `nexus creds rotate --force-now`." (Pairs with the doctor plaintext-fallback check, also P1-7.)

## Local vs remote hosts

- **Local sites:** Nexus owns the lifecycle, so lazy-on-start works exactly as described.
- **WP Engine / external SSH sites:** there is no Nexus-controlled "start." Confirm first whether the
  provider key is even synced into their `wp_options` (the `autoSyncCredentials`/WP-connector path is
  local-first — remote sites may only ever use the gateway). If a remote site does hold a key, its
  refresh trigger is the next refresh cycle / next command against it, or `--force-now`. **Open
  question — pin this down before building the remote branch; do not assume symmetry with local.**

## Security model

- Deferring the per-site cleanup is acceptable **only because** step 1 (revoke at source) kills the
  old key upstream. A stopped local site's stale key is at rest on local disk, not serving traffic,
  not network-reachable, and self-heals on start.
- "Stale" is a durable, visible state (the version stamp), never a silent success — which is the
  specific failure the synchronous walk had.

## Testing

- Unit: version bump on `setKey`; `stale` predicate (provider match, gateway exclusion, version
  comparison); report shaping.
- Integration: rotate → a running non-gateway site is synced now and its version advances; a stopped
  site is reported stale; on its next `siteStarted`, `autoSyncCredentials` advances its version.
  Prove non-vacuity by asserting the stopped site is stale before start and current after.
- Gateway site: rotate advances the vault version and the gateway serves the new key with **no**
  per-site sync attempted.

## Open questions

1. Remote-host credential storage (above) — the one real unknown.
2. Version representation: monotonic counter (simple) vs. key hash (also detects a re-set to the same
   value). Counter is enough for rotation; hash is more robust. Pick one.
3. `--force-now` starting stopped local sites is a side effect (boots MySQL/PHP per site). Gate it
   behind an explicit flag and a printed warning; never the default.
