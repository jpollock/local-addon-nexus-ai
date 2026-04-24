# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 39 |
| Error events | 0 |
| Duration | 287.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 38 |
| Output tokens | 11,022 |
| Cache creation | 35,114 |
| Cache read | 1,818,899 |
| **Total cost** | **$0.8428** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1934-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Promotion is complete. Here's a summary of what happened:

**Done:**
1. **Backup created** — Pre-promotion backup of `jppwpeplugin` (production) with ID `e50447b9-bac4-4a8b-b1d2-491e0da7f3d5`
2. **Staging promoted to production** — `jppwpeplugistg` → `jppwpeplugin` (files + database)

**Bug fixed along the way:** The `wpe promote` command was sending wrong field names to the CAPI (`source_install_id` / `destination_install_id` / `include_database`) and was passing install *names* instead of *UUIDs*. Fixed in both GraphQL resolvers (`resolvers.ts`, `resolvers/wpe.ts`) and the MCP `promote-environment.ts` handler to:
- Resolve install names → UUIDs via `/installs/{id}` before calling `/install_copy`
- Use correct CAPI field names: `source_environment_id`, `destination_environment_id`, `custom_options.include_db`
```