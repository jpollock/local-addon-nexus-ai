# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 24 |
| Error events | 0 |
| Duration | 193.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 39 |
| Output tokens | 8,244 |
| Cache creation | 58,369 |
| Cache read | 1,046,648 |
| **Total cost** | **$0.6567** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The site itself is fine — it was just halted. We've started it and it should be loading now.

**What I found:**

1. **Site was halted** — that was the loading issue. Started it, no fatal PHP/nginx errors, WordPress is healthy (plugins, themes, options all respond correctly).

2. **db-scanner SQL bug** (separate issue) — `db-scanner.ts:358` uses `TABLE_ROWS as rows`, but `rows` is a reserved word in MySQL 8.0.2+. That's what's causing the SQL errors in the PHP error log. Two-line fix needed:
   - `:358`: `TABLE_ROWS as rows` → `TABLE_ROWS as row_count`
   - `:413`: `r.rows` → `r.row_count`

Want me to apply that fix?
```