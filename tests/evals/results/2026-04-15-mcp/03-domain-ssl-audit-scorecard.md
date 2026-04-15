# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 81.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 14 |
| Output tokens | 2,516 |
| Cache creation | 70,201 |
| Cache read | 191,859 |
| **Total cost** | **$0.3586** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-mcp/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the full picture across all 10 accounts (269 installs total):

---

## SSL Status Summary

### No issues found — 9 of 10 accounts checked

**No expiring certificates (within 30 days)** and **no expired certs** anywhere. The vast majority of installs show "Error fetching certs" because they're on WP Engine's default subdomains (`*.wpengine.com`) — those use WPE's shared SSL and don't expose per-cert data via the API.

---

### Actionable items

**3 installs missing SSL certificates:**

| Account | Install | Environment |
|---------|---------|-------------|
| **getflywheel** | `getflywheel` | production |
| **getflywheel** | `localwpe` | production |
| **devrel** | `frostwpe` | production |

These production installs have no SSL certificate configured at all. If they have custom domains pointed at them, those domains would be serving over HTTP only.

**1 account couldn't be checked:**

| Account | Reason |
|---------|--------|
| **btwpe** | WP Engine auth session expired mid-run |
```