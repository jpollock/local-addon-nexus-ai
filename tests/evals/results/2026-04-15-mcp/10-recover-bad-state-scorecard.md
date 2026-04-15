# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 42 |
| Error events | 0 |
| Duration | 225.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 60 |
| Output tokens | 9,430 |
| Cache creation | 83,227 |
| Cache read | 2,068,941 |
| **Total cost** | **$1.0744** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Found the root cause. In the unified fleet view, `jppblank` shows **no ↔ link** between the local site and the WPE install — they're two separate, unconnected things. Every other connected pair shows ↔; jppblank doesn't.

**What happened:** The local `jppblank` site and the WPE `jppblank` install both exist independently. Without an established WPE connection in Local, Magic Sync can't push — which explains the zero sync history (no push was ever recorded because the link was never set up).

**The state of things:**
- Local `jppblank` (edqY1Hhb0) — running, no WPE connection
- WPE `jppblank` (3beb5d13, production) — healthy, PHP 8.2, untouched

**To fix it — connect the sites first:**

In the Local UI:
1. Click `jppblank` in the site list
2. Find the **"WP Engine"** tab or **"Connect"** button
3. Select the `jppblank` WPE install to link them
4. Then run the push

Or via CLI if you prefer:
```bash
nexus wpe link jppblank --install jppblank
```

Once linked, retry the push. The WPE inst
```