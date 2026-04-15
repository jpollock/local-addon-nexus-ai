# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 20 |
| Error events | 0 |
| Duration | 321.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 23 |
| Output tokens | 5,434 |
| Cache creation | 77,817 |
| Cache read | 746,227 |
| **Total cost** | **$0.5973** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I've hit a blocker I can't work around from here. Here's the situation:

**Root cause:** Two `nexus` issues are preventing WordPress version data from loading:

1. **Version mismatch** — The `nexus` binary your shell uses (`~/node_modules/.bin/nexus`) is v0.2.1, but `nexus update` updated a *different* global installation. The running binary is still 0.2.1 while the addon is v0.2.4.

2. **MCP server not responding** — `nexus sites list`, `nexus fleet health`, and all site-querying commands route through the MCP server on port 10800. While Local *is* listening there, the CLI can't communicate with it (likely due to the version mismatch).

**To fix this and answer your question:**

```bash
# Option 1: Update the local nexus package that your shell uses
cd ~ && npm install @local-labs-jpollock/local-addon-nexus-ai@latest

# Option 2: Restart Local to clear any hung MCP connections
# (then reopen this terminal to pick up fresh PATH)
```

After either fix, run:
```bash
nexus fleet health
``
```