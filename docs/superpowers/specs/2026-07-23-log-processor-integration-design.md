# Log Processor Integration Design
## Security Sentinel + SEO Insights

**Date:** 2026-07-23
**Status:** Approved for implementation

---

## Problem

Log-processor produces rich, pre-classified daily access log aggregates (`DayAggregate`) covering traffic quality, AI crawl activity, referral composition, 404 demand signals, and — critically — attack patterns (auth bursts, probe paths, enumeration, IP cardinality). None of this data flows to security-sentinel or the seo-insights weekly report today.

Security-sentinel detects threats from static site data (plugin inventory, user list, file/DB scans). It has no visibility into behavioral signals that only appear in access logs: active brute-force campaigns, distributed probe sweeps, enumeration attempts. SEO Insights surfaces traffic intelligence only on-demand via three contributed tools; the weekly automated report contains none of it.

---

## Design Decisions

**Option A — Tool-chain** selected. Both agents call `ctx.tools.invoke('get_log_aggregates', {...})` and `ctx.tools.invoke('fetch_log_window', {...})` directly. No new log-processor contributed tools, no new manifest declarations, no file-based coupling. This is the pattern seo-insights already uses for its three existing log tools — proven, self-contained, no new infrastructure.

**No `nexus.agent.yaml` changes needed.** Contributed tools from other agents are accessible to any agent via `ctx.tools.invoke` without declaration. Confirmed by seo-insights' `tools: []` manifest calling `get_log_aggregates` successfully today.

**Two-tier data access within Option A:**
- **L1 — Aggregate pull** (`get_log_aggregates`): default, always called, offline, no S3 cost
- **L2 — Forensic pull** (`fetch_log_window`): conditional, two triggers:
  - Hardcoded threshold: agent code detects a specific aggregate signal crossing a threshold and calls `fetch_log_window` automatically
  - LLM-driven: the synthesizer (sentinel) or run loop (seo-insights) decides opportunistically

**Graceful skip when log data is absent.** If `get_log_aggregates` returns no days — site not connected, no data ingested — both agents proceed without log signals. A one-line note is added to the output. Nothing blocks.

---

## Security Sentinel Integration

### Tier 1 — New Log-Backed Checks

After the existing ABS/EXP/REL static checks, sentinel runs `runLogChecks(ctx, siteId)`. This function:

1. Calls `ctx.tools.invoke('get_log_aggregates', { siteId, from: 30daysAgo, to: yesterday })`
2. If no aggregates returned: logs "No log data for `siteId` — skipping log checks" and returns empty
3. Folds the returned array of `DayAggregate` objects into a 30-day summary
4. Runs four checks against the summary:

| Check ID | Signal | Hardcoded threshold | Finding severity |
|---|---|---|---|
| LOG-AUTH | `attack.authAttack` — cumulative login + xmlrpc POSTs across 30 days | > 100 | High |
| LOG-PROBE | `attack.probes` — any single path with high hit count | Any path > 50 hits | Medium |
| LOG-ENUM | `attack.enumeration` — userRestApi or authorScan hits | > 20 hits total | Medium |
| LOG-DIST | `attack.ipCardinality` — distinct attacker IPs | > 50 distinct IPs | High |

Each triggered check produces a `Finding` using the same type as existing sentinel findings, so it appears in the Approvals tab without UI changes.

### Hardcoded L2 Escalation (Tier 1 → fetch_log_window)

If LOG-AUTH or LOG-DIST cross a **critical** threshold — > 500 login/xmlrpc POSTs or > 200 distinct IPs — the agent immediately calls `fetch_log_window` with `confirm: true` using the same 30-day window, `pathContains: '/wp-login.php'` for LOG-AUTH (or `/xmlrpc.php` if xmlrpc volume dominates), and no path filter for LOG-DIST (to capture IP distribution across all attack traffic). The returned `byIp`, `byDay`, and `sample` fields are attached as structured evidence to the finding. No LLM involved.

Critical thresholds:
- LOG-AUTH critical: > 500 cumulative login/xmlrpc POSTs in 30 days
- LOG-DIST critical: > 200 distinct attacker IPs in 30 days

### Tier 1 → Tier 2 Trigger

Log findings feed the same finding severity pool as existing checks. A LOG-AUTH or LOG-DIST finding at High severity can independently trigger Tier 2 investigation, using the existing sentinel Tier 2 trigger condition unchanged.

### Tier 2 — LLM Synthesizer Integration

When Tier 2 runs (for any reason), it receives a compact **attack summary block** alongside the existing specialist reports. The block is built from the 30-day aggregate fold and looks like:

```
Log corroboration (last 30 days):
- Auth attacks: 847 login POSTs, 312 xmlrpc POSTs across 8 nights
- Top probe paths: /.env (203 hits), /wp-config.php.bak (91 hits)
- Enumeration: user REST API (44 hits), author scan (18 hits)
- Distinct attacker IPs: 67 (distributed campaign)
```

The synthesizer has `fetch_log_window` available as a callable tool. It may call it autonomously — for example, to correlate a suspicious new admin account (REL-03 finding) with a specific IP that appears heavily in auth attack data.

`fetch_log_window` two-phase protocol for LLM-driven calls: synthesizer must call `confirm: false` first (cost estimate), then `confirm: true` to execute. Hardcoded escalation paths skip the estimate and call `confirm: true` directly (date windows are already bounded).

### Files Changed

- `agents/security-sentinel/agent.js` — add `runLogChecks(ctx, siteId)` function; call in Tier 1 block; build attack summary string; inject into Tier 2 synthesizer prompt
- No manifest changes

---

## SEO Insights Integration

### Existing Tools — No Changes

The three existing contributed tools (`analyze_ai_crawl_health`, `analyze_404_demand`, `analyze_referral_sources`) remain exactly as-is. They are user-invoked, on-demand, and already call `get_log_aggregates` correctly.

### Weekly run() — New Traffic Intelligence Section

The weekly `run()` currently produces a site report with orphan/stale content counts. It will additionally:

1. Call `ctx.tools.invoke('get_log_aggregates', { siteId, from: 30daysAgo, to: yesterday })`
2. If no data: append "No access log data — connect this site via the Log Processor agent for traffic insights." and continue
3. If data present: compute and append a **Traffic Intelligence** section to `AgentResult.summary`

**Traffic Intelligence section contents:**

| Subsection | Source fields | Example output |
|---|---|---|
| Traffic quality | `byClass.human_plausible` ÷ total requests | "43% of requests appear to be human traffic (30-day avg)" |
| AI crawl exposure | `aiTraining` + `aiRetrieval` bot totals | "GPTBot (1,240 hits), ClaudeBot (890 hits) actively training on content" |
| Top 404 demand | `notFound.contentLike` top 5 paths by hit count | "High-demand missing content: /pricing (84 hits), /tutorial/advanced (61 hits)" |
| Referral mix | `referrals.search` / `.ai` / `.other` / `.direct` | "Traffic sources: 28% search, 9% AI referral, 63% direct" |
| Attack exposure | `attack.authAttack` totals | "847 auth probes in 30 days — consider running Security Sentinel on this site" |

The attack exposure row is a cross-agent signal only: seo-insights surfaces it as a recommendation, takes no action itself.

If aggregates cover fewer than 30 days (missing days present): note the coverage — "Based on 18 of 30 days (12 days not yet ingested)."

### fetch_log_window in SEO Insights

Available but passive. The weekly `run()` does not call it automatically. The LLM-driven run loop may call it opportunistically — for example, confirming that a high-demand 404 path is real human traffic rather than a scanner pattern before recommending a content investment. No hardcoded escalation thresholds; LLM judgment is the right trigger for a planning tool.

### Files Changed

- `agents/seo-insights/agent.ts` — add `getLogInsights(ctx, siteId, days)` helper; call in `run()` after existing report computation; append Traffic Intelligence section to summary
- No manifest changes

---

## Edge Cases

| Case | Behaviour |
|---|---|
| Log-processor not installed / tool call fails | Catch error, skip log section, log a warning. Neither agent blocks. |
| Partial data (some days missing) | Use available days. Note coverage in output: "Based on N of 30 days." |
| `fetch_log_window` LLM call | Synthesizer/run-loop calls `confirm: false` first (estimate), then `confirm: true`. Hardcoded paths skip estimate. |
| Log checks trigger Tier 2 independently | Existing Tier 2 trigger logic unchanged — log findings feed same severity pool as static findings. |
| Fleet correlation with log data | Out of scope. Per-site only. |
| seo-insights sees high attack exposure | Report it as a recommendation to run Sentinel. Do not act on it. |

---

## What Does Not Change

- `nexus.agent.yaml` for either agent
- Log-processor's contributed tool signatures or database schema
- Sentinel's existing ABS/EXP/REL/FLEET checks
- Seo-insights' three existing log-backed contributed tools
- The `DayAggregate` type (inlined in seo-insights, will be inlined in sentinel the same way)
- Any UI components — log findings appear in existing Approvals/Activity tabs automatically

---

## Implementation Scope

Two agent files touched:

1. **`agents/security-sentinel/agent.js`** — `runLogChecks()` function + synthesizer prompt extension
2. **`agents/seo-insights/agent.ts`** — `getLogInsights()` helper + `run()` report extension
