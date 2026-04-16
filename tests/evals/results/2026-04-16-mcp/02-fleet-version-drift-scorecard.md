# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 32.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 1,201 |
| Cache creation | 40,555 |
| Cache read | 156,891 |
| **Total cost** | **$0.2172** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The `find_outdated_sites` tool needs your permission before I can run it — you should see a permission prompt in your Local/Claude interface.

Here's what I have so far from the fleet health summary while you decide:

**Fleet Overview — 6 local sites, average score 47/100**

| Site | Score | Status |
|---|---|---|
| autocarfinder | 41/100 | Critical |
| acflikebutton | 41/100 | Critical |
| andonovstg | 41/100 | Critical |
| another-test | 47/100 | Critical |
| frostscape | 51/100 | Warning |
| jppblank | 61/100 | Warning |

Zero sites are in a "healthy" state, which suggests version currency is a contributing factor across the board. Once you approve the `find_outdated_sites` permission, I can give you the exact WordPress versions and which specific sites are behind.
```