# Track 4 — The Two Lenses and Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the fleet from a list into an assessment — one ranked list of findings across every site, each with a plain-language reason it matters and a runnable fix.

**Architecture:** A single `Finding` shape produced by two lenses. The **site health** lens reads CAPI, remote WP-CLI and the sentinel scanner; the **content health** lens reads the content index and Google Search Console. Both emit the same shape into one store, so the UI ranks them together and the user never learns which subsystem found what. `InboxStore` is the substrate — it already keys on `(source, code, scope)` with status, severity and first/last-seen.

**Tech Stack:** TypeScript, existing `seo-insights` agent tools, `SiteDataResolver`, `InboxStore`, Jest.

**Spec:** `docs/planning/2026-08-13-nexus-native-fleet-workspace-design.md`, sections "Reframe" and "The two lenses".

## Status of this plan

**Stages 1–3 are ready. Stage 4 is partly gated.** This track is mostly assembly: the analysis already exists across `seo-insights` (15 tools), the sentinel scanner, the WPE composites and `SiteDataResolver`. What does not exist is a common output shape, a store, and ranking.

## Global Constraints

- **One `Finding` shape for both lenses.** Two shapes would leak the subsystem split into the UI, which the design and the design mockups both reject — board C mixes a WooCommerce CVE, a GSC traffic collapse, a WPE cache misconfiguration and a content contradiction in one ranked list.
- **A finding carries a runnable remediation**, not a description of one: a tool name plus arguments, routed through the tier system and, when the blast radius warrants, through Track 3's sandbox. This is the difference between a product and a report.
- **A finding carries a plain-language "why it matters."** Severity alone is not a finding. Session 7 asked specifically for the AI to explain the value of a change so less technical people understand it.
- **Every finding carries provenance**, reusing `DataProvenance` and the ladder Track 1 established.
- **Own-data only.** No Ahrefs, no SERP or AI Overview scraping, no YouTube. That boundary is deliberate and is the same line as free-versus-paid.
- Every stage ends green: `npx tsc --noEmit` and `npx jest tests/unit`.

---

## Stage 1 — The `Finding` contract

Everything else in this track is downstream of getting this shape right, and it becomes an MCP output shape that Track 3 and the UI both consume — so widening it later is a breaking change.

### Task 1.1 — Define it

**Files:** create `src/main/findings/types.ts`

```
Finding {
  id            stable hash of (code, scope) so re-detection updates rather than duplicates
  code          machine key, e.g. 'wpe.cache.object-cache-disabled'
  lens          'site-health' | 'content-health'   // for filtering, never for grouping in UI
  severity      'critical' | 'warning' | 'info'
  title         one line, human
  why           plain language, required, non-empty — enforce it in the type's constructor
  scope         { installId, environment, localSiteId? } | { fleet: true }
  provenance    DataProvenance
  remediation   { tool, args, requiresSandbox } | null
  detectedAt, lastSeenAt
}
```

`why` being required and non-empty is the one thing in this shape worth enforcing at runtime rather than trusting. It is the first thing that gets dropped under deadline and the first thing users notice missing.

### Task 1.2 — `FindingStore` over `InboxStore`

Upsert-by-id so a finding re-detected on the next sweep updates `lastSeenAt` rather than duplicating. Resolve-on-absence: a finding not seen in a sweep that covered its scope is resolved, not deleted — you need the history to answer "did the fix work."

### Task 1.3 — Ranking

Pure function over the finding set. Severity dominates; ties break on blast radius (fleet-wide before single-site), then recency. Pure and separately tested — ranking is the thing everyone will want to tune, and it should be tunable without touching detection.

---

## Stage 2 — Site health lens

### Task 2.1 — Detector interface

`Detector { code, lens, run(scope, services): Promise<Finding[]> }`. Registered like tools are, so adding a check is adding a file.

### Task 2.2 — First detectors, from existing analysis

Wrap what already exists rather than writing new analysis:

- **Outdated core / plugins with known vulnerabilities** — `SiteDataResolver.getPluginsWithUpdateCheck`, already provenance-aware.
- **Object cache not enabled** — CAPI install config. Session 1 named this specifically as the thing most people get wrong; it is also the clearest demonstration that being the host is an advantage.
- **PHP version at or past end of life** — CAPI.
- **Filesystem integrity and known exploit patterns** — the sentinel scanner, which works on stopped sites.
- **Version drift across a site's environments** — `detect_drift`.

### Task 2.3 — Sweep orchestration

Fan out with `Promise.allSettled`, bounded concurrency via the existing `p-limit`. **A detector that throws produces a finding about itself, not silence.** The alternative is a fleet that looks healthy because the checker broke.

---

## Stage 3 — Content health lens

### Task 3.1 — Enable and wrap `seo-insights`

The agent exists with 15 tools and real GSC calls, disabled by default. Wrap four as detectors: `detect_decay` (traffic collapse), `detect_cannibalization` (competing pages), `find_overlap_candidates` (semantic duplication), and a contradiction detector built on the same vector search.

### Task 3.2 — The contradiction detector

New, and the most valuable thing in this track. Vector-search a claim against the site's own published library and flag conflicts — the content team's Phase 2 check 2, generalised from one site to a fleet. The substrate is `SmartSearchHandler` plus `SqliteVecStore`.

Worth stating: this is the one detector with no third-party equivalent, because it needs the customer's whole content corpus indexed, which is a thing only the host has.

### Task 3.3 — GSC credential path

`connect_gsc` and `ProviderRegistry`'s `webmasters.readonly` scope already exist. Findings must degrade to `external-api` provenance, not vanish, when GSC is not connected — an unconnected integration should be visible as a gap, not as an absence.

---

## Stage 4 — Delivery

### Task 4.1 — MCP surface *(ready)*

`nexus_findings_list` (ranked, filterable by lens, severity, scope) and `nexus_findings_fix` (execute a finding's remediation through the tier system and Track 3's sandbox decision). Follow the compact-markdown and `isAvailable` conventions the Track 1 fix wave established, and bound output by default — a fleet of 200 sites produces a lot of findings.

### Task 4.2 — Webhook egress *(ready)*

Findings out to Slack, ClickUp and PagerDuty. `HttpEventInterface` is the substrate. Sessions 6 and 7 were explicit that they will not log into another dashboard; Session 7 already routes UptimeRobot → PagerDuty → Slack.

### Task 4.3 — Second-model verification *(ready)*

"Check this recommendation with a different model." Nexus is already multi-provider, so this is routing plus a presentation of the disagreement. Sessions 1 and 2 asked for it independently, and it buys trust disproportionate to its cost.

### Task 4.4 — The findings surface *(gated)*

Gated on the same shell decision as Tracks 2 and 3. Board C of the design handoff is directional, not a spec.

---

## Sequencing

Stage 1 first and alone — everything downstream encodes its decisions. Stages 2 and 3 are independent of each other and can run in parallel. Stage 4's first three tasks need only Stage 1.

**The dependency worth naming:** Task 4.1's `nexus_findings_fix` needs Track 3's sandbox decision function. Until Track 3 Stage 3 lands, findings can be detected, ranked and delivered, but only the direct-execution remediations can actually run. That is a reasonable intermediate state and does not block the rest.
