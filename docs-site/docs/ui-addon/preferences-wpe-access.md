---
title: WPE Access & Permissions Settings
description: How to configure which WP Engine accounts sync, which environments allow SSH, and per-site overrides
keywords: [preferences, settings, wpe, permissions, accounts, ssh, production, staging, scope, access control]
---

# WPE Access & Permissions Settings

The **WPE Access & Permissions** card lives in **Local → Nexus AI → Settings tab** (and in Nexus Preferences → WP Engine for the advanced view). It controls three things:

1. Which WP Engine **accounts** are in scope
2. What **operation types** are allowed on each environment
3. **Per-site exceptions** for individual installs

---

## Finding the Settings

**Settings tab** (recommended for daily use):
1. Open the Nexus AI panel in Local
2. Click the **Settings** tab
3. Scroll to **WPE ACCESS & PERMISSIONS**
4. Click the row to expand it (look for the ▶ arrow)

**Nexus Preferences** (for more detail):
1. Local → Preferences → Nexus AI → WP Engine

---

## Account Scope

The **Account scope** section shows all your connected WP Engine accounts as clickable pills.

```
Account scope — click to include / exclude accounts from the permissions below

  ✓ btwpe    ✓ devrel    ✓ Unicorn    ✗ OldAccount    ✓ getflywheel
```

- **✓ green, solid border** — account is included (installs sync, commands allowed)
- **✗ grey, dashed border, dimmed** — account is excluded (installs hidden everywhere)

**Click any pill to toggle it.** Changes apply to all future syncs and commands.

**What "excluded" means in practice:**
- WPE metadata sync skips all installs in that account
- `wp_*` MCP tools cannot target installs from excluded accounts
- The account's installs don't appear in `nexus sites list` or fleet searches
- Existing cached data is kept but not refreshed

**When to exclude an account:**
- You have a personal/sandbox account you don't want mixed into fleet operations
- An account has been deprecated but still shows up in CAPI
- A client account you manage separately from your main fleet

---

## Operation Permissions

Five operation types, each with per-environment toggles (**Dev / Stg / Prd**).

### WP-CLI over SSH (Read)

**What it controls:** Read-only SSH commands — `wp plugin list`, `wp core version`, `wp user list`, `wp option get`, `wp site health`.

**Default:** ✅ Allowed on all environments including production.

This is what the **metadata sync** uses — it reads plugin lists, WP version, and user counts from every install via SSH. Turning this off for production means those installs won't get updated metadata from SSH.

> If you see many WPE installs showing as "stale" with no WP version or plugin data, check that `WP-CLI (Read)` is enabled for production.

### WP-CLI over SSH (Write)

**What it controls:** Modifying SSH commands — `wp plugin install/update/activate/deactivate`, `wp core update`, `wp post create/update/delete`, `wp search-replace`.

**Default:** ✅ Dev/Staging · ❌ Production blocked.

Turning this on for production allows `wp_plugin_install`, `wp_core_update`, etc. on live sites. This is a significant capability — use per-site exceptions rather than a blanket production enable.

### Pull to Local

**What it controls:** The `local_wpe_pull` MCP tool and Local's pull operation.

**Default:** ✅ Allowed everywhere.

Pulling downloads files and optionally the database from WPE to your local machine. It does not modify the remote environment.

### Push to WPE

**What it controls:** The `local_wpe_push` MCP tool and Local's push operation.

**Default:** ✅ Dev/Staging · ❌ Production blocked.

Pushing overwrites the remote environment with your local files (and optionally database). Extremely destructive on production — requires explicit enable.

### Delete / Promote

**What it controls:** `wpe_delete_install`, `wpe_delete_site`, `wpe_promote_environment`, `wpe_update_install`, `wpe_purge_cache`.

**Default:** ❌ Blocked everywhere.

Irreversible or high-impact CAPI operations. Enable only temporarily and for specific environments when needed.

---

## Expanding an Operation Card

Click any operation row to expand it and see:
- **Environment toggles** — flip Dev/Stg/Prd on or off
- **Site exceptions** — per-install overrides (see next section)

---

## Site Exceptions

Override the global defaults for specific installs.

**Example use cases:**
- Allow SSH write on `my-staging-site` production (it's not a real production)
- Block SSH read on `legacy-site` production (it's too fragile for WP-CLI)
- Allow `promote-environment` only for `release-pipeline` install

**Adding an exception:**
1. Expand an operation card
2. Click **+ Add site exception**
3. Search for the install name (e.g., `jppwpeplugistg`)
4. Choose the environment and whether to Allow or Block
5. Save

**Exception priority:** Site exceptions always win over the global default for that operation.

---

## The Header Summary

The collapsed card shows a one-line summary, for example:

```
11 accounts · production blocked for SSH write & push & delete
```

This tells you at a glance which operations are restricted on production without expanding the card.

---

## Common Configurations

### "I want production read-only, everything else unlocked"
- WP-CLI (Read): Dev ✅ Stg ✅ Prd ✅
- WP-CLI (Write): Dev ✅ Stg ✅ Prd ❌
- Push: Dev ✅ Stg ✅ Prd ❌
- Delete/Promote: Dev ❌ Stg ❌ Prd ❌

This is the **default**.

### "I want nothing to touch production"
- WP-CLI (Read): Dev ✅ Stg ✅ Prd ❌
- WP-CLI (Write): Dev ✅ Stg ✅ Prd ❌
- Push: Dev ✅ Stg ✅ Prd ❌
- Delete/Promote: Dev ❌ Stg ❌ Prd ❌

Note: With WP-CLI (Read) off for production, the metadata sync will skip production installs and they'll show as "stale."

### "I trust staging for everything"
- All operations: Dev ✅ Stg ✅ Prd ❌ (keep production protected)

### "I want one specific production install to allow SSH write"
Keep defaults, then add a site exception:
- Install: `my-prod-site`, Environment: production, Operation: WP-CLI (Write) = Allow

---

## FAQ

**Why do some installs still show as stale even though I enabled WP-CLI (Read) on production?**

Check account scope — if the install's account is excluded, it won't sync. Also check that the WPE metadata sync has run recently (Operations tab → Sync metadata).

**Does blocking an operation affect already-cached data?**

No. Existing cached data (WP version, plugin list) is preserved. Blocking stops future refreshes, not existing data.

**Can I undo an accidental permission change?**

Yes — the permissions are stored as settings and can be toggled back at any time. There's no history log of permission changes.

**What about the `wpe_create_backup` tool — is that blocked by delete/promote?**

No. `wpe_create_backup` is always allowed as it's a protective operation. The delete/promote gate only controls `wpe_delete_install`, `wpe_delete_site`, `wpe_promote_environment`, `wpe_update_install`, and `wpe_purge_cache`.
