# CLAUDE.md

This file provides guidance to Claude Code when working with the Nexus AI Local addon.

---

## Project Vision

**This addon implements Tier 1 foundation from `pm-work/local-ai-vision.md`:**

> **Local as Intelligent AI Host for WordPress Development**
>
> Local's original insight: abstract away painful WordPress infrastructure (nginx, MySQL, PHP, SSL, hosts file) behind something that just *works*.
>
> The next chapter: **AI infrastructure is currently as painful to set up locally as WordPress was in 2012.** Local becomes the tool that makes AI infrastructure invisible too — running on your machine, across your entire fleet of WordPress sites.

**Positioning Shift:**
> Local made WordPress easy to work with on one's computer.
> Local will now make WordPress *and AI* easy to work with on one's computer.

### Core Principles

1. **Fleet-aware, not just site-aware** - Intelligence across entire WordPress practice
2. **Interface-agnostic** - MCP as universal adapter for any AI client (Claude, Cursor, ChatGPT)
3. **Local-first by default, cloud-connected by choice** - Data and models stay on your machine
4. **Complementary to WordPress 7** - For developers and builders, not site editors

### Tiered Capability Model

**Tier 1 — Runs everywhere (IMPLEMENTED):**
- Vector DB (LanceDB) and MCP server
- Lightweight, no GPU required, works on any machine Local supports
- Bundled CPU-based embedding model (all-MiniLM-L6-v2, 22MB, ~90MB in memory)
- Semantic search works out of the box without API calls or cloud dependency

**Tier 2 — WP Engine Cloud AI Gateway (FUTURE):**
- LLM access through existing WP Engine account
- Same gateway in local dev and production

**Tier 3 — Local LLM via Ollama (IMPLEMENTED):**
- On-device inference for capable hardware
- Addon detects Ollama at localhost:11434/api/tags
- Hardware-aware model recommendations based on RAM

**Tier 4 — Bring your own API keys (FUTURE):**
- OpenAI, Anthropic, etc. via Gateway layer

---

## Strategic Context

From `pm-work/local-ai-vision.md` and `pm-work/nexus-ai-implementation-plan.md`:

### The Mental Model: Local as Intelligent Multi-Site AI Host

Not just a dev tool. A **host** running on your machine that is intelligent about your entire WordPress practice. Key properties:

- **Fleet-aware** - Knows about all sites, not just one
- **Interface-agnostic** - Doesn't care if you talk to it through Local UI, Claude Code, Cursor, or WP Admin
- **Local-first** - Data and models stay on your machine unless you choose otherwise

### The AI Infrastructure Stack

**Infrastructure (IMPLEMENTED):**
- Vector DB - Local semantic search over WordPress content, ACF fields, site data
- Local LLM - Optional on-device models via Ollama

**Connectivity (IMPLEMENTED):**
- MCP Server - Exposes entire fleet as MCP surface for AI clients
- AI Gateway - Unified routing (FUTURE - Tier 2/4)

**Capabilities (IMPLEMENTED):**
- 58 MCP tools across 8 modules
- 2 composite tools (multi-operation workflows)
- 6 MCP resources (workflow guides)

**Intelligence (IMPLEMENTED):**
- **Context Management** - Real-time WordPress event tracking (plugins, users, content)
- **Digital Twin Pattern** - Graph database maintaining site state
- Observability - Event audit logs

---

## WordPress Events System

**Architecture Inspiration:** wp-nexus and ai-native-wordpress-foundation

The event tracking system implements the **"Context Management"** pillar from the vision:

> **Context Management** — what does the AI know about your site, your client, your project; maintained and current

### Pattern We're Following

From wp-nexus (multi-service WordPress intelligence platform):
```
WordPress Sites → wp-event-nexus (ingestion) → wp-twin-nexus (state) → wp-intelligence-nexus (AI)
```

Our local implementation:
```
WordPress Sites (local) → Event Processor → Graph DB + Vector Store → MCP Tools → AI Clients
```

### Why Events Are Core to the Vision

Events build the **digital twin** of local WordPress sites - the real-time state that enables:

- **Fleet Intelligence** - Cross-site patterns, problems, insights
- **Proactive Management** - Detect issues before they escalate
- **AI Context** - Keep AI clients informed about actual site state
- **Security Auditing** - Track user changes, plugin activations
- **Content Freshness** - Update vector embeddings when posts change

### Event Types Tracked

**10 event types across 4 categories:**

1. **Content:** post_created, post_updated, post_deleted
2. **Plugins:** plugin_activated, plugin_deactivated, plugin_updated, plugin_deleted
3. **Users:** user_created, user_updated, user_deleted
4. **Site:** site_initialized

### Event Flow

1. WordPress hooks fire in `wp-plugins/nexus-ai-connector/`
2. HTTP POST to Local addon (port 13000, Bearer auth)
3. EventProcessor queues event (non-blocking response)
4. Background processing updates GraphService + VectorStore
5. MCP tools expose updated state to AI clients

**Storage:**
- Graph DB: `~/Library/Application Support/Local/nexus-ai/graph.db` (SQLite)
- Vectors: `~/Library/Application Support/Local/nexus-ai/vectors/` (LanceDB per-site tables)

**Implementation Docs:** See `docs/implementation-notes/wordpress-events/`

---

## Architecture Overview

### Data Flow: Indexing

```
Site starts (siteStarted hook)
       ↓
FileScanner.scan(site)
  - Reads wp-content/themes/*, plugins/*
  - Produces: ThemeInfo[], PluginInfo[]
       ↓
MySQLExtractor.extract(site)
  - Connects via socket
  - Queries: wp_posts, wp_postmeta, wp_options
  - Produces: Document[] (with HTML stripped)
       ↓
EmbeddingService.embedBatch(documents)
  - ONNX Runtime session
  - 384-dim vectors, 5ms/doc
       ↓
VectorStore.upsert(siteId, documents)
  - LanceDB table: site_{siteId}_content
       ↓
IndexRegistry.update(siteId, stats)
```

### Data Flow: MCP Search Query

```
AI Client → MCP tools/call: search_site_content
       ↓
McpServer.handleToolCall()
  - Validates input, resolves site
       ↓
EmbeddingService.embed(query)
  - Single embedding, ~5ms
       ↓
VectorStore.search(siteId, queryVector)
  - LanceDB vector similarity
       ↓
Format response with context
```

### Data Flow: WordPress Event

```
WordPress Admin UI (user activates plugin)
       ↓
WordPress Hook: activated_plugin
       ↓
nexus-ai-connector plugin
       ↓ (HTTP POST with Bearer token)
HttpEventInterface (port 13000)
       ↓ (enqueue event, respond 200 OK)
EventProcessor (background)
       ↓
GraphService → SQLite graph.db
  - Updates plugins table
       ↓
MCP Tools → expose updated data
       ↓
Claude/AI clients (see new plugin state)
```

---

## Development Workflow

### Essential Commands

```bash
# Build addon
npm run build

# Run tests
npm test                # All tests
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
npm run test:eval       # Eval tests (instruction quality)
npm run test:e2e        # E2E tests (requires Local running)

# Manual testing
node scripts/manual-testing/manual-test-check-stats.js
node scripts/manual-testing/manual-demo-fleet-queries.js
node scripts/manual-testing/manual-reinstall-plugin.js
```

### Project Structure

```
src/
├── main/                      ← Addon backend (Electron main process)
│   ├── events/                ← Event processor, graph service
│   │   ├── EventProcessor.ts
│   │   ├── GraphService.ts
│   │   ├── HttpEventInterface.ts
│   │   └── types.ts
│   ├── mcp/                   ← MCP server and tools
│   │   ├── McpServer.ts
│   │   ├── tools/             ← 58 tools across 8 modules
│   │   ├── resources/         ← 6 workflow guide resources
│   │   └── instructions/      ← Server-level guidance
│   ├── vector/                ← LanceDB + ONNX embeddings
│   │   ├── VectorStore.ts
│   │   ├── EmbeddingService.ts
│   │   └── LanceDBService.ts
│   └── services/              ← Core addon services
│       ├── MySQLExtractor.ts
│       ├── FileScanner.ts
│       └── OllamaService.ts
├── renderer/                  ← UI components (Phase 10 - deferred)
├── common/                    ← Shared types, constants
└── wp-plugins/
    └── nexus-ai-connector/    ← WordPress plugin (event sender)
```

### Key Files to Know

**Planning & Vision:**
- `MASTER_PLAN.md` - Strategic roadmap, phase status, references to pm-work
- `STATUS.md` - Current state, metrics, next steps
- `pm-work/local-ai-vision.md` - Original strategic vision
- `pm-work/nexus-ai-implementation-plan.md` - 11-phase implementation plan

**User Docs:**
- `README.md` - User-facing documentation
- `docs/user-guide.md` - How to use the addon
- `docs/security.md` - Security model

**Developer Docs:**
- `docs/developer-guide.md` - Development setup and patterns
- `docs/testing-strategy.md` - Test philosophy and structure
- `docs/wp-connector.md` - WordPress plugin architecture

**Implementation Notes:**
- `docs/implementation-notes/wordpress-events/` - Event system completion notes

---

## Testing Philosophy

From `docs/testing-strategy.md`:

1. **Contracts → Tests → Implementation (TDD)**
2. **Real Local environment** for E2E (auto-start/stop)
3. **Deterministic evals** - No LLM calls in test suite (<2s per eval)
4. **Per-platform validation** - macOS, Windows, Linux

**Test Counts:**
- 489 unit tests
- 85 integration tests
- 44 eval tests
- 90 E2E tests

---

## Reference Projects

**These projects inspired our architecture:**

### wp-nexus (`/Users/jeremy.pollock/development/wpengine/wp-nexus/`)

Multi-service WordPress intelligence platform:
- **wp-event-nexus** - Event ingestion pattern we follow
- **wp-twin-nexus** - Digital twin state management
- **wp-intelligence-nexus** - AI analysis layer
- **wp-mcp-nexus** - MCP tools catalog

Key insight: Fast/Slow intelligence architecture
- Fast (<200ms): Rule-based, real-time
- Slow (minutes/hours): AI analysis, cross-site patterns

### ai-native-wordpress-foundation (`/Users/jeremy.pollock/development/wpengine/ai-native-wordpress-foundation/`)

Strategic vision for AI-native WordPress:
- Context engineering patterns
- Project integration approaches
- Agent-native architecture

---

## Current Phase: 11 (Polish & Distribution)

**Status:** In progress

**Completed:**
- ✅ Edge case testing (Unicode, emoji, CJK, large posts)
- ✅ Per-platform packaging
- ✅ README and licenses
- ✅ 708 total tests passing

**Remaining:**
- UI refinement (if needed based on feedback)
- Beta testing with real users
- Marketplace submission

**Decision Point:** Ship as headless MCP-only vs. build Phase 10 UI first

---

## Phase 10: Local UI (Deferred)

**Original Plan:** Dashboard in Local showing:
- Event statistics
- Recent events timeline
- Context search interface
- Storage health metrics

**Status:** Deferred - addon is fully functional via MCP

**Detailed Plan:** `docs/phase1-ui-plan.md` (32 tests, 10-13 day timeline)

**Rationale:** MCP-first design means UI is nice-to-have, not blocker. Can build post-V1 based on user demand.

---

## Important Patterns

### Service Container (Awilix)

**Access pattern:**
```typescript
// ✅ CORRECT - Lazy access from container
const getSiteData = () => serviceContainer.cradle.siteData;

// ❌ WRONG - Eager destructuring (may not exist yet)
const { siteData } = serviceContainer.cradle;
```

**Why:** Services may not be resolved at import time. Access lazily.

### Lifecycle Hooks

```typescript
export function onReady(readyPromise: Promise<void>) {
  // Wait for addon services to initialize
  await readyPromise;
  // Now safe to use services
}
```

**Why:** Addon services (embeddings, MCP server) initialize asynchronously. Wait for readyPromise.

### Local Services Bridge

```typescript
import { LocalServicesBridge } from './services/LocalServicesBridge';

const bridge = new LocalServicesBridge(serviceContainer);
const sites = bridge.getSites();
```

**Why:** Typed facade over raw service container. Safer than direct access.

### Remote WP-CLI Pattern

**Local execution:**
```typescript
wp_plugin_list({ site: 'mysite' })  // Uses `lwp` via Local's binaries
```

**Remote WPE execution:**
```typescript
wp_plugin_list({ install_name: 'mysiteprod' })  // SSH to WPE
```

**SSH pattern:** Direct `spawn('ssh')`, NOT Local's SshService (bundled SSH binary has issues)

**Install resolution:** site.hostConnections[].remoteSiteId → CAPI getInstallList() → install name

---

## Common Tasks

### Adding a New MCP Tool

1. Create tool file in `src/main/mcp/tools/<module>/`
2. Define schema and handler
3. Register in module's `index.ts`
4. Add unit tests in `tests/unit/mcp/tools/<module>/`
5. Add integration test in `tests/integration/`
6. Add E2E test if complex workflow

### Adding a New Event Type

1. Add to `EventType` union in `src/main/events/types.ts`
2. Add WordPress hook in `wp-plugins/nexus-ai-connector/nexus-ai-connector.php`
3. Add event builder in `wp-plugins/nexus-ai-connector/includes/class-event-builder.php`
4. Add processor in `src/main/events/EventProcessor.ts`
5. Update GraphService if new entity type
6. Add tests

### Testing WordPress Events

**Via Admin UI (real hooks):**
1. Go to http://nexus-e2e-test.local/wp-admin
2. Perform action (activate plugin, create user)
3. Check stats: `node scripts/manual-testing/manual-test-check-stats.js`

**Via wp_eval (manual hook triggering):**
```javascript
const phpCode = `do_action('activated_plugin', 'plugin-slug/plugin.php', false);`;
// Use wp_eval MCP tool
```

**Note:** WP-CLI doesn't fire hooks (performance optimization). Always test via Admin UI or wp_eval.

---

## Key Principles

1. **TDD Always** - Write tests before implementation
2. **Contracts First** - Define interfaces before code
3. **Real Testing** - Use real Local environment for E2E, not mocks
4. **Documentation** - Update MASTER_PLAN.md and STATUS.md when completing phases
5. **Vision Alignment** - Check pm-work docs before major decisions
6. **Reference Projects** - Learn from wp-nexus and ai-native-wordpress-foundation patterns

---

## Quick Reference

**Master Plan:** See `MASTER_PLAN.md` for phases, vision, and roadmap
**Current State:** See `STATUS.md` for metrics, commands, and next steps
**Vision:** See `pm-work/local-ai-vision.md` for strategic context
**Implementation:** See `pm-work/nexus-ai-implementation-plan.md` for phase details
**Testing:** See `docs/testing-strategy.md` for test philosophy

---

**Last Updated:** 2026-03-05

## Native Modules & Electron

**Critical:** This addon uses `better-sqlite3`, a native Node.js module that must be compiled for the correct Node.js version.

**The Issue:**
- **Tests** run with system Node.js (NODE_MODULE_VERSION 127)
- **Local** runs with Electron's Node.js (NODE_MODULE_VERSION 136)
- Native binaries compiled for one won't work in the other

**If you see:** `Error: The module 'better_sqlite3.node' was compiled against a different Node.js version...`

**Quick Fix:**
```bash
# For tests (system Node):
npm run prepare:electron

# For Local (Electron Node):
npm run rebuild:electron
```

**See:** `docs/NATIVE_MODULES.md` for complete troubleshooting guide.

**During Development:**
- Tests work out of the box (use system Node)
- Testing in Local may require rebuild
- Local's build process should auto-rebuild when packaging

**For CI/CD:**
- Tests use system Node (no special handling)
- E2E in Local requires electron-rebuild
- Separate builds per platform (macOS, Windows, Linux)

