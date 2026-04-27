# Eval Scorecard: 01-single-field-lookup (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 9 |
| Error events | 0 |
| Duration | 53.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 1,395 |
| Cache creation | 23,106 |
| Cache read | 386,792 |
| **Total cost** | **$0.2236** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1842-cli-skills/01-single-field-lookup-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
There is no site named "jppblank" in your Local Sites. I see sites like `jpp0413p`, `jeremypollockblog`, and `local-copy-jpp`, but nothing matching "jppblank".

Did you mean one of these?
- **`jpp0413p`**
- **`jeremypollockblog`**
- **`local-copy-jpp`**
```