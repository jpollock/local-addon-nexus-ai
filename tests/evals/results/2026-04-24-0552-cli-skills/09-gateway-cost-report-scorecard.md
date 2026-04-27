# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Duration | 35.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 1,077 |
| Cache creation | 12,979 |
| Cache read | 141,265 |
| **Total cost** | **$0.1072** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/09-gateway-cost-report-transcript.txt

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

**Total: $0.35 across 57 requests, 27.8k tokens**

---

**By Site:**

| Site | Cost | Share | Requests |
|------|------|-------|----------|
| frostscape | $0.20 | 59% | 18 |
| jppblank | $0.14 | 40% | 33 |
| testjppdev | $0.001 | <1% | 3 |
| wK9vE-gUp | $0.001 | <1% | 3 |

**frostscape is your top spender** at 59% of cost — despite fewer requests than `jppblank`, it costs more because it's hitting the expensive models.

---

**By Model:**

| Model | Cost | Requests |
|-------|------|----------|
| gpt-image-1 | $0.28 | 7 |
| gpt-4.1 | $0.044 | 19 |
| claude-opus-4-6 | $0.010 | 1 |
| claude-haiku-4-5-20251001 | $0.009 | 18 |
| gpt-4o-mini | $0.002 | 12 |

**Image generation is the biggest cost driver** — `gpt-image-1` accounts for 81% of total spend with only 7 requests (~$0.04/image). That's almost certainly coming from `frostscape` given its cost profile.
```