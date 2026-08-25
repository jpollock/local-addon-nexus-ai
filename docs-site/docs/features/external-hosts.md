---
title: External SSH Hosts
description: Bring any SSH-reachable WordPress site into the fleet
keywords: [ssh, external-hosts, nexus-host, fleet]
---

# External SSH Hosts

Sites that are neither Local nor WP Engine — a client's shared host, a VPS —
can join the fleet through a `~/.ssh/config` alias.

```bash
nexus host test <alias>     # check the connection, nothing registered
nexus host add <alias>      # probe, list the WordPress installs found, pick which to register
nexus host list             # what's registered
nexus host refresh <alias>  # collect WP/PHP/plugin/theme metadata now (read-only)
nexus host index <alias>    # content-index for semantic search (read-only)
```

Registered sites appear in the **Sites** tab and in fleet tools alongside
local and WPE sites, addressed as `ssh:<alias>/<site>@<environment>`.

## The guarantees

- **An alias is a connection, not a site** — one login can host many installs;
  registration lets you pick which ones count.
- **Nexus stores no key material and never writes to your server.** The probe
  is read-only; if key-based login isn't set up, Nexus prints the
  `ssh-copy-id` command for *you* to run.
- **The registered environment is a write gate.** A host registered as
  `production` refuses writes even when addressed with a different suffix —
  a target string can tighten the gate, never loosen it. Re-register with
  `--env development` to enable writes.
- **Schedules are opt-in.** Automatic metadata refresh and content indexing
  are off by default; enable them in Settings → Sync Schedule (or
  `nexus settings set externalRefreshAutoEnabled true`).
- **Unknown stays unknown.** On hosts where the PHP version can't be read,
  it is reported as unknown — never guessed — and such a host isn't health-
  scored on data it doesn't have.

## What works

18 of the 22 `nexus wp` subcommands reach a registered host (the exceptions:
`db scan/clean/report` and `users`, which are local-only by design). Fleet
views, search, and the chat treat external sites as first-class once refreshed
and indexed.

## See also

- The full CLI detail: [CLI Command Reference](../reference/cli-command-reference.md)
- [Permissions & Access Control](../reference/permissions-access-control-v2.md)
