# Eval Scorecard: 09-gateway-cost-report (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 58.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 2,052 |
| Cache creation | 50,405 |
| Cache read | 296,888 |
| **Total cost** | **$0.3089** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/09-gateway-cost-report-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
The nexus CLI doesn't currently have a command for AI gateway spending or usage breakdowns. There's no `nexus ai usage`, `nexus gateway stats`, or equivalent command in the CLI today.

**What the CLI can't do (yet):**
- No command to query AI gateway token usage or cost
- No per-site or per-model breakdown of gateway traffic
- No billing/spend reporting

**What does exist:**
- The Local UI has a gateway usage dashboard (auto-refreshes in the app UI)
- Telemetry is reported to a Cloudflare Worker (`nexus-analytics.jeremy7746.workers.dev`), but there's no CLI command to query it back

**Options to actually get this data:**
1. **Local app UI** — open Local, go to the Nexus AI addon, and check the gateway usage dashboard there
2. **Query the telemetry worker directly** — if you expose a stats endpoint on `nexus-analytics.jeremy7746.workers.dev`, a `nexus ai usage` CLI command could surface this
3. **Build `nexus ai usage`** — this is a clear gap worth adding to the WPE Full Coverage plan


```