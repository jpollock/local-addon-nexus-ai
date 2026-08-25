---
title: UI Quick Start
description: Get started with Nexus AI UI addon in 3 minutes
keywords: [ui, addon, local, quick-start, installation, getting-started]
---

# UI Quick Start

Get up and running with the Nexus AI UI addon in 3 minutes.

## Prerequisites

Before you begin, make sure you have:

- **Local by WP Engine** installed ([download](https://localwp.com))
- At least one WordPress site in Local

## Installation

### Install via CLI (Recommended)

Install the CLI globally — the addon is auto-installed into Local on first run:

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

Open Local by WP Engine and the Nexus AI addon activates automatically.

!!! info "No separate addon download needed"
    The CLI (`npm install -g`) handles everything. It downloads and installs the platform-specific addon into Local automatically on first run. No manual download or ZIP installation required.

### Manual Install (Advanced)

If you need to install the addon separately:

1. Download the platform tarball from [releases.elasticapi.io](https://releases.elasticapi.io/nexus-ai/latest.json) (`.tgz` file for your platform)
2. Extract it to Local's addon directory — see [full instructions](../ui-addon/installation.md#method-2-manual-install-from-releases)
3. Restart Local

### Verify

```bash
nexus doctor
```

Every `⚠️` or `❌` includes the exact command to fix it.

## First Launch

1. **Open Nexus AI:** click the **Nexus AI** icon in Local's toolbar.

2. **The view opens on the Now tab.** Five tabs run across the top:

   - **Now** — what needs you: pending approvals, findings, and a re-entry
     card if you left a chat session mid-task
   - **Sites** — the fleet list (the Properties view): local sites, WP Engine
     installs, and external SSH hosts in one table
   - **Record** — the event record: stats and a timeline of what the platform
     observed and did
   - **Agents** — the shipped agents (security-sentinel, log-processor,
     web-analytics, seo-insights) with consoles, run history, and settings
   - **Settings** — sync schedules, WPE access permissions, advanced actions

   The **Docked Panel** chat is available alongside every tab.

## First Steps

### 1. Look at your fleet (Sites tab)

Open **Sites**. Every site you manage is one row — local, WP Engine, and
external SSH together, each labeled with its source and its data level
(Scanned / Configured / Searchable).

- **Search becomes filters:** type in the search box and your words turn into
  removable filter clauses (by name, source, version, plugin, …).
- **Needs you:** a column surfaces sites with findings that want attention.

### 2. Index a site for search

Tick a running site's row and use the bulk bar's **⚡ Index**. Indexing embeds
the site's content locally (nothing leaves your machine) so semantic search
and the chat can answer content questions about it.

To keep data current automatically, enable the schedules in **Settings**
(they are opt-in, off by default).

### 3. Ask the Docked Panel

Open the Docked Panel and ask a question in plain language:

```
which of my sites run woocommerce, and which of those are behind on updates?
```

Answers name the age of the data they rest on, disclose staleness, offer a
live re-check, and cite the records that supplied them. Risky operations are
governed by reviewed procedures — the panel walks checkpoints and asks for
your approval where the platform requires it.

### 4. Connect WP Engine sites

1. Connect Local to WP Engine (**Local → Connect → WP Engine**)
2. Open **Sites** and click **Refresh** — your installs join the list
3. Reads work immediately; writes to production are refused until you grant
   them in **Settings → WPE Access**

### 5. Act on many sites at once

In **Sites**, tick the rows you mean (or filter first, then select) and use
the bulk bar: refresh metadata, index content. Bulk actions run only over the
ticked rows — an empty selection never means "everything".

## Common Workflows

### Daily morning check

1. Open **Now** — anything that needs you is already there
2. Glance at **Sites** for the Needs-you column

### Before a client meeting

1. Filter **Sites** to the client's sites
2. Ask the Docked Panel for a health summary — answers cite their sources

### Weekly maintenance

1. **Sites** → filter to what's behind → tick → refresh/index
2. Review agent findings under **Agents**

## Settings

Everything is configured in the **Settings** tab of the Nexus AI view:
connections (WPE account, SSH hosts, AWS), the chat panel and its AI
provider + API key, background schedules, write permissions, capability
grants, and advanced tools. There is no separate Preferences → Nexus AI page.

## Troubleshooting

### The view doesn't open

1. Restart Local completely (Quit, not just close window)
2. Check **Preferences → Addons** — "Nexus AI" should be enabled
3. Check **Help → Reveal Logs Folder** → `main.log` for errors

### Sites not showing

1. Click **Refresh** in the Sites tab
2. Sites must exist in Local's own sidebar (local) or your connected WPE
   account (remote)
3. Run `nexus doctor` — every ⚠️/❌ prints the exact fix

### Indexing fails on a site

1. The site must be **running** (or let the bulk bar auto-start it when
   offered)
2. Check the site is healthy: open its Site Shell and run
   `wp core verify-checksums`
3. Re-run indexing for that one site and read the row's error

### WPE connection issues

1. Re-authenticate: **Local → Connect → WP Engine**
2. Test connectivity: `ping wpengineapi.com`
3. `nexus wpe status` shows the auth state

[Troubleshooting Guide →](../cli/troubleshooting.md)

## Next Steps

- **[First Scan](first-scan.md)** — how indexing works
- **[First AI Query](first-ai-query.md)** — more chat examples
- **[CLI Quick Start](cli-quick-start.md)** — the same power in a terminal
