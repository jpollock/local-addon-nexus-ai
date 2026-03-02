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

- Semantic search across all site content with relevance scoring
- WooCommerce product extraction (price, SKU, stock, attributes, categories)
- ACF custom field enrichment (text, repeater, group, flexible content)
- Fleet-wide operations across multiple Local sites
- WP-CLI execution on both local and remote WP Engine installs via SSH
- Ollama integration with automatic site context injection
- 3-tier safety system with confirmation tokens for destructive operations
- Per-platform packaging with native binary stripping

## Requirements

- [Local](https://localwp.com/) 9.0.0 or later
- Node.js 20+
- ~200 MB disk space (ONNX model + LanceDB binaries)

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
npm test                       # Run unit tests (450+)
npm run test:integration       # Run integration tests (82+)
npm run test:eval              # Run eval tests (44)
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
├── common/           # Shared types and constants
│   ├── types.ts
│   └── constants.ts
└── main/
    ├── content/      # Extraction and chunking pipeline
    │   ├── ContentPipeline.ts
    │   ├── MySQLExtractor.ts
    │   ├── FileScanner.ts
    │   ├── IndexRegistry.ts
    │   ├── html-cleaner.ts
    │   └── extractors/
    │       ├── WooCommerceExtractor.ts
    │       ├── ACFExtractor.ts
    │       ├── MediaExtractor.ts
    │       └── ...
    ├── embeddings/    # ONNX inference + tokenizer
    │   ├── EmbeddingService.ts
    │   └── tokenizer.ts
    ├── vector-store/  # LanceDB wrapper
    │   └── VectorStore.ts
    └── mcp/           # MCP server + tool modules
        ├── McpServer.ts
        ├── tool-registry.ts
        ├── site-resolver.ts
        └── modules/
            ├── content/          # 2 tools
            ├── site-context/     # 4 tools
            ├── ollama/           # 2 tools
            ├── fleet/            # 6 tools
            ├── site-management/  # 11 tools
            ├── wp-cli/           # 12 tools
            ├── wpe/              # 9 tools
            └── composite/        # 2 tools
```

## MCP Tools (48)

| Module | Tools | Description |
|--------|-------|-------------|
| Content | 2 | Semantic search within and across sites |
| Site Context | 4 | Site structure, index status, reindexing |
| Ollama | 2 | Local LLM queries with site context injection |
| Fleet | 6 | Cross-site analysis, drift detection, comparisons |
| Site Management | 11 | Create, start, stop, clone, delete Local sites |
| WP-CLI | 12 | Plugin/theme/user management, local and remote |
| WPE | 9 | WP Engine account, install, and sync operations |
| Composite | 2 | Parallel site and plugin audits |

## License

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for runtime dependency licenses.
