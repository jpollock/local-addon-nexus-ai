# Eval Scorecard: 05-wpe-usage-data

**Date:** 2026-04-14  
**Mode:** mcp  
**Model:** claude-sonnet-4-6[1m]  
**Weighted Score:** 91.0/100

## Exact Token Counts (from claude -p API response)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,881 |
| Cache creation | 54,238 |
| Cache read | 125,051 |
| **Total cost** | **$0.2691** |

> Note: Cache creation/read dominate the cost — these are the MCP tool definitions
> (~160 tools) being loaded into/from the prompt cache.

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| Steps correct | 90 | 30% |
| Friction (100=zero) | 90 | 20% |
| Output clarity | 95 | 10% |
| **Weighted total** | **91.0** | |

### Step-by-step assessment
- ✅ Discovered accounts without being asked for IDs
- ✅ Retrieved data for all 274 installs across 10 accounts
- ✅ Showed top sites by traffic (80k visits/month for localwpe)
- ✅ Presented bandwidth (314 GB for top site)
- ✅ Zero friction — tool call succeeded on first try
- ✅ Clean formatted table output
- ℹ️ Used `wpe_portfolio_overview` (richer than CLI/Skills account-level API)

## Reviewer Notes

MCP produced richer results than CLI/Skills — used wpe_portfolio_overview which
gives per-install breakdown (274 installs) including real traffic (80k visits, 314GB
bandwidth for localwpe), not just account-level summaries. CLI/Skills used
account-usage which showed zeros due to billing lag.

Zero friction, zero retries. But required --allowedTools flag for automated run —
interactive users see a confirmation prompt first.

---

# Side-by-Side Comparison: Case 05 (WPE Usage Data)

| Metric | CLI/Skills | MCP | Ratio |
|--------|-----------|-----|-------|
| Tool calls | 15 (Bash) | ~2 (MCP) | — |
| Actual tokens | ~1,550 (est.) | 181,348 (exact) | 117x |
| **Cost** | **~$0.0073** | **$0.2691** | **37x** |
| Task completed | ✅ | ✅ | tie |
| Weighted score | 93.0 | 91.0 | CLI wins |
| Output quality | Account-level (zeros) | Install-level (real data) | MCP wins |
| First run cache | N/A | $0.2691 | MCP expensive |
| Warm cache run | ~$0.0073 | ~$0.048 | CLI still 6.5x cheaper |

## Key Insight

**MCP is 37x more expensive on cold cache** because it loads ~180k tokens of tool
definitions on every new session. On warm cache (repeat invocations), it's 6-7x more
expensive than CLI/Skills.

**BUT:** MCP produced better results in this case — `wpe_portfolio_overview` gave
per-install traffic data while `nexus wpe account-usage` only gave account-level totals.
The quality/cost tradeoff depends on the task.

**Cache amortization:** If a user runs 10 MCP tasks in one session, the $0.20 cache
creation cost spreads across all tasks, making each task effectively ~$0.02 more expensive
rather than $0.20. CLI/Skills has no such amortization cost.
