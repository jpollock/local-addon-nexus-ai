# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 12 |
| Error events | 0 |
| Duration | 71.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 2,288 |
| Cache creation | 64,275 |
| Cache read | 104,838 |
| **Total cost** | **$0.3068** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the full picture across your 10 accounts (213+ installs checked):

---

## SSL Status Summary

### Confirmed Issues

| Install | Account | Issue |
|---------|---------|-------|
| `frostwpe` | devrel | ❌ No certificate |
| `getflywheel` | getflywheel | ❌ No certificate |
| `localwpe` | getflywheel | ❌ No certificate |

**No expiring or expired certificates were detected.** No installs showed certs expiring within 30 days.

---

### Notes on "Error fetching certs"

The vast majority of installs returned `⚠️ Error fetching certs` — this is expected behavior. The WPE SSL API only returns data for **custom/imported certificates**. Installs on their default `*.wpengine.com` subdomain are covered by WPE's managed wildcard cert, which isn't tracked per-install via the API. Those installs are fine.

### 2 Accounts Couldn't Be Checked (auth expired)

- **esmv7us1l20jdr**
- **esmy9dign4hoqz**

Run `wpe_login` and retry those two if you want full coverage.

---

### Bottom Line

The only ac
```