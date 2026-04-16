# Eval Scorecard: 05-staging-to-prod-promotion (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 23 |
| Error events | 0 |
| Duration | 237.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 23 |
| Output tokens | 9,192 |
| Cache creation | 47,620 |
| Cache read | 822,390 |
| **Total cost** | **$0.5632** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/05-staging-to-prod-promotion-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 35% | Got a result |
| Steps correct | TBD | 35% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **35.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The backup is confirmed complete, but the `promote` command is hitting HTTP 400 from the WPE CAPI without exposing the error body. Here's the full picture:

---

**Completed:**
- Production backup created and verified: `c750ca3b-8cde-4be5-95aa-b6b18d820229` (status: `completed`)

**Blocked:**
- `nexus wpe promote jppwpeplugistg → jppwpeplugin` fails with `CAPI POST /install_copy: HTTP 400`
- Tried both with and without `--no-database` — same result
- Credentials are configured, both installs are reachable and healthy

**Likely causes for the 400:**
1. **Bug in nexus 0.2.1** — there's an update to 0.2.4 available (`nexus update`). The promote command may have a request body format issue fixed in a newer release.
2. **WPE site mismatch** — the CAPI `install_copy` endpoint requires both installs to be in the same WPE site. The CLI doesn't surface the site ID per install, so I can't confirm from here if `jppwpeplugin` and `jppwpeplugistg` are grouped under the same WPE site as `wpepluginte
```