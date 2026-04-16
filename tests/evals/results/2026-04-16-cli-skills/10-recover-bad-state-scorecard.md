# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 41 |
| Error events | 0 |
| Duration | 241.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 32 |
| Output tokens | 7,690 |
| Cache creation | 49,772 |
| Cache read | 1,220,285 |
| **Total cost** | **$0.6682** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found. Let me give you the full picture:

---

**The WPE side looks active but has problems:**

- Install `jppblank` (prod) — status: **active**, PHP 8.2, WP 6.9.4
- Install `jppblankdev` (dev) — also active
- Domain: `jppblank.wpenginepowered.com` (primary)
- **❌ No SSL certificate** on prod
- **❌ No recent backup** on prod

**The local side:**

- Local app is **not running** (UI is closed)
- `jppblank@local` is **halted**
- **No `nexus sync push` history** — meaning the push was done through Local's Connect drawer (not the CLI)

---

**What likely happened:**

The push via Local's Connect UI probably transferred your files to WPE, but SSL was never provisioned on the production environment. This is a common issue — the push creates/updates the install but SSL doesn't automatically follow. A halted local site after an operation like this is normal (Local pauses it).

The lack of a recent backup is also a risk — if the push left the site in a bad state on WPE, there's no 
```