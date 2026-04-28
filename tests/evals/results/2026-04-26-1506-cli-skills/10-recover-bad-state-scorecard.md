# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 16 |
| Error events | 0 |
| Duration | 176.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 6,775 |
| Cache creation | 22,972 |
| Cache read | 708,266 |
| **Total cost** | **$0.4003** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The site is actually up (HTTP 200, SSL verified). Here's the full picture:

---

**What I found:**

**The site IS working** — `https://jppblank.wpenginepowered.com` returns HTTP 200 with a valid SSL certificate. The `nexus diagnose` showing `❌ SSL certificate` and `❌ Recent backup` are false positives — `nexus wpe ssl jppblank` and `nexus wpe domains jppblank` both 404 because those CAPI sub-endpoints appear to require a UUID, not the install name. That's a Nexus bug in how those commands look up installs, not an actual problem with the site.

**But the content is the issue.** The screenshot you captured shows a default "Hello world!" WordPress install — standard WPE fresh-install state with the default tagline "Your SUPER-powered WP Engine Site". This means one of two things happened when you tried to push:

1. **Push failed silently** — the site never received your local content, and it remains in its original blank state from when the WPE environment was first created.
2. **Push suc
```