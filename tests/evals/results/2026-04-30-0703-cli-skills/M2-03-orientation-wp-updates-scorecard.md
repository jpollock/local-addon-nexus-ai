# Eval Scorecard: M2-03-orientation-wp-updates (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 14 |
| Error events | 0 |
| Duration | 96.5s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 773 |
| Output tokens | 4,362 |
| Cache creation | 50,347 |
| Cache read | 414,250 |
| **Total cost** | **$0.3808** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0703-cli-skills/M2-03-orientation-wp-updates-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 20% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's the full picture across local and WP Engine:

---

## Local Sites — WordPress Versions

| Site | WP Version | Status |
|------|-----------|--------|
| nexus-e2e-test | 7.0-RC2 | Pre-release (running) |
| nitropack-1 | 7.0-beta6 | Pre-release, older than RC2 |
| jpp0413p | 6.9.4 | Likely current stable |
| Newsroom Demo | 6.9.1 | Behind (6.9.4 exists) |
| jeremypollockblog | 6.8.1 | Behind |
| nexus | 6.8.1 | Behind |
| ACF Auto Car Finder | unknown | Needs a start to scan |
| local-copy-jpp | unknown | Needs a start to scan |

**Sites needing updates:** `Newsroom Demo` (6.9.1 → 6.9.4), `jeremypollockblog` (6.8.1), and `nexus` (6.8.1) are clearly behind. The two pre-release sites (`nitropack-1`, `nexus-e2e-test`) can be updated to 7.0 GA when it ships.

To update a site once started:
```bash
node .../nexus.js wp core update <sitename>@local
```

---

## WP Engine Sites

You're **not currently authenticated** with WP Engine:

```
nexus wpe login
```

Once logged in, run `nexus wpe
```