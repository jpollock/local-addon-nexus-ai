# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 35 |
| Error events | 0 |
| Duration | 170.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 7,534 |
| Cache creation | 80,572 |
| Cache read | 346,090 |
| **Total cost** | **$0.5190** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1012-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the full SSL picture across your WP Engine fleet.

---

## SSL Audit Results

**Coverage note:** The WPE API's `/ssl_certificates` endpoint only returns data for installs with custom SSL certs configured — installs on `*.wpengine.com` / `*.wpenginepowered.com` subdomains don't expose certs through this API. That accounts for the 404s across most of the 299 installs.

### Installs With SSL Cert Data

| Install | Account | Domains | Expiry | Status |
|---------|---------|---------|--------|--------|
| **getflywheel** | getflywheel | 24 domains (getflywheel.com, heyflywheel.com, campflywheel.com, +21 more) | **32 days (May 28)** | ⚠️ Near threshold |
| **localwpe** | getflywheel | 9 domains (localwp.com, localbyflywheel.com, pressmatic.io, +6 more) | **31 days (May 27)** | ⚠️ Near threshold |
| **frostwpe** | devrel | frostwp.com | 63 days | ✅ OK |

### Summary

- **No certs expire within 30 days**
- **Two production installs expire in 31–32 days** — `getflywheel` and `localwpe` ar
```