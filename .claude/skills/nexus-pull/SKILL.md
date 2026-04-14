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

## Target syntax — required format

| Target | Format | Example |
|--------|--------|---------|
| Local site | `<name>@local` | `frostscape@local` |
| WPE source | `wpe:<account>/<install>@<env>` | `wpe:jpollock911/testblankjpp1@production` |

- `@local` suffix is **required** on the local site — bare names are rejected
- Account is the WPE account **slug** (e.g. `jpollock911`, `w7579`), not the UUID
- Environment: `production`, `staging`, or `development`

## Step 1: Discover available sites

```!
nexus sites list
```

Use this output to confirm the local site name and find the correct WPE account slug + install name.

## Step 2: Build the command and pull

1. Confirm `$0` exists locally — if halted, start it first: `nexus sites start $0@local`
2. From the list above, identify the WPE account slug and install name for `$1`
3. If either argument is missing or ambiguous, ask the user before proceeding
4. Run the pull with the correct target format:

```
nexus sync pull <name>@local --from wpe:<account>/<install>@production --db
```

The `--db` flag includes the database. Remove it for files-only.

**Pull is async** — runs in Local's background. Do not run WP-CLI on the site until it completes (status returns to "running").

## Step 3: Verify

```
nexus sites get <name>@local
nexus wp health --site <name>@local
```
