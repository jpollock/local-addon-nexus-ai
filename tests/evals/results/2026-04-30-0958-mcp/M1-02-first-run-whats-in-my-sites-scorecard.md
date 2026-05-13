# Eval Scorecard: M1-02-first-run-whats-in-my-sites (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 57.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 683 |
| Cache creation | 25,597 |
| Cache read | 208,644 |
| **Total cost** | **$0.1688** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M1-02-first-run-whats-in-my-sites-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your fleet overview:

### Local Sites (8)
**Running:**
- `nexus-e2e-test` — nexus-e2e-test.local
- `jpp0413p` — jpp0413p.local
- `local-copy-jpp` — local-copy-jpp.local

**Halted:**
- `jeremypollockblog`, `nexus`, `nitropack-1`, `ACF Auto Car Finder`, `Newsroom Demo`

### WP Engine (310 installs)
You have a large WPE fleet. Notable ones include:
- **jpp0413p** (production) — matches your running local site
- **localwpe** + **localstg2** — the Local product's own WPE environments
- **jeremypollock2** + staging/dev — your personal blog
- **benfischer** — full prod/staging/dev set
- Various test/demo/support/autoscale installs (most recent: `cafe0430001`, `kwh20260429`, `seamlesstest1`)

None of your local sites appear to be explicitly linked (↔) to WPE installs in this view, though `jpp0413p` shares a name with the WPE install `jpp0413p`. Want me to dig into any specific site or check indexing/health status?
```