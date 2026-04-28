# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 29 |
| Error events | 0 |
| Duration | 276.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 399 |
| Output tokens | 10,064 |
| Cache creation | 50,334 |
| Cache read | 1,573,721 |
| **Total cost** | **$0.8130** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Root cause found. The `/wp-json/` path returns a cached homepage HTML (`x-cache: HIT: 1`), but `index.php?rest_route=/wp/v2/posts` returns proper JSON. Every URL in the REST API response uses the `index.php?rest_route=` form — **the site is on plain permalinks**.

Here's what's wrong with `jppblank`:

**Root cause: Plain permalinks (never configured after initial install)**

The site was created in August 2025 and has never had its permalink structure changed from the WordPress default. With plain permalinks:
- All post URLs use `?p=1` instead of `/hello-world/` 
- `/wp-json/` doesn't route correctly — requests hit Cloudflare cache and return the homepage
- WP-CLI over SSH also timed out, likely related to the unconfigured state
- 9 of 11 installed plugins are deactivated (fresh default install, never set up)

**Fix**: Log into the WP Admin at `https://jppblank.wpenginepowered.com/wp-login.php`, go to **Settings > Permalinks**, select "Post name" (or any non-plain option), and click **
```