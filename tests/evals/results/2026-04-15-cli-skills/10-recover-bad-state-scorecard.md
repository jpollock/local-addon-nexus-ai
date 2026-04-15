# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 24.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 12 |
| Output tokens | 678 |
| Cache creation | 39,924 |
| Cache read | 195,672 |
| **Total cost** | **$0.2186** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
It looks like the MCP tools need your permission to run. Can you approve the tool calls? Once you do, I'll:

1. List all local sites to find `jppblank`
2. Pull its sync history to see what happened during the push
3. Check the site's current state

You can approve individual tool calls as they come up, or if you want to grant broader access, you can do that in your Local settings.
```