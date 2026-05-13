# Eval Scorecard: M3-02-find-which-copy-is-real (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 51.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 809 |
| Cache creation | 44,562 |
| Cache read | 208,702 |
| **Total cost** | **$0.2419** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M3-02-find-which-copy-is-real-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 30% | Human review |
| output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Neither **jpp-client**, **jpp-client-2**, nor **jpp-client-backup** appear in your fleet — they're not among your 8 local sites or 310+ WPE installs.

Your local sites are: `ACF Auto Car Finder`, `jeremypollockblog`, `jpp0413p`, `local-copy-jpp`, `Newsroom Demo`, `nexus`, `nexus-e2e-test`, and `nitropack-1`.

A few possibilities:
- The sites may exist under different names (e.g. `jpp0413p` or `local-copy-jpp` look like they could be related to your "jpp" work)
- They may be halted and not yet synced to the index
- They could be on a different machine

Do any of those existing site names ring a bell? Or do you know roughly what the sites contain — I can search for content across indexed sites to help narrow it down.
```