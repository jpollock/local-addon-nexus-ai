# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 111.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 3,682 |
| Cache creation | 130,024 |
| Cache read | 573,454 |
| **Total cost** | **$0.7149** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Both domain detail calls return HTTP 500 — the install's domain API is in a broken state on WPE's backend. Here's the complete picture:

---

**Root cause: Two compounding issues**

**1. No SSL certificate provisioned** — `wpe_get_ssl_certificates` returned HTTP 404, meaning there are zero SSL certs on this install. Any HTTPS request to `jppblank.wpenginepowered.com` will fail.

**2. Broken domain configuration on WPE's backend** — Both individual domain detail API calls return HTTP 500. The domains listing also shows `[object Object]` in the "Redirect To" column for both domains, which indicates the redirect configuration is stored in a malformed state (an object instead of a domain string). This is likely preventing SSL from being auto-provisioned.

---

**What's working:** The install itself exists, PHP 8.2 is configured, and 2 domains are registered. This is a domain/SSL configuration issue, not a WordPress or code problem.

**What to do:**

Since the domain API is returning 500s, 
```