# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 19 |
| Error events | 0 |
| Duration | 132.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 4,420 |
| Cache creation | 220,918 |
| Cache read | 680,035 |
| **Total cost** | **$1.0988** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the complete SSL audit across all 10 WP Engine accounts (299 installs checked):

---

## SSL Audit Results

### ❌ Expired Certificates (Action Required)

| Install | Account | Domain(s) | Expired |
|---------|---------|-----------|---------|
| **qwerky** | esmy9dign4hoqz | `qwerky.tech`, `www.qwerky.tech` | **2022-03-08** (4+ years ago) |

### ⚠️ Expiring Within ~30 Days (Watch List)

| Install | Account | Domain(s) | Expiry | Days Left |
|---------|---------|-----------|--------|-----------|
| **getflywheel** | getflywheel | getflywheel.com + 24 others | 2026-05-28 | ~32 days |
| **localwpe** | getflywheel | local.getflywheel.com, pressmatic.io + others | 2026-05-28 | ~32 days |

These two are just outside the 30-day window but WPE's Let's Encrypt certs auto-renew around 30 days before expiry — if auto-renewal isn't working, they'd expire May 28.

### ✅ Confirmed Valid

| Install | Account | Domain(s) | Expiry |
|---------|---------|-----------|--------|
| frostwpe | devrel | f
```