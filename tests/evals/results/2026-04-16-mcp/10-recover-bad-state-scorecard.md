# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 99.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 17 |
| Output tokens | 3,867 |
| Cache creation | 58,148 |
| Cache read | 301,173 |
| **Total cost** | **$0.3665** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/10-recover-bad-state-transcript.txt

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

**Root cause: the local `jppblank` site is not linked to the WPE install.**

- The fleet view shows no ↔ between local `jppblank` and WPE `jppblank` — no connection was established
- Sync history: **0 events** — the push never actually started from Local's side
- WPE install `jppblank` (production) is **active and SSH-ready** — nothing is wrong on WPE's end
- The local site itself is running fine

**What happened:** When you tried to push, Local had no WPE link configured for this site, so the operation couldn't begin. Nothing was transferred, nothing is stuck or corrupted.

**How to fix it — two options:**

**Option A: Link via Local UI (recommended)**
1. In Local, click on the `jppblank` site
2. Go to the **WP Engine** tab (or "Connect" section)
3. Connect it to the `jppblank` WPE install
4. Then push normally

**Option B: Push directly with the install name via CLI/MCP**
```
local_wpe_push site=jppblank remote_install_
```