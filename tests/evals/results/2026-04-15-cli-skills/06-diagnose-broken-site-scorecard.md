# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 17.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 376 |
| Cache creation | 39,118 |
| Cache read | 154,813 |
| **Total cost** | **$0.1988** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
It looks like the MCP tool permissions aren't granted yet. Can you approve the `mcp__local__list_sites` tool call so I can discover the jppblank site and investigate?
```