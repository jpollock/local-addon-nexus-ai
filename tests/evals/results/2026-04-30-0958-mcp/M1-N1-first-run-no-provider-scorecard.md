# Eval Scorecard: M1-N1-first-run-no-provider (PARTIAL — auto-scored)

**Date:** 2026-04-30  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 50.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,132 |
| Cache creation | 13,022 |
| Cache read | 357,790 |
| **Total cost** | **$0.1732** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-30-0958-mcp/M1-N1-first-run-no-provider-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| steps correct | TBD | 20% | Human review |
| completeness | TBD | 20% | Human review |
| output clarity | TBD | 20% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's your current Nexus status:

---

## What's Working

**MCP Server** — running, uptime ~3.8 hours, all 160+ tools available

**Local Sites** — 8 sites detected, all running, all indexed:
- nexus-e2e-test, jeremypollockblog, jpp0413p, nexus, nitropack-1, ACF Auto Car Finder, local-copy-jpp, Newsroom Demo

**Content Index** — 4,088 content items + 3,470 plugins indexed and searchable across your fleet

**Event Pipeline** — healthy (0 pending, 0 failed)

**Telemetry** — enabled and registered

---

## What Needs Setup

**1. WP Engine Authentication** (not connected)
The `wpe_*` tools (live installs, push/pull, backups, domains, SSL) won't work until you authenticate. Run:
> "Log me in to WP Engine" — or call `wpe_login` to open the OAuth flow in your browser.

**2. AI Provider** (not configured)
The AI features (content search, site analysis, writing tools) need an AI provider key. You'll need to set up Anthropic, OpenAI, Google, or Ollama — or enable the Local AI Gateway if you have
```