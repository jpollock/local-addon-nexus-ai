# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 34 |
| Error events | 0 |
| Duration | 387.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 2,005 |
| Output tokens | 21,458 |
| Cache creation | 209,063 |
| Cache read | 3,355,513 |
| **Total cost** | **$2.1185** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The fix is compiled. The CLI is still using the old code in Local's running main process — Local needs to be restarted to pick up the change.

Here's what I found and fixed:

**Root cause:** The WPE CAPI accepts install *names* for the base `/installs/{name}` endpoint but requires the install *UUID* for all sub-resource paths (`/domains`, `/ssl_certificates`, `/backups`, etc.). Every resolver that called sub-resources was passing the name directly, causing HTTP 404s.

**The fix:** Added a `resolveInstallUuid(installId)` helper inside `createWpeResolvers` that calls `capiGetInstall()` (which does proper name→UUID resolution) and updated all 11 affected resolvers: `nexusWpeInstallUsage`, `nexusWpeUpdateInstall`, `nexusWpeDeleteInstall`, `nexusWpeBackupStatus`, `nexusWpeBackupVerify`, `nexusWpeDomains`, `nexusWpeDomainAdd`, `nexusWpeDomainRemove`, `nexusWpeDomainCheck`, `nexusWpeSslCertificates`, `nexusWpeSslRequest`, `nexusWpeDiagnose`, and `nexusWpeGoLiveCheck`.

**What this means for j
```