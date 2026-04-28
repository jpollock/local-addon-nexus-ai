# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 20 |
| Error events | 0 |
| Duration | 217.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 13 |
| Output tokens | 9,607 |
| Cache creation | 29,380 |
| Cache read | 891,364 |
| **Total cost** | **$0.5217** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1028-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Confirmed: `/wp-json/` returns empty — pretty permalinks are disabled. Here's the full picture:

**What I found with jppblank:**

1. **Pretty permalinks are disabled** — the REST API link in the page source uses `index.php?rest_route=/` instead of the standard `/wp-json/` path. The clean URL endpoint returns nothing, so any plugin or integration that hits `/wp-json/` won't work. This is likely why things feel broken.

2. **No recent backup** — `nexus wpe diagnose` flagged this. Either WPE backups aren't running or the site hasn't had activity that triggers one.

3. **No SSL cert in CAPI** (minor) — no custom domain configured; the site just uses the default `jppblank.wpenginepowered.com` wildcard cert, which works fine in the browser but shows up as a gap in the diagnostic.

**The site itself is up** — HTTP 200, WordPress serving full HTML, WP admin login redirecting correctly.

**Root cause:** Go to the WP admin → Settings → Permalinks, save any permalink structure (e.g. Post name). T
```