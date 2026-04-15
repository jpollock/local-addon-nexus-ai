# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 15 |
| Error events | 0 |
| Duration | 379.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 17 |
| Output tokens | 6,813 |
| Cache creation | 59,823 |
| Cache read | 613,103 |
| **Total cost** | **$0.5105** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I've hit a wall — here's the diagnosis:

**Root cause: nexus CLI v0.2.1 is incompatible with addon v0.2.4, causing all site commands to time out.**

The `nexus update` command ran but updated a *different* install path (not the one in your `PATH` at `~/node_modules/.bin/nexus`). Every nexus command that needs to talk to Local is hanging before it can get info about jppblank.

**What I can confirm:**
- Local is running
- GraphQL server is up (port 4000)
- MCP server is not responding (port 10800)
- Some site services are running (nginx, php-fpm, mysqld, mailpit — started at 9:16AM)

**To unblock this, please do these two things:**

1. **Fix the CLI version mismatch** — run this in your terminal to update the PATH version:
   ```bash
   npm install -g @local-labs-jpollock/local-addon-nexus-ai@0.2.4
   ```
   Or update the local install: `npm install @local-labs-jpollock/local-addon-nexus-ai@0.2.4` from `~/`

2. **Restart Local** — `nexus doctor` explicitly recommended this to get the MCP
```