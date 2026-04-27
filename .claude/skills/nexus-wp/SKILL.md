---
name: nexus-wp
description: Run WP-CLI commands on a local WordPress site via nexus. Target format is <sitename>@local. For WPE remote installs use nexus-wpe skill instead.
argument-hint: <site@local> <wp-cli-command>
allowed-tools: Bash(nexus *)
---

# WP-CLI via Nexus (local sites)

For **local** sites only. WPE remote installs → use `nexus-wpe` skill.

Target format: `<sitename>@local` or bare site name (auto-resolved from graph DB).

**Common commands:**

```
nexus wp core version <target>          # WP version
nexus wp plugin list <target>           # list plugins
nexus wp plugin update <target> --all   # update all plugins
nexus wp health <target>                # site health check
nexus wp option-get <target> siteurl    # get WP option
nexus wp user-list <target>             # list users
nexus wp db export <target>             # export database
```

**Examples:**
```
nexus wp core version mysite@local
nexus wp core version jppblank          # bare name — auto-resolves local or WPE
nexus wp plugin list mysite@local --json
```

Show the output and explain what it means.
