# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 33.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 796 |
| Cache creation | 14,577 |
| Cache read | 528,006 |
| **Total cost** | **$0.2250** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
You're not currently authenticated with WP Engine. You need to log in first:

```bash
node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/nexus.js wpe login
```

This will open a browser window for OAuth authentication. Once you complete that, re-run your request and I'll pull SSL status across all accounts and flag any certificates expiring within 30 days.
```