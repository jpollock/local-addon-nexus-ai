# Eval Scorecard: 10-recover-bad-state (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 21 |
| Error events | 0 |
| Duration | 311.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 14 |
| Output tokens | 9,407 |
| Cache creation | 30,978 |
| Cache read | 991,089 |
| **Total cost** | **$0.5546** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0552-cli-skills/10-recover-bad-state-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found. **The push actually succeeded — jppblank is healthy.**

**Evidence:**
- Homepage returns HTTP 200, serving "Jeremy Pollock Site" with WordPress running correctly
- `wp-login.php` accessible (200)
- Fresh backup just created successfully (ID: `faf9bf71-267e-4773-a7e9-80aa29ae056e`)

**What caused the "weird state" appearance:**

The `nexus wpe diagnose` flags were misleading:

- **❌ SSL** — the site is actually on HTTPS (HTTPS worked fine in the curl). CAPI only shows "no SSL" because there's no *custom domain cert* — the default `.wpenginepowered.com` wildcard cert is active.
- **❌ Recent backup** — the push via Local doesn't always trigger a CAPI-visible pre-push backup. There was none in the window the diagnostic checks.
- **❌ domains/SSL endpoint 404s** — CAPI's `/installs/jppblank/domains` and `/installs/jppblank/ssl_certificates` both 404. This appears to be a CAPI quirk for this install — jppblankdev shows the same behavior.

**One real bug found:** `nexus wp
```