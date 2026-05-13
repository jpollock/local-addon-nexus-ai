# Eval Scorecard: M1-03-first-run-make-searchable

**Date:** 2026-04-30  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 22.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 1 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 763 |
| Output tokens | 266 |
| Total tokens | 1,029 |
| Estimated cost | $0.0063 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 91 |
| Tool results | 274 |
| Skill prompts | 0 |
| Conversation | 664 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 0 | 40% |
| steps correct | 20 | 20% |
| completeness | 30 | 20% |
| output clarity | 60 | 20% |
| **Weighted total** | **22.0** | |

## Reviewer Notes

WRONG: said 310 sites already indexed. Ignored local sites not indexed. Prompt now fixed.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M1-03-first-run-make-searchable
Mode: cli-skills
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 25.4s
Tool calls: 3
Cost: $0.0910

============================================================
TURN 1
============================================================
PROMPT: I want to be able to search my sites. How do I get started?

Let me check the setup and search skill files to give you accurate guidance.

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-doctor/SKILL.md"})

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-search/SKILL.md"})
  ⎿  1	---
2	name: nexus-search
3	description: Search across all indexed local WordPress sites by content. Use when looking for sites that contain specific content, posts, or pages. Pass the search query as args.
4	argument-hint: <search query>
5	allowed-tools: Bash(node *)
6	---
7	
8	# Cross-Site Content Search
9	
10	Search query: `$ARGUMENTS`
11	
12	Run this command to search all indexed local sites:
13	
14	```
15	nexus content search-all "$ARGUMENTS"
16	```
17	
18	Then present the results clearly:
  ⎿  1	---
2	name: nexus-doctor
3	description: Run Nexus AI diagnostics. Checks Local running, addon active, MCP server, gateway, AI provider, API key, and site count. Auto-suggests the exact fix command for every failure. Use when troubleshooting Nexus or verifying a working setup.
4	allowed-tools: Bash(nexus *)
5	---
6	
7	# Nexus AI Diagnostic
8	
9	Current system status:
10	
11	```!
12	nexus doctor
13	```
14	
15	Based on the output above:
16	
17	1. **Triage**: Separate ✅ passing, ⚠️ warnings, ❌ fai
Let me run a quick health check first to see where things stand.

⏺ Bash({"command":"node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/nexus.js doctor 2>&1"})
  ⎿  💡 No AI provider configured. Run: nexus ai config


Nexus AI v0.2.5 — System Health
───────────────────
... [truncated]
```