---
title: Choose Your Path
description: Two ways to get value from Nexus AI — pick the one that fits you
---

# Choose Your Path

Nexus AI does two distinct things. You don't need both to get started — pick the one that fits right now.

## Path A — Connect Your AI Agent

**Who it's for:** Anyone using Claude Code, Cursor, Claude Desktop, Windsurf, or another MCP-compatible AI assistant.

**What you get:** 160+ tools that let your AI agent search, manage, and audit your entire WordPress fleet — local sites and WP Engine — with natural language.

**What you need:** Nothing. No API key. Just Local running with the addon installed.

**Time to value:** ~2 minutes.

```bash
nexus mcp setup
```

Then ask your AI agent: *"List my WordPress sites"* or *"Which of my sites need plugin updates?"*

[→ CLI Quick Start](cli-quick-start.md)

---

## Path B — AI Features Inside WordPress

**Who it's for:** WordPress developers who want AI-powered title generation, summarization, and excerpt writing directly in the block editor.

**What you need:** An Anthropic or OpenAI API key.

**Time to value:** ~5 minutes per site.

```bash
nexus ai config        # set your provider and API key
nexus ai setup mysite  # install AI features on a site
```

Then open the block editor and use the AI writing tools in the post toolbar.

[→ UI Quick Start](ui-quick-start.md)

---

## Not Sure?

Start with **Path A**. It works immediately, requires no API key, and gives you a feel for what Nexus AI can do. You can add Path B at any time.

---

!!! tip "Check your setup anytime"
    ```bash
    nexus doctor
    ```
    Shows the health of every layer and tells you exactly what to do next.
