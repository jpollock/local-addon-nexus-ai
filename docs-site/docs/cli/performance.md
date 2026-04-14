---
title: Performance
description: Timing expectations, indexing characteristics, concurrency behavior, and scripting guidance for the Nexus CLI
keywords: [performance, indexing, latency, timeout, concurrency, scripting, quiet, json]
---

# Performance

This page describes what to expect from each category of CLI operation — which are fast, which are slow, why, and how to work with that in scripts.

## Prerequisites

- Local by WP Engine is installed and running
- The Nexus AI addon is active in Local

---

## Operation Speed Reference

| Operation | Typical Duration | Notes |
|-----------|-----------------|-------|
| `nexus sites list` | < 1 second | Reads Local's in-memory site list |
| `nexus sites get` | < 1 second | Single site lookup |
| `nexus fleet health` | 2–5 seconds | Queries all running sites |
| `nexus fleet filter` | 1–3 seconds | Filters cached site data |
| `nexus wp plugin list` | 1–3 seconds | Runs `wp plugin list` via WP-CLI |
| `nexus wp core version` | 1–2 seconds | Single WP-CLI call |
| `nexus sites start / stop / restart` | 15–90 seconds | Local starts the site process |
| `nexus sites create` | 30–120 seconds | Creates site + installs WordPress |
| `nexus sites clone` | 60–300 seconds | Copies files + database |
| `nexus sites export` | 60–600 seconds | Depends on site size |
| `nexus sites import` | 60–600 seconds | Depends on archive size |
| `nexus content reindex` | 30–600 seconds | Depends on post count + file count |
| `nexus bulk reindex <3 sites>` | 60–600 seconds | Serial per site |
| `nexus bulk plugin-update` | 60–600 seconds | Serial per site |
| `nexus wp db export` | 10–300 seconds | Depends on database size |
| `nexus wp db scan` | 5–30 seconds | Runs multiple `wp eval` calls |
| `nexus sync pull / push` | Queued in Local | CLI returns after queuing |

"Fast" operations (< 5 seconds) read from Local's GraphQL server or call a single WP-CLI command. "Slow" operations involve file I/O, WordPress installation, or processing many sites.

---

## Indexing Performance

`nexus content reindex` builds the vector search index for a site. The addon processes each WordPress post as a document, splits it into chunks (max 500 words each), and embeds it using an on-device ONNX model.

**What affects indexing time:**

- **Post count** — sites with thousands of posts take proportionally longer
- **Post length** — long posts split into more chunks, each requiring an embedding
- **Custom post types** — additional post types increase volume
- **File indexing** — theme and plugin files add to the document count
- **CPU speed** — embedding runs on the CPU; faster hardware speeds this up

**Typical rates:**

- Small site (< 500 posts): 30–90 seconds
- Medium site (500–2,000 posts): 2–5 minutes
- Large site (2,000+ posts): 5–10 minutes

Check index status after reindexing:

```bash
nexus content index-status mysite@local
```

**Output:**

```
Index Status: mysite@local
──────────────────────────────────────────────────
State:         ✅ indexed
Documents:     5,432
Chunks:        21,804
Last Indexed:  4/13/2026, 9:12:04 AM
```

---

## Content Search Latency

`nexus content search` and `nexus fleet search` query the pre-built vector index — they do not re-embed at query time. Expect:

- **Single-site search**: < 1 second for most queries
- **Fleet search** (across all sites): 1–3 seconds

Search latency is consistent regardless of post count because the vector index scales efficiently. The bottleneck is network round-trip to Local's GraphQL server.

---

## How `nexus doctor` Identifies Performance Issues

`nexus doctor` runs a fixed set of checks:

- Local installed
- Local running
- Addon active and version matched
- GraphQL server reachable
- MCP server running and responding
- AI agent configured
- AI provider set with API key
- Sites with AI configured

It does not measure indexing speed or query latency. Use it to confirm the system is connected, not to benchmark operations.

```bash
nexus doctor
```

If the GraphQL server is slow to respond, `nexus doctor` will report a longer than usual runtime. This is a signal that Local is under load.

---

## Concurrency

**Serial execution** — `nexus bulk` commands process sites one at a time, not in parallel. This avoids overloading Local's internal server, which is single-threaded for most operations.

For `nexus bulk reindex` across three sites, the total time is roughly the sum of each site's reindex time, not the maximum.

**No parallelism flags** — there is no `--concurrency` or `--parallel` option. If you need parallel execution, run multiple `nexus` processes in shell background jobs:

```bash
nexus content reindex mysite@local &
nexus content reindex blog@local &
wait
```

This is faster but uses more CPU, which may slow down individual reindex operations.

---

## `--quiet` and `--json` for Scripting

The CLI does not have a `--quiet` flag. To suppress human-readable progress output in scripts, redirect stderr:

```bash
# Suppress "Starting bulk reindex..." progress messages
nexus bulk reindex mysite@local blog@local 2>/dev/null
```

Progress lines (like `Starting bulk reindex of 2 sites...`) go to stdout, so use `--json` to get clean output:

```bash
# JSON output contains only structured results, not progress text
nexus bulk health-check mysite@local blog@local --json
```

The bootstrap spinner (`🔧 Connecting to Local...`) is only shown in interactive terminals (TTY). In scripts and CI, it is suppressed automatically.

---

## Large Fleet Considerations (50+ Sites)

The CLI does not enforce a site count limit, but performance degrades at scale:

- `nexus fleet health` queries all running sites. With 50+ running sites, this can take 10–30 seconds.
- `nexus bulk health-check` with 50 targets will run serially and may take 15–30 minutes total.
- `nexus audit plugins` scans all running sites and is limited to a 5-minute timeout.

**Strategies for large fleets:**

1. Use `nexus fleet filter` to narrow the target set before bulk operations.
2. Use site groups (`nexus fleet groups`) to manage named subsets.
3. Run operations during off-hours when sites are not actively being developed.
4. Check `nexus content list-indexed` to skip already-indexed sites in reindex scripts.

```bash
# Only reindex sites that are not yet indexed
nexus content list-indexed --json \
  | jq -r '.[] | select(.state != "indexed") | .target'
```

---

## When to Use `--json` vs Interactive Output

Use `--json` when:
- Processing output in a shell pipeline
- Parsing results in a script or AI agent
- Storing results for later comparison
- Passing output to `jq`

Use interactive output (default) when:
- Running commands manually to check status
- Reviewing health reports or audit results
- Following along with a multi-step workflow

`--json` output is stable across patch releases. Interactive output formatting may change between versions.

---

## Next Steps

- [Bulk Operations](./bulk-operations.md) — fleet and bulk command reference
- [Local Site Management](./local-sites.md) — start, stop, and manage sites
- [Error Handling](./error-handling.md) — timeouts and recovery
