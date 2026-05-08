# Eval Scorecard: M4-03-health-nexus-itself

**Date:** 2026-04-30  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 92.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 1 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 632 |
| Output tokens | 289 |
| Total tokens | 921 |
| Estimated cost | $0.0062 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 63 |
| Tool results | 136 |
| Skill prompts | 0 |
| Conversation | 723 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 85 | 20% |
| completeness | 90 | 30% |
| output clarity | 80 | 10% |
| **Weighted total** | **92.0** | |

## Reviewer Notes

2 calls. Ran nexus doctor correctly. Accurate health summary.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M4-03-health-nexus-itself
Mode: cli-skills
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 25.5s
Tool calls: 2
Cost: $0.0861

============================================================
TURN 1
============================================================
PROMPT: Is Nexus working correctly? I want to make sure everything is connected and functioning.

Let me read the nexus-doctor skill to get the right syntax, then run diagnostics.

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-doctor/SKILL.md"})
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

⏺ Bash({"command":"node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/nexus.js doctor","timeout":30000})
  ⎿  💡 No AI provider configured. Run: nexus ai config


Nexus AI v0.2.5 — System Health
──────────────────────────────────────────────────
  ✅  Local app           Installed
  ✅  Local running       Running
  ✅  Nexus AI addon      Active (v0.2.5) · dev
  ✅  Version match       v0.2.5
  ✅  GraphQL server      Connected (port 4000)
  ✅  MCP server          Running · 172 tools (v0.1.0)
  ✅  AI agent config     Claude Desktop
  ⚠️   AI provider         Not configured
  ○   Local Gateway       Disabled
Nexus is largely healthy. Here's the breakdown:

**All green:**
- Local is installed and running
- Nexus AI addon is active (v0.2.5, dev mode)
- GraphQL server connected on port 4000
- MCP server running with 172 tools
- Claude Desktop is configured as the AI a
... [truncated]
```