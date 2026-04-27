# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 12 |
| Error events | 0 |
| Duration | 100.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 2,518 |
| Cache creation | 131,059 |
| Cache read | 200,747 |
| **Total cost** | **$0.5895** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the SSL audit across all 10 accounts (297+ installs total):

---

## SSL Audit Results

### Confirmed Issues

| Severity | Install | Account | Domain | Issue |
|----------|---------|---------|--------|-------|
| ❌ | `frostwpe` | devrel | frostwp.com | No SSL certificate |
| ❌ | `qwerky` | esmy9dign4hoqz | qwerky.wpenginepowered.com | No SSL certificate |

### Account Could Not Be Checked

| Account | Reason |
|---------|--------|
| **getflywheel** | Auth token expired mid-run — `localwp.com` and `getflywheel.com` were not checked |

### No Issues Found (Confirmed)
Accounts **jpollock911**, **w7579**, **esmv7us1l20jdr**, **goldenecomm**, **btwpe**, **qawpeproduct**, **esmy9dign4hoqz**, **esm5z2bl7u8vqk** — all reported 0 expiring, 0 expired certs in their summaries.

---

### Caveats

The vast majority of installs returned "Error fetching certs" — this likely means they only have default `.wpenginepowered.com` / `.wpengine.com` subdomains (WPE-managed SSL, not tracked via CAPI), 
```