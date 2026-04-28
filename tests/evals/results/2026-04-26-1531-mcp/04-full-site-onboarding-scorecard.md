# Eval Scorecard: 04-full-site-onboarding (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 41 |
| Error events | 0 |
| Duration | 153.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 57 |
| Output tokens | 3,897 |
| Cache creation | 158,984 |
| Cache read | 4,593,605 |
| **Total cost** | **$2.0329** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/04-full-site-onboarding-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the status:

**AI Setup: Failed**
The site is running WordPress **6.9.4**, but the AI Experiments plugin requires **WordPress 7.0+**. The gateway setup can't proceed until WP core is upgraded.

**Site Health Summary:**
- WP 6.9.4 (needs upgrade to 7.0 for AI)
- 2 plugins installed, 0 active — Akismet has an update available
- Theme: Twenty Twenty-Five 1.4
- DB size: ~750 KB

**Next step:** Upgrade WordPress core to 7.0 before AI setup will work. Want me to do that now?
```