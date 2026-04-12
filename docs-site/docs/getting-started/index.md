---
title: Getting Started
description: Get up and running with Nexus AI in minutes
keywords: [getting started, quick start, installation, setup]
---

# Getting Started

## Install

```bash
npm install -g @local-labs-jpollock/local-addon-nexus-ai
```

One package installs everything: the `nexus` CLI, the Local addon, and the MCP server. On first run it detects your platform and downloads the correct addon build automatically.

After restarting Local, verify everything is working:

```bash
nexus doctor
```

Every `⚠️` or `❌` includes the exact command to fix it.

---

## Choose Your Path

### Path A — Connect Your AI Agent

No API key required. ~2 minutes.

Your AI assistant (Claude Code, Cursor, Claude Desktop, etc.) gets 160+ tools to search, manage, and audit your entire WordPress fleet.

```bash
nexus mcp setup
```

Then ask: *"List my WordPress sites"* or *"Which sites need plugin updates?"*

[→ CLI Quick Start](cli-quick-start.md){ .md-button .md-button--primary }

---

### Path B — AI Features Inside WordPress

Requires an API key. ~5 minutes per site.

Generate titles, summaries, and excerpts directly in the WordPress block editor.

```bash
nexus ai config        # set provider + API key
nexus ai setup mysite  # install AI features on a site
```

[→ UI Quick Start](ui-quick-start.md){ .md-button }

---

!!! tip "Not sure? Start with Path A."
    It works immediately, requires no API key, and gives you a feel for what Nexus AI can do. You can add Path B at any time.

---

## Prerequisites

- **Local by WP Engine** 9.0.0+ ([download](https://localwp.com))
- **Node.js** 18+ ([download](https://nodejs.org))

---

## Troubleshooting

```bash
nexus doctor
```

Run this first. It checks Local, the addon, MCP server, AI provider, and site configuration in one command.

[Full Troubleshooting Guide →](../reference/faq.md)
