---
title: WP Engine Management
description: Managing WP Engine installs from Local — sync, permissions, pull/push, and the platform surface
keywords: [wpe, wp-engine, sync, pull, push, installs]
---

# WP Engine Management

Nexus AI manages WP Engine installs alongside local sites — same list, same
tools, same permission gates.

## Connect

1. Connect Local to your account: **Local → Connect → WP Engine**
2. Open the Nexus AI **Sites** tab and click **Refresh** — your installs join
   the fleet list, labeled by source and environment

The connection state lives in **Settings → Connections**.

## What data is collected, and when

Three layers, each cheaper than the next is deeper:

| Layer | What | How | When |
|---|---|---|---|
| L1 | Install inventory: name, environment, PHP/WP version, account | WP Engine API (CAPI) | On refresh; opt-in scheduler ("Check WP Engine sites") |
| L2 | Site details: plugins, themes, URL, post counts | SSH + WP-CLI | Opt-in scheduler ("Refresh site details"), or on demand |
| L3 | Content, embedded for semantic search | SSH extraction → local sqlite-vec | Opt-in scheduler ("Make content searchable"), or ⚡ Index in the Sites tab |

**All three schedulers are off by default** — enable them in
**Settings → Background work**. Until L2 runs, an install shows inventory
only; until L3 runs, it isn't searchable. The Sites tab shows each install's
data level so absence reads as "not collected yet", never as "empty site".

## Permissions — reads always, writes granted

Reading a WPE install (versions, plugin lists, health) is always allowed.
**Writes are gated per operation per environment**, and production writes are
refused by default. The grid lives in **Settings → Permissions**; a refused
operation tells you exactly which cell to change. See
[Settings](preferences.md#permissions--what-agents-may-do).

## Pull & Push

- **Pull** (WPE → local): `nexus sync pull`, the `local_wpe_pull` MCP tool, or
  ask the Docked Panel. Pulling records lineage — Nexus then knows which
  environment your local copy tracks, and divergence questions ("how far
  behind production am I?") become answerable.
- **Push** (local → WPE): `nexus sync push` / `local_wpe_push` — always
  confirmation-gated, refused on production unless granted.
- **Compare**: `nexus wpe plugin-diff <a> <b>` or the `compare_sites` tool.
- **History**: `nexus sync history <site>`.

## The platform surface

The full WP Engine management surface (~75 MCP tools, mirrored by
`nexus wpe`) is available to the chat, AI clients, and the terminal:

| Area | Examples |
|---|---|
| Accounts & users | list accounts, usage, limits; add / update / remove / audit portal users |
| Installs & sites | create / update / delete installs, per-install usage |
| Domains & SSL | add domains, DNS status checks, request Let's Encrypt |
| Backups | create, poll to completion, verify |
| Ops | cache purge, environment promotion (grant-gated), diagnostics, go-live checklist, fleet health |

See the [CLI Command Reference](../reference/cli-command-reference.md#nexus-wpe)
for the complete `nexus wpe` listing.

## Where things show up

- **Sites tab** — every install as a row: filter by source (`wpe`),
  environment, version; bulk refresh/index over ticked rows.
- **Docked Panel** — "how are my WPE installs doing?" answers with data ages
  and citations; drift and health questions route through the same fleet
  tools.
- **Record tab** — syncs, refreshes, and gated operations appear in the event
  timeline.

## Troubleshooting

- `nexus wpe status` — auth state; `nexus wpe login` re-authenticates
- `nexus doctor` — connection and setup checks with exact fixes
- A refused write is a **permissions** answer, not an error — read the
  message; it names the grant to change
- Installs with no plugin data have not had L2 run yet — click Refresh or
  enable the scheduler

## See also

- [External SSH Hosts](../features/external-hosts.md) — the same model for
  non-WPE hosts
- [WPE Sync Architecture](../architecture/wpe-sync-architecture.md) — how the
  sync engine works
- [Permissions & Access Control](../reference/permissions-access-control-v2.md)
