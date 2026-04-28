# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 6 |
| Error events | 0 |
| Duration | 52.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,340 |
| Cache creation | 27,417 |
| Cache read | 618,282 |
| **Total cost** | **$0.3084** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your AI gateway spend for April 2026:

**Total: $0.35 · 57 requests · 27.8k tokens**

**By site:**
| Site | Cost | Share | Requests |
|---|---|---|---|
| **frostscape** | $0.2049 | 59% | 18 |
| jppblank | $0.1395 | 40% | 33 |
| testjppdev | $0.0014 | <1% | 3 |
| wK9vE-gUp | $0.0007 | <1% | 3 |

**By model:**
| Model | Cost | Requests |
|---|---|---|
| gpt-image-1 | $0.2800 | 7 |
| gpt-4.1 | $0.0444 | 19 |
| claude-opus-4-6 | $0.0104 | 1 |
| claude-haiku-4-5-20251001 | $0.0094 | 18 |
| gpt-4o-mini | $0.0024 | 12 |

**frostscape** is the top spender at 59% of total cost, though jppblank has nearly twice as many requests (33 vs 18). The cost disparity is almost entirely explained by image generation — `gpt-image-1` accounts for $0.28 of your $0.35 total (81%) despite only 7 requests. If frostscape is where you're doing image gen, that's why it dominates cost.
```