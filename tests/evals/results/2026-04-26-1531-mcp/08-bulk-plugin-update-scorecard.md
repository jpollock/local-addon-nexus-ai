# Eval Scorecard: 08-bulk-plugin-update (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 1 |
| Error events | 0 |
| Duration | 27.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 645 |
| Cache creation | 12,037 |
| Cache read | 201,501 |
| **Total cost** | **$0.1153** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/08-bulk-plugin-update-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Only one update is available across your fleet. Let me parse the version bump to confirm it qualifies as a patch/minor (not major):

- **akismet** on `eval-test-onboard`: `5.6` → `5.7` — this is a **minor** version bump (5.x → 5.y), not a major upgrade.

**Proposed changes:**

| Site | Plugin | Current | New | Bump Type |
|------|--------|---------|-----|-----------|
| eval-test-onboard | akismet | 5.6 | 5.7 | minor ✓ |

No major version upgrades were found — nothing to skip.

Want me to apply this update to `akismet` on `eval-test-onboard`?
```