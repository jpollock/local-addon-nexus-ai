# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 33 |
| Error events | 0 |
| Duration | 324.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 2,779 |
| Cache creation | 80,667 |
| Cache read | 451,169 |
| **Total cost** | **$1.3026** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the full SSL health picture across your WPE fleet:

---

## SSL Certificate Health — 287 Installs

### CRITICAL — Expired Certs (action needed)

**`qwerky`** (esmy9dign4hoqz account)
- `qwerky.tech` and `www.qwerky.tech` — both expired **2022-03-08** (4+ years ago)
- WPE still shows them as `ENABLED` — stale record. Verify if that custom domain is still active; if so, trigger new Let's Encrypt issuance from the WPE portal.

---

### Watch — Expiring Within 43 Days (outside 30-day window, but close)

**`localwpe`** (getflywheel account — `localwp.com`)
- 9 Let's Encrypt certs all expire **2026-05-28** (43 days out)
- Covers: `localwp.com`, `www.localwp.com`, `local.getflywheel.com`, `pressmatic.io`, `localbyflywheel.com`, `locallaboratory.io`, etc.
- Auto-renewal should handle this, but check again on **2026-04-28** when they enter the 30-day window.

---

### Healthy

**`frostwpe`** (devrel account — `frostwp.com`) — expires **2026-06-28** (74 days). No action needed.

---

### 
```