# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 53 |
| Error events | 0 |
| Duration | 370.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 55 |
| Output tokens | 12,927 |
| Cache creation | 44,024 |
| Cache read | 4,760,220 |
| **Total cost** | **$1.7872** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The root issue is clear now. Both backup creation and the promote operation require WPE OAuth authentication via Local (`capiGetInstalls()` is called which needs the CAPI OAuth service). The basic auth credentials only cover the final backup HTTP call — not the install lookup step.

**You need to authenticate with WP Engine first.** Here's the situation:

| Operation | Auth Needed | Status |
|-----------|-------------|--------|
| List installs (for lookup) | WPE OAuth | ❌ Not logged in |
| Create backup | Basic auth (configured) + OAuth for lookup | ❌ Blocked by lookup |
| Promote environment | WPE OAuth | ❌ Not logged in |

**To proceed, run this in a terminal:**

```bash
node /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai/bin/nexus.js wpe login
```

This opens a browser. Complete the WPE login there, then come back and I'll run the full sequence:

1. Create + verify a backup of `jppwpeplugin` (production, ID: `74123063-1f21-4080-b983-aaa5c95ed1e2`)
2. Promote `jppwpe
```