# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 53 |
| Error events | 0 |
| Duration | 360.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9,826 |
| Output tokens | 15,944 |
| Cache creation | 170,279 |
| Cache read | 4,075,042 |
| **Total cost** | **$2.1297** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I now have a complete picture. Here's what I found:

---

## What Happened

**The push was from the local site called `jppblankdev`** (not `jppblank`) — it was linked to the WPE `jppblankdev` production install (site ID `8dba401b-e003-4de2-9905-4c2f6181c440`).

### The push failed repeatedly in March (~March 19)

The logs are unambiguous:

```
WPEPushService: rsync process existed with code 255
RsyncService: rsync: connection unexpectedly closed
WPEPushService: Failed to backup to WP Engine — 404 Not Found
```

Two compounding failures:
1. **Pre-push backup → 404** — WPE couldn't create a checkpoint backup for the install. Local treats this as a warning (not fatal), so the push continued anyway.
2. **Rsync → code 255** — SSH connection dropped repeatedly. This means the file transfer to WPE failed every time it was attempted. The site was never fully pushed.

### The local site no longer exists

The local `jppblankdev` site was deleted from Local between the March 1 backup and today — 
```