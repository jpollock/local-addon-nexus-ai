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
| Duration | 48.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 308 |
| Output tokens | 1,493 |
| Cache creation | 26,423 |
| Cache read | 432,403 |
| **Total cost** | **$0.2521** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your April 2026 AI gateway breakdown:

**Total: $0.35 across 57 requests (27.8k tokens)**

---

**By site:**

| Site | Spend | Share | Requests |
|---|---|---|---|
| **frostscape** | $0.2049 | 59% | 18 |
| jppblank | $0.1395 | 40% | 33 |
| testjppdev | $0.0014 | <1% | 3 |
| wK9vE-gUp | $0.0007 | <1% | 3 |

**frostscape** is your biggest spender by cost despite fewer requests — its 18 requests cost more than jppblank's 33.

---

**By model:**

| Model | Spend | Requests |
|---|---|---|
| **gpt-image-1** | $0.2800 | 7 |
| gpt-4.1 | $0.0444 | 19 |
| claude-haiku-4-5 | $0.0094 | 18 |
| gpt-4o-mini | $0.0024 | 12 |
| claude-opus-4-6 | $0.0104 | 1 |

Image generation (`gpt-image-1`) is by far your biggest cost driver — 7 requests account for 81% of total spend ($0.28). That's almost certainly coming from frostscape given the cost profile matches. If you want to cut costs, that's the lever.
```