# Eval Scorecard: M2-01-orientation-all-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 60.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 807 |
| Cache creation | 25,520 |
| Cache read | 208,571 |
| **Total cost** | **$0.1704** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M2-01-orientation-all-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your fleet at a glance:

---

### Local Sites (8) — all running
| Site | Domain |
|------|--------|
| nexus-e2e-test | nexus-e2e-test.local |
| jeremypollockblog | jeremypollockblog.local |
| jpp0413p | jpp0413p.local |
| nexus | nexus.local |
| nitropack-1 | nitropack-1.local |
| ACF Auto Car Finder | acf-auto-car-finder.local |
| local-copy-jpp | local-copy-jpp.local |
| Newsroom Demo | newsroom-demo.local |

---

### WP Engine Environments (310)
A large fleet — highlights include:

- **Your personal sites**: `jeremypollock2` (prod/stg/dev), `jpmeautoscale` (LIVE: jeremypollock.me), `jpp0413p`
- **Key demo/test sites**: `localwpe`, `newsroomdemo`, `acfrecipes`, `autocarfinder`, `fakerincdemo`, `ecommtruspice`
- **Autoscale tests**: `newsroomauto`, `imjlargeauto`, `imjomeosesauto`, numerous `*fluid*` and `*autoscal*` installs
- **Blueprints**: `atlascommerce`, `atlasshopify`, `atlasportfolio`, `faustscaffold1`, `bpheadlessb*`
- **Support/QA sites**: `tamtesting`, `ciantester`, 
```