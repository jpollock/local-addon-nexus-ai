# Eval Scorecard: 06-diagnose-broken-site (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 53 |
| Error events | 0 |
| Duration | 410.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 47 |
| Output tokens | 16,195 |
| Cache creation | 74,645 |
| Cache read | 2,564,275 |
| **Total cost** | **$1.2923** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/06-diagnose-broken-site-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 10% | Got a result |
| Steps correct | TBD | 45% | Human review |
| Friction | TBD | 25% | Human review |
| Output clarity | TBD | 20% | Human review |
| **Auto partial** | **10.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
I've found the problem. Here's a full diagnosis:

---

**Root cause: Corrupted port configuration in `sites.json`**

Every service for jppblank is assigned the same port `10048`:

| Service | Configured port |
|---------|----------------|
| mailpit WEB | 10048 |
| mailpit SMTP | 10048 |
| nginx HTTP | **10048** |
| MySQL | **10048** |
| PHP CGI | 10017 |

Compare to a healthy site like `eval-test-onboard`, where each service gets a unique port (10054, 10065, 10066, 10067, 10068). jppblank's config is clearly broken — all those services can't share a single port.

**What's actually happening right now:**

- All 4 processes (nginx, MySQL, PHP-FPM, mailpit) are running — `site-statuses.json` shows the site as "running"
- But `netstat` shows **nothing is listening on port 10048** — nginx's worker process started but couldn't bind to 10048 (MySQL likely grabbed it first, then also dropped it)
- MySQL is only reachable via its Unix socket, not TCP
- Mailpit launched with no port args and fel
```