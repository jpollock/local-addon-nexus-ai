# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 55 |
| Error events | 0 |
| Duration | 448.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 23 |
| Output tokens | 19,381 |
| Cache creation | 113,668 |
| Cache read | 1,569,134 |
| **Total cost** | **$1.1878** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1922-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have the full picture now. Let me compile the comprehensive SSL report across all installs.

---

## SSL Audit — All WP Engine Accounts (297 installs)

**Good news: Nothing is expiring within 30 days.** But there are certs worth watching.

---

### ⚠️ Expiring in 35 days — May 28, 2026

Two high-traffic installs in the **getflywheel** account have Let's Encrypt certs due for renewal:

**`getflywheel`** install (getflywheel.com) — 24 domains, all expiring May 28:
- getflywheel.com, www.getflywheel.com
- flywheel.company / .hosting / .host / .support
- campflywheel.com, heyflywheel.com, hostingonfleek.com
- layoutbyflywheel.com, flywheelwhitelabel.com, whitelabelbyflywheel.com
- flywheel-web-hosting.com + www variants

**`localwpe`** install (localwp.com) — 9 domains, all expiring May 28:
- localwp.com, www.localwp.com
- local.getflywheel.com
- localbyflywheel.com, www.localbyflywheel.com
- locallaboratory.io, www.locallaboratory.io
- pressmatic.io, www.pressmatic.io

These are Let's E
```