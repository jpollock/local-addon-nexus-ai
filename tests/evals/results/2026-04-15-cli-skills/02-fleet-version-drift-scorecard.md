# Eval Scorecard: 02-fleet-version-drift (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 42 |
| Error events | 0 |
| Duration | 266.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 77 |
| Output tokens | 8,289 |
| Cache creation | 86,931 |
| Cache read | 1,700,993 |
| **Total cost** | **$0.9609** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/02-fleet-version-drift-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found — and there's an important limitation to explain:

**The problem: All 31 sites are halted.**

Nexus gets WordPress version data via WP-CLI, which requires a site to be running. With all sites halted, `wpVersion` returns `null` for every site — so the CLI can't report which ones are behind.

```
nexus fleet filter --json  →  31 sites, all wpVersion: null
```

**To get WP version data, you have two options:**

**Option 1 — Start sites individually and check:**
```bash
nexus sites start <site-name>
nexus wp <site-name> "core version"
```

**Option 2 — Start all and run a fleet health sweep:**
```bash
nexus sites start <site-name>  # for each site you care about
nexus fleet filter --json       # will now show wpVersion
```

**What I can tell you right now:**
- You have **31 local sites**, all halted
- Fleet health reports **1 warning + 5 critical** issues, but those appear to be connectivity/health checks, not WP version flags (since versions can't be read)
- The latest
```