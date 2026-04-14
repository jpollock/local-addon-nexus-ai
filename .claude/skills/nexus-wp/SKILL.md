---
name: nexus-wp
description: Run WP-CLI commands on a local WordPress site via nexus. Covers plugins, themes, core, database, posts, options, and health. Use for any WordPress management task on a local site.
argument-hint: <site-name> <wp-cli-command>
allowed-tools: Bash(nexus *)
---

# WP-CLI via Nexus

Site: `$0`
Command: `$1 $2 $3 $4 $5`

## Step 1: Verify site is running

```!
nexus sites list
```

If `$0` is halted, start it first: `nexus sites start $0`

## Step 2: Execute

Run the requested WP-CLI command:

```
nexus wp $1 --site $0
```

**Common patterns:**

| Task | Command |
|------|---------|
| List plugins | `nexus wp plugin list --site $0` |
| Activate plugin | `nexus wp plugin activate <slug> --site $0` |
| Update all plugins | `nexus wp plugin update --all --site $0` |
| Check WP version | `nexus wp core version --site $0` |
| Export database | `nexus wp db export --site $0` |
| Search/replace URL | `nexus wp search-replace old.com new.local --site $0` |
| List users | `nexus wp user-list --site $0` |
| Get option | `nexus wp option-get siteurl --site $0` |
| Site health | `nexus wp health --site $0` |

If the full command wasn't provided in arguments, ask the user what WP-CLI operation they want to perform.

After running, show the output and explain what it means.
