---
name: nexus-sites
description: Discover and show all local and WP Engine sites with status. Groups running vs halted, shows WPE links, and surfaces next actions. Use at the start of any workflow involving sites — always call this first before acting on a site.
allowed-tools: Bash(nexus *)
---

# Site Discovery

```!
nexus sites list
```

Present the results clearly:

1. **Running local sites** (ready to use) — name, domain, WPE link if any
2. **Halted local sites** — name, domain (note: must start before most operations)
3. **WP Engine installs** (cloud) — install name, environment (production/staging/dev), domain

If a site argument was provided (`$ARGUMENTS`), focus on that specific site and show its details with `nexus sites get $ARGUMENTS`.

After listing, identify what the user most likely wants to do next and suggest the relevant command.
