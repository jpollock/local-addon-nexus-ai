# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 11 |
| Error events | 0 |
| Duration | 59.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 2,158 |
| Cache creation | 24,210 |
| Cache read | 300,332 |
| **Total cost** | **$0.2133** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a summary of what I found across your 10 WP Engine accounts:

---

## SSL Status Summary

### Accounts Successfully Checked (5 of 10)

| Account | Installs Checked | SSL Issues |
|---------|-----------------|------------|
| devrel | 25 | None |
| jpollock911 | 2 | None |
| w7579 | 34 | None |
| btwpe | 10 | None |
| qawpeproduct | 62 | None |

**Total: 133 installs scanned — no expiring or expired certificates.**

### One Active Custom Domain Found

| Install | Domain | Expiry | Status |
|---------|--------|--------|--------|
| `frostwpe` (devrel) | frostwp.com | 2026-06-28 | ✅ Valid (~64 days out) |

This certificate is healthy and outside the 30-day warning window.

### "Error fetching certs" — What It Means

The vast majority of installs show "Error fetching certs" — this is **not an SSL problem**. It means those installs have no custom domains configured and are using WPE's default `*.wpengine.com` subdomain, which is covered by WPE's own wildcard certificate. No action need
```