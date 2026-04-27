# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 175.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 969 |
| Cache creation | 15,961 |
| Cache read | 66,630 |
| **Total cost** | **$0.2783** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Your WP Engine session has expired — the OAuth token needs refreshing before the SSL audit can proceed.

**What to do:**

Run this in your terminal to re-authenticate:
```
nexus wpe login
```

This opens the browser OAuth flow outside of MCP, stores the token, and all `wpe_*` tools will work again.

Once that's done, come back and say **"retry the SSL audit"** — I'll immediately fan out parallel `wpe_account_ssl_status` calls across every account and report back with:
- Domains with SSL issues (invalid / pending / failed / missing certs)
- Certificates expiring within the next 30 days (with exact expiry dates)
- Which account each issue belongs to
```