# Eval Scorecard: M5-02-compare-which-copy-to-use (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 57.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 2,117 |
| Cache creation | 11,888 |
| Cache read | 158,809 |
| **Total cost** | **$0.1240** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M5-02-compare-which-copy-to-use-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus AI MCP tools aren't appearing as connected in this session — both site-inspection skills rely on the MCP server being registered, and it's not showing up. Without it, I can't inspect content, plugin states, or activity across those sites.

Based on naming alone:

- **`jpp-client`** — this is your active development site. It's the "clean" name, no qualifier.
- **`jpp-client-staging`** — use this to test changes before deploying to production WPE. Develop in `jpp-client`, promote to staging when ready.
- **`jpp-client-old`** — archived reference only; don't develop here.

So: **`jpp-client`** for active work, **`jpp-client-staging`** as your pre-deploy validation environment.

To confirm this with actual data (running status, WordPress versions, recent content), you'd need to check that the Nexus AI MCP server is connected to your Claude Desktop session. Run `nexus doctor` from the terminal or check the MCP server config — if it's connected, I'd be able to inspect those sites d
```