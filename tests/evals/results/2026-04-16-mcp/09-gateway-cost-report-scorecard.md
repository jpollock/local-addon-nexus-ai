# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 24 |
| Error events | 0 |
| Duration | 251.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 28 |
| Output tokens | 15,946 |
| Cache creation | 63,057 |
| Cache read | 1,031,016 |
| **Total cost** | **$0.7850** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Got the data. Let me calculate. The first record (nexus-test-site, timestamp `1774385741712`) is from March — all others are April. Let me crunch the numbers.

---

## April 2026 — AI Gateway Spend (MTD)

**Grand total: $0.35** across 57 requests

---

### By Site

| Site | ID | Requests | Cost | % |
|---|---|---|---|---|
| **frostscape** | nAx5blbIx | 18 | **$0.2049** | 59% |
| **jppblank** | edqY1Hhb0 | 9 | **$0.1298** | 37% |
| **jppblank** | wK9vE-gUp | 17 | $0.0049 | 1.4% |
| **jppblank** | BmZdfLcD2 | 6 | $0.0027 | 0.8% |
| **jppblank** | kxGIbuguh | 2 | $0.0015 | 0.4% |
| **testjppdev** | 77kvDA4Q5 | 3 | $0.0014 | 0.4% |
| **jppblank** | bmXFV-gJq | 2 | $0.0014 | 0.4% |

> Note: "jppblank" appears under 4 different site IDs — each is a distinct Local site instance (created/recreated separately).

**frostscape is your heaviest user by a wide margin** — 59% of all spend.

---

### By Model

| Model | Provider | Requests | Cost |
|---|---|---|---|
| **gpt-image-1** | OpenAI | 7 | *
```