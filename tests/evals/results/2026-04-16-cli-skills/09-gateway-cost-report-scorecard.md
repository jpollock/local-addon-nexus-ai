# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 23 |
| Error events | 0 |
| Duration | 168.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 26 |
| Output tokens | 7,078 |
| Cache creation | 46,469 |
| Cache read | 949,528 |
| **Total cost** | **$0.5654** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I've hit the key issue: **Local isn't running**, so the addon and gateway are unreachable. The nexus CLI returns HTTP 500 for all addon-dependent commands, and the sandbox blocks direct network/filesystem access.

Here's what I can confirm:

**Why I can't get the data right now:**
- The AI gateway runs as Local's `HttpEventInterface` — it only runs when Local is open
- Gateway usage data lives in the addon's SQLite database, which is only accessible via the addon (or with Local open)
- `nexus sites list` → HTTP 500; all site-level AI commands fail the same way

**To get the breakdown you want, start Local first:**

```bash
# Open Local app, then:
nexus doctor        # verify addon is reachable
nexus sites list    # confirm sites are visible
```

Once Local is running, I can pull the gateway cost breakdown by site and model. The addon's usage dashboard tracks token counts per site and model — that data feeds into the UI's "Gateway Usage" panel and is queryable via the MCP server's tools
```