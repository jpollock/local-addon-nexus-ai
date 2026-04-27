# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 205.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 13 |
| Output tokens | 6,431 |
| Cache creation | 42,784 |
| Cache read | 797,412 |
| **Total cost** | **$0.4962** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found across all the checks:

**The WPE install looks healthy:**
- Install is `active` and SSH-ready
- WordPress `siteurl` and `home` are both correctly set to `https://jppblank.wpenginepowered.com` — no URL mismatch
- Domains are configured correctly
- No stuck push operation is running

**What I couldn't find:**
- No local site named `jppblank` exists in your fleet
- Neither `jpp0413p` nor `local-copy-jpp` has any push history to jppblank
- So I can't tell which local site you pushed from, or see a failure record for it

**The SSL 404 is a red herring** — it just means no manually-provisioned cert. WPE's `wpenginepowered.com` subdomain uses their wildcard cert, which doesn't appear in that API.

---

**My read:** From everything accessible via MCP, jppblank's WPE environment is in good shape. A few questions that would help pin down what went wrong:

1. **What does "weird state" look like?** Can you visit `https://jppblank.wpenginepowered.com` and see the site? Or is it
```