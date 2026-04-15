# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 223.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 17 |
| Output tokens | 3,378 |
| Cache creation | 77,913 |
| Cache read | 511,573 |
| **Total cost** | **$0.4964** |

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
The nexus CLI is running into two blockers here:

1. **Version mismatch** — CLI is v0.2.1, addon is v0.2.4. The CLI times out on most commands that require Local connectivity.
2. **No `gateway usage` CLI command exists yet** — there's no `nexus gateway` or `nexus ai usage` subcommand in the current CLI. The usage dashboard exists in the **Local addon UI** (auto-refreshes via IPC + 30s poll), not exposed as a CLI command.

Here's how to get the data right now:

**Option 1 — Addon UI**
Open Local → click the Nexus AI section on any site → look for the "Gateway Usage" panel. It shows usage broken down by model and request.

**Option 2 — Fix the CLI first**
```bash
nexus update      # bring CLI to v0.2.4
```
Then restart Local to get the MCP server responding. After that, more commands will work.

**Option 3 — Query the gateway DB directly** (the usage is in better-sqlite3 at `~/Library/Application Support/Local/nexus-ai/`) — but that requires file tools which I can't use under current con
```