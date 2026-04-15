# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 35 |
| Error events | 0 |
| Duration | 176.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 21 |
| Output tokens | 4,692 |
| Cache creation | 53,705 |
| Cache read | 572,676 |
| **Total cost** | **$0.7642** |

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
The AI gateway usage data is tracked and stored (per-site, per-model, with USD cost), but it's **not currently exposed as an MCP tool** — it only lives in Local's IPC/renderer layer, which powers the in-app Gateway Usage Dashboard.

Here's what exists and where to find your data today:

**In the Local UI:**
Open Local → your site → the Nexus AI section → "Gateway Usage" dashboard. It shows cost by time window (last hour/day/week), requests, tokens, and most active site.

**What's tracked per request:**
- `siteId` / `siteName`
- `model` (e.g., `claude-3-5-sonnet-20241022`)
- `provider` (`anthropic` / `openai` / `google`)
- `promptTokens`, `completionTokens`, `totalTokens`
- `costUsd` (calculated using provider-specific pricing)
- `callerPlugin` / `callerTheme` / `callerFeature` (which WordPress plugin made the call)

**Why it's not in MCP:**
The IPC handlers (`AI_GATEWAY_GET_COST`, `AI_GATEWAY_GET_STATS`) are wired to the renderer/UI but nothing in the MCP server reads `nexus_ai_gateway
```