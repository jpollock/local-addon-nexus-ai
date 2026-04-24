# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 73.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 1,633 |
| Cache creation | 37,808 |
| Cache read | 184,128 |
| **Total cost** | **$0.2215** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `get_metrics` data only shows MCP tool call counts — not AI gateway spending. There's no MCP tool currently exposed for querying gateway usage by site and model.

Here's what the gateway usage feature looks like across the different access modes:

| Access Mode | Status |
|---|---|
| **Local UI** | Available — the gateway dashboard in the addon shows usage and auto-refreshes |
| **CLI** (`nexus gateway usage`) | Recently added (commit `4f21853`) |
| **MCP** | **Not yet exposed** — no MCP tool exists for gateway usage data |

The gateway usage data lives in the Nexus AI SQLite database and is surfaced through the Local app's UI and the CLI, but it hasn't been wrapped into an MCP tool yet.

**To get the breakdown you're looking for, your options are:**

1. **Local UI** — open Local, go to the Nexus AI panel, and check the gateway usage dashboard
2. **CLI** — run `nexus gateway usage` in terminal (if you're on the latest build from the `testing-and-evals` branch)

Adding a `gateway_us
```