# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 21 |
| Error events | 0 |
| Duration | 150.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 26 |
| Output tokens | 6,259 |
| Cache creation | 46,603 |
| Cache read | 843,378 |
| **Total cost** | **$0.5217** |

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
The sandbox is blocking all outbound network connections (curl, node, python all require approval), and the nexus CLI (v0.2.1) doesn't have a command for this.

**The short answer: gateway spending by site and model isn't exposed through the CLI yet.**

Here's what I found:

- The gateway is running at `127.0.0.1:13000`, but its usage endpoints require network access the sandbox won't approve
- The nexus CLI has no `nexus ai usage`, `nexus ai gateway`, or equivalent command
- Gateway usage data IS tracked — the Local addon UI has a "gateway usage dashboard" that shows this, auto-refreshed via IPC

**Where you can get this today:**
1. **Local addon UI** — the addon panel in Local shows gateway usage data per site, refreshed every 30s
2. **Local app data** — the underlying SQLite DB at `~/Library/Application Support/Local/nexus-ai/` holds the raw records, but I can't query it from this sandbox

**Two things worth noting:**
- There's a CLI update to **v0.2.4** available (`nexus update`) —
```