# Technical Spikes: Local AI Add-on

**Context:** These spikes validate assumptions in `local-ai-vision.md` that could change the architecture, delivery vehicle, or first release scope. Each spike has a clear question, a suggested approach, and success criteria. They should be run before committing to a V1 plan.

**Codebase references:**
- Local core: `flywheel-local`
- MCP addon: `local-addon-cli-mcp`
- Architecture doc: `pm-work/lightning-services-architecture.md`

---

## Architectural Constraint: The Addon Process Model

A critical fact that shapes all spike decisions: **Local add-ons run inside Electron's main process.** The addon loader (`AddonLoaderService.ts:273`) uses `require()` to load addon code directly into the main Node.js runtime. The MCP addon is not a separate process — it's library code running in the same process as site management, GraphQL, and IPC.

This means:
- **Embedded Node.js libraries (LanceDB, ONNX Runtime, SQLite-VSS) add zero additional processes.** They execute as function calls within the existing Electron process.
- **The "always on when Local is running" vision costs zero additional OS processes** if Tier 1 infrastructure is fully embedded.
- **Multitenancy is the natural model.** One vector DB instance serves all sites through per-site collections/namespaces. One embedding model loaded once, shared across all indexing operations.
- **External binary processes are only needed for Tier 3 (Ollama).** This cleanly separates the Tier 1 architecture (embedded, lightweight, zero processes) from the Tier 3 architecture (managed external binary, GPU access, heavy resources).

The resource picture with an embedded Tier 1:
```
Without AI addon:
  Electron main process (~300-500MB)
    └── manages PHP, MySQL, Nginx per site

With AI addon (embedded Tier 1):
  Electron main process (~400-650MB)
    └── same as above
    └── + embedding model weights in memory (~80MB)
    └── + vector DB library (disk-backed, ~10-50MB active memory)
    └── + MCP server (already exists, negligible)
    └── additional OS processes: 0
    └── CPU cost: only during indexing/querying, idle otherwise
```

This framing drives the spike design: **Tier 1 spikes evaluate embedded, in-process solutions. Tier 3 spikes evaluate external binary management. These are separate concerns with separate risk profiles.**

---

## Spike 1: Embedded Vector DB + Multitenancy

### Question
Which embedded vector store runs well inside Electron's main process, supports per-site collection isolation, and handles the scale of a typical Local fleet (5-30 sites, hundreds to thousands of documents per site)?

### Why This Matters
This is the foundation of Tier 1. An embedded vector store means zero additional processes, zero binary distribution concerns, and the "always on" promise is essentially free. But it must work reliably inside Electron's main process without blocking the event loop, handle multiple sites' data with proper isolation, and query fast enough for interactive use via MCP.

### Candidates

**LanceDB**
- Rust core with Node.js bindings via NAPI. Embedded, no server.
- Disk-backed columnar storage — data lives on disk, only active queries consume significant memory.
- Per-table isolation: create `site_{siteId}_posts`, `site_{siteId}_pages` tables.
- Metadata filtering: query with `WHERE site_id = 'x' AND post_type = 'page'`.
- Active development, backed by LanceDB Inc.
- Native bindings mean platform-specific `.node` files (macOS Intel, ARM, Windows, Linux).

**SQLite-VSS**
- Vector search extension for SQLite via `better-sqlite3`.
- Single file per site or one DB with `site_id` column.
- SQLite is synchronous by default — may block the event loop during large queries.
- Familiar technology, battle-tested storage layer.
- Extension distribution requires native binaries per platform.

**Vectra**
- Pure TypeScript, no native dependencies. File-based JSON storage.
- Simplest to distribute — no platform-specific binaries at all.
- Loads entire index into memory — doesn't scale well beyond a few thousand documents per collection.
- Limited query filtering, basic nearest-neighbor search.
- Good for prototyping, may need replacement at scale.

### Evaluation Criteria
| Criteria | Weight | Notes |
|----------|--------|-------|
| Runs in-process (no separate binary) | Required | The whole point of embedded |
| Non-blocking / async-safe | High | Must not freeze Local's UI via event loop blocking |
| Per-site collection isolation | High | Fleet-wide instance, per-site namespaces |
| Disk-backed (not all in memory) | High | 15 sites with 500 posts each = 7,500 docs; must not require all in RAM |
| Metadata filtering | High | Filter by site_id, post_type, date, etc. |
| Cross-platform native bindings | Medium | If native, must support macOS Intel, ARM, Windows, Linux |
| No native bindings (pure JS) | Bonus | Eliminates platform-specific distribution entirely |
| Query latency < 100ms | High | Interactive use via MCP |
| Maturity / maintenance | Medium | Active project, not abandoned |

### Suggested Approach
1. Build a Node.js test harness that simulates the addon environment (single process, shared event loop)
2. For each candidate: create 15 site collections, insert 500 embeddings per site (7,500 total) with metadata (site_id, post_type, post_id, title), run semantic queries with metadata filters, measure query latency, memory usage, and event loop lag
3. Test concurrent operations: index one site while querying another — does it block?
4. Measure cold start: how long to open/initialize the vector store when the addon loads?
5. Measure disk footprint for 7,500 documents with 384-dimensional embeddings

### Success Criteria
- At least one candidate: works embedded in Node.js, supports 15-site multitenancy, queries return in < 100ms, does not block the event loop during indexing, disk footprint under 100MB for 7,500 documents

### Risk If This Fails
No embedded option meets the requirements. Fallback: use a standalone vector DB server (Qdrant), which pushes binary management back into Tier 1 scope and adds a process. Alternatively, start with Vectra (simplest, pure JS) accepting its scale limitations, plan to migrate.

---

## Spike 2: CPU Embedding Performance in Electron

### Question
Can a bundled CPU-based embedding model run inside Electron's main process (via ONNX Runtime Node.js bindings), generating embeddings fast enough for background indexing without degrading Local's responsiveness?

### Why This Matters
Tier 1 claims embeddings are generated locally with no GPU and no cloud dependency. This model runs *in the same process* as Local's UI, site management, and GraphQL server. If embedding generation blocks the event loop or consumes so much CPU that Local becomes sluggish, the UX breaks. The spike must validate both raw performance and in-process coexistence.

### Suggested Approach
1. Set up `all-MiniLM-L6-v2` (384 dimensions) with `onnxruntime-node` in a Node.js script that simulates shared-process conditions
2. Prepare test corpus: 100, 500, and 2000 WordPress posts (title + content, HTML stripped, average ~500 words per post)
3. Measure raw performance: time to embed each corpus, per-document latency, peak memory
4. Measure event loop impact: run embedding generation while simultaneously handling HTTP requests (simulating MCP server activity) — measure request latency degradation
5. Test batching strategies: embed 1 doc at a time vs. batches of 10/50 — what's the throughput/responsiveness tradeoff?
6. Test on: MacBook Air M1 (8GB), MacBook Pro M2/M3 (16GB), older Intel Mac if available
7. Measure total disk footprint: `onnxruntime-node` package + model file

### Metrics to Capture
| Metric | Target | Unacceptable |
|--------|--------|-------------|
| Per-document embedding latency | < 50ms | > 200ms |
| Time to index 500 posts | < 30 seconds | > 2 minutes |
| Event loop lag during indexing | < 50ms p99 | > 200ms (UI would feel frozen) |
| Peak memory for model + runtime | < 200MB | > 500MB |
| Disk footprint (runtime + model) | < 150MB | > 300MB |

### Success Criteria
- 500 posts indexed in under 60 seconds on M1 MacBook Air with < 50ms event loop lag
- Total addon size increase (runtime + model) under 200MB
- Background indexing does not noticeably affect Local's UI responsiveness or MCP server latency

### Risk If This Fails
Several fallback options, not all mutually exclusive:
- **Background worker thread:** Move embedding to a Node.js `worker_threads` — still in-process, no new OS process, but off the main event loop. Adds complexity but solves the blocking problem.
- **Deferred indexing:** Index only when the machine is idle (low CPU), or only index on explicit user action.
- **Cloud fallback:** Tier 1 ships the vector DB structure but embeddings require Tier 2 (WPE cloud) or Tier 3 (Ollama). Tier 1 becomes "semantic search ready" rather than "semantic search working."
- **Smaller model:** Use a lighter model (e.g., `all-MiniLM-L6-v2` is already small; `gte-tiny` is smaller but lower quality).

---

## Spike 3: WordPress Content Extraction

### Question
What is the most reliable and practical way to extract structured content from a Local WordPress site for vector indexing, and what content is worth indexing?

### Why This Matters
The vector DB is only as useful as what's in it. WordPress content lives in `wp_posts` (with serialized block markup, shortcodes, and HTML), `wp_postmeta` (ACF fields, custom fields), `wp_options`, and potentially custom tables from plugins. The extraction method determines what the system can index, when indexing happens (site must be running?), and how it handles the diversity of WordPress data structures across sites.

### Suggested Approach
Test three extraction methods against the same site:

**Method A: WP-CLI**
```bash
wp post list --post_type=post,page --fields=ID,post_title,post_content,post_excerpt --format=json
wp post meta list <id> --format=json
```
- Pros: respects WordPress filters, handles shortcode expansion, standard tooling, already available via the addon's `wpCli` service
- Cons: site must be running, slower for bulk extraction

**Method B: Direct MySQL query**
```sql
SELECT ID, post_title, post_content, post_status, post_type FROM wp_posts WHERE post_status = 'publish';
SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN (...);
```
- Pros: fast, doesn't require site to be running (if MySQL is up), bulk extraction
- Cons: raw HTML/block markup, no shortcode expansion, must parse Gutenberg block comments, need to know table prefix

**Method C: mu-plugin REST endpoint**
Inject a mu-plugin (Local already uses `auto_prepend_file` for this pattern) that exposes a REST endpoint returning cleaned, structured content.
- Pros: full WordPress context, renders content through WordPress's pipeline, custom field resolution
- Cons: requires site to be running, adds code to the site, security surface

For each method, evaluate:
1. Content quality: is the extracted text useful for semantic search, or full of markup noise?
2. ACF/custom field handling: can it access structured field data?
3. Block content: Gutenberg blocks are stored as HTML comments with JSON attributes — does the method handle this?
4. Performance: time to extract 500 posts
5. Dependency: does the site need to be running?

### Success Criteria
- Identify one method (or combination) that produces clean, searchable text from post content, page content, and custom fields
- Document what content types are indexable and what gets lost
- Confirm the method works across a vanilla WordPress site and a site with ACF/custom plugins

### Risk If This Fails
Content extraction is too noisy or too slow for a good search experience. Mitigation: start with a narrower scope (posts and pages only, title + excerpt, skip custom fields in V1) and expand later.

---

## Spike 4: Ollama Integration Model

### Question
Should the add-on bundle and manage Ollama as a binary, detect and integrate with an existing Ollama install, or offer a hybrid approach? This is a Tier 3 concern — it is the only component in the vision that requires an external process.

### Why This Matters
With Tier 1 fully embedded (Spikes 1-3), Ollama is the *only* reason the addon would need to manage an external binary process. This cleanly separates the architectural question: Tier 1 is in-process and lightweight; Tier 3 is where external process management, GPU access, and heavy resource usage live.

Ollama has properties that differ from other services:
- Many developers already have it installed (~20M+ downloads)
- It manages its own model downloads (4-30GB per model) — a fundamentally different distribution problem than shipping an 80MB embedding model
- It needs GPU access for reasonable inference performance
- It has its own process lifecycle (often runs as a background service via `brew services` or launchd)
- Its REST API is already a de facto standard (`localhost:11434`)

### Three Approaches to Evaluate

**A. Detect and integrate (light touch)**
The addon checks if Ollama is already running at `localhost:11434` or installed at known paths (`/usr/local/bin/ollama`, `~/.ollama/`). If found, it connects. If not, it surfaces a message: "Install Ollama for local AI features" with a link.
- Pros: no binary management, no GPU complexity, respects user's existing setup, zero additional processes from addon
- Cons: not "effortless" — user must install Ollama separately, addon can't guarantee it's running
- Precedent: how VS Code handles Docker, Git, and other external tools

**B. Bundle and manage (full control)**
The addon downloads the Ollama binary on first use, manages it as a fleet-wide process (like the Router), handles model downloads.
- Pros: fully effortless, addon controls everything
- Cons: Ollama is ~100MB+, models are 4-30GB, GPU passthrough from a spawned process needs testing, duplicates existing installs, complex update management
- Precedent: how Local manages Lightning Services binaries (PHP, MySQL, Nginx)

**C. Hybrid (detect, offer to manage)**
Check for existing Ollama first. If found, integrate with it. If not found, offer to install and manage it. User can switch between addon-managed and self-managed at any time.
- Pros: respects existing setups, still effortless for new users
- Cons: two code paths to maintain, edge cases when user has Ollama but addon wants a different version

### Suggested Approach
1. **Detection test:** Write a script that reliably detects Ollama on macOS — check `localhost:11434/api/tags`, check `which ollama`, check `~/.ollama/`, check if running as a launchd service. Measure how many developers on the team already have it installed.
2. **Integration test:** Connect to a running Ollama instance from a Node.js process (the addon runtime), list models, run an embedding generation, run a simple completion. Measure latency overhead of the HTTP API.
3. **Process management test:** If going with B or C, spawn Ollama from Node.js via `child_process.spawn()`, verify GPU access works, verify model loading, verify clean shutdown on `deactivate()`. Test the `Process.ts` patterns (auto-restart, tree-kill) with Ollama specifically.
4. **Model recommendation logic:** Given available RAM and GPU (detectable via `os.totalmem()` and Ollama's own hardware detection), what models should the addon recommend? Build a simple decision matrix.

### Key Sub-Questions
- Does Ollama spawned as a child process of Electron correctly access the GPU? Or does it need to be a standalone service?
- If the user has Ollama installed and running with their own models, should the addon use those models or recommend its own? (Probably: use what's there, recommend if nothing suitable is found.)
- When Ollama is used for embeddings (as an alternative to the bundled CPU model from Spike 2), how does performance compare? Is it fast enough for batch indexing?
- Can Ollama serve both embedding generation and LLM inference simultaneously without resource contention?

### Success Criteria
- A clear recommendation on Approach A, B, or C with documented tradeoffs
- Working prototype of the recommended approach: addon detects or spawns Ollama, connects, generates embeddings, runs a simple completion
- Confirmation of whether GPU access works from an addon-spawned process
- A model recommendation matrix based on available hardware

### Risk If This Fails
Approach B (bundle and manage) doesn't work reliably from an addon — GPU access fails, orphan processes, or resource contention. Mitigation: default to Approach A (detect-only) for V1, which keeps Tier 3 functional but pushes Ollama installation to the user. This is acceptable for a developer-facing Tier 3 feature.

---

## Spike 5: Addon Asset Distribution

### Question
How does the add-on distribute the embedding model and any native library bindings (ONNX Runtime `.node` files, LanceDB `.node` files) that Tier 1 requires?

### Why This Matters
Even with a fully embedded Tier 1 (no external binaries), the addon still needs to ship:
- An ONNX model file (~80MB for `all-MiniLM-L6-v2`)
- `onnxruntime-node` native bindings (~30-50MB, platform-specific `.node` files)
- Vector DB native bindings if using LanceDB (~10-20MB, platform-specific)
- Total: ~120-150MB of assets beyond normal addon JavaScript

This is smaller than the original framing (which included standalone vector DB and Ollama binaries), but still significantly larger than a typical Local addon. If Spike 1 selects a pure-JS vector store (Vectra), native bindings drop out and only the ONNX model + runtime remain.

### Questions to Answer
1. What is the current maximum addon package size in the Local marketplace? Is there a limit?
2. What is the actual download/install experience for a 120-150MB addon vs. a 5MB addon?
3. Can native `.node` bindings for multiple platforms be bundled in a single addon package? (npm packages like `onnxruntime-node` typically use `optionalDependencies` per platform)
4. Can the addon download the ONNX model on first run instead of bundling it? (The addon has full Node.js + `fs` + `https` access)
5. Where should model files live on disk? With the addon or in a separate data directory?

### Suggested Approach
1. Check the Local addon marketplace/packaging system for size limits and install flow
2. Test the "bundle everything" approach: create a test addon package at ~150MB with platform-specific native deps, install through the normal addon flow
3. Test the "download on first run" approach: ship a small addon (~5MB) that downloads ONNX model + runtime on first activation, with progress indication
4. Evaluate npm `optionalDependencies` patterns for cross-platform native modules within an Electron addon context
5. Document the tradeoffs: bundled (simple, one download) vs. on-demand (smaller install, first-run setup step)

### Success Criteria
- A clear recommendation on bundle vs. on-demand with documented tradeoffs
- Working prototype of the chosen approach
- Cross-platform native module loading verified in the Electron addon context (at minimum macOS Intel + ARM)

### Risk If This Fails
Addon distribution can't handle the payload cleanly. Mitigations:
- Use pure-JS vector store (Vectra) to eliminate native vector DB bindings
- Download ONNX model on first run to keep addon install small
- Worst case: Tier 1 ships without local embeddings, requires Tier 2 (cloud) for embedding generation

---

## Spike Dependencies

```
Spike 1 (Embedded Vector DB)
  ├── informs → Spike 5 (native bindings needed? or pure JS?)
  └── can run immediately (no dependencies)

Spike 2 (CPU Embedding Performance)
  ├── informs → Spike 5 (ONNX model + runtime size)
  └── can run immediately (no dependencies)

Spike 3 (Content Extraction)
  └── independent (can run in parallel with all others)

Spike 4 (Ollama Integration)
  ├── informs → whether Tier 3 is in V1 scope
  └── can run immediately (no dependencies, but lower priority than Tier 1 spikes)

Spike 5 (Asset Distribution)
  └── depends on Spike 1 + Spike 2 (must know what needs distributing)
```

### Recommended Order

**Round 1 — Run in parallel, these have no dependencies on each other:**
- **Spike 1** (Embedded Vector DB) — determines the storage foundation
- **Spike 2** (CPU Embedding Performance) — determines whether Tier 1 self-contained embeddings are viable
- **Spike 3** (Content Extraction) — determines what goes into the vector DB

These three together validate or invalidate the core Tier 1 promise: "semantic search works out of the box, no cloud, no GPU, no extra processes."

**Round 2 — Informed by Round 1 results:**
- **Spike 5** (Asset Distribution) — now we know what needs shipping: which native bindings (if any), which model, total size
- **Spike 4** (Ollama Integration) — can run in parallel with Spike 5; informs Tier 3 scope but does not block Tier 1

**Why this order works:**
- Round 1 spikes are independent and can all run simultaneously
- Round 1 results determine whether Tier 1 is viable as described in the vision
- If any Round 1 spike fails, we know before investing in distribution (Spike 5) or Tier 3 (Spike 4)
- Spike 4 (Ollama) is important but does not block a Tier 1 first release — it informs whether Tier 3 is in V1 or deferred

---

## Decision Matrix: What Spike Results Mean for V1

| Spike 1 Result | Spike 2 Result | Spike 3 Result | V1 Scope |
|---------------|---------------|---------------|----------|
| Embedded works | CPU embeddings viable | Extraction works | **Full Tier 1:** Vector DB + local embeddings + MCP. Zero extra processes. Ship it. |
| Embedded works | CPU embeddings too slow | Extraction works | **Tier 1 without self-contained embeddings:** Vector DB + MCP, but embeddings require Tier 2 (cloud) or Tier 3 (Ollama). Or use `worker_threads` to move embedding off main thread. |
| Embedded works | CPU embeddings viable | Extraction too noisy | **Tier 1 with limited content:** Index post titles + excerpts only. Expand content extraction in V2. |
| No embedded option works | Either | Either | **Reframe Tier 1:** Must use standalone vector DB (Qdrant), which adds a process. Spike 4's binary management question becomes relevant for Tier 1, not just Tier 3. |

---

## Outputs

Each spike should produce:
- A short written summary (1-2 pages) with findings, measurements, and recommendation
- Working prototype code (kept in a `spikes/` directory, not production quality)
- A clear go/no-go recommendation for the relevant tier
- Any changes needed to `local-ai-vision.md` based on findings
