# Nexus AI Master Plan

**Last Updated:** 2026-03-05

---

## Source of Truth

**Primary Planning:** `/Users/jeremy.pollock/development/wpengine/flywheel-local/pm-work/`

**Key Documents:**
- `pm-work/local-ai-vision.md` - Strategic vision and positioning
- `pm-work/nexus-ai-implementation-plan.md` - 11-phase implementation plan
- `pm-work/spike-results.md` - Technical validation results
- `pm-work/technical-spikes.md` - Proof of concepts

---

## Strategic Vision

From `pm-work/local-ai-vision.md`:

> **Local as Intelligent AI Host for WordPress Development**
>
> Local's original insight: abstract away painful WordPress infrastructure (nginx, MySQL, PHP, SSL, hosts file) behind something that just *works*.
>
> The next chapter: **AI infrastructure is currently as painful to set up locally as WordPress was in 2012.** Local becomes the tool that makes AI infrastructure invisible too — running on your machine, across your entire fleet of WordPress sites.

### Core Principles

1. **Fleet-aware, not just site-aware** - Intelligence across your entire WordPress practice
2. **Interface-agnostic** - One MCP surface for Claude, Cursor, ChatGPT, etc.
3. **Local-first by default, cloud-connected by choice** - Data stays on your machine
4. **Complementary to WordPress 7** - For developers, not editors

### Tiered Capability Model

- **Tier 1 (Runs everywhere):** Vector DB + MCP Server - No GPU, no cloud, no dependencies
- **Tier 2 (WP Engine Cloud):** LLM access through existing WP Engine account
- **Tier 3 (Local LLM):** On-device inference via Ollama for capable hardware
- **Tier 4 (BYOK):** OpenAI, Anthropic, etc. via Gateway layer

---

## Implementation Status

### Phase Overview (Per pm-work/nexus-ai-implementation-plan.md)

- ✅ **Phase 1: Foundation** - Local addon structure, service container, lifecycle hooks
- ✅ **Phase 2: Content Pipeline** - MySQL extraction, file scanning, embedding generation
- ✅ **Phase 3: MCP Server** - HTTP server, tools, authentication
- ✅ **Phase 4: Deep Content Intelligence** - Vector search, semantic queries, relevance tuning
- ✅ **Phase 5: Richer Structure Layer** - Theme/plugin scanning, ACF fields, structural context
- ✅ **Phase 6: Fleet Intelligence** - Cross-site queries, site comparison, fleet-wide search
- ✅ **Phase 7: Search Quality & MCP-CLI Subsumption** - Deduplication, remote WP-CLI support
- ✅ **Phase 8: Instructions, Resources & Composite Tools** - Server-level guidance, workflow resources
- ✅ **Phase 9: Ollama Integration (Tier 3)** - Local LLM detection, context injection, hardware-aware recommendations
- ⏸️ **Phase 10: Local UI** - Deferred (addon fully functional headless via MCP)
- 🚧 **Phase 11: Polish & Distribution** - Edge cases, packaging, marketplace submission

### Current Phase 11 Status

**Completed:**
- ✅ Edge case testing (Unicode, emoji, CJK, large posts, error recovery)
- ✅ Per-platform packaging (scripts/strip-platforms.sh + package-addon.js)
- ✅ README and THIRD_PARTY_LICENSES
- ✅ 489 unit + 85 integration + 44 eval + 90 E2E tests

**Remaining:**
- UI refinement (if needed based on user feedback)
- Beta testing with real users
- Marketplace submission preparation

---

## WordPress Events System (Context Management)

**Architecture Inspiration:** wp-nexus and ai-native-wordpress-foundation

**Purpose:** Build real-time digital twin of local WordPress sites for AI intelligence

### The Pattern We're Following

```
wp-nexus architecture:
WordPress Sites → wp-event-nexus (ingestion) → wp-twin-nexus (state) → wp-intelligence-nexus (AI)

Our implementation:
WordPress Sites (local) → Event Processor → Graph DB + Vector Store → MCP Tools → AI Clients
```

### Why Events Matter (From pm-work/local-ai-vision.md)

> **Context Management** — what does the AI know about your site, your client, your project; maintained and current

The events system implements this vision:
- **Plugin activations/deactivations** → Track technology stack changes
- **User creation/updates** → Security auditing and access patterns
- **Content changes** → Keep vector embeddings current
- **Site initialization** → Bootstrap context for new sites

### Current Event Coverage

**10 event types tracked:**
- Content: `post_created`, `post_updated`, `post_deleted`
- Plugins: `plugin_activated`, `plugin_deactivated`, `plugin_updated`, `plugin_deleted`
- Users: `user_created`, `user_updated`, `user_deleted`
- Site: `site_initialized`

**Event Flow:**
1. WordPress hooks fire in wp-plugins/nexus-ai-connector/
2. HTTP POST to Local addon (port 13000, Bearer auth)
3. EventProcessor queues and processes asynchronously
4. GraphService updates SQLite knowledge graph
5. VectorStore updates embeddings (for content events)
6. MCP tools expose data to AI clients

**Storage:**
- Graph DB: `~/Library/Application Support/Local/nexus-ai/graph.db`
- Vectors: `~/Library/Application Support/Local/nexus-ai/vectors/`
- Event audit log: `~/Library/Application Support/Local/nexus-ai/audit.log`

**Documentation:** See `docs/implementation-notes/wordpress-events/`

---

## MCP Architecture

**58 MCP tools across 8 modules:**

1. **content** - Vector search, content operations
2. **site-context** - Site metadata, structural information
3. **ollama** - Local LLM integration (Tier 3)
4. **fleet** - Cross-site queries and comparisons
5. **site-management** - Site lifecycle operations
6. **wp-cli** - WordPress CLI operations (local + remote)
7. **wpe** - WP Engine hosting integration
8. **composite** - Multi-operation workflows

**2 composite tools:**
- `nexus_site_audit` - Parallel version+plugins+themes+health+updates
- `nexus_plugin_audit` - Fleet-wide plugin analysis

**6 MCP resources:**
- `nexus://guide/getting-started`
- `nexus://guide/safety`
- `nexus://guide/remote-wp-cli`
- `nexus://workflow/go-live`
- `nexus://workflow/staging-workflow`
- `nexus://workflow/disaster-recovery`

**Server-level instructions:** Embedded in MCP `initialize` response for discovery-first, routing, safety guidance

---

## Testing Strategy

**Test Coverage:**
- 489 unit tests (services, utilities)
- 85 integration tests (service interactions)
- 44 eval tests (instruction/resource quality, <2s, zero LLM cost)
- 90 E2E tests (full MCP workflows)

**Testing Philosophy:**
- Contracts → Tests → Implementation (TDD)
- Real Local environment for E2E (auto-start/stop via setup.ts/teardown.ts)
- Deterministic evals (no LLM calls in test suite)
- Per-platform validation (macOS, Windows, Linux)

**See:** `docs/testing-strategy.md`

---

## Next Steps

### Immediate (This Week)

1. ✅ Clean up root directory (Task #18 - DONE)
2. ✅ Create master planning structure (Task #19 - IN PROGRESS)
3. ⏸️ Reconcile documentation with pm-work vision (Task #20)

### Short-term (This Month)

**Option A: Complete Phase 11 (Recommended)**
- Gather beta user feedback on headless MCP functionality
- Address any critical usability issues
- Prepare marketplace submission
- **Timeline:** 1-2 weeks

**Option B: Build Phase 10 UI (If User Demand)**
- Dashboard showing event stats, recent events, context search
- Storage health visualization
- Event processing controls
- **Timeline:** 2-3 weeks (per docs/phase1-ui-plan.md)

### Decision Point

**Question for stakeholder:** Should we:
1. Ship Phase 11 as-is (headless MCP-only, fully functional)?
2. Build Phase 10 UI before shipping?
3. Something else?

---

## Risk Register

From `pm-work/nexus-ai-implementation-plan.md`:

**Resolved Risks:**
- ✅ Native module compatibility (LanceDB, ONNX Runtime work in Electron)
- ✅ Distribution size (per-platform packages <115MB)
- ✅ Performance on modest hardware (184 docs/sec, <3s full site index)
- ✅ Multi-tenancy security (per-site table isolation)

**Current Risks:**
- **Low:** User adoption without UI (mitigated by MCP-first design)
- **Low:** WordPress plugin auto-installation (validated in testing)
- **Medium:** AI Gateway complexity if built (deferred to post-V1)

---

## Out of Scope (V1)

Per `pm-work/nexus-ai-implementation-plan.md`:

- AI Gateway (unified routing) - Tier 2/3/4 use direct connections
- Multi-site workspace UI - MCP clients provide this
- Advanced analytics dashboards - Can query via MCP
- Mobile companion app - Not needed for developer tool
- WordPress 7 integration - Future collaboration opportunity

---

## Key Links

**Reference Projects:**
- wp-nexus: `/Users/jeremy.pollock/development/wpengine/wp-nexus/`
  - wp-event-nexus - Event ingestion pattern
  - wp-twin-nexus - Digital twin state management
  - wp-intelligence-nexus - AI analysis layer
  - wp-mcp-nexus - MCP tools catalog

- ai-native-wordpress-foundation: `/Users/jeremy.pollock/development/wpengine/ai-native-wordpress-foundation/`
  - Strategic vision for AI-native WordPress
  - Context engineering patterns
  - Project integration approaches

**Documentation:**
- User Guide: `docs/user-guide.md`
- Developer Guide: `docs/developer-guide.md`
- Security: `docs/security.md`
- WordPress Events: `docs/implementation-notes/wordpress-events/`

**Quick Commands:**
```bash
# Build addon
npm run build

# Run tests
npm test

# Check event stats
node scripts/manual-testing/manual-test-check-stats.js

# Demo fleet queries
node scripts/manual-testing/manual-demo-fleet-queries.js
```

---

## Contributors

**Primary:** Jeremy Pollock
**AI Pair:** Claude (Anthropic)

**Last Review:** 2026-03-05
