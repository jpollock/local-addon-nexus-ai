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
| Duration | 231.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 20 |
| Output tokens | 7,228 |
| Cache creation | 39,360 |
| Cache read | 2,003,620 |
| **Total cost** | **$0.8572** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found:

**The website itself is fine** — `jppblank.wpenginepowered.com` returns HTTP 200 and the WP admin loads correctly (redirecting to login as expected).

**The real blockers I found:**

1. **WPE API authentication is expired** — `nexus wpe login` returns "Not authenticated." This blocks all WPE management commands (fleet health, diagnose, domains, SSL, etc.). Fix:
   ```
   node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/nexus.js wpe login
   ```

2. **SSH/WP-CLI is timing out** — `nexus wp theme list jppblank` hit the 30s timeout. This suggests either a slow SSH connection to the WPE environment or something on the site is making WP-CLI commands hang (e.g., a plugin with a slow `init` hook).

3. **Site data is 2 days stale** — plugin list showed cached data. The "2 active plugins" and available updates (ACF 6.7→6.8, Genesis Blocks 3.1.7→3.1.8) are from the last sync, not live state.

4. **Not indexed** — jppblank isn't in the content search 
```