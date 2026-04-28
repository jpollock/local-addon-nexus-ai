# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 314.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 17 |
| Output tokens | 10,433 |
| Cache creation | 58,206 |
| Cache read | 1,489,989 |
| **Total cost** | **$0.8218** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have the full picture across all 299 installs. Here's the complete SSL report:

---

## SSL Report — All 10 WP Engine Accounts (299 installs)

### Critical: Expired Certificates

| Install | Account | Domain | Status |
|---------|---------|--------|--------|
| `frostscape` | w7579 | wordpress-tester.work | 🔴 **Expired 750 days ago** (still ENABLED) |
| `frostscape` | w7579 | www.wordpress-tester.work | 🔴 **Expired 683 days ago** (still ENABLED) |
| `qwerky` | esmy9dign4hoqz | qwerky.tech | 🔴 **Expired 1,510 days ago** (still ENABLED) |
| `qwerky` | esmy9dign4hoqz | www.qwerky.tech | 🔴 **Expired 1,510 days ago** (still ENABLED) |

Both of these have certificates that have been expired for **years** but are marked as ENABLED. The sites are still running on those domains — visitors would see browser SSL warnings.

---

### Borderline: Expiring in 31–32 Days (just outside your 30-day window)

| Install | Account | Expiry | Domains |
|---------|---------|--------|---------|
| `getflyw
```