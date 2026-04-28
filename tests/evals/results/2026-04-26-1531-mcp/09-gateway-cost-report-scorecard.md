# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Duration | 23.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 610 |
| Cache creation | 106,942 |
| Cache read | 106,478 |
| **Total cost** | **$0.4421** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a breakdown of your April 2026 AI gateway spend:

**Total: $0.35 across 57 requests and ~27.8k tokens**

### By Site

| Site | Cost | Requests |
|---|---|---|
| **frostscape** | $0.2049 | 18 |
| jppblank | $0.1395 | 33 |
| testjppdev | $0.0014 | 3 |
| wK9vE-gUp | $0.0007 | 3 |

**frostscape is your top spender** — $0.20 for 18 requests, meaning a high average cost per request (~$0.011). That points to expensive model usage, likely image generation.

### By Model

| Model | Cost | Requests |
|---|---|---|
| **gpt-image-1** | $0.2800 | 7 req |
| gpt-4.1 | $0.0444 | 19 req |
| claude-opus-4-6 | $0.0104 | 1 req |
| claude-haiku-4-5-20251001 | $0.0094 | 18 req |
| gpt-4o-mini | $0.0024 | 12 req |

**Image generation (gpt-image-1) is 81% of your total spend** — just 7 requests cost $0.28. That's ~$0.04/image, which is typical for gpt-image-1. Everything else is cheap by comparison.

**Key insight:** If you want to cut costs, frostscape + gpt-image-1 is the combination to watch. The te
```