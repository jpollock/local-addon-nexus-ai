# MCP Tool Context & Description Quality

**Status:** In progress  
**Problem:** Claude makes inefficient and incorrect tool choices because tool descriptions are
inaccurate, incomplete, or actively misleading. Fleet context requires multiple discovery
tool calls that could be eliminated.

---

## Problem Statement

Three concrete failures from observed sessions:

1. **`wp_eval` on remote WPE** — description said "Remote WPE: pass install_name instead of
   site" → Claude tried it → hit blocklist → retried with different PHP → 3 wasted calls.

2. **Missing local site for frostscape** — Claude proposed the full pull→update→push workflow,
   user approved, then Claude discovered mid-execution that no local site existed and had to
   improvise (create site, find install ID separately, ask permission again).

3. **Install ID discovery** — Claude made 3+ tool calls (knowledge graph search, wpe_get_installs
   investigation, graph again) to find frostscape's install ID — data that was already in the
   WPE sync cache.

**Root cause:** Tool descriptions don't give Claude what it needs to reason correctly. The
server instructions are good; individual tool descriptions are not.

---

## Solution: Three Layers

### Layer 1 — Tool Description Standards

Every tool description must answer:
- **What it does** (1 sentence)
- **Prerequisites** — what must be true before calling
- **Destructive?** — explicit Tier 3 label + what gets overwritten
- **Async?** — returns immediately or blocks; how to track progress
- **Local-only or remote?** — explicit for every tool
- **What's next** — which tool to call after this one
- **Alternatives** — when to use something else instead

**The three model descriptions (copy these patterns):**

```
async: "Returns immediately with status 'in_progress'. Poll local_operation_status
        every 20s. Typically takes X–Y minutes."

tier3: "Tier 3 (destructive) — requires confirmation. [What gets destroyed]."

local-only: "LOCAL SITES ONLY. For remote WPE use [alternatives]."

remote-capable: "Works on local sites (site=) and remote WPE installs (install_name=)."
```

### Layer 2 — Dynamic Fleet Resource

Expose a `nexus://fleet/state` MCP resource that reads from the WPE sync cache.
Claude reads this at the start of any workflow that touches WPE installs.

Content: for each WPE install — name, install_id, environment, linked local site name
(or none). For each local site — name, status, linked WPE install name (or none).

This eliminates the discovery tool-call pattern. Claude already knows frostscape's install
ID and whether a local site exists before it starts planning.

**Why resource, not static instructions:** Resources are read on demand and always reflect
the current sync cache state. Static instructions go stale and bloat the context window.

### Layer 3 — Workflow Pre-flight Templates in Instructions

The server instructions already have good tool routing. Add named workflow templates with
explicit prerequisite checklists:

```
## Workflow: Pull → Update → Push

BEFORE STARTING — verify all of these:
□ Read nexus://fleet/state — confirm install exists, note install_id
□ Check if local site exists (nexus_list_sites) — create with local_create_site if not
□ Confirm with user: include_database? (default: yes for full environment)
□ Warn user: local_wpe_push is destructive — it overwrites the live WPE environment
□ Ask: does user want export backup before pull?

STEPS (in order):
1. local_wpe_pull (include_database=true) → poll local_operation_status
2. local_export_site (if user wants backup) → poll local_operation_status
3. local_start_site (if site stopped after pull)
4. wp_plugin_update --all
5. wp_site_health → confirm no regressions
6. local_wpe_push → poll local_operation_status
```

---

## Implementation Plan

### Phase 1 — Fix critical tool descriptions (this sprint)

**Priority order (highest impact first):**

| Tool | File | Critical issue |
|---|---|---|
| `local_wpe_pull` | `wpe/wpe-pull.ts` | Says "check Local app" — contradicts instructions (should poll tool). Missing prerequisites. |
| `local_wpe_push` | `wpe/wpe-push.ts` | Missing Tier 3 label. Missing poll guidance. Missing "pull first" warning. |
| `wp_plugin_list` | `wp-cli/plugin-list.ts` | Doesn't mention remote WPE support via install_name |
| `wp_plugin_update` | `wp-cli/plugin-update.ts` | Minimal. Missing remote support, --all flag, WP version dependency |
| `wp_plugin_install` | `wp-cli/plugin-install.ts` | Missing remote support, wordpress.org-only note |
| `wp_plugin_activate` | `wp-cli/plugin-activate.ts` | Missing remote support note |
| `wp_plugin_deactivate` | `wp-cli/plugin-deactivate.ts` | Missing remote support note |
| `local_clone_site` | `site-management/clone-site.ts` | Minimal. Missing what gets cloned, async note |
| `wp_db_export` | `wp-cli/db-export.ts` | Missing local-only note |
| `wp_import_database` | `wp-cli/import-database.ts` | Missing local-only, missing destructive warning |
| `wp_site_health` | `wp-cli/site-health.ts` | Missing local-only note |
| `local_wpe_link` | `wpe/wpe-link.ts` | Minimal — missing what linking enables |

### Phase 2 — Dynamic fleet resource (next sprint)

- Add `nexus://fleet/state` resource to InstructionRegistry
- Resource reads from WPE sync cache (no live CAPI call)
- Format: structured markdown with install names, IDs, environments, local links
- Register in `registerResources()` in `instructions/resources/index.ts`
- Update server instructions: "Read nexus://fleet/state before any WPE workflow"

### Phase 3 — Workflow templates in instructions (next sprint)

- Add named workflow blocks to `server-instructions.ts`
- Pull→Update→Push with full prerequisite checklist
- Plugin audit workflow (list → identify outdated → update → verify)
- Site creation workflow (create → configure → link to WPE if needed)

---

## Files Changed (Phase 1)

```
src/main/mcp/modules/wpe/wpe-pull.ts
src/main/mcp/modules/wpe/wpe-push.ts
src/main/mcp/modules/wp-cli/plugin-list.ts
src/main/mcp/modules/wp-cli/plugin-update.ts
src/main/mcp/modules/wp-cli/plugin-install.ts
src/main/mcp/modules/wp-cli/plugin-activate.ts
src/main/mcp/modules/wp-cli/plugin-deactivate.ts
src/main/mcp/modules/site-management/clone-site.ts
src/main/mcp/modules/wp-cli/db-export.ts
src/main/mcp/modules/wp-cli/import-database.ts
src/main/mcp/modules/wp-cli/site-health.ts
src/main/mcp/modules/wpe/wpe-link.ts
```
