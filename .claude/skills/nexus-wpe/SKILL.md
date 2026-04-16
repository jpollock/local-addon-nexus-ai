---
name: nexus-wpe
description: Query WP Engine account data — sites, installs, usage metrics, bandwidth, visits, storage, domains, backups, SSL, users, and diagnostics. Use when asked about WPE environments, usage stats, storage, installs, traffic, or anything related to the WP Engine account.
argument-hint: [topic] e.g. usage, installs, domains, backups, users, diagnose
allowed-tools: Bash(nexus *)
---

# WP Engine Account Data

Topic: `$ARGUMENTS`

## Step 1: Get fleet-wide context

```!
nexus wpe portfolio
```

This shows all accounts, total installs, and fleet-wide visits + bandwidth.
Use this data to answer usage/traffic/storage questions directly when possible.
Only run additional commands if more detail is needed.

## Step 2: Fetch additional detail if needed

Based on `$ARGUMENTS` and what the portfolio output didn't cover:

| Topic | Command |
|-------|---------|
| **Usage / bandwidth / visits (fleet)** | ✅ Already in portfolio above |
| Usage drill-down (per account) | `nexus wpe account-usage <accountId>` |
| Usage drill-down (per install) | `nexus wpe usage <installId>` |
| Prior month usage | `nexus wpe portfolio --month-offset 1` |
| Account overview | `nexus wpe account <accountId>` |
| Account limits | `nexus wpe limits <accountId>` |
| All installs for an account | `nexus wpe installs <accountId>` |
| Install details | `nexus wpe install <installId>` |
| Domains | `nexus wpe domains <installId>` |
| SSL status | `nexus wpe ssl <installId>` |
| Backups | `nexus wpe backup-status <installId> <backupId>` |
| Users | `nexus wpe users <accountId>` |
| Diagnose install | `nexus wpe diagnose <installId>` |
| Go-live check | `nexus wpe go-live-check <installId> <domain>` |

**If the portfolio shows zeros** for visits/bandwidth, the current billing period
hasn't rolled up yet. Run: `nexus wpe portfolio --month-offset 1` to get last month's data.

## Step 3: Present findings

- Highlight accounts with the most traffic or storage
- Flag anything abnormal (high bandwidth, 404 accounts, missing SSL)
- Suggest follow-up if user wants per-install breakdown
