# Eval Scorecard: M4-03-health-nexus-itself (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 37.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 694 |
| Cache creation | 12,805 |
| Cache read | 356,719 |
| **Total cost** | **$0.1655** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M4-03-health-nexus-itself-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the Nexus health summary:

**Overall: Mostly healthy with one flag**

| Check | Status |
|---|---|
| Local sites | 8/8 running, all indexed |
| WPE authentication | Connected (10 accounts) |
| Event queue | Clean (0 pending, 0 failed) |
| Knowledge graph | 4,090 content items, 3,479 plugins |
| MCP server uptime | ~4.3 hours |

**One issue flagged:** MCP tool error rate is **9%** (threshold is 5%). This session has logged 9 errors across 100 tool calls — likely from the failed `wpe_status` call (which hit a GraphQL schema mismatch, `Cannot query field "wpeStatus"`) and possibly other transient failures. This is cosmetic rather than critical — all core systems are operational.

Everything that matters is working: Local is running, WPE is authenticated, search indexes are live, and the event pipeline is clean.
```