# Eval Scorecard: M1-01-first-run-what-can-i-do

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 94.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 2 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 621 |
| Output tokens | 278 |
| Total tokens | 899 |
| Estimated cost | $0.0060 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 30 |
| Tool results | 175 |
| Skill prompts | 0 |
| Conversation | 694 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 90 | 20% |
| completeness | 85 | 20% |
| output clarity | 95 | 20% |
| **Weighted total** | **94.0** | |

## Reviewer Notes

Concrete fleet numbers, specific example prompts. Best first-run onboarding seen.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M1-01-first-run-what-can-i-do
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 66.2s
Tool calls: 3
Cost: $0.6168

============================================================
TURN 1
============================================================
PROMPT: I just installed Nexus. What can I do with it right now?

I'll run the Nexus doctor skill to check your setup status first.

⏺ Skill({"skill":"nexus-doctor"})
  ⎿  Shell command failed for pattern "```!
nexus doctor
```": [stderr]
(eval):1: command not found: nexus
I'm in MCP-only mode, so let me check your system health and sites directly via the MCP tools.

⏺ mcp__local-nexus-ai__get_system_health({})

⏺ mcp__local-nexus-ai__nexus_list_sites({})
  ⎿  {
  "status": "healthy",
  "uptime_ms": 258057,
  "memory": {
    "rss_mb": 185.515625,
    "heap_used_mb": 66.81645202636719,
    "heap_total_mb": 72.859375,
    "external_mb": 4.389055252075195
  },
  "event_queue": {
    "pending": 0,
    "processing": 0,
    "failed_last_hour": 0
  },
  "mcp_tools": {
    "total_calls": 0,
    "error_rate": 0,
    "avg_duration_ms": 0
  },
  "search": {
    "total_queries": 0,
    "avg_duration_ms": 0,
    "cache_hit_rate": 0
  },
  "issues": []
}
  ⎿  ## Fleet (8 local, 306 WPE)

Local sites = development copies. WP Engine installs = live environments.
↔ indicates a linked pair (same site, different environments).

### Local Sites
- nexus-e2e-test (nexus-e2e-test.local) [halted]
- jeremypollockblog (jeremypollockblog.local) [halted]
- jpp0413p (jpp0413p.local) [halted]
- nexus (nexus.local) [halted]
- nitropack-1 (nitropack-1.local) [halted]
- ACF Auto Car Finder (acf-auto-car-finder.local) [halted]
- local-copy-jpp (local-copy-jpp.local) [ha
Your Nexus setup is healthy and connected. Here's what you can do right now:

## Your Fleet
- **8 local sites** in Local (all currently halted)
- **306 WP Engine environments** across prod/staging/dev

## What You Can Do Right Now

**Explore your WP
... [truncated]
```