# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 19 |
| Error events | 0 |
| Duration | 167.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4,564 |
| Output tokens | 7,740 |
| Cache creation | 81,945 |
| Cache read | 713,812 |
| **Total cost** | **$0.6512** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Both Bash and MCP tools are pending approval. I can walk you through the exact steps, or you can approve the tool calls as they come up.

Here's what needs to happen — all via the `nexus wpe` CLI:

**Step 1 — Get install IDs** (I need the UUID, not the name):
```bash
nexus wpe installs --json
```
Look for `jppwpeplugin` (production) and `jppwpeplugistg` (staging) and grab their `id` fields.

**Step 2 — Create a verified backup of production** (blocks until complete, ~2-10 min):
```bash
nexus wpe backup-verify <jppwpeplugin-install-id> --description "Pre-promote backup $(date +%Y-%m-%d)"
```
> Note: This requires WPE API credentials (basic auth) stored via `nexus wpe set-credentials`. If you haven't set those, do `nexus wpe credentials-status` first.

**Step 3 — Preview the promotion** (shows warning, no action taken):
```bash
nexus wpe promote <jppwpeplugistg-id> <jppwpeplugin-id>
```

**Step 4 — Execute the promotion** after reviewing:
```bash
nexus wpe promote <jppwpeplugistg-id> <jp
```