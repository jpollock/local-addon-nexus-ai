# Eval Scorecard: M4-02-health-database (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 52.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 1,008 |
| Cache creation | 12,987 |
| Cache read | 208,689 |
| **Total cost** | **$0.1264** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M4-02-health-database-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the database health summary across all 8 running sites:

---

**Fleet Overview:** 8 scanned, 0 failures. 4 sites are clean (score 100), 4 need attention.

---

### Sites Needing Attention

| Site | Score | Top Issue |
|---|---|---|
| **Newsroom Demo** | 78 | 3,866 orphaned postmeta rows + 59 revisions + 23 trashed posts |
| **nexus-e2e-test** | 88 | 417 post revisions accumulating (recommend `WP_POST_REVISIONS = 5`) |
| **local-copy-jpp** | 88 | 376 orphaned postmeta + WP Rocket autoload bloat (0.1 MB/request) |
| **ACF Auto Car Finder** | 90 | 205 orphaned postmeta rows + ACF autoload bloat |

**Newsroom Demo is the worst offender** — the 3,866 orphaned postmeta rows look like leftover data from a removed plugin (`_mediapress_revisions_revision_name`). That's worth cleaning up.

---

### Clean Sites (Score 100)

`jeremypollockblog`, `jpp0413p`, `nexus`, `nitropack-1` — no actionable issues.

---

**Want me to run `clean_database_items` on any of these?** It defaults to a dry ru
```