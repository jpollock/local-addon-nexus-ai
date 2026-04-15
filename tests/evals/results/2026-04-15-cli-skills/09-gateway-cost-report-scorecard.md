# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 19 |
| Error events | 0 |
| Duration | 171.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 22 |
| Output tokens | 3,221 |
| Cache creation | 79,818 |
| Cache read | 722,407 |
| **Total cost** | **$0.5644** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The CLI can't reach the addon right now — `nexus doctor` showed the MCP server isn't responding, and CLI commands that require addon connectivity are timing out.

Here's the situation:

**Gateway usage data exists but isn't reachable right now.** The addon stores `nexus_ai_gateway_usage` records (per-request: site ID, model, prompt/completion tokens, cost in USD) in its electron store and exposes them via IPC (`ai-gateway-get-usage`). The usage dashboard in Local's UI reads this data, but the CLI doesn't have a `nexus gateway usage` command to pull it directly.

**To get the breakdown you want, two things need to happen:**

1. **Fix the connectivity issue first** — run `nexus update` to bring the CLI up from v0.2.1 to v0.2.4 (matching the installed addon), then restart Local. `nexus doctor` should show all green.

2. **Either** check the usage dashboard in the Local addon UI (it already shows per-site and per-model breakdowns with costs), **or** I can add a `nexus gateway usage` CLI co
```