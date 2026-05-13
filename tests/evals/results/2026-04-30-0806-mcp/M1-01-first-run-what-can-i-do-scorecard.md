# Eval Scorecard: M1-01-first-run-what-can-i-do (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 59.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 1,995 |
| Cache creation | 18,267 |
| Cache read | 152,074 |
| **Total cost** | **$0.1441** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0806-mcp/M1-01-first-run-what-can-i-do-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The Nexus MCP tools aren't currently connected to this session, but I can tell you what Nexus enables based on my knowledge of the addon. Here's what you can do right now:

---

**Search across all your local sites**
Ask me things like "which of my sites has a post about checkout errors?" or "find any pages mentioning pricing" — Nexus indexes your site content and searches across all of them at once.

**Get a fleet overview**
"Show me all my sites" — see which are running vs halted, their WordPress versions, and quick links to WP Engine environments if connected.

**Check site health**
- SSL certificate status
- Database health — autoload bloat, orphaned tables, meta key breakdown
- Plugin version drift across sites
- "Which sites need WordPress core updates?"

**Run WP-CLI commands via natural language**
"Check the WordPress version on my staging site" or "list active plugins on my-site" — Nexus translates these to WP-CLI and runs them.

**Database scanning and cleanup**
"Scan the dat
```