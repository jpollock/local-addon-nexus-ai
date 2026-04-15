# Eval Scorecard: 03-domain-ssl-audit (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 92.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 777 |
| Cache creation | 47,901 |
| Cache read | 136,825 |
| **Total cost** | **$0.2324** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/03-domain-ssl-audit-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Local isn't running — the nexus CLI requires Local to be running since it routes WPE API calls through the addon.

**Fix:** Start Local by WP Engine, then re-run this check. Once Local is up:

```bash
nexus wpe installs --json
```

This will pull all installs, and then I can loop through each one to run `nexus wpe ssl <installId>` and flag any certs expiring within 30 days or in an error state.

Want me to run the full SSL audit automatically as soon as Local is up? Just let me know when it's running and I'll kick it off.
```