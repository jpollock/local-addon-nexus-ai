# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 38.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,115 |
| Cache creation | 13,803 |
| Cache read | 372,217 |
| **Total cost** | **$0.1802** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your April 2026 gateway breakdown:

**Total: $0.35 across 57 requests**

---

**By site:**

| Site | Spent | Share | Requests |
|------|-------|-------|----------|
| frostscape | $0.2049 | 59% | 18 |
| jppblank | $0.1395 | 40% | 33 |
| testjppdev | $0.0014 | <1% | 3 |
| wK9vE-gUp | $0.0007 | <1% | 3 |

**frostscape is your top spender by cost** (59% of spend), even though jppblank made nearly twice as many requests. That gap is entirely explained by...

---

**By model:**

| Model | Spent | Requests |
|-------|-------|----------|
| gpt-image-1 | $0.2800 | 7 |
| gpt-4.1 | $0.0444 | 19 |
| claude-opus-4-6 | $0.0104 | 1 |
| claude-haiku-4-5-20251001 | $0.0094 | 18 |
| gpt-4o-mini | $0.0024 | 12 |

**Image generation is driving 81% of your total cost.** The 7 `gpt-image-1` calls ($0.28) almost certainly belong to frostscape — that's why frostscape's per-request cost is so much higher than jppblank's (which is mostly running cheap Haiku or gpt-4o-mini).
```