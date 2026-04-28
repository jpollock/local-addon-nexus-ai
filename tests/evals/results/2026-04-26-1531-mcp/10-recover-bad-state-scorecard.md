# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 17 |
| Error events | 0 |
| Duration | 242.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 9,299 |
| Cache creation | 38,608 |
| Cache read | 824,994 |
| **Total cost** | **$0.5318** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I now have enough evidence for a complete diagnosis. Here's what I found:

---

**The push itself succeeded.** WordPress 6.9.4 is running, plugins are in place, and the database URLs are correctly set to `https://jppblank.wpenginepowered.com`. The content got there.

**The "weird state" is a missing SSL certificate.** The site URL is configured for HTTPS, but jppblank has no SSL certificate provisioned. Anyone (or any WP process) hitting `https://jppblank.wpenginepowered.com` gets a cert error. That's the broken part.

**Evidence trail:**
- `siteurl` = `https://jppblank.wpenginepowered.com` ✅ (correct, search-replace worked)
- `home` = `https://jppblank.wpenginepowered.com` ✅
- SSL certificates API → 404 (no cert exists)
- Go-live checklist → ❌ "No certificate found covering jppblank.wpenginepowered.com"
- DNS status = unknown (but this is a WPE-managed subdomain, so DNS itself should be fine)

**Why this probably happened:** SSL certs aren't automatically provisioned when you push fil
```