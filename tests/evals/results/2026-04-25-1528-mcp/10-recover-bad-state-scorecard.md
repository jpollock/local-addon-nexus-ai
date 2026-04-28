# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 13 |
| Error events | 0 |
| Duration | 164.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 13 |
| Output tokens | 6,477 |
| Cache creation | 35,021 |
| Cache read | 815,084 |
| **Total cost** | **$0.4730** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I now have enough evidence to give you a clear picture. Here's what the investigation found:

---

**What the evidence shows:**

1. **WPE `jppblank` is "active" at the API level** — the install didn't crash entirely.

2. **No local site named `jppblank` exists in Local** — there's no local site to retry the push from. The two closest local sites (`jpp0413p`, `local-copy-jpp`) show no push operations to jppblank in their sync history either. Whatever local site was used for the push isn't currently tracked.

3. **Domain configuration is suspect** — both domains (`jppblank.wpengine.com`, `jppblank.wpenginepowered.com`) show `Redirect To: [object Object]`, which indicates a serialization error in the domain config. This is likely a real redirect misconfiguration, not just a display bug.

4. **SSL 404** — no certificates found for the install. The same is true for `jppblankdev`, so this may just be how WPE handles default subdomain wildcard certs via the API (not conclusive either way).

5
```