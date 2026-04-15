# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 38 |
| Error events | 0 |
| Duration | 202.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 25 |
| Output tokens | 8,164 |
| Cache creation | 85,602 |
| Cache read | 900,683 |
| **Total cost** | **$0.7137** |

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
Here's what I found:

**Root cause: broken WPE link + CLI version mismatch**

The push left the local `jppblank` site in a partially-linked state. The evidence:

1. **`@unknown` environment in WPE link** — `nexus sites get jppblank@local` shows `WPE Link: 8dba401b-e003-4de2-9905-4c2f6181c440@unknown`. The Site UUID is correct, but the environment should be `@production`, not `@unknown`. This happened when the push started linking the site but didn't complete.

2. **Multiple CLI commands failing with `is not a function`** — `nexus wpe changes`, `nexus wpe link`, `nexus wp health` all fail with errors like `services.localServices.getSiteChanges is not a function`. This is a v0.2.1 bug — you're running v0.2.1, latest is **v0.2.4**. These functions were added or changed and the old binary doesn't have them.

3. **WPE install itself is fine** — the production install exists (`3beb5d13-1ef2-4732-b626-4832a1991da8`), has the correct primary domain (`jppblank.wpenginepowered.com`), PHP 8.2. No
```