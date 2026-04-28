# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 11 |
| Error events | 0 |
| Duration | 91.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 3,058 |
| Cache creation | 19,463 |
| Cache read | 611,840 |
| **Total cost** | **$0.3024** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The twin cache only has plugin presence data (slug, active count, sites) — no version info. To check for available updates, WP-CLI needs sites running so it can query wordpress.org.

Here's the situation:

**All 34 local sites are halted.** The `wp plugin update --dry-run --all` command is exactly right for your ask, but it requires sites to be up.

**Options:**

1. **Start sites selectively** — tell me which sites matter to you, I'll start each one, run the dry-run, collect results, and report back before touching anything
2. **Start all sites sequentially** — I cycle through all 34, run dry-run on each, stop it, move to next. Takes a while but gives you a complete picture
3. **Start a subset by criteria** — e.g., only sites linked to WPE production, or only your personal/dev sites

The dry-run output looks like:
```
Plugin 'woocommerce' would update from version 8.5.1 to 8.6.0.   ← minor (safe)
Plugin 'elementor' would update from version 3.20.0 to 4.0.0.   ← major (skip)
```

I'll p
```