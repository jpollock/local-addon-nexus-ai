# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 55 |
| Error events | 0 |
| Duration | 455.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 119 |
| Output tokens | 17,558 |
| Cache creation | 71,931 |
| Cache read | 4,502,590 |
| **Total cost** | **$1.8842** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have enough to give you a clear picture. Here's what I found:

---

## What I found about jppblank

**The site is up and responding fine** (HTTP 200, no PHP errors, no maintenance mode). It shows the default blank WPE install content — "Jeremy Pollock Site / Your SUPER-powered WP Engine Site", the genesis-block-theme, just the default "Hello world!" post dated August 2025.

**No push activity appears in Local's logs at all.** I searched all 9 verbose log files — the only jppblank entries are background Nexus sync events from April 22 and 24. No rsync, no ssh-to-jppblank, no connect-push logs from today or any recent date.

**The SSH key doesn't work for jppblank:**
```
jppblank@jppblank.ssh.wpengine.net: Permission denied (publickey)
```
Your `~/.ssh/config` points `*.ssh.wpengine.net` to `~/.ssh/wpengine_ed25519`, but that key is rejected. The jppblank host IS in your `known_hosts` (so SSH was attempted at some point), but auth fails.

**No local site is linked to jppblank** in Loca
```