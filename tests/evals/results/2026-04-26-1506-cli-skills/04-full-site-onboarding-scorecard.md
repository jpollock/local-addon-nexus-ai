# Eval Scorecard: 04-full-site-onboarding (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 33 |
| Error events | 0 |
| Duration | 271.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 352 |
| Output tokens | 6,708 |
| Cache creation | 51,884 |
| Cache read | 2,665,431 |
| **Total cost** | **$1.0959** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1506-cli-skills/04-full-site-onboarding-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Everything is healthy. Here's a summary:

**AI setup on `eval-test-onboard` — complete**

- WordPress upgraded from 6.9.4 → 7.0-RC2 (required for AI Experiments)
- AI setup ran with Anthropic as the provider (the Local Gateway is already globally enabled and will route requests through it)

**Health check:**
| Check | Status |
|---|---|
| Nexus AI Connector | ✅ Installed (1.0.0) |
| Experiments | ✅ Enabled |
| Providers configured | ✅ 1 (Anthropic) |
| Credentials | ✅ Synced |
| Abilities | ✅ 3 available |

The site is fully configured and healthy.
```