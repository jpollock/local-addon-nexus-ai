# WPE Full Coverage Plan

**Status:** Complete (executed 2026-04-10 on branch ux-issues)
**Branch:** ux-issues
**Tracking:** All phases complete — see checkboxes below

## Context

Full implementation plan for:
1. 100% WPE CAPI v1.10.1 coverage via MCP tools
2. Tier 3 destructive operations with stricter confirmation pattern
3. Higher-order workflow/composite tools
4. CLI parity (32 new CLI commands)

## Architecture Reference

- MCP handlers: `src/main/mcp/modules/wpe/<name>.ts` → registered in `index.ts`
- Safety tiers: `src/main/mcp/safety.ts` — `TIER_OVERRIDES`, `CONFIRMATION_MESSAGES`, `PRE_CHECKS`
- CAPI auth: `services.localServices!.capiDirect(path)` — OAuth Bearer; `POST /installs/{id}/backups` is a confirmed exception requiring basic auth
- Tier 3 flow: `ConfirmationManager` in `safety.ts` generates token on first call; second call validates token + exact param match; enforced by `McpSafetyWrapper` before registry
- CLI bridge: Commander subcommands in `src/cli/commands/wpe.ts` → GraphQL mutation → `schema.ts` type + mutation → `resolvers.ts` resolver → `ipc-handlers.ts` IPC handler → tool registry
- Every new CLI-accessible tool needs all four of: handler file, schema entry, resolver, IPC handler

---

## Phase 0 — Safety.ts Pre-Declaration

**Do this first, before any handler.** Add all new tool names to `TIER_OVERRIDES`, `CONFIRMATION_MESSAGES`, `PRE_CHECKS`.

- [x] Add all Tier 1 new tools to `TIER_OVERRIDES`
- [x] Add all Tier 2 new tools to `TIER_OVERRIDES`
- [x] Add all Tier 3 new tools to `TIER_OVERRIDES`
- [x] Add `CONFIRMATION_MESSAGES` for each Tier 3 tool
- [x] Add `PRE_CHECKS` for each Tier 3 tool

New Tier 1 tools:
```
wpe_get_account, wpe_get_account_limits, wpe_get_account_usage_summary,
wpe_get_account_usage_insights, wpe_get_account_user, wpe_get_sites,
wpe_get_site, wpe_get_backup, wpe_get_domains, wpe_get_domain,
wpe_get_domain_status_report, wpe_check_domain_status,
wpe_get_ssl_certificates, wpe_get_domain_ssl_certificate,
wpe_get_ssh_keys, wpe_get_current_user, wpe_get_offload_settings,
wpe_get_largefs_validation,
wpe_account_overview, wpe_account_domains, wpe_account_ssl_status,
wpe_installs_by_account, wpe_environment_diff, wpe_go_live_checklist,
wpe_user_audit, wpe_fleet_health, wpe_diagnose_site, wpe_portfolio_overview
```

New Tier 2 tools:
```
wpe_create_account_user, wpe_update_account_user, wpe_create_site,
wpe_update_site, wpe_create_install, wpe_update_install,
wpe_create_domain, wpe_create_domains_bulk, wpe_update_domain,
wpe_request_ssl_certificate, wpe_import_ssl_certificate,
wpe_create_ssh_key, wpe_update_offload_settings,
wpe_configure_offload_settings, wpe_refresh_install_disk_usage,
wpe_refresh_account_disk_usage, wpe_backup_and_verify,
wpe_prepare_go_live, wpe_copy_install, wpe_add_user_to_accounts
```

New Tier 3 tools + confirmation messages:
```
wpe_delete_account_user  → "This will revoke WP Engine portal access for this user."
wpe_delete_site          → "This will delete the WP Engine site and ALL its installs (production, staging, development)."
wpe_delete_install       → "This will permanently delete this WP Engine environment and all its content. This cannot be undone."
wpe_delete_domain        → "This will remove the domain from this install. Live traffic to this domain will break."
wpe_delete_ssh_key       → "This will remove the SSH key. Any automation using it will stop working."
wpe_promote_environment  → "This will overwrite the destination environment with content from the source. Destination content will be lost."
```

---

## Phase 1 — Tier 3 Confirmation Pattern Enhancement

The safety wrapper already handles token generation and param matching. WPE-specific additions:

### `confirm_name` guard (highest-risk ops only)
`wpe_delete_install` and `wpe_delete_site` require a `confirm_install_name` / `confirm_site_name` parameter. On the confirmed call (token present), the handler checks `args.confirm_install_name === fetchedInstall.name` and rejects if mismatched. Enforced in the handler — not the safety wrapper — because it requires knowing the live name from CAPI.

### Resource-fetch on pre-confirmation call
All Tier 3 WPE handlers fetch the resource on the first (no-token) call and include details in the warning:
- Show name, environment, domain, created date of what will be deleted
- Do NOT block on missing data — still return the token

### Backup nudge for `wpe_delete_install`
Pre-confirmation call additionally fetches `GET /installs/{id}/backups?limit=1`.
If no backup within 7 days: include `⚠️ No recent backup found — create one before deleting.` in the warning.
Does NOT block, but forces acknowledgement.

- [x] Document pattern in handler comments (reference this file)
- [x] Implement `wpe_delete_install` with `confirm_install_name` + backup nudge
- [x] Implement `wpe_delete_site` with `confirm_site_name` + install enumeration

---

## Phase 2 — Atomic CAPI Gaps

Handler pattern for all tools:
- `isAvailable: (services) => requireCAPI(services)`
- All `capiDirect()` calls wrapped in `try/catch` → `capiError(err)`
- `ok()` returns formatted markdown (tables, lists) — never raw JSON
- Register in `src/main/mcp/modules/wpe/index.ts`

### 2.1 Account Management

- [x] `wpe_get_account` — `get-account.ts` — `GET /accounts/{id}` — Tier 1
  - Input: `account_id`
  - Returns: account name, ID, created date

- [x] `wpe_get_account_limits` — `get-account-limits.ts` — `GET /accounts/{id}/limits` — Tier 1
  - Input: `account_id`
  - Returns: visitor/storage/bandwidth plan limits formatted as table

- [x] `wpe_get_account_usage_summary` — `get-account-usage-summary.ts` — `GET /accounts/{id}/usage/summary` — Tier 1
  - Input: `account_id`, optional `month_offset`
  - Returns: visits, bandwidth, storage rollup

- [x] `wpe_get_account_usage_insights` — `get-account-usage-insights.ts` — `GET /accounts/{id}/usage/insights` — Tier 1
  - Input: `account_id`, optional filters
  - Returns: breakdown by environment/site type

- [x] `wpe_get_account_user` — `get-account-user.ts` — `GET /accounts/{id}/account_users/{uid}` — Tier 1
  - Input: `account_id`, `user_id`
  - Returns: name, email, roles

- [x] `wpe_create_account_user` — `create-account-user.ts` — `POST /accounts/{id}/account_users` — Tier 2
  - Input: `account_id`, `email`, `first_name`, `last_name`, `roles` (array)

- [x] `wpe_update_account_user` — `update-account-user.ts` — `PATCH /accounts/{id}/account_users/{uid}` — Tier 2
  - Input: `account_id`, `user_id`, `roles` (array)

- [x] `wpe_delete_account_user` — `delete-account-user.ts` — `DELETE /accounts/{id}/account_users/{uid}` — Tier 3
  - Pre-confirm: fetch user, display name + email + roles, return token
  - Confirmed: proceed with DELETE

### 2.2 Site Management (CAPI Sites)

- [x] `wpe_get_sites` — `get-sites.ts` — `GET /sites` — Tier 1
  - Returns: all sites across accounts

- [x] `wpe_get_site` — `get-site.ts` — `GET /sites/{id}` — Tier 1
  - Input: `site_id`

- [x] `wpe_create_site` — `create-site.ts` — `POST /sites` — Tier 2
  - Input: `name`, `account_id`
  - Returns: site_id (needed before create_install)

- [x] `wpe_update_site` — `update-site.ts` — `PATCH /sites/{id}` — Tier 2
  - Input: `site_id`, `name`

- [x] `wpe_delete_site` — `delete-site.ts` — `DELETE /sites/{id}` — Tier 3
  - Pre-confirm: fetch site + list all installs; show all environments being deleted
  - Require `confirm_site_name` matching site name

### 2.3 Install Lifecycle

- [x] `wpe_create_install` — `create-install.ts` — `POST /installs` — Tier 2
  - Input: `site_id`, `name`, `environment` (production|staging|development), `account_id`

- [x] `wpe_update_install` — `update-install.ts` — `PATCH /installs/{id}` — Tier 2
  - Input: `install_id`, optional `php_version`, `environment`

- [x] `wpe_delete_install` — `delete-install.ts` — `DELETE /installs/{id}` — Tier 3
  - Pre-confirm: fetch install + check last backup recency (GET /installs/{id}/backups?limit=1)
  - Warn if no backup within 7 days (does not block)
  - Require `confirm_install_name` matching install name

- [x] `wpe_get_backup` — `get-backup.ts` — `GET /installs/{id}/backups/{bid}` — Tier 1
  - Input: `install_id`, `backup_id`
  - Returns: status, created_at, type

- [x] `wpe_refresh_install_disk_usage` — `refresh-disk-usage.ts` — `POST /installs/{id}/usage/refresh_disk_usage` — Tier 2
  - Input: `install_id`

- [x] `wpe_refresh_account_disk_usage` — `refresh-account-disk-usage.ts` — `POST /accounts/{id}/usage/refresh_disk_usage` — Tier 2
  - Input: `account_id`

### 2.4 Domain Management

- [x] `wpe_get_domains` — `get-domains.ts` — `GET /installs/{id}/domains` — Tier 1
  - Input: `install_id`
  - Returns: list with primary flag, redirect_to, status

- [x] `wpe_get_domain` — `get-domain.ts` — `GET /installs/{id}/domains/{did}` — Tier 1
  - Input: `install_id`, `domain_id`

- [x] `wpe_create_domain` — `create-domain.ts` — `POST /installs/{id}/domains` — Tier 2
  - Input: `install_id`, `name` (domain string)

- [x] `wpe_create_domains_bulk` — `create-domains-bulk.ts` — `POST /installs/{id}/domains/bulk` — Tier 2
  - Input: `install_id`, `domains` (array of strings)

- [x] `wpe_update_domain` — `update-domain.ts` — `PATCH /installs/{id}/domains/{did}` — Tier 2
  - Input: `install_id`, `domain_id`, optional `redirect_to`, `primary` (bool)

- [x] `wpe_delete_domain` — `delete-domain.ts` — `DELETE /installs/{id}/domains/{did}` — Tier 3
  - Pre-confirm: fetch domain; warn loudly if it is the primary domain
  - Return token; confirmed: proceed with DELETE

- [x] `wpe_check_domain_status` — `check-domain-status.ts` — `POST /installs/{id}/domains/{did}/check_status` — Tier 1
  - Input: `install_id`, `domain_id`
  - Returns: DNS propagation status

- [x] `wpe_get_domain_status_report` — `get-domain-status-report.ts` — `GET /installs/{id}/domains/{did}/status_report` — Tier 1
  - Input: `install_id`, `domain_id`

### 2.5 SSL Management

- [x] `wpe_get_ssl_certificates` — `get-ssl-certificates.ts` — `GET /installs/{id}/ssl_certificates` — Tier 1
  - Input: `install_id`
  - Returns: list with expiry, domains covered, status

- [x] `wpe_get_domain_ssl_certificate` — `get-domain-ssl-certificate.ts` — `GET /installs/{id}/domains/{did}/ssl_certificate` — Tier 1
  - Input: `install_id`, `domain_id`

- [x] `wpe_request_ssl_certificate` — `request-ssl-certificate.ts` — `POST /installs/{id}/ssl_certificates` — Tier 2
  - Input: `install_id`, `domain_ids` (array), optional `san_domains`

- [x] `wpe_import_ssl_certificate` — `import-ssl-certificate.ts` — `POST /installs/{id}/ssl_certificates/import` — Tier 2
  - Input: `install_id`, `certificate` (PEM string), `private_key`, optional `ca_bundle`

### 2.6 SSH Keys

- [x] `wpe_get_ssh_keys` — `get-ssh-keys.ts` — `GET /ssh_keys` — Tier 1
  - Returns: all SSH keys for authenticated user

- [x] `wpe_create_ssh_key` — `create-ssh-key.ts` — `POST /ssh_keys` — Tier 2
  - Input: `label`, `public_key`

- [x] `wpe_delete_ssh_key` — `delete-ssh-key.ts` — `DELETE /ssh_keys/{id}` — Tier 3
  - Pre-confirm: fetch key, display label + fingerprint
  - Return token; confirmed: proceed with DELETE

### 2.7 Current User + Offload

- [x] `wpe_get_current_user` — `get-current-user.ts` — `GET /user` — Tier 1
  - Returns: user ID, email, first/last name

- [x] `wpe_get_offload_settings` — `get-offload-settings.ts` — `GET /installs/{id}/offload` — Tier 1
  - Input: `install_id`

- [x] `wpe_update_offload_settings` — `update-offload-settings.ts` — `PATCH /installs/{id}/offload` — Tier 2
  - Input: `install_id`, relevant offload config fields

- [x] `wpe_get_largefs_validation` — `get-largefs-validation.ts` — `GET /installs/{id}/offload/largefs/validate` — Tier 1
  - Input: `install_id`

---

## Phase 3 — Higher-Order Workflow Tools

All composite tools live in `src/main/mcp/modules/wpe/` and register in `index.ts`.

- [x] `wpe_promote_environment` — `promote-environment.ts` — Tier 3
  - Wraps `POST /install_copy`
  - Input: `source_install_id`, `destination_install_id`, optional `include_database` (bool, default true), `_confirmationToken`
  - Pre-confirm: fetch both installs; warn if destination is production; check destination backup recency (warn if >24h); display "overwrite {dest} with {src}" message
  - Confirmed: `POST /install_copy`

- [x] `wpe_backup_and_verify` — `backup-and-verify.ts` — Tier 2
  - Input: `install_id`, optional `description`
  - Steps: create backup (basic auth) → extract backup_id → poll `GET /installs/{id}/backups/{bid}` every 10s → return `{status: completed|timeout, backup_id, created_at}`
  - Timeout: 10 minutes

- [x] `wpe_account_overview` — `account-overview.ts` — Tier 1
  - Input: `account_id`
  - Chains: GET /accounts/{id} + GET /installs?account_id={id} + graph data for WP/PHP
  - Returns: account name, install count by environment, WP/PHP version distribution

- [x] `wpe_account_domains` — `account-domains.ts` — Tier 1
  - Input: `account_id`
  - Chains: installs for account → GET /installs/{id}/domains for each (parallel)
  - Returns: flat table of all domains grouped by install, with primary flag + status

- [x] `wpe_account_ssl_status` — `account-ssl-status.ts` — Tier 1
  - Input: `account_id`
  - Chains: installs → SSL certs per install (parallel)
  - Returns: table of install × domain × expiry × status
  - Flags: expiring ≤30 days (⚠️), expired (❌), no cert (❌), valid (✅)

- [x] `wpe_installs_by_account` — `installs-by-account.ts` — Tier 1 (GH issue #4)
  - Groups all installs by account with counts per environment type

- [x] `wpe_environment_diff` — `environment-diff.ts` — Tier 1
  - Input: `install_id_a`, `install_id_b`
  - Chains: wpe_get_install for both + wp_plugin_list via SSH remote exec for each (if available) + wpe_get_domains for each
  - Returns: side-by-side diff — WP version, PHP version, plugin delta, domain delta

- [x] `wpe_go_live_checklist` — `go-live-checklist.ts` — Tier 1 (READ ONLY)
  - Input: `install_id`, `domain`
  - Checks (each ✅/❌/⚠️): domain added to install, DNS resolving, SSL cert exists + valid, SSL not expiring ≤30d, WP version current
  - Returns checklist with next action for each failure

- [x] `wpe_prepare_go_live` — `prepare-go-live.ts` — Tier 2 (ACTION)
  - Input: `install_id`, `primary_domain`, optional `redirect_www` (bool, default true)
  - Actions: add domain if missing → set as primary → add www redirect if requested → request SSL → purge cache
  - Returns per-step success/failure; stops on critical failure, reports partial progress

- [x] `wpe_user_audit` — `user-audit.ts` — Tier 1
  - Input: optional `account_id`
  - Chains: all accounts → GET /accounts/{id}/account_users for each (parallel)
  - Returns: flat table — user email, name, role, accounts
  - Highlights: owner/billing roles, users in multiple accounts

- [x] `wpe_fleet_health` — `fleet-health.ts` — Tier 1
  - Input: optional `account_id`
  - Chains: wpe_portfolio_usage + wpe_fleet_versions + SSL status per install (parallel)
  - Returns: per-install row: traffic tier, WP version, PHP version, SSL status, disk usage
  - Flags: outdated WP, high traffic + old PHP, SSL expiring, disk >80%

- [x] `wpe_diagnose_site` — `diagnose-site.ts` — Tier 1
  - Input: `install_id`
  - Checks: WP + PHP versions, primary domain DNS, SSL expiry, last backup recency, disk usage vs limits
  - Returns: structured diagnosis with remediation text for each failing check

- [x] `wpe_portfolio_overview` — `portfolio-overview.ts` — Tier 1
  - Extended wpe_portfolio_usage + version distribution + SSL summary + disk totals
  - "Executive fleet summary" — all key metrics in one call

- [x] `wpe_add_user_to_accounts` — `add-user-to-accounts.ts` — Tier 2
  - Input: `email`, `account_ids` (array), `role`
  - Batch POST /accounts/{id}/account_users across multiple accounts
  - Returns: per-account success/failure

---

## Phase 4 — CLI Parity

All new CLI commands in `src/cli/commands/wpe.ts`.
- All read commands get `--json` flag
- All Tier 3 commands require `--confirm` or `--confirm-name <value>` — no interactive prompting
- Each command needs: Commander subcommand + GraphQL mutation in schema.ts + resolver in resolvers.ts + IPC handler in ipc-handlers.ts

### 4.1 Account + User

- [x] `nexus wpe account <accountId>` → `wpe_get_account`
- [x] `nexus wpe limits <accountId>` → `wpe_get_account_limits`
- [x] `nexus wpe users <accountId>` → `wpe_get_account_users` (MCP exists, add CLI)
- [x] `nexus wpe user <accountId> <userId>` → `wpe_get_account_user`
- [x] `nexus wpe user-add <accountId> --email <e> --first <f> --last <l> --role <r>` → `wpe_create_account_user`
- [x] `nexus wpe user-update <accountId> <userId> --role <role>` → `wpe_update_account_user`
- [x] `nexus wpe user-remove <accountId> <userId> --confirm` → `wpe_delete_account_user`
- [x] `nexus wpe user-audit [--account <accountId>]` → `wpe_user_audit`

### 4.2 Sites + Installs

- [x] `nexus wpe sites [--account <accountId>]` → `wpe_get_sites`
- [x] `nexus wpe site <siteId>` → `wpe_get_site`
- [x] `nexus wpe create-site --name <name> --account <accountId>` → `wpe_create_site`
- [x] `nexus wpe create-install --site <siteId> --name <name> --env <env>` → `wpe_create_install`
- [x] `nexus wpe update-install <installId> [--php <version>]` → `wpe_update_install`
- [x] `nexus wpe delete-install <installId> --confirm-name <installName>` → `wpe_delete_install`

### 4.3 Backup

- [x] `nexus wpe backup-status <installId> <backupId>` → `wpe_get_backup`
- [x] `nexus wpe backup-verify <installId> [--description <text>]` → `wpe_backup_and_verify`

### 4.4 Domains + SSL

- [x] `nexus wpe domains <installId>` → `wpe_get_domains`
- [x] `nexus wpe domain-add <installId> <domain>` → `wpe_create_domain`
- [x] `nexus wpe domain-remove <installId> <domainId> --confirm` → `wpe_delete_domain`
- [x] `nexus wpe domain-check <installId> <domainId>` → `wpe_check_domain_status`
- [x] `nexus wpe ssl <installId>` → `wpe_get_ssl_certificates`
- [x] `nexus wpe ssl-request <installId> [--domains <d1,d2>]` → `wpe_request_ssl_certificate`

### 4.5 SSH Keys

- [x] `nexus wpe ssh-keys` → `wpe_get_ssh_keys`
- [x] `nexus wpe ssh-key-add --label <label> --key <pubkey>` → `wpe_create_ssh_key`
- [x] `nexus wpe ssh-key-remove <keyId> --confirm` → `wpe_delete_ssh_key`

### 4.6 Workflow Commands

- [x] `nexus wpe promote <sourceInstallId> <destInstallId> [--no-database] --confirm` → `wpe_promote_environment`
- [x] `nexus wpe diagnose <installId>` → `wpe_diagnose_site`
- [x] `nexus wpe go-live-check <installId> <domain>` → `wpe_go_live_checklist`
- [x] `nexus wpe portfolio` → `wpe_portfolio_overview`
- [x] `nexus wpe fleet-health [--account <accountId>]` → `wpe_fleet_health`

---

## Phase 5 — Server Instructions Update

File: `src/main/mcp/instructions/server-instructions.ts`

- [x] Expand Tool Routing table with all new tools grouped by category
- [x] Add Domain Management section: guidance on check → create → set primary → request SSL workflow
- [x] Add SSL Management section: request vs import, use get_ssl_certificates for expiry monitoring
- [x] Add Install Lifecycle section: create_site → create_install order; Tier 3 warnings; `confirm_install_name` requirement
- [x] Add Higher-Order Workflows section: when to use each composite tool; `go_live_checklist` (read) vs `prepare_go_live` (act); `promote_environment` vs `copy_install`
- [x] Update auth section to mention `wpe_get_current_user`

---

## Phase 6 — Tests

Test files:
- [x] `tests/unit/mcp/wpe-account-management.test.ts` — all account + user tools
- [x] `tests/unit/mcp/wpe-install-lifecycle.test.ts` — site CRUD + install lifecycle + backup
- [x] `tests/unit/mcp/wpe-domain-ssl.test.ts` — domain + SSL + SSH + offload tools
- [x] `tests/unit/mcp/wpe-workflows.test.ts` — all composite/workflow tools
- [x] `tests/unit/mcp/wpe-tier3.test.ts` — all destructive ops: token flow, confirm_name enforcement, backup nudge

Per-handler test structure:
```
describe('wpe_<name>', () => {
  it('returns formatted results on success')
  it('handles capiError on 401 with auth re-login message')
  it('handles capiError on network failure')
  // For Tier 3 handlers:
  it('returns pre-confirmation prompt when no token provided')
  it('validates confirm_name matches fetched resource name')
  it('proceeds on valid token + matching confirm_name')
  it('warns about missing backup for delete_install')
})
```

---

## Scope Summary

| Category | MCP tools | CLI commands | Handler files |
|----------|-----------|-------------|---------------|
| Account management | 8 | 8 | 8 |
| Site management | 5 | 5 | 5 |
| Install lifecycle | 6 | 4 | 6 |
| Domain management | 8 | 4 | 8 |
| SSL management | 4 | 2 | 4 |
| SSH keys | 3 | 3 | 3 |
| User / offload / misc | 4 | 0 | 4 |
| Composite workflows | 14 | 6 | 14 |
| **Total** | **52** | **32** | **52** |

Additional files modified: `index.ts`, `safety.ts`, `schema.ts`, `resolvers.ts`, `ipc-handlers.ts`, `server-instructions.ts`, `wpe.ts`

---

## Execution Order

```
Phase 0  — safety.ts pre-declaration
Phase 1  — Tier 3 pattern + delete_install + delete_site handlers
Phase 2a — Account management: get_account, limits, usage_summary/insights
Phase 2b — Account user CRUD: get_user, create, update, delete_user
Phase 2c — Site CRUD: get_sites, get_site, create_site, update_site, delete_site
Phase 2d — Install lifecycle: create, update, delete, get_backup, refresh_disk
Phase 2e — Domain management: all 8 tools
Phase 2f — SSL management: all 4 tools
Phase 2g — SSH keys + get_current_user + offload tools
Phase 3a — promote_environment
Phase 3b — backup_and_verify
Phase 3c — account_overview, installs_by_account, account_domains
Phase 3d — account_ssl_status, fleet_health, diagnose_site
Phase 3e — go_live_checklist, prepare_go_live
Phase 3f — user_audit, environment_diff, portfolio_overview, add_user_to_accounts
Phase 4  — CLI parity (all 32 commands + GQL schema/resolver/IPC for each)
Phase 5  — Server instructions update
Phase 6  — Tests
```

---

## Notes

- Test each `capiDirect()` endpoint manually against real CAPI before finalizing — some write endpoints may require basic auth (like backups). Document auth behavior in handler comments.
- `wpe_copy_install` (raw) vs `wpe_promote_environment` (guarded) — both wrap `POST /install_copy`. Promote has pre-checks and Tier 3; copy is a direct pass-through for power users.
- Composite tools that call other tools should call `capiDirect()` directly (not other handlers) to avoid double-error-handling and keep control flow predictable.
- For parallel CAPI calls in composites (e.g., account_ssl_status fetching SSL for N installs), use `Promise.all()` with per-item error catching — one failed install should not abort the whole report.
