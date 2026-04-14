---
name: nexus-push
description: Push a local site up to a WP Engine environment. DESTRUCTIVE — overwrites the live WPE environment. Requires explicit confirmation. Use only when intentionally deploying local changes to WPE.
argument-hint: <local-site> <wpe-install-name>
disable-model-invocation: true
allowed-tools: Bash(nexus *)
---

# Push Local → WP Engine (DESTRUCTIVE)

⚠️ **This overwrites the WP Engine environment with your local site content.**

Arguments: `$ARGUMENTS`
- Local site: `$0`
- WPE install: `$1`

## Step 1: Pre-flight check

```!
nexus sites list
```

Before pushing:
1. Confirm `$0` exists locally and is in the desired state
2. Confirm `$1` is the correct WPE install (check environment — don't push to production by mistake)
3. Verify a recent backup exists on WPE or create one: `nexus wpe backup create $1`
4. Run site health check: `nexus wp health --site $0`

## Step 2: Confirm with the user

Show them:
- Source: `$0` (local)
- Destination: `$1` (WPE install, environment)
- What will be overwritten: files + optionally DB

Ask explicitly: **"Confirm you want to push `$0` to `$1`? This cannot be automatically undone."**

Only proceed after explicit "yes".

## Step 3: Push

```
nexus sync push $0 --to $1
```

Add `--db` to also push the database. Do not include `--db` for files-only.

**Push is async** — monitor in Local's UI. Do not interrupt.
