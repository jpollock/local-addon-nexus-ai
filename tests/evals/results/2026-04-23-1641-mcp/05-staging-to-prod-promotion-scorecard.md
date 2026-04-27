# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 13 |
| Error events | 0 |
| Duration | 153.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 20 |
| Output tokens | 4,958 |
| Cache creation | 34,218 |
| Cache read | 712,214 |
| **Total cost** | **$0.4164** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The CAPI `/install_copy` endpoint is returning HTTP 400 consistently across all parameter combinations — this appears to be a WP Engine API-side restriction rather than a parameter issue (both installs are confirmed on the same site and account).

Here's where things stand:

**Completed:**
- Production backup created — Backup ID: `24e974b1-3eb4-4138-bb34-d339f5ce0059`

**Blocked:**
- The WPE CAPI `POST /install_copy` endpoint rejects the request with HTTP 400. This can happen when the account plan doesn't expose environment copy via API, or when the CAPI has a restriction on promoting staging → production for this install pair.

**To complete the promotion manually**, go to the WP Engine portal:
1. Log in to `my.wpengine.com`
2. Navigate to the **wpeplugintest** site
3. Open the **jppwpeplugistg** (staging) environment
4. Click **Copy to** → select **jppwpeplugin** (production)

The production backup is already in place if you need to roll back.
```