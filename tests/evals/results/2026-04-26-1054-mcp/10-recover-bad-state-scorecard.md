# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 15 |
| Error events | 0 |
| Duration | 312.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 15 |
| Output tokens | 7,775 |
| Cache creation | 36,503 |
| Cache read | 817,688 |
| **Total cost** | **$0.4989** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1054-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what the investigation found. Let me give you the complete picture.

---

**The actual state of things:**

**jppblank WPE install — looks fine:**
- Status: active ✅
- WordPress 6.9.4 running
- PHP 8.2, 2 domains configured (jppblank.wpengine.com / jppblank.wpenginepowered.com)
- No stuck operations

**jppblank local site — does not exist:**
This is the real finding. There is no local site named "jppblank" in Local at all. It's not in the sites list, and direct lookup returned "Site not found." The WPE install exists, but there's no local counterpart — and no ↔ link is shown.

**No stuck push operations found** on jpp0413p or local-copy-jpp (the two most likely candidates by name). jpp0413p has zero sync history and is linked to a completely different WPE install.

---

**What likely happened:**

The local site "jppblank" that you were pushing from no longer exists in Local. The most common cause: Local deleted the local site entry when the push failed partway through (this can h
```