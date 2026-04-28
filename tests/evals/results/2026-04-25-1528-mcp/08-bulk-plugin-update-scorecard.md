# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 6 |
| Error events | 0 |
| Duration | 109.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 9 |
| Output tokens | 4,588 |
| Cache creation | 125,743 |
| Cache read | 474,776 |
| **Total cost** | **$0.6828** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Good news — I can work with what the graph DB has. Here's the full picture before touching anything:

---

## Plugin Update Preview — Local Fleet

**Methodology note:** All 31 local sites are halted, so I can't hit WordPress.org for live update data. The version info below comes from cross-site comparison in the graph DB (index is 55 days stale — actual WordPress.org versions may be higher). Treat this as a preview; a live audit would require starting sites.

---

### Patch/Minor bumps — safe to update (same major version)

| Plugin | Site(s) behind | Current → Target | Bump type |
|--------|---------------|-----------------|-----------|
| `akismet` | jeremypollock.blog | 5.2 → 5.6 | minor |
| `ai-provider-for-ollama` | sync-test, The Curated Shelf | 1.0.0 → 1.0.3 | patch |
| `ai-provider-for-anthropic` | The Curated Shelf | 1.0.1 → 1.0.2 | patch |
| `ai` | The Curated Shelf | 0.3.1 → 0.6.0 | minor |
| `advanced-custom-fields` | The Curated Shelf | 6.4.3 → 6.7.0 | minor |
| `advanced-c
```