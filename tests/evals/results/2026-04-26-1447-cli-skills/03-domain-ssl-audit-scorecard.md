# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 35 |
| Error events | 0 |
| Duration | 231.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 10,638 |
| Cache creation | 181,325 |
| Cache read | 554,520 |
| **Total cost** | **$1.0059** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1447-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have enough data now. Let me compile the complete SSL report.

Here's the full SSL audit across your 10 WP Engine accounts (299 installs):

---

## SSL Audit Results

### Installs with SSL data available via CAPI

| Install | Domain | Expiry | Status | Account |
|---------|--------|--------|--------|---------|
| getflywheel | getflywheel.com + 23 others | **31–32 days** | ENABLED | getflywheel |
| localwpe | localwp.com + 8 others | **31–32 days** | ENABLED | getflywheel |
| frostwpe | frostwp.com | 63 days | ENABLED | devrel |
| tristest | psblegacy.tristinbrown.com | 60 days | ENABLED | esmy9dign4hoqz |

### Findings

**Expiring within 30 days:** None technically — all current certs expire at 31–32 days. But two installs are extremely close:

**`getflywheel` + `localwpe` — Expires ~May 27–28 (31–32 days out)**
These two installs carry your highest-traffic domains and will breach the 30-day threshold in the next 24–48 hours if not renewed. Certs cover:
- `getflywheel.com`, `www.getf
```