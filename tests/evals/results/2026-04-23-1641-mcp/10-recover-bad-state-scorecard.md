# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 21 |
| Error events | 0 |
| Duration | 178.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 25 |
| Output tokens | 7,198 |
| Cache creation | 41,820 |
| Cache read | 561,247 |
| **Total cost** | **$0.4332** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I have enough evidence to give you a clear picture. Here's what I found:

---

## What happened

**The WPE install is active but has no SSL certificate.** That's the "weird state."

| Check | Result |
|---|---|
| WPE install `jppblank` status | ✅ Active, PHP 8.2 |
| Domains configured | ✅ 2 (`jppblank.wpenginepowered.com` + `jppblank.wpengine.com`) |
| SSL certificates | ❌ None — API returns 404 (no certs at all) |
| Local site named "jppblank" | ❌ Does not exist |
| Stuck push operation | None found |

**The push likely completed on WPE's end** — the install is `active` and the domains are configured. But SSL was not provisioned (or was wiped), which means the site is currently only accessible over HTTP and any HTTPS traffic will fail with a certificate error.

The missing local site is a separate issue — no local site named `jppblank` exists in Local. Your other jpp-named local sites (`local-copy-jpp`, `jpp0413p`) don't show any push history to `jppblank` either, so I can't trace whi
```