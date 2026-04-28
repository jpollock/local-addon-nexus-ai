# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 51.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 6 |
| Output tokens | 1,738 |
| Cache creation | 23,178 |
| Cache read | 290,819 |
| **Total cost** | **$0.2003** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what the fleet scan found:

---

**Fleet snapshot — 30 sites total (2 running, 28 halted)**

### Running sites — plugins checked

| Site | Plugins | Updates available |
|---|---|---|
| `nexus-e2e-cli-test-site` | 0 plugins installed | — |
| `eval-test-onboard` | 6 plugins | **none** (all `null`) |

**`eval-test-onboard` plugin versions:**
- `ai` — 0.6.0
- `ai-provider-for-local-gateway` — 1.0.0
- `akismet` — 5.6 (inactive)
- `nexus-ai-connector` — 1.0.0
- `nexus-ai-connector-config` — must-use
- `advanced-cache.php` — drop-in

All plugins on both running sites are already up-to-date. Nothing to update.

---

### The 28 halted sites

WP-CLI can't reach halted sites — they have no running PHP/web process. To check or update their plugins, each site would need to be started first. That's 28 start cycles, which would take a while and is probably more disruptive than useful.

**Options if you want to go deeper:**
1. Start specific sites you care about and run `nexus wp plugin update 
```