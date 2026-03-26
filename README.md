# Nexus AI — Local Addon

AI-powered WordPress site intelligence for [Local](https://localwp.com/). One MCP connection for all WordPress operations — local, WPE, or elsewhere.

## What It Does

Nexus AI indexes your WordPress sites into a vector database and exposes them through the Model Context Protocol (MCP), enabling AI assistants to understand and work with your sites.

1. **Scan** — Reads site structure from the filesystem (themes, plugins, PHP version)
2. **Extract** — Pulls content from MySQL (posts, pages, products, ACF fields, media)
3. **Chunk** — Splits long content at sentence boundaries for optimal retrieval
4. **Embed** — Generates 384-dimensional vectors using all-MiniLM-L6-v2 (ONNX, runs locally)
5. **Index** — Stores vectors in LanceDB with cosine distance search and post-level dedup

## Features

- **MCP Server** — 111 tools for AI assistants (Claude Desktop, Cursor, etc.)
- **WP Engine Remote Management** — Sync and manage WPE sites alongside local sites (see below)
- **Production-Ready Security** — Input validation, audit logging, credential redaction
- **High-Performance UI** — Virtual scrolling for 500+ sites without lag, 7 active panels
- **AI Gateway** — Credential proxy, usage tracking, cost monitoring
- **Event Tracking** — WordPress action/filter tracking with graph database
- **Bulk Operations** — Fleet-wide operations with progress tracking and per-site results
- Semantic search across all site content with relevance scoring
- WooCommerce product extraction (price, SKU, stock, attributes, categories)
- ACF custom field enrichment (text, repeater, group, flexible content)
- Fleet-wide analytics (drift detection, health monitoring, plugin usage)
- WP-CLI execution on both local and remote WP Engine installs via SSH
- Ollama integration with automatic site context injection
- 3-tier safety system with confirmation tokens for destructive operations
- Per-platform packaging with native binary stripping

## WP Engine Remote Management

Nexus AI can sync your **WP Engine sites** into the same fleet view as your local sites, giving you unified search and management across your entire WordPress portfolio.

**Key Capabilities:**
- 🔍 **Unified Search** — Search content across local + WPE sites in Site Finder
- ⚡ **Fast Sync** — 251 sites in ~25 minutes with full content indexing
- 📊 **Full Metadata** — WordPress version, plugins, users extracted via remote WP-CLI
- 🔗 **Link Detection** — Automatically identifies which WPE sites are already pulled to local
- ⬇️ **Pull to Local** — One-click creation of local copies for development/testing

**Quick Start:**
1. Connect Local to your WP Engine account (Local → Connect → WP Engine)
2. Open Nexus AI → Preferences
3. Click **"Sync Now"** under "WP Engine Sites"
4. View synced sites in Fleet Overview

**Performance:**
- ~6 seconds per site (SSH ControlMaster + 10x concurrency)
- Live progress indicator in Fleet Overview header
- Re-sync anytime to refresh data

**See:** [WPE Remote Management User Guide](docs/WPE_REMOTE_MANAGEMENT_USER_GUIDE.md) for full documentation

## MCP Integration

Nexus AI exposes **111 MCP tools** for AI assistants to manage WordPress sites. Use with Claude Desktop, Cursor, or any MCP-compatible client.

**Tool Categories:**
- **Content** (2 tools) — Semantic search within and across sites
- **Site Context** (6 tools) — Site structure, index status, reindexing
- **Ollama** (4 tools) — Local LLM queries with automatic site context
- **Fleet** (6 tools) — Cross-site analysis, drift detection, comparisons
- **Site Management** (17 tools) — Create, start, stop, clone, delete local sites
- **WP-CLI** (31 tools) — Plugin/theme/user management, local + remote via SSH
- **WP Connector** (12 tools) — AI credential sync, Abilities API
- **WPE** (13 tools) — WP Engine account/site/install management
- **Composite** (3 tools) — Parallel site and plugin audits
- **Fleet Intelligence** (9 tools) — Advanced fleet analytics
- **Test Tools** (1 tool) — Diagnostics

**Setup:** Install Nexus AI addon in Local, then configure MCP client to connect to `~/Library/Application Support/Local/nexus-ai-mcp-connection-info.json`

## Requirements

- [Local](https://localwp.com/) 9.0.0 or later
- Node.js 20+
- ~200 MB disk space (ONNX model + LanceDB binaries)
- [Ollama](https://ollama.com/) (optional, for local AI chat)

## Installation

### From Release

1. Download the tarball for your platform from the [Releases](../../releases) page
2. Extract to Local's addon directory:
   ```
   ~/Library/Application Support/Local/addons/local-addon-nexus-ai/
   ```
3. Restart Local

### From Source

```bash
git clone <repo-url> local-addon-nexus-ai
cd local-addon-nexus-ai
npm install
npm run download-model
npm run build
```

Symlink or copy the addon directory into Local's addon path, then restart Local.

## Development

```bash
npm install                    # Install dependencies
npm run download-model         # Download ONNX model (~30 MB)
npm run build                  # Compile TypeScript + create entry points
npm run watch                  # Watch mode for development
npm test                       # Run unit tests (1,235 tests)
npm run test:eval              # Run eval tests (52, LLM evals need Ollama)
npm run test:integration       # Run integration tests (187 tests)
npm run test:e2e               # Run E2E tests (347 tests, requires Local running)
npm run test:all               # Run all test suites
npm run package:mac-arm        # Package for macOS Apple Silicon
npm run rebuild                # Rebuild native modules for Electron (after npm install)
```

**See:** `.claude/project/` for comprehensive developer AI context (architecture, patterns, testing, troubleshooting)

## MCP Connection

When the addon starts, it writes connection info to:

```
~/Library/Application Support/Local/nexus-ai-mcp-connection-info.json
```

This file contains the URL, auth token, and port for connecting an MCP client.

## Architecture

```
src/
├── common/              # Shared types and constants
│   ├── types.ts
│   ├── constants.ts
│   └── schemas.ts       # Zod validation schemas
├── main/
│   ├── content/         # Extraction and chunking pipeline
│   │   ├── ContentPipeline.ts
│   │   ├── MySQLExtractor.ts
│   │   ├── FileScanner.ts
│   │   ├── IndexRegistry.ts
│   │   ├── html-cleaner.ts
│   │   └── extractors/
│   │       ├── WooCommerceExtractor.ts
│   │       ├── ACFExtractor.ts
│   │       ├── MediaExtractor.ts
│   │       └── ...
│   ├── embeddings/      # ONNX inference + tokenizer
│   │   ├── EmbeddingService.ts
│   │   └── tokenizer.ts
│   ├── vector-store/    # LanceDB wrapper
│   │   └── VectorStore.ts
│   ├── graph/           # SQLite graph database
│   │   └── GraphService.ts
│   ├── events/          # WordPress event processing
│   │   ├── EventProcessor.ts
│   │   └── HttpEventInterface.ts
│   ├── ai-gateway/      # AI credential proxy
│   │   └── AIGateway.ts
│   ├── bulk/            # Bulk operation manager
│   │   └── BulkOperationManager.ts
│   ├── audit/           # Audit logger
│   │   └── AuditLogger.ts
│   └── mcp/             # MCP server + tool modules (111 tools)
│       ├── McpServer.ts
│       ├── tool-registry.ts
│       ├── site-resolver.ts
│       └── modules/
│           ├── content/             # 2 tools
│           ├── site-context/        # 6 tools
│           ├── ollama/              # 4 tools
│           ├── fleet/               # 6 tools
│           ├── site-management/     # 17 tools
│           ├── wp-cli/              # 31 tools
│           ├── wp-connector/        # 12 tools
│           ├── wpe/                 # 13 tools
│           ├── composite/           # 3 tools
│           ├── fleet-intelligence/  # 9 tools
│           └── test-tools/          # 1 tool
└── renderer/
    └── components/
        ├── NexusOverview.tsx          # Fleet dashboard (7 active panels)
        ├── NexusPreferences.tsx       # Addon settings
        ├── SidebarSearchPanel.tsx     # Search integration
        ├── SiteInfoWPE.tsx            # WPE site details
        ├── AIGatewayUsagePanel.tsx    # AI usage tracking
        ├── BulkOperationsPanel.tsx    # Bulk operation progress
        ├── EventTimeline.tsx          # Live event stream
        └── ...
```

## MCP Tools (~111)

| Module | Tools | Description |
|--------|-------|-------------|
| Content | 2 | Semantic search within and across sites |
| Site Context | 6 | Site structure, index status, reindexing |
| Ollama | 4 | Local LLM queries with site context injection |
| Fleet | 6 | Cross-site analysis, drift detection, comparisons |
| Site Management | 17 | Create, start, stop, clone, delete Local sites |
| WP-CLI | 31 | Plugin/theme/user management, local and remote via SSH |
| WP Connector | 12 | AI credential sync, Abilities API discovery and execution |
| WPE | 13 | WP Engine account, install, and sync operations |
| Composite | 3 | Parallel site and plugin audits |
| Fleet Intelligence | 9 | Advanced fleet analytics, health monitoring |
| Test Tools | 1 | Diagnostic tools |

**See:** `docs-site/docs/ai-context/` for user-facing AI context

## Testing

Four-tier test pyramid. See [tests/TESTING-STRATEGY.md](tests/TESTING-STRATEGY.md) for full details.

| Tier | Command | What it tests |
|------|---------|---------------|
| Unit | `npm test` | Code logic with mocked deps (1,226 tests) |
| Eval | `npm run test:eval` | Content quality + LLM tool routing (52 tests) |
| Integration | `npm run test:integration` | Real ONNX, LanceDB, MCP (187 tests) |
| E2E | `npm run test:e2e` | Full addon in running Local (90+ tests) |

LLM evals call Ollama directly to verify the model routes to the correct tools and doesn't hallucinate. They skip automatically when Ollama is not available.

## License

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for runtime dependency licenses.
