---
title: Next Steps
description: What to do after getting started with Nexus AI
---

# Next Steps

You've installed Nexus AI and run `nexus doctor`. Here's where to go depending on the path you took.

---

## If you connected an AI agent (Path A)

Your AI assistant can now search, manage, and audit your WordPress fleet. Try these:

**Ask your AI agent:**

- *"List all my WordPress sites"*
- *"Which of my sites need plugin updates?"*
- *"What plugins are installed on mysite?"*
- *"Find posts about WooCommerce on my sites"*

**Explore the tools:**

- [MCP Tool Reference →](../mcp-tools/index.md) — Browse all ~160 tools
- [MCP Setup →](../cli/mcp-setup.md) — Add more AI agents or troubleshoot

---

## If you set up WordPress AI features (Path B)

Your sites now have AI writing tools in the block editor. Try these:

**In WordPress admin → any post or page:**

- Use the AI toolbar to generate titles, summaries, and excerpts
- Check **AI → Settings** to confirm the provider is active

**Configure more sites:**

```bash
nexus ai setup <sitename>   # add AI to another site
nexus ai config             # change provider or API key
```

---

## Useful commands

```bash
nexus doctor              # check system health at any time
nexus sites list          # see all local + WP Engine sites
nexus mcp status          # confirm MCP server is running
nexus ai config           # view or change AI provider settings
nexus update              # update CLI and addon to latest version
```

---

## Add WP Engine

If you have WP Engine sites, connect your account to manage remote sites alongside local ones:

```bash
# Authenticate in Local: Preferences → WP Engine → Connect
# Then sync your installs:
nexus sync wpe
```

[WP Engine Integration →](../integrations/wpe-account.md)

---

## Keep learning

<div class="grid cards" markdown>

- **MCP Tools**

    Browse all ~160 tools available to AI assistants.

    [→ Tool Reference](../mcp-tools/index.md)

- **CLI Commands**

    Full reference for every `nexus` command.

    [→ Command Reference](../reference/cli-command-reference.md)

- **Fleet Management**

    Manage and audit all your sites at scale.

    [→ Fleet Overview](../features/fleet-overview.md)

- **Troubleshooting**

    Something broken? Start with `nexus doctor`.

    [→ FAQ](../reference/faq.md)

</div>
