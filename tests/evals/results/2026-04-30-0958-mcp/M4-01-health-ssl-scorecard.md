# Eval Scorecard: M4-01-health-ssl (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 13 |
| Error events | 0 |
| Duration | 95.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 2,070 |
| Cache creation | 32,277 |
| Cache read | 270,858 |
| **Total cost** | **$0.2334** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M4-01-health-ssl-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the SSL picture across your 10 WP Engine accounts:

---

## ❌ Expired (Action Required)

| Install | Account | Domain | Expired |
|---------|---------|--------|---------|
| **frostscape** | w7579 | wordpress-tester.work | **2024-04-06** (2 years ago) |

---

## ⚠️ Expiring in 28 Days

| Install | Account | Domains | Expires |
|---------|---------|---------|---------|
| **getflywheel** | getflywheel | getflywheel.com + 21 more | 2026-05-28 |
| **localwpe** | getflywheel | local.getflywheel.com + 6 more | 2026-05-28 |

These two need attention **before May 28th**.

---

## ⚠️ Two Accounts Had Auth Errors

- **btwpe** and **esmy9dign4hoqz** — WPE auth expired mid-scan, so those accounts couldn't be checked. Run `wpe_login` to re-authenticate if you want SSL status for those.

---

## Everything Else

The ~200 remaining installs across your other accounts show no custom domain SSL certs configured — they're likely running on the default `*.wpengine.com` subdomain only (which WPE man
```