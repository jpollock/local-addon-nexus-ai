# Eval Scorecard: M5-03-compare-local-wpe-mapping (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 85.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 2,218 |
| Cache creation | 44,431 |
| Cache read | 208,710 |
| **Total cost** | **$0.2625** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M5-03-compare-local-wpe-mapping-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the breakdown. No local sites show the `↔` formal Local Connect link, so none are officially linked via Local's Connect UI. But matching by name reveals clear counterparts:

---

### Paired (name match with WPE install)

| Local Site | WPE Install | WPE Domain |
|---|---|---|
| **jpp0413p** | `jpp0413p` (production) | jpp0413p.wpenginepowered.com |
| **local-copy-jpp** | `localcopyjpp` (production) | localcopyjpp.wpenginepowered.com |
| **Newsroom Demo** | `newsroomdemo` (production) + `newsroomdemstg` (staging) | newsroomdemo.wpenginepowered.com |
| **ACF Auto Car Finder** | `autocarfinder` (production) + `autocarfindstg` (staging) | autocarfinder.wpenginepowered.com |

**Likely pair** (related by purpose/name, less exact):

| Local Site | WPE Install | Note |
|---|---|---|
| **jeremypollockblog** | `jeremypollock2` (production) | WPE site is `jeremypollock.blog` account |

---

### Local-only (no WPE counterpart found)

- **nexus-e2e-test** — test/dev only
- **nexus** — develo
```