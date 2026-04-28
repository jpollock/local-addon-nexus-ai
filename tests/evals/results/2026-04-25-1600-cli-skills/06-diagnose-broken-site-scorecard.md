# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 19 |
| Error events | 0 |
| Duration | 168.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 21 |
| Output tokens | 5,990 |
| Cache creation | 20,816 |
| Cache read | 1,525,647 |
| **Total cost** | **$0.6257** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found. Two issues:

1. **"jppblank" doesn't exist as a local site** — it's not in your Local sites list at all. The closest match is `jpp0413p` (halted, linked to WPE).

2. **Not authenticated with WP Engine** — so I can't look up WPE installs to check if "jppblank" is a WPE environment.

To diagnose further, I need to know which context you mean:

**Is jppblank...**
- A **WPE install**? → Run `nexus wpe login` to authenticate, then I can look it up and check its status/domains/SSL.
- A **local site** that should exist but doesn't? → It may not have been created yet, or it got removed. I can help create or restore it.
- A **local site that won't start**? → It's not in your site list at all, so Local doesn't know about it.

The quickest path: run `nexus wpe login` to authenticate with WP Engine, and I can check if jppblank is a WPE install and what's wrong with it.
```