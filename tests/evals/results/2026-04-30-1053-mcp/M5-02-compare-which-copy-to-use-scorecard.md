# Eval Scorecard: M5-02-compare-which-copy-to-use

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 89.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 1 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 510 |
| Output tokens | 290 |
| Total tokens | 800 |
| Estimated cost | $0.0059 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 19 |
| Tool results | 57 |
| Skill prompts | 0 |
| Conversation | 723 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 80 | 20% |
| completeness | 80 | 30% |
| output clarity | 90 | 10% |
| **Weighted total** | **89.0** | |

## Reviewer Notes

Named sites don't exist — showed full list, ID'd likely candidates (jpp0413p, local-copy-jpp).

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M5-02-compare-which-copy-to-use
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 65.4s
Tool calls: 2
Cost: $0.2111

============================================================
TURN 1
============================================================
PROMPT: I have multiple local sites for my client project — jpp-client, jpp-client-staging, and jpp-client-old. Which one should I be working in for active development?


⏺ Skill({"skill":"nexus-sites"})
  ⎿  Shell command failed for pattern "```!
nexus sites list
```": [stderr]
(eval):1: command not found: nexus
Since we're in MCP-only mode, I'll use the MCP tools directly to investigate your sites.

⏺ mcp__local-nexus-ai__nexus_list_sites({})
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
None of the three sites you mentioned — `jpp-client`, `jpp-client-staging`, or `jpp-client-old` — appear in your local fleet. Your 8 local sites are:

| Site | Domain | Status |
|------|--------|--------|
| nexus-e2e-test | nexus-e2e-test.local | running |
| jeremypollockblog | jeremypollockblog.local | running |
| **jpp0413p** | jpp0413p.local | running |
| nexus | nexus.local | running |
| nitropack-1 | nitropack-1.local | running |
| ACF Auto Car Finder | acf-auto-car-finder.local | running |
| **local-copy-jpp** | local-copy-jpp.local | running |
| Newsroom Demo | newsroom-demo.local | running |

The most likely candidates for your "jpp client" work are **jpp0413p** (linked to the `jpp0413` WPE production install) and **local-copy-jpp** (l
... [truncated]
```