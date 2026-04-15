# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 104.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 1,510 |
| Cache creation | 72,659 |
| Cache read | 72,870 |
| **Total cost** | **$0.3170** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Local isn't running — the `nexus` CLI requires it to execute WPE commands. Please start Local by WP Engine, then I'll proceed with the backup and promote.

Once Local is running, here's what I'll do:
1. `nexus wpe backups jppwpeplugin` — verify existing backups
2. `nexus wpe backup jppwpeplugin` — create a fresh production backup
3. `nexus wpe promote jppwpeplugistg --to production` — promote staging → production

Can you start Local and let me know when it's up?
```