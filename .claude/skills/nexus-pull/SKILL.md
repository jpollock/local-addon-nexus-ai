---
name: nexus-pull
description: Pull a WP Engine environment down to a local site — files and optionally database. Requires the local site to exist and be running. Use when you want to sync a WPE environment locally.
argument-hint: <local-site> <wpe-install-name>
allowed-tools: Bash(nexus *)
---

# Pull WP Engine → Local

Arguments: `$ARGUMENTS`
- Local site: `$0`
- WPE install: `$1`

## Step 1: Discover available sites

```!
nexus sites list
```

## Step 2: Validate and pull

1. Confirm `$0` exists as a local site and is running (start it if halted)
2. Confirm `$1` exists as a WPE install in the list above
3. If either argument is missing, ask the user to pick from the lists above
4. Run the pull:

```
nexus sync pull $0 --from $1 --db
```

The `--db` flag includes the database. Remove it for files-only.

**Pull is async** — it runs in Local's background. After starting, check progress in Local's UI or watch the logs. Do not run WP-CLI commands on the site until the pull completes (status returns to "running").

## Step 3: Verify

After pull completes, confirm with:
```
nexus sites get $0
nexus wp health --site $0
```
