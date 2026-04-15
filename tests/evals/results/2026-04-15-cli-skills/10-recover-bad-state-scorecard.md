# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 226.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,527 |
| Cache creation | 48,080 |
| Cache read | 173,983 |
| **Total cost** | **$0.2554** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I can see:

**The immediate problem:** The MCP server (port 10800) is not responding, which is why every nexus command hangs. This is unrelated to Local itself being up — Local and GraphQL (port 4000) are both running fine.

**Likely connection to your push:** The failed push to WPE may have left the MCP server in a stuck state.

**What to do:**

1. **Restart Local** (quit and reopen the app) — this will reset the MCP server and addon state
2. After restart, run `nexus update` to fix the version mismatch (CLI v0.2.1 vs addon v0.2.4)
3. Then I can check the sync history for `jppblank` to see what actually happened with the push

There's also a version mismatch worth knowing about:
- CLI: `v0.2.1`
- Addon: `v0.2.4` (dev)

This mismatch alone shouldn't break things, but it's worth cleaning up. After you restart Local, let me know and I'll pull the sync history and WPE status for `jppblank` to figure out where that push stands.
```