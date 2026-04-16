# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 28 |
| Error events | 0 |
| Duration | 221.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 31 |
| Output tokens | 6,191 |
| Cache creation | 47,321 |
| Cache read | 1,170,670 |
| **Total cost** | **$0.6216** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The WPE backup API is consistently returning HTTP 500 — this is a server-side failure from WPE, not something I can work around.

Here's the current situation:

**What I found:**
- Production install: `jppwpeplugin` (ID: `74123063-1f21-4080-b983-aaa5c95ed1e2`)
- Staging install: `jppwpeplugistg` (ID: `3a4b72ba-3aba-4753-b8ae-419e1956651d`)
- Diagnostic shows: no SSL cert, no recent backup
- Backup API: HTTP 500 (WPE server-side error — credentials are configured correctly)

**The blocker:** You asked to make sure production has a backup first, but the WPE backup API is rejecting the request with a server error. I won't run the promotion without that being confirmed.

**Options:**
1. **Log into WPE dashboard manually** and create a backup there — then tell me to proceed with the promotion
2. **Proceed anyway** — WPE automatically creates a checkpoint restore point as part of the copy/promote operation itself, so production data is protected even without a manual pre-backup. If you're OK
```