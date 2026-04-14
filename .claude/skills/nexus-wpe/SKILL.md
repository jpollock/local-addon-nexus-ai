---
name: nexus-wpe
description: Query WP Engine account data — sites, installs, usage metrics, domains, backups, SSL, users, and diagnostics. Use when asked about WPE environments, usage stats, storage, installs, or anything related to the WP Engine account.
argument-hint: [topic] e.g. usage, installs, domains, backups, users, diagnose
allowed-tools: Bash(nexus *)
---

# WP Engine Account Data

Topic: `$ARGUMENTS`

## Step 1: Discover accounts and installs

```!
nexus wpe accounts
```

Use the account ID(s) above for follow-up queries. If only one account exists, use it automatically.

## Step 2: Fetch the requested data

Based on `$ARGUMENTS`, run the appropriate command:

| Topic | Command |
|-------|---------|
| Usage / storage (install) | `nexus wpe usage <installId>` |
| Usage / storage (account) | `nexus wpe account-usage <accountId>` |
| Account overview | `nexus wpe account <accountId>` |
| Account limits | `nexus wpe limits <accountId>` |
| All installs | `nexus wpe installs <accountId>` |
| Install details | `nexus wpe install <installId>` |
| Domains | `nexus wpe domains <installId>` |
| SSL status | `nexus wpe ssl <installId>` |
| Backups | `nexus wpe backup-status <installId> <backupId>` |
| Users | `nexus wpe users <accountId>` |
| Diagnose install | `nexus wpe diagnose <installId>` |
| Go-live check | `nexus wpe go-live-check <installId> <domain>` |

If the topic is "usage" or "storage" and no install is specified, run `account-usage` for the whole account.

## Step 3: Present findings

After fetching data:
- Highlight anything that looks abnormal (high usage, missing SSL, expired certs, failed backups)
- Compare against limits if relevant
- Suggest follow-up commands if the user would want more detail
