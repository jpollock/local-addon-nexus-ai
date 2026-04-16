# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 24 |
| Error events | 0 |
| Duration | 249.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 27 |
| Output tokens | 5,106 |
| Cache creation | 46,769 |
| Cache read | 990,605 |
| **Total cost** | **$0.5492** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found and what you need to know:

---

**The blocker: Local app isn't open.**

The fleet has 30 halted sites. `nexus` can query GraphQL (and even start site processes via it), but WP-CLI commands — which power plugin list/update — require the **Local app to be open** to route PHP execution. Every `wp plugin` command times out with "Timed out waiting for Local."

---

**Good news: the tooling is exactly right for what you want.**

Once Local is open, the workflow is:

```bash
# Preview — what would change (no writes):
/Users/jeremy.pollock/node_modules/.bin/nexus audit plugins --json

# Then per-site dry-run:
/Users/jeremy.pollock/node_modules/.bin/nexus wp plugin update <site>@local --all --dry-run

# And the update command supports --dry-run, which I'd use to filter out major bumps before touching anything
```

The `--dry-run` flag on `nexus wp plugin update` shows what would be updated without making changes — exactly the preview you asked for.

---

**Next steps:**

1.
```