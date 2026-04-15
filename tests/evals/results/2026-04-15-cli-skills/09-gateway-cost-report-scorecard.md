# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 205.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 4,273 |
| Cache creation | 44,269 |
| Cache read | 332,060 |
| **Total cost** | **$0.6761** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I'm hitting a wall — the gateway usage data lives in Local's app storage (`~/Library/Application Support/Local/`), which I don't have filesystem access to read, and there's no CLI command to query it yet.

**What does exist:**
- The data IS tracked — every gateway request is logged with `siteId`, `siteName`, `model`, `provider`, `costUsd`, `promptTokens`, `completionTokens`, and timestamp
- It's accessible in the **Local app UI** — look for the "Gateway Usage" panel in the Nexus AI addon tab
- Records are capped at the last 1,000 requests

**Two options to get you this data:**

1. **Quickest now:** Open the Local app → find your Nexus AI addon tab → the Gateway Usage dashboard shows cost by site/model with time filters (1h / 24h / 7d / all)

2. **I can build a `nexus gateway usage` CLI command** that reads the storage file and prints a breakdown by site and model — similar to how the UI dashboard works. This would let you query it from the terminal going forward. Want me to do that?
```