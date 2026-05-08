# Eval Scorecard: M4-N1-health-wpe-not-authenticated (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 74.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,542 |
| Cache creation | 28,427 |
| Cache read | 356,099 |
| **Total cost** | **$0.2366** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M4-N1-health-wpe-not-authenticated-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
You're authenticated. Here's what the scan found across **309 installs**:

## SSL Summary

### 🚨 Critical — No Certificate (3 production installs)
These sites have no SSL at all and will show as insecure to visitors:

| Install | Domain |
|---------|--------|
| `localwpe` | localwpe.wpengine.com |
| `frostwpe` | frostwpe.wpengine.com |
| `frostscape` | frostscape.wpengine.com |

### ⚠️ Note on "SSL expiring" warnings
Nearly every other install shows "⚠️ Error fetching SSL / SSL expiring" — this is almost certainly a rate-limiting or API availability issue with the SSL cert endpoint, not 209 sites actually expiring. WPE auto-renews Let's Encrypt certs on `.wpengine.com` subdomains, so mass expiry would be very unusual.

## Recommended action
The 3 `❌ No cert` installs are the real concern. Want me to drill into one of them to check what domains are configured and request a certificate? For example:

```
wpe_get_domains → localwpe install ID
wpe_request_ssl_certificate → for each uncove
```