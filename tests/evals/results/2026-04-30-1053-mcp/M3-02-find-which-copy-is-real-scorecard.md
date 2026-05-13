# Eval Scorecard: M3-02-find-which-copy-is-real

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 87.5/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 1 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 596 |
| Output tokens | 235 |
| Total tokens | 831 |
| Estimated cost | $0.0053 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 39 |
| Tool results | 206 |
| Skill prompts | 0 |
| Conversation | 586 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 80 | 20% |
| completeness | 75 | 30% |
| output clarity | 90 | 10% |
| **Weighted total** | **87.5** | |

## Reviewer Notes

Sites don't exist — handled cleanly. Suggested local-copy-jpp as closest match.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M3-02-find-which-copy-is-real
Mode: mcp
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 51.7s
Tool calls: 3
Cost: $0.2568

============================================================
TURN 1
============================================================
PROMPT: I have a few sites that look like copies of the same project — jpp-client, jpp-client-2, and jpp-client-backup. Which one is the most recent? Which should I actually be working in?


⏺ Skill({"skill":"nexus-sites"})
  ⎿  Shell command failed for pattern "```!
nexus sites list
```": [stderr]
(eval):1: command not found: nexus
I'll compare those three sites using the MCP tools directly since we're in MCP-only mode.

⏺ ReadMcpResourceTool({"server":"local-nexus-ai","uri":"nexus://fleet/state"})
  ⎿  {"contents":[{"uri":"nexus://fleet/state","mimeType":"text/markdown","text":"# Fleet State (from local cache)\n\n## WP Engine Installs (306 installs, synced 15m ago)\n\n| install_name | install_id | environment | primary_domain | account |\n|---|---|---|---|---|\n| sprntndntchmbr | 9564d013-757d-4b18-8aa0-93bdd5fb9d99 | production | sprntndntchmbr.wpenginepowered.com | esmy9dign4hoqz |\n| benfischer | 5893fe56-9fde-441c-8692-c9d1623b5ad8 | production | benfischer.wpenginepowered.com | qawpeprodu
The fleet cache doesn't show those three sites — let me check the live site list.

⏺ mcp__local-nexus-ai__local_list_sites({})
  ⎿  ## Local Sites (8 total, 8 running)

### Running
- **nexus-e2e-test** (nexus-e2e-test.local) [id: 6BJ5_1BUz, indexed: yes]
- **jeremypollockblog** (jeremypollockblog.local) [id: At8fkqcKD, indexed: yes]
- **jpp0413p** (jpp0413p.local) [id: zs6yHfXgd, indexed: yes]
- **nexus** (nexus.local) [id: QfFx8PJAR, indexed: yes]
- **nitropack-1** (nitropack-1.local) [id: Fec1MGsPP, indexed: yes]
- **ACF Auto Car Finder** (acf-auto-car-finder.local) [id: mmWgjXGRS, indexed: yes]
- **local-copy-jpp** (local
None of those three sites — `jpp-client`, `jpp-client-2`, or `jpp-
... [truncated]
```