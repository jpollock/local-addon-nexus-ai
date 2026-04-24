# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 72.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 2,922 |
| Cache creation | 46,705 |
| Cache read | 129,561 |
| **Total cost** | **$0.2579** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The AI gateway spending breakdown (per-site, per-model token costs) isn't exposed through any current MCP tool. Here's what's actually available and where the data lives:

**What the MCP tools can see:**
- `wpe_get_account_usage` — WPE hosting metrics (bandwidth, storage, visits) — not AI costs
- `get_metrics` — MCP tool performance (call counts, latency) — not AI costs

**Where your gateway spending data actually lives:**

1. **Local app UI** — The gateway usage dashboard (Operations tab) shows per-site, per-model usage and auto-refreshes. That's the most direct view.

2. **`nexus gateway usage` CLI** — Added recently (commit `4f21853`), this command pulls gateway usage from the local database. In a terminal: `nexus gateway usage --breakdown site,model`

3. **Cloudflare telemetry worker** — Aggregate events are pushed to `nexus-analytics.jeremy7746.workers.dev`, but there's no MCP tool that queries it.

**Why it's missing from MCP:** The gateway tracks usage internally and exposes it 
```