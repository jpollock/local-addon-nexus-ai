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

- **AI Chat** — Built-in chat interface with streaming responses and tool calling
- **WP Engine Remote Management** — Sync and manage WPE sites alongside local sites (see below)
- Semantic search across all site content with relevance scoring
- WooCommerce product extraction (price, SKU, stock, attributes, categories)
- ACF custom field enrichment (text, repeater, group, flexible content)
- Fleet-wide operations across multiple Local sites
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

## Chat

The Chat tab provides an AI assistant inside Local that can manage your WordPress sites using natural language. It calls the same MCP tools that external clients use — listing sites, checking plugins, running WP-CLI commands, and more.

**Providers:** Ollama (local, default), OpenAI, Anthropic, Google, WPE Gateway

**How it works:**
1. You type a message in the Chat tab
2. The system prompt instructs the model to use tools for real data (never guess)
3. The agent loop streams the response, executes any tool calls, feeds results back to the model, and repeats until done
4. Tier 3 (destructive) tool calls require your approval in the UI before executing

**Setup:** Install [Ollama](https://ollama.com/) and pull a tool-capable model:
```bash
ollama pull llama3.2
```

Configure other providers in Preferences > Nexus AI.

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
npm test                       # Run unit tests (618+)
npm run test:eval              # Run eval tests (52, LLM evals need Ollama)
npm run test:integration       # Run integration tests (82+)
npm run test:e2e               # Run E2E tests (90+, requires Local running)
npm run test:all               # Run all test suites
npm run package:mac-arm        # Package for macOS Apple Silicon
```

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
│   └── chat-types.ts    # Chat message and stream event types
├── main/
│   ├── chat/            # AI chat system (IPC-based)
│   │   ├── ChatService.ts          # Agent loop, system prompt, tool execution
│   │   ├── chat-ipc-handlers.ts    # IPC wiring for renderer communication
│   │   ├── tool-adapter.ts         # Converts MCP tools to chat provider format
│   │   └── providers/              # LLM provider implementations
│   │       ├── ollama.ts           # Ollama (local, default)
│   │       ├── openai.ts           # OpenAI API
│   │       ├── anthropic.ts        # Anthropic API
│   │       ├── google.ts           # Google Gemini API
│   │       └── wpe-gateway.ts      # WP Engine AI Gateway
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
│   └── mcp/             # MCP server + tool modules
│       ├── McpServer.ts
│       ├── tool-registry.ts
│       ├── site-resolver.ts
│       └── modules/
│           ├── content/          # 2 tools
│           ├── site-context/     # 4 tools
│           ├── ollama/           # 2 tools
│           ├── fleet/            # 6 tools
│           ├── site-management/  # 11 tools
│           ├── wp-cli/           # 12 tools
│           ├── wp-connector/     # 3 tools
│           ├── wpe/              # 9 tools
│           └── composite/        # 2 tools
└── renderer/
    └── components/
        ├── ChatTab.tsx             # Chat UI with streaming and tool approval
        ├── NexusPreferences.tsx     # Provider and model configuration
        ├── FleetOverview.tsx        # Fleet dashboard
        └── ...
```

## MCP Tools (51)

| Module | Tools | Description |
|--------|-------|-------------|
| Content | 2 | Semantic search within and across sites |
| Site Context | 4 | Site structure, index status, reindexing |
| Ollama | 2 | Local LLM queries with site context injection |
| Fleet | 6 | Cross-site analysis, drift detection, comparisons |
| Site Management | 11 | Create, start, stop, clone, delete Local sites |
| WP-CLI | 12 | Plugin/theme/user management, local and remote |
| WP Connector | 3 | AI credential sync, Abilities API discovery and execution |
| WPE | 9 | WP Engine account, install, and sync operations |
| Composite | 2 | Parallel site and plugin audits |

## Testing

Four-tier test pyramid. See [tests/TESTING-STRATEGY.md](tests/TESTING-STRATEGY.md) for full details.

| Tier | Command | What it tests |
|------|---------|---------------|
| Unit | `npm test` | Code logic with mocked deps (618+ tests) |
| Eval | `npm run test:eval` | Content quality + LLM tool routing (52 tests) |
| Integration | `npm run test:integration` | Real ONNX, LanceDB, MCP (82+ tests) |
| E2E | `npm run test:e2e` | Full addon in running Local (90+ tests) |

LLM evals call Ollama directly to verify the model routes to the correct tools and doesn't hallucinate. They skip automatically when Ollama is not available.

## License

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for runtime dependency licenses.
