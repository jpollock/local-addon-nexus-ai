# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 45 |
| Error events | 0 |
| Duration | 313.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 1,276 |
| Output tokens | 13,358 |
| Cache creation | 62,762 |
| Cache read | 1,722,985 |
| **Total cost** | **$0.9565** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The gateway usage data is recorded and stored — but there's currently no MCP tool or CLI command to query it externally. Here's what I found:

**Where the data lives**: `nexus_ai_gateway_usage` key in Local's electron userData store (in-process only, accessible via IPC from the UI).

**What's tracked per request**: siteId, siteName, model, provider, promptTokens, completionTokens, costUsd, timestamp, callerPlugin, callerTheme, callerUserId.

**What the IPC handlers can compute** (used by the UI dashboard):
- Total cost, requests, tokens for any time range
- Breakdown by model
- Most active site (by request count)

**The gap**: no MCP tool or `nexus` CLI command exposes this data — so there's no way for me to query it directly right now.

**Your options:**

1. **Open the Local UI** — the addon has a Gateway Usage dashboard that shows this breakdown in real time.

2. **I add a `get_gateway_usage` MCP tool** — would expose cost/usage by site and model, queryable from any AI agent. Would b
```