# Eval Scorecard: M1-N1-first-run-no-provider

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 95.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 2 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 1,067 |
| Output tokens | 444 |
| Total tokens | 1,511 |
| Estimated cost | $0.0099 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 76 |
| Tool results | 327 |
| Skill prompts | 0 |
| Conversation | 1,109 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 90 | 20% |
| completeness | 95 | 20% |
| output clarity | 90 | 20% |
| **Weighted total** | **95.0** | |

## Reviewer Notes

Clear what-works / what-needs-setup split. Named exact tools that won't work without AI config.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M1-N1-first-run-no-provider
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 86.9s
Tool calls: 7
Cost: $0.2765

============================================================
TURN 1
============================================================
PROMPT: I just installed Nexus but I haven't configured anything yet. What works right now and what do I still need to set up?


⏺ Skill({"skill":"nexus-doctor"})
  ⎿  Shell command failed for pattern "```!
nexus doctor
```": [stderr]
(eval):1: command not found: nexus
Since I'm in MCP-only mode, I'll use the MCP tools directly to run diagnostics.

⏺ mcp__local-nexus-ai__get_system_health({})

⏺ mcp__local-nexus-ai__nexus_list_sites({})
  ⎿  {
  "status": "healthy",
  "uptime_ms": 504102,
  "memory": {
    "rss_mb": 189.203125,
    "heap_used_mb": 81.22451400756836,
    "heap_total_mb": 141.3125,
    "external_mb": 9.553238868713379
  },
  "event_queue": {
    "pending": 0,
    "processing": 0,
    "failed_last_hour": 0
  },
  "mcp_tools": {
    "total_calls": 19,
    "error_rate": 0,
    "avg_duration_ms": 4540.421052631579
  },
  "search": {
    "total_queries": 0,
    "avg_duration_ms": 0,
    "cache_hit_rate": 0
  },
  "issues":
  ⎿  ## Fleet (8 local, 306 WPE)

Local sites = development copies. WP Engine installs = live environments.
↔ indicates a linked pair (same site, different environments).

### Local Sites
- **nexus-e2e-test** (nexus-e2e-test.local) [running]
- **jeremypollockblog** (jeremypollockblog.local) [running]
- **jpp0413p** (jpp0413p.local) [running]
- **nexus** (nexus.local) [running]
- **nitropack-1** (nitropack-1.local) [running]
- **ACF Auto Car Finder** (acf-auto-car-finder.local) [running]
- **local-cop
Now let me check if any sites have AI configured and get graph stats.

⏺ mcp__local-nexus-ai__get_graph_stats({})

⏺ mcp__local-nexus-ai__list_indexed_sites({})

⏺ mcp__local-nexus-ai__get_telemetry_status({})
  ⎿  {
  "total_content": 4090,
  "total_plugins"
... [truncated]
```