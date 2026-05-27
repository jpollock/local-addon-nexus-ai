# Nexus AI for Local — WordPress and AI Development, Effortlessly Local

**For developers managing multiple WordPress sites:** Stop checking each site manually. Nexus AI for Local indexes your entire portfolio (running in Local and/or WP Engine) and gives AI assistants real tools to search, audit, and manage your fleet.

## The Problem

You manage 20, 50, 100+ WordPress sites. Every day you ask questions like:

- "Which sites have the Stripe plugin?"
- "Where did I write that SMTP setup guide?"
- "Do all my WooCommerce sites use the same shipping plugin?"
- "Which sites are running WordPress < 6.0?"

The answer? Check each site manually. Open 50 admin panels. Run the same WP-CLI command 50 times. Or worse — guess.

## The Solution

### Nexus AI for Local

Install the addon once. Get unified access to every site (local + WPE) through AI tools, CLI commands, or visual dashboards.

1. **Semantic search** — AI assistants search ALL your sites at once, understanding meaning (not just keywords)
2. **Real control** — Execute WP-CLI commands on local or remote sites, bulk updates, health checks
3. **Local + WPE unified** — Sync WP Engine production sites alongside local dev sites
4. **Safety guardrails** — 3-tier confirmation system prevents accidental destruction

**Result:** Ask Claude "which of my sites need WooCommerce updates?" → Real answer from your actual sites, not generic advice.

## Built for AI-First WordPress Development

Nexus AI brings enterprise-grade AI capabilities to local WordPress development, with production-ready tooling for both Local and WP Engine environments.

### Ship-Ready AI Stack

- **MCP Server** — ~160 tools for AI assistants (Claude Desktop, Cursor, Zed, Continue)
- **CLI** — Terminal commands for local and WPE site management (hosting + WordPress)
- **Open Source AI** — Ships with LanceDB (vector database), ONNX embeddings, and Ollama integration
- **Local AI Gateway** — Centralized credential proxy, usage tracking, and cost monitoring for your entire fleet

### Secure Enterprise Connections

Leverages Local's secure channels to WP Engine:
- **CAPI OAuth2** — Authenticated account and install management
- **SSH ControlMaster** — Persistent, encrypted connections for remote WP-CLI

### AI-Powered Workflows

- **Semantic Search** — Search across all sites simultaneously, understanding meaning (not just keywords)
- **Content Analysis** — Extract insights from WooCommerce products, ACF fields, and custom post types
- **Local LLM Support** — Built-in Ollama integration with automatic site context injection
- **Fleet Intelligence** — Drift detection, health monitoring, plugin usage analytics

### Flexible AI Integration

- **Bring Your Own Key (BYOK)** — Support for Anthropic, OpenAI, and Google LLM APIs
- **Future-Ready** — Designed for WPE AI API Gateway integration
- **One-Click Setup** — Automated WordPress site configuration for AI use (keys, features, plugins)

### Developer Experience

- **Zero Configuration** — Auto-downloads platform-specific addon, auto-activates, just works
- **Cross-Platform** — macOS (ARM64/Intel), Windows, Linux
- **Production Security** — Input validation, audit logging, credential redaction, 3-tier safety system

## Features

- **CLI** — Terminal commands for all operations. Works with any AI that can write shell commands. No MCP setup required. Scriptable, automatable, transparent.
- **MCP Server** — ~160 tools for AI assistants (Claude Desktop, Cursor, etc.)
- **WP Engine Remote Management** — Sync and manage WPE sites alongside local sites (see below)
- **Database Health** — Scans WordPress databases for bloat (revisions, orphaned postmeta with plugin attribution, expired transients, autoload bloat, ghost plugin tables, auto-drafts, trash). Shows a 0–100 health score with advisor-voice recommendations and prevention tips. Safe cleanup via `nexus wp db clean` (dry-run default). Available via site card UI, CLI, and MCP tools. Local-only.
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
- 🔒 **Production Safety** — Production environments are **excluded by default** from WP-CLI commands and content sync. Enable in Preferences → WP Engine → Environment Access.

**Quick Start:**

1. Connect Local to your WP Engine account (Local → Connect → WP Engine)
2. Open Nexus AI Dashboard → **Operations** tab
3. Click **"Sync Now"** under "WP Engine Sites"
4. View synced sites in Dashboard and Site Finder

**Performance:**

- ~6 seconds per site (SSH ControlMaster + 10x concurrency)
- Live progress indicator in Fleet Overview header
- Re-sync anytime to refresh data

**See:** [WPE Remote Management User Guide](docs/WPE_REMOTE_MANAGEMENT_USER_GUIDE.md) for full documentation

## How It Works

Nexus AI indexes your WordPress sites into a local vector database for semantic search. Uses ONNX for embeddings (runs locally, no cloud dependencies) and LanceDB for fast vector search.

**What gets indexed:**
- Posts, pages, products (WooCommerce), custom post types
- ACF custom fields (text, repeater, group, flexible content)
- Site metadata (WordPress version, plugins, themes, users)
- Media (attachments with alt text and captions)

**What doesn't get indexed:**
- Passwords, API keys, user emails, session data (security-first)

**Technical details:** All-MiniLM-L6-v2 model (384-dimensional vectors), sentence-boundary chunking, cosine distance search, post-level deduplication.

## Keyboard Shortcuts

**AI Site Finder:**
- `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux) — Open Site Finder search panel
- `Cmd+Enter` / `Ctrl+Enter` — Submit search query
- `Esc` — Close search panel

**Dashboard:**
- Visual feedback with toast notifications for all operations
- Real-time loading indicators for sync and search operations
- Filter count badges show active search results

## Your Choice For AI Integration

Nexus AI for Local enables two paths for users to take for integrating with their favorite AI application. The Model Context Protocol (MCP) is a common way to hook into AI but Command Line Interfaces (CLI) are equally useful, and often preferred, given that you can interact with the capabilities just like the AI does and use them to do things like create batch scripts, automations, etc.

### CLI

The `nexus` command-line tool gives you direct terminal access to all WordPress fleet operations. Perfect for users who prefer to see exactly what executes, want scriptable automation, or use AI assistants that work through shell commands rather than MCP.

**Why CLI?**

- **Visibility** — See exactly what runs. No AI black box.
- **Universal AI compatibility** — Works with ANY AI that can write shell commands (Claude Code, Aider, ChatGPT, Copilot, etc.)
- **Scriptable** — Use in bash scripts, cron jobs, CI/CD pipelines
- **Composable** — Pipe to `jq`, `grep`, `awk` or chain with other tools
- **Review before execution** — AI suggests commands, you decide to run them

**Quick Start:**

```bash
# List all your sites
nexus sites list

# Search content across all sites
nexus search "WooCommerce shipping configuration"

# Get plugin status on a specific site
nexus wp plugin list --site mysite

# Check which sites need WordPress updates
nexus sites outdated

# Update a plugin across multiple sites
nexus wp plugin update woocommerce --sites "shop,store,demo"
```

**How it works with AI:**

AI assistants can suggest `nexus` commands in their responses. You review and execute them:

```
You: "Which of my sites are running WordPress 6.3?"

Claude Code: "I'll check that for you. Run this command:
nexus sites list --wp-version 6.3

This will show all sites running WordPress 6.3."

[You run the command and see the results]
```

**When to use CLI vs MCP:**
- **CLI** → You want control, visibility, scriptability
- **MCP** → You want autonomous AI execution, conversational workflow

**Available Commands:**
- `nexus sites` — List, filter, and query sites
- `nexus search` — Semantic content search
- `nexus wp` — Execute WP-CLI on local or remote sites
- `nexus wpe` — WP Engine account and install management
- `nexus scan` — Index site content
- `nexus db` — Database operations

See full CLI reference: [CLI Commands](docs-site/docs/cli/commands.md)

### MCP

Nexus AI exposes **~160 MCP tools** for AI assistants to manage WordPress sites. Use with Claude Desktop, Cursor, or any MCP-compatible client.

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
- Node.js 18+
- ~200 MB disk space (ONNX model + LanceDB binaries)
- [Ollama](https://ollama.com/) (optional, for local AI chat)

## Installation

### Automatic Install (Recommended)

Install the CLI, which automatically downloads and installs the addon for your platform:

```bash
# Install CLI globally
npm install -g @local-labs-jpollock/local-addon-nexus-ai

# Verify everything is working
nexus doctor
```

`nexus doctor` checks Local, the addon, MCP server, AI provider, and site configuration — and prints the exact next step for anything that needs attention.

**What the first run does:**
1. CLI detects the addon is missing
2. Prompts: "Download and install addon for macOS (Apple Silicon)? (Y/n)"
3. Downloads the correct platform-specific addon from GitHub Releases
4. Extracts to Local's addon directory
5. Activates the addon automatically
6. Prompts you to restart Local

**After restarting Local, connect your AI agent:**

```bash
nexus mcp setup   # configure Claude Code, Cursor, Claude Desktop, etc.
```

This is the fastest path to value — no API key required.

**Supported platforms:**
- macOS (Apple Silicon) - `darwin-arm64`
- macOS (Intel) - `darwin-x64`
- Windows (64-bit) - `win32-x64`
- Linux (64-bit) - `linux-x64`

The addon includes all dependencies and native modules pre-compiled for your platform (~300 MB compressed).

### Manual Install (Alternative)

If auto-install fails or you prefer manual installation:

1. Download the tarball for your platform from [Releases](../../releases):
   - macOS (Apple Silicon): `nexus-ai-darwin-arm64-{version}.tgz`
   - macOS (Intel): `nexus-ai-darwin-x64-{version}.tgz`
   - Windows: `nexus-ai-win32-x64-{version}.tgz`
   - Linux: `nexus-ai-linux-x64-{version}.tgz`

2. Extract to Local's addon directory:
   ```bash
   # macOS/Linux
   tar -xzf nexus-ai-darwin-arm64-{version}.tgz \
     -C ~/Library/Application\ Support/Local/addons/local-addon-nexus-ai/

   # Windows (PowerShell)
   # Extract to %APPDATA%\Local\addons\local-addon-nexus-ai\
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
npm test                       # Run unit tests (~2,200 tests)
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
│   └── mcp/             # MCP server + tool modules (~160 tools)
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
        ├── NexusOverview.tsx          # Main dashboard (Dashboard/Ask/Tell/Operations/Activity/Settings)
        ├── SettingsTab.tsx            # Sync schedule, auto-index, WPE access controls
        ├── SystemTab.tsx              # Site Status — per-site data level (Scanned/Configured/Searchable)
        ├── ChatTab.tsx                # Ask/Tell AI assistant
        ├── NexusPreferences.tsx       # AI provider, gateway, WPE credentials
        ├── SidebarSearchPanel.tsx     # Site Finder search panel
        ├── FleetCompletenessWidget.tsx # Data Completeness progress bars
        ├── BulkOperationsPanel.tsx    # Bulk operation progress
        ├── AIGatewayPanel.tsx         # AI gateway usage tracking
        ├── EventTimeline.tsx          # Live event stream
        └── ...
```

## MCP Tools (~160)

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

Five-tier test pyramid. See [tests/TESTING-STRATEGY.md](tests/TESTING-STRATEGY.md) for full details.

| Tier | Command | What it tests |
|------|---------|---------------|
| Unit | `npm test` | Code logic with mocked deps (~2,200 tests) |
| Eval | `npm run test:eval` | Content quality + LLM tool routing (52 tests) |
| Integration | `npm run test:integration` | Real ONNX, LanceDB, MCP (187 tests) |
| E2E | `npm run test:e2e` | Full addon in running Local (347 tests) |
| Browser | `npm run test:e2e:browser` | WordPress UI via Playwright (2 tests) |

LLM evals call Ollama directly to verify the model routes to the correct tools and doesn't hallucinate. They skip automatically when Ollama is not available.

Browser tests verify the complete user journey: create content in WP Admin → plugin sends event → Local indexes → content searchable via MCP.

## License

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for runtime dependency licenses.
