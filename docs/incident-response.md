# Incident response — leaked credential runbook

What to do when a credential managed by Nexus AI leaks. The hard part is that a provider key is
**cached in several places**, and overwriting it in one place leaves the old key live elsewhere —
so rotation must touch every location below. (An automated `nexus creds rotate` command that does
this in one step is planned but not yet shipped — see the end.)

## Where a leaked credential lives

| Credential | Cache locations (all must be cleared/rotated) |
|---|---|
| **LLM provider API key** (Anthropic / OpenAI / Google) | 1. The encrypted vault (`KeyVault`, `encrypted_*` in RegistryStorage). 2. **Every managed site's `wp_options`** — `setup-ai.ts` syncs the key into each site's WordPress DB as a plaintext option. 3. **Every managed site's MU-plugin config** (`nexus-ai-connector-config.php`), regenerated on site start. |
| **AI gateway webhook token** | `http_webhook_auth_token.json` / `http_webhook_info.json` (RegistryStorage), and the copy embedded in **every site's MU-plugin config**. Deliberately reused across restarts, so it does not rotate on its own. |
| **WP Engine CAPI token** | Encrypted in the credential store; rotate in the WP Engine portal. |
| **GraphQL / MCP bearer tokens** | `graphql-connection-info.json` / `nexus-ai-mcp-connection-info.json` (0600). Regenerated on restart. |

All under `~/Library/Application Support/Local/nexus-ai/` unless noted.

## Response steps

1. **Revoke at the source first.** For a provider key, disable/delete it in the provider's console
   (Anthropic / OpenAI / Google) — this is what actually stops abuse. For the WPE CAPI token,
   rotate it in the WP Engine portal.
2. **Overwrite the local vault copy.** Set a new key (`nexus ai config`, or the Settings UI). This
   updates the `KeyVault` copy only.
3. **Clear it from every managed site.** For each site the key was synced to, remove or overwrite
   the provider-key `wp_option` and re-run the AI setup so the site holds the new key (or none):
   the old key otherwise stays live in that site's DB and MU-plugin config.
4. **Rotate the webhook token** if it (or a value derived from it) leaked: regenerate it and
   re-push MU-plugin configs to every site, so no site keeps presenting the old token to the
   gateway.
5. **Check for abuse in the window.** Review the provider console's usage for the leaked key, and
   the gateway's own spend (per-site rate limits / cost) for anomalies.
6. **If the leak was in git** (the classic case): assume the value is public the moment it was
   pushed. Rotate regardless of a later redaction, and purge the path from history
   (`git filter-repo`) or publish from a fresh squashed repo — a redaction commit does not remove
   the value from history.

## Prevention already in place

- **Secret scanning** blocks most leaks before they land: a pre-commit hook and CI both run
  `scripts/scan-secrets.js` (and gitleaks in CI); `scripts/package-addon.js` fails the build on a
  hit. Enable the hook per clone with `npm run setup-hooks`.
- **Signed releases** mean a swapped artifact is rejected (`docs/release-signing.md`).
- **Tool failures are recorded** to telemetry (category-only), so an incident is less likely to be
  invisible.

## Not yet automated (do these by hand for now)

- **`nexus creds rotate <provider>`** — a single command to overwrite the vault, walk every site
  clearing/re-syncing the `wp_option`, regenerate the webhook token, and re-push MU-plugin configs.
  Until it ships, follow steps 2–4 manually.
- **A `nexus doctor` security check** that flags when `KeyVault` fell back to **plaintext** storage
  (safeStorage unavailable). Until then, watch the main-process log for the KeyVault plaintext
  warning at startup.
