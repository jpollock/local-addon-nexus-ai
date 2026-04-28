# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 52 |
| Error events | 0 |
| Duration | 310.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 13,827 |
| Output tokens | 12,752 |
| Cache creation | 58,761 |
| Cache read | 2,765,777 |
| **Total cost** | **$1.2828** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1028-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have enough to give you a complete picture. Here's what happened:

---

## What went wrong with the jppblank push

**The good news: the WPE site is intact.** `jppblank.wpenginepowered.com` is responding normally (HTTP 200). The push **never completed** — it failed at the very beginning.

### The two errors (both in the March logs, same pattern)

```
WPEPushService: Failed to backup to WP Engine
→ CAPI POST /installs/jppblank/backups → 404 Not Found

WPEPushService: Error in WP Engine connect
→ rsync process exited with code 255
```

**Error 1 — Backup 404:** Local tried to snapshot jppblank before pushing, but the CAPI backup endpoint returned 404. Local logs this as a warning ("This will not prevent the site from attempting to push"), so it continued anyway.

**Error 2 — rsync exit 255:** This is a hard failure. Exit code 255 from rsync means **SSH connection refused** — the rsync never transferred a single file. Nothing on WPE was overwritten.

### Why it looks "weird"

- `nexus wp
```