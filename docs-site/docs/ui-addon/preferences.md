---
title: Settings
description: The Settings tab — connections, chat, background work, permissions, capabilities, advanced
keywords: [settings, preferences, permissions, schedules, connections]
---

# Settings

All Nexus AI configuration lives in the **Settings** tab of the Nexus AI view.
(There is no separate Preferences → Nexus AI page in Local anymore — settings
moved here, and host-key approval happens where you meet it, in the add-host
flow.) Changes apply immediately; nothing requires a Local restart.

Everything here is also scriptable: `nexus settings get [key]`,
`nexus settings set <key> <value>`, `nexus settings patch <json>`.

The tab has six sections.

## Connections — "Where your sites are"

- **WP Engine** — your connected account(s); connect via Local → Connect →
  WP Engine. Once connected, installs appear in the Sites tab.
- **External SSH hosts** — hosts registered with `nexus host add`, with their
  environments and access state. Approving a new host key happens in the
  add-host wizard (an unknown key) or the identity-changed screen (a changed
  key) — deliberately never over the API.
- **AWS (access logs)** — Access Key ID / Secret for the log-processor
  agent's S3 bucket, validated on save with specific error messages
  (bad key id vs. bad secret vs. network).

## Chat

- **Enable AI Chat Panel** — the Docked Panel bubble in the bottom-right of
  every Local screen.
- **AI provider, API key, and model** — pick Anthropic / OpenAI / Google /
  Ollama, store the key, choose from the provider's live model list.
- **Chat history** — how long history is kept, and a delete-all control.

## Background work

The seven scheduled jobs, each with an enable switch (where applicable) and an
interval. **Everything that costs anything is opt-in and off by default.**

| Job | Default interval | Opt-in? |
|---|---|---|
| Check WP Engine sites | 24h | off by default |
| Refresh site details (WPE) | 8h | off by default |
| Make content searchable (WPE) | 24h | off by default |
| Check other hosts (SSH) | 24h | off by default |
| Make other hosts searchable (SSH) | 24h | off by default |
| Index sites on this Mac | 8h | off by default |
| Look over stopped local sites | 24h | always on (interval only) |

Toggling a job takes effect immediately — the scheduler restarts without a
Local restart, whether you flip it here or via
`nexus settings set wpeRefreshAutoEnabled true`.

## Permissions — "What agents may do"

**Reading a site is always allowed. The grid controls writing.** Four
operations × three environments:

| Operation | Local | Staging | Production |
|---|---|---|---|
| Copy a site down to this Mac (`pull`) | — | ✓ default | ✓ default |
| Install or update things (`wpcli`) | ✓ | ✓ | **refused by default** |
| Push local changes up (`push`) | — | ✓ | **refused by default** |
| Delete or promote an environment (`delete`) | **refused** | **refused** | **refused by default** |

Plus **account scope** (which WPE accounts are in play) and per-site
exceptions. A refused operation names this section in its error, with the
exact permission and environment to change.

## Capabilities

The capability register behind [Procedures & Grants](../features/procedures.md):
each capability's **state** (granted / denied), **the document it is pinned
to** (the runbook, by content hash), and **what granting it gates**.
Production-scoped capabilities (promotion, incident remediation) are denied
until explicitly granted here; new capabilities arrive denied.

## Advanced

Operational tools: logs on disk (with copy buttons), AI gateway usage, search
index rebuild, database health, cleanup actions, and reset. The destructive
ones confirm first; `nexus reset` is the CLI equivalent of the factory reset.

## See also

- [WPE Access Preferences](preferences-wpe-access.md) — the permissions grid
  in depth
- [Permissions & Access Control](../reference/permissions-access-control-v2.md)
- CLI: `nexus settings --help`
