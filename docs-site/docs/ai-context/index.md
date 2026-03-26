---
title: AI Context for Nexus AI
description: Comprehensive context for AI assistants using Nexus AI
keywords: [ai context, mcp, tools, features, capabilities]
---

# AI Context for Nexus AI

**Last Verified:** 2026-03-25

This section provides structured context for AI assistants (Claude, ChatGPT, etc.) using Nexus AI through MCP or CLI interfaces.

## What This Section Contains

| Document | Purpose | For |
|----------|---------|-----|
| **[Features](features.md)** | Complete list of verified features | Understanding capabilities |
| **[MCP Tools](mcp-tools.md)** | All 111 tools with examples | Tool selection and usage |
| **[CLI Commands](cli-commands.md)** | All CLI commands with examples | Command-line workflows |
| **[Common Tasks](common-tasks.md)** | Task-based workflows | Step-by-step guidance |
| **[Troubleshooting](troubleshooting.md)** | Common issues and solutions | Problem resolution |

## Quick Reference

### What Nexus AI Does

Nexus AI is a Local addon + CLI that:

1. **Indexes WordPress sites** into a vector database (LanceDB)
2. **Exposes MCP tools** for AI assistants to manage sites
3. **Provides semantic search** across all site content
4. **Supports local + WP Engine sites** in unified interface
5. **Executes WP-CLI** commands locally and remotely via SSH

### What It Does NOT Do

- ❌ AI Chat UI (was removed)
- ❌ Site Groups UI (not implemented)
- ❌ Smart Filters UI (not implemented)
- ❌ Direct database access (uses WP-CLI)
- ❌ Arbitrary shell commands (safety restricted)

### Key Capabilities

**Search & Discovery:**
- Semantic search across post content, pages, products, ACF fields
- Cross-site search (search all indexed sites at once)
- WooCommerce product extraction
- ACF custom field enrichment

**Site Management:**
- Local site CRUD (create, start, stop, delete)
- WP Engine remote site management via CAPI
- WP-CLI execution (local + remote via SSH)
- Plugin/theme/user management

**Fleet Operations:**
- Cross-site analysis (drift detection, comparisons)
- Bulk operations with progress tracking
- Health monitoring
- AI Gateway usage tracking

**AI Integration:**
- MCP server for AI assistants (Claude Desktop, Cursor, etc.)
- CLI for terminal workflows
- Ollama integration with site context injection
- 3-tier safety system with confirmation tokens

## How to Use This Context

### For General Questions

Start with **[Features](features.md)** to understand what Nexus AI can and cannot do.

### For Tool Selection

Check **[MCP Tools](mcp-tools.md)** to find the right tool for your task:
- Search content → `search_site_content` or `search_across_sites`
- Manage sites → `local_list_sites`, `local_create_site`, etc.
- WP-CLI → `wp_plugin_list`, `wp_core_version`, etc.
- WP Engine → `wpe_get_sites`, `wpe_sync_sites`, etc.

### For Workflows

Use **[Common Tasks](common-tasks.md)** for step-by-step instructions:
- How to search for content
- How to create and configure a site
- How to sync WP Engine sites
- How to execute bulk operations

### For Troubleshooting

Check **[Troubleshooting](troubleshooting.md)** for:
- Common error messages
- Tool failures
- Connection issues
- Performance problems

## Architecture Quick Reference

**Tech Stack:**
- TypeScript + Electron (main + renderer)
- LanceDB (vector database, cosine distance)
- ONNX Runtime (local embeddings, all-MiniLM-L6-v2)
- better-sqlite3 (graph database)
- React 16.8 (class-based, no hooks)

**Tool Modules (11 total):**
- content (2 tools) - Semantic search
- site-context (6 tools) - Site structure
- ollama (4 tools) - Local LLM queries
- fleet (6 tools) - Cross-site analysis
- site-management (17 tools) - Local site CRUD
- wp-cli (31 tools) - WordPress CLI
- wpe (13 tools) - WP Engine management
- composite (3 tools) - Parallel operations
- wp-connector (12 tools) - AI credential sync
- fleet-intelligence (9 tools) - Advanced analytics
- test-tools (1 tool) - Diagnostics

**Total:** ~111 MCP tools

## Data Locations

```
~/Library/Application Support/Local/
├── addons/local-addon-nexus-ai/       # Addon code
├── nexus-ai/                          # Data directory
│   ├── lancedb/                       # Vector database
│   ├── graph.db                       # SQLite graph
│   └── models/                        # ONNX models
├── nexus-ai-mcp-connection-info.json  # MCP connection
└── graphql-connection-info.json       # GraphQL connection
```

## Next Steps

- **New to Nexus AI?** Start with [Features](features.md)
- **Using MCP tools?** See [MCP Tools](mcp-tools.md)
- **Using CLI?** See [CLI Commands](cli-commands.md)
- **Specific task?** Check [Common Tasks](common-tasks.md)
- **Having issues?** Try [Troubleshooting](troubleshooting.md)
