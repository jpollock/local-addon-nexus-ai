# Developer Guide

This guide covers the Nexus AI addon architecture, how to add new tools, the testing strategy, and the build system.

## Architecture

Nexus AI is a Local addon with three layers:

```
Renderer (React)         Main Process (Node.js)         External
┌──────────────┐        ┌─────────────────────┐        ┌───────────┐
│ FleetOverview│──IPC──>│ IPC Handlers        │        │ MCP Client│
│ ChatTab      │        │ ChatService         │        │ (Claude,  │
│ Preferences  │        │ MCP Server ─────────│──HTTP──│  Cursor)  │
└──────────────┘        │   ├─ Tool Registry   │        └───────────┘
                        │   ├─ Safety Layer    │
                        │   ├─ Audit Logger    │
                        │   └─ Modules (9)     │
                        │ Content Pipeline     │
                        │ Embedding Service    │
                        │ Vector Store         │
                        └─────────────────────┘
```

### Startup Sequence

The addon initializes in four phases (see `src/main/index.ts`):

1. **Foundation Services (sync)** — VectorStore, EmbeddingService, ContentPipeline, IndexRegistry
2. **Lifecycle Hooks (sync)** — `siteStarted`, `siteDeleted` hooks with `readyPromise` gate
3. **MCP Server (async)** — Register all tool modules, start HTTP server on port 10800-10899
4. **IPC Handlers (sync)** — Wire up renderer communication for dashboard and chat

A `readyPromise` resolves after VectorStore and EmbeddingService finish async initialization. Lifecycle hooks await this before triggering indexing to prevent race conditions.

### Key Design Decisions

**Lazy service access:** Services are accessed via `svc(name)` from the Awilix container, not eagerly destructured. This avoids resolution errors for services that may not exist in the container.

**LocalServicesBridge:** A typed facade (`src/main/mcp/local-services-bridge.ts`) over Local's raw service container. All tool modules interact with Local through this bridge, never directly with the container.

**Remote SSH:** Remote WP-CLI uses direct `spawn('ssh')` instead of Local's SshService. The bundled SSH binary has path issues on some platforms. The SSH connection pattern is `local+ssh+{installName}@{installName}.ssh.wpengine.net`.

**Composite tools:** Use `Promise.allSettled` for parallel execution with graceful partial-failure handling. A composite tool succeeds even if some sub-operations fail — it reports both successes and failures.

## Directory Structure

```
src/
├── common/                  # Shared types and constants
│   ├── types.ts             # PluginInfo, SiteInfo, etc.
│   ├── constants.ts         # IPC channels, storage keys
│   └── chat-types.ts        # Chat message and stream event types
├── main/
│   ├── index.ts             # Addon entry point and lifecycle
│   ├── ipc-handlers.ts      # IPC handlers for dashboard
│   ├── chat/                # AI chat system
│   │   ├── ChatService.ts   # Agent loop, tool execution
│   │   ├── tool-adapter.ts  # MCP tools -> chat provider format
│   │   └── providers/       # Ollama, OpenAI, Anthropic, Google, WPE
│   ├── content/             # Extraction and chunking pipeline
│   ├── embeddings/          # ONNX inference
│   ├── vector-store/        # LanceDB wrapper
│   └── mcp/                 # MCP server and tools
│       ├── McpServer.ts     # HTTP server, JSON-RPC handling
│       ├── tool-registry.ts # Tool registration and execution
│       ├── safety.ts        # Tier assignments, confirmation tokens
│       ├── site-resolver.ts # Resolve site name/ID/domain to site object
│       ├── local-services-bridge.ts
│       ├── instructions/    # Server instructions and MCP resources
│       │   ├── server-instructions.ts
│       │   └── resources/   # Markdown files served via nexus:// URIs
│       └── modules/         # Tool modules (one directory per module)
│           ├── content/
│           ├── site-context/
│           ├── ollama/
│           ├── fleet/
│           ├── site-management/
│           ├── wp-cli/
│           ├── wp-connector/
│           ├── wpe/
│           └── composite/
└── renderer/
    └── components/          # React components (class-based)
        ├── FleetOverview.tsx
        ├── ChatTab.tsx
        └── NexusPreferences.tsx
```

## Adding a New Tool

### 1. Create the tool handler

Create a file in the appropriate module under `src/main/mcp/modules/`. Follow the existing pattern:

```typescript
// src/main/mcp/modules/my-module/my-tool.ts
import type { ToolRegistry } from '../../tool-registry';

export function registerMyTool(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'my_tool_name',
      description: 'What this tool does — one sentence for the AI agent',
      inputSchema: {
        type: 'object',
        properties: {
          site: {
            type: 'string',
            description: 'Site name, ID, or domain',
          },
          // ... other parameters
        },
        required: ['site'],
      },
      // Optional: hide tool when prerequisites are missing
      isAvailable: (services) => !!services.localServices,
    },
    execute: async (args, services) => {
      const { site } = args as { site: string };
      const localServices = services.localServices!;

      // Resolve site name to ID
      const resolved = await localServices.resolveSiteObject(site);

      // Do the work
      const result = await localServices.wpCliRun(resolved.id, ['...']);

      return {
        content: [{ type: 'text', text: `Result: ${result.stdout}` }],
      };
    },
  });
}
```

### 2. Register in the module index

```typescript
// src/main/mcp/modules/my-module/index.ts
import type { ToolRegistry } from '../../tool-registry';
import { registerMyTool } from './my-tool';

export function registerMyModuleTools(registry: ToolRegistry): void {
  registerMyTool(registry);
}
```

### 3. Register in the main entry point

```typescript
// src/main/index.ts
import { registerMyModuleTools } from './mcp/modules/my-module/index';
// ...
registerMyModuleTools(toolRegistry);
```

### 4. Assign a safety tier

If your tool modifies state, add it to `TIER_OVERRIDES` in `src/main/mcp/safety.ts`:

```typescript
export const TIER_OVERRIDES: Record<string, TierConfig> = {
  // ...
  my_tool_name: { tier: 2 },
  // For destructive tools:
  my_dangerous_tool: {
    tier: 3,
    warning: 'This will permanently delete everything.',
    preChecks: ['Verify you have a backup'],
  },
};
```

Tools not in `TIER_OVERRIDES` default to Tier 1 (read-only).

### 5. Update server instructions

Add the tool to the routing table in `src/main/mcp/instructions/server-instructions.ts` so AI agents know when to use it.

### 6. Write tests

At minimum:
- **Unit test** in `tests/main/` — test the handler logic with mocked services
- **Integration test** — add a spot-check to `tests/integration/04-tool-registry-live.integration.test.ts`
- **Eval test** — if the tool appears in server instructions, add a check to `tests/eval/instructions-quality.test.ts`

## Adding a New Module

1. Create `src/main/mcp/modules/<module-name>/index.ts` with a `registerXxxTools(registry)` function
2. Create individual tool files in the module directory
3. Call the register function from `src/main/index.ts`
4. Update the tool count in README.md and add the module to the architecture tree

## Testing

Four-tier test pyramid. See `tests/TESTING-STRATEGY.md` for the full guide.

### Unit Tests (`tests/main/`)

Standard Jest with mocked dependencies. Fast and deterministic.

```bash
npm test                          # Run all unit tests
npm test -- --testPathPattern=wp-connector  # Run specific test file
npm test -- --watch               # Watch mode
```

Key patterns:
- Mock `LocalServicesBridge` for tool handler tests
- Mock `wpCliRun` to return expected stdout
- Use `createMockBridge()` helpers for consistent mock setup

### Eval Tests (`tests/eval/`)

Two categories:

- **Deterministic evals** — Validate instruction and resource quality without LLM calls
- **LLM evals** — Call Ollama to verify tool routing and anti-hallucination. Skip when Ollama is unavailable.

```bash
npm run test:eval
```

### Integration Tests (`tests/integration/`)

Real ONNX model, real LanceDB, real MCP protocol.

```bash
npm run download-model            # Required first
npm run test:integration
```

### E2E Tests (`tests/e2e/`)

Full addon running in a real Local instance. Tests numbered `01-` through `15-` and run sequentially.

```bash
npm run test:e2e                  # Requires Local running with the addon
```

Setup/teardown manages the Local app lifecycle. Tests use a thin MCP HTTP client (`helpers/client.ts`) and environment discovery (`helpers/environment.ts`).

## Build System

```bash
npm run build      # Clean + compile TypeScript + create entry points + copy markdown resources
npm run watch      # TypeScript watch mode (no entry point creation)
npm run clean      # Remove lib/ directory
```

The build has a post-compile step (`scripts/create-entry-points.js`) that:
1. Creates `lib/main.js` and `lib/renderer.js` entry points
2. Copies markdown resource files from `src/` to `lib/` (TypeScript doesn't copy `.md` files)

### Packaging

Platform-specific packaging strips unused native binaries (ONNX, LanceDB) to reduce addon size:

```bash
npm run package:mac-arm    # macOS Apple Silicon
npm run package:mac-x64    # macOS Intel
npm run package:linux-x64  # Linux x64
npm run package:win-x64    # Windows x64
```

The `scripts/strip-platforms.sh` script removes binaries for other platforms. The `scripts/package-addon.js` script creates the distributable tarball.

GitHub Actions workflow automates packaging for all platforms on release.

## Code Style

- TypeScript with CommonJS modules and ES2020 target
- No `.spec.ts` convention — all tests use `.test.ts`
- Class-based React components in the renderer (Local uses older React patterns)
- Zod for runtime schema validation in tool handlers
- Error results use `{ content: [{ type: 'text', text: message }], isError: true }`
