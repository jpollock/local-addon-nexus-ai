# Eval Scorecard: M3-02-find-which-copy-is-real

**Date:** 2026-04-30  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 85.5/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 9 |
| Error events | 4 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 1,501 |
| Output tokens | 298 |
| Total tokens | 1,799 |
| Estimated cost | $0.0090 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 350 |
| Tool results | 705 |
| Skill prompts | 0 |
| Conversation | 743 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| steps correct | 80 | 20% |
| completeness | 70 | 30% |
| output clarity | 85 | 10% |
| **Weighted total** | **85.5** | |

## Reviewer Notes

Sites dont exist — correctly identified that and showed what does exist. Clean handling.

## Transcript

```
EVAL TRANSCRIPT (AUTOMATED)
Case: M3-02-find-which-copy-is-real
Mode: cli-skills
Date: 2026-04-30
Model: claude-sonnet-4-6
Duration: 191.8s
Tool calls: 9
Cost: $0.1877

============================================================
TURN 1
============================================================
PROMPT: I have a few sites that look like copies of the same project — jpp-client, jpp-client-2, and jpp-client-backup. Which one is the most recent? Which should I actually be working in?

I'll read the relevant skill files to get the right approach, then investigate all three sites in parallel.

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-sites/SKILL.md"})

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-search/SKILL.md"})

⏺ Read({"file_path":"/Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/.claude/skills/nexus-wp/SKILL.md"})
  ⎿  1	---
2	name: nexus-sites
3	description: Discover and show all local and WP Engine sites with status. Groups running vs halted, shows WPE links, and surfaces next actions. Use at the start of any workflow involving sites — always call this first before acting on a site.
4	allowed-tools: Bash(nexus *)
5	---
6	
7	# Site Discovery
8	
9	```!
10	nexus sites list
11	```
12	
13	Present the results clearly:
14	
15	1. **Running local sites** (ready to use) — name, domain, WPE link if any
16	2. **Halted l
  ⎿  1	---
2	name: nexus-wp
3	description: Run WP-CLI commands on a local WordPress site via nexus. Target format is <sitename>@local. For WPE remote installs use nexus-wpe skill instead.
4	argument-hint: <site@local> <wp-cli-command>
5	allowed-tools: Bash(nexus *)
6	---
7	
8	# WP-CLI via Nexus (local sites)
9	
10	For **local** sites only. WPE remote installs → use `nexus-wpe` skill.
11	
12	Target format: `<sitename>@local` or bare site name (auto-resolved from graph DB).
13	
14	**Common commands:**

  ⎿  1	---
2	name: 
... [truncated]
```