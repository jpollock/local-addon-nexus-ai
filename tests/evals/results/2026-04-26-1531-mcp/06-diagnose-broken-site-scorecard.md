# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 35 |
| Error events | 0 |
| Duration | 498.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 114 |
| Output tokens | 15,656 |
| Cache creation | 51,565 |
| Cache read | 3,034,941 |
| **Total cost** | **$1.3390** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
**Root cause confirmed.** The `permalink_structure` option is **empty** and `rewrite_rules` is **empty**. This means WordPress is using "Plain" permalinks — no pretty URLs, no rewrite rules, and critically, **no REST API routing**. That's why `/wp-json/` returns HTML instead of JSON.

Here's the full diagnostic summary:

**What's broken:** The WordPress REST API is non-functional. Any request to `/wp-json/wp/v2/*` gets a 200 response with `text/html` (the homepage) instead of `application/json`.

**Root cause:** `permalink_structure = ""` (Plain mode). Without rewrite rules, the server can't route `/wp-json/` requests to WordPress — they fall through to the homepage.

**Evidence chain:**
1. `permalink_structure` option → empty string
2. `rewrite_rules` option → empty (no rules generated)
3. `GET /wp-json/wp/v2/posts` → 301 → `/wp-json/wp/v2/posts/` → `200 text/html` (homepage)

**Fix:** Set any non-plain permalink structure. The quickest path:

- **Via WP Admin:** Settings → Permalinks
```