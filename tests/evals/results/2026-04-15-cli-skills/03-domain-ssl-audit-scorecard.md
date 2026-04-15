# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 24.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 806 |
| Cache creation | 75,699 |
| Cache read | 76,272 |
| **Total cost** | **$0.3189** |

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
It looks like the MCP permission needs to be approved. Once you grant access, I'll:

1. Fetch all your WP Engine accounts
2. Run `wpe_account_ssl_status` against each account in parallel
3. Report any domains with SSL issues or certs expiring within 30 days

Please approve the `mcp__wp-nexus__wpe_get_accounts` tool call and I'll proceed.
```