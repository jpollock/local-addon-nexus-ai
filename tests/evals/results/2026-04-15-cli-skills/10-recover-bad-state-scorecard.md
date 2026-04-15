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
| Duration | 230.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 24 |
| Output tokens | 7,934 |
| Cache creation | 55,328 |
| Cache read | 935,409 |
| **Total cost** | **$0.6072** |

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

**What went wrong:** The local site `jppblank` has a corrupted WPE link. It's stored as `8dba401b-e003-4de2-9905-4c2f6181c440@unknown` — that UUID is actually the WPE *site* ID, but the environment (`@unknown` instead of `@production`) never got set properly. This means nexus can't resolve the right install to push to.

**What's fine:** The WPE install itself is in good shape — `jppblank` exists on WPE (production, PHP 8.2, `jppblank.wpenginepowered.com`). The push likely failed before (or during) file transfer because nexus couldn't resolve the target install from the broken link.

**The fix is simple — re-link the local site to the correct WPE target:**

```bash
nexus wpe link jppblank@local wpe:b97e432b-c10a-4f0a-9ce7-55cedd575099/jppblank@production
```

That will replace the broken `@unknown` link with the correct production install target. After that, push/pull should work normally again.

One side note: there's a bug worth knowing about — `nexus wpe domains
```