# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 12 |
| Error events | 0 |
| Duration | 107.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 4,798 |
| Cache creation | 230,660 |
| Cache read | 1,208,979 |
| **Total cost** | **$1.2997** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a clean summary of your **local sites and their WordPress update status** (latest stable is 6.9.4):

---

## WordPress Version Summary — Local Sites

### Up to date (6.9.4) — 5 sites
- acflikebutton, heath.biz, local-copy-jpp, jpp0413p, nexus-e2e-cli-test-site

---

### Needs patch update (6.9.0 → 6.9.4) — 5 sites
- **wp-archaeologist**, **migrate**, **cli-test**, **wp-migrate-receiver-new**, **wp-migrate-pusher**

```bash
nexus wp core update <site>@local
```

---

### Needs minor update (6.8.x → 6.9.4) — 7 sites
| Site | Current |
|---|---|
| jeremypollock.blog | 6.8.1 |
| nexus | 6.8.1 |
| mu-plugin | 6.8.1 |
| offload-media-clean | 6.8.2 |
| pm-toolkit-hub | 6.8.3 |
| wp-events-analyzer | 6.8.3 |
| nitropack-2 | 6.8.3 |

---

### Significantly behind — 1 site
- **e2e-test-fresh** is on **6.2.2** — likely intentional as a test fixture, but worth verifying.

---

### Unknown / no scan data — ~12 sites
- nitropack-1, wp-archaeologist-saas, cli-target, The Curated Shelf, nexus-t
```