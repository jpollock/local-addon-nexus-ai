# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 67.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 1,861 |
| Cache creation | 28,565 |
| Cache read | 200,173 |
| **Total cost** | **$0.1951** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `get_metrics` tool only tracks MCP tool call counts and latency — not AI gateway usage or token costs. There's no MCP tool in the current server that exposes per-site, per-model gateway spending data.

Here's why: the AI gateway usage stats live in two places neither of which is reachable via MCP:

1. **In-app dashboard** — the Local addon tracks gateway requests in-memory and surfaces them via the Local UI (the "Gateway Usage" panel in the addon's preferences). You'd need to open Local and look there.

2. **Cloudflare Worker telemetry** — aggregated usage is sent to `nexus-analytics.jeremy7746.workers.dev`, but that's an external HTTP endpoint with no MCP binding.

**To get the breakdown you want, you have two options:**

- **In Local:** Open the Nexus AI addon → Preferences (or the site info panel) → Gateway Usage dashboard. It shows per-request logs with model and site info.

- **Via CLI (if you have terminal access):** The `nexus analytics` command (if implemented) or checking 
```