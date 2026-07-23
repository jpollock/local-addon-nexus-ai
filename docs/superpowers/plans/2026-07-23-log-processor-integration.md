# Log Processor Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire log-processor's pre-classified `DayAggregate` data into security-sentinel (four new Tier 1 checks + synthesizer corroboration) and seo-insights (automatic Traffic Intelligence section in the weekly report).

**Architecture:** Two-tier log data access — `get_log_aggregates` (always, offline) + conditional `fetch_log_window` (forensic escalation). No manifest changes; contributed tools are already accessible via `ctx.tools.invoke`. Three sequential tasks: sentinel log checks → sentinel synthesizer extension → seo-insights run() integration.

**Tech Stack:** JavaScript (sentinel agent.js, synthesizer.js — CommonJS, no TypeScript), TypeScript (seo-insights agent.ts), `ctx.tools.invoke` for cross-agent tool calls.

## Global Constraints

- Agents are standalone files — no imports from other agent modules or from the main addon codebase.
- `DayAggregate` type must be inlined in any agent that uses it (copy from seo-insights agent.ts lines 29–51 as the canonical source).
- `get_log_aggregates` returns `{ content: [{ type: 'text', text: '<JSON string>' }] }` — always parse via `rawResult?.content?.[0]?.text`.
- Log data absence is not an error — skip gracefully, return `null` or empty signals, log one info line.
- Sentinel agent.js is plain JavaScript (CommonJS `require`, no `import`, no TypeScript syntax).
- seo-insights agent.ts is TypeScript — types required.
- `fetch_log_window` two-phase: hardcoded escalation calls `confirm: true` directly (window is bounded); LLM-driven calls must call `confirm: false` first.
- Do not modify `nexus.agent.yaml` for either agent.
- Agent files live at: `~/Library/Application Support/Local/nexus-ai/agents/`

---

### Task 1: Security Sentinel — `runLogChecks()` + thread attackSummary

**Files:**
- Modify: `~/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js`

**Interfaces:**
- Produces: `runLogChecks(siteId, tools, log)` → `Promise<{ signals: Signal[], attackSummary: string|null }>`
- Where `Signal = { id: string, severity: string, category: string, title: string }`
- Produces: updated `run()` that collects `attackSummary` per install and passes it to `tier2Investigate`
- Produces: updated `tier2Investigate` signature: `(install, tier1Signals, tools, ai, log, state, _pollIntervalMs, autonomy, attackSummary)` — `attackSummary` is the new optional 9th arg
- Produces: `synthesizerSpec.buildPrompt` called with `logCorroboration: attackSummary` (Task 2 consumes this)

- [ ] **Step 1: Add the `runLogChecks` function**

Insert the following function in `agent.js` immediately before the `// ─── Tier 1: Absolute checks` comment block (around line 413):

```javascript
// ─── Log-backed checks (LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST) ────────────

async function runLogChecks(siteId, tools, log) {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  let rawResult;
  try {
    rawResult = await tools.invoke('get_log_aggregates', { siteId, from, to: today });
  } catch (err) {
    log.info(`[LOG] get_log_aggregates unavailable for ${siteId}: ${err.message} — skipping log checks`);
    return { signals: [], attackSummary: null };
  }

  const text = rawResult?.content?.[0]?.text;
  if (!text) return { signals: [], attackSummary: null };

  let parsed;
  try { parsed = JSON.parse(text); } catch { return { signals: [], attackSummary: null }; }

  const aggregates = Object.values(parsed?.aggregates ?? {});
  if (aggregates.length === 0) {
    log.info(`[LOG] No log data for ${siteId} — skipping log checks`);
    return { signals: [], attackSummary: null };
  }

  // Fold 30-day totals
  let totalLoginPosts = 0;
  let totalXmlrpcPosts = 0;
  const probePathCounts = {};
  let userRestApiHits = 0;
  let authorScanHits = 0;
  let distinctIps = 0;

  for (const agg of aggregates) {
    for (const hourData of Object.values(agg.attack?.authAttack ?? {})) {
      totalLoginPosts  += Object.values(hourData.loginPosts  ?? {}).reduce((s, n) => s + n, 0);
      totalXmlrpcPosts += Object.values(hourData.xmlrpcPosts ?? {}).reduce((s, n) => s + n, 0);
    }
    for (const [path, data] of Object.entries(agg.attack?.probes ?? {})) {
      probePathCounts[path] = (probePathCounts[path] ?? 0) + (data.hits ?? 0);
    }
    userRestApiHits += Object.values(agg.attack?.enumeration?.userRestApi ?? {}).reduce((s, n) => s + n, 0);
    authorScanHits  += Object.values(agg.attack?.enumeration?.authorScan  ?? {}).reduce((s, n) => s + n, 0);
    distinctIps = Math.max(distinctIps, agg.attack?.ipCardinality?.distinct ?? 0);
  }

  const totalAuthAttacks = totalLoginPosts + totalXmlrpcPosts;
  const topProbes = Object.entries(probePathCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const highProbes = topProbes.filter(([, hits]) => hits > 50);
  const totalEnum  = userRestApiHits + authorScanHits;

  const signals = [];

  // LOG-AUTH: >100 total auth POSTs in 30 days
  if (totalAuthAttacks > 100) {
    signals.push({
      id: 'LOG-AUTH', severity: 'high', category: 'active-compromise',
      title: `Active brute-force: ${totalAuthAttacks.toLocaleString()} auth probes in 30 days (${totalLoginPosts} login, ${totalXmlrpcPosts} xmlrpc)`,
    });
  }

  // LOG-PROBE: any single path >50 hits
  if (highProbes.length > 0) {
    signals.push({
      id: 'LOG-PROBE', severity: 'medium', category: 'pre-breach',
      title: `Reconnaissance probes: ${highProbes.map(([p, h]) => `${p} (${h})`).join(', ')}`,
    });
  }

  // LOG-ENUM: >20 enumeration hits
  if (totalEnum > 20) {
    signals.push({
      id: 'LOG-ENUM', severity: 'medium', category: 'pre-breach',
      title: `User enumeration: ${userRestApiHits} REST API hits, ${authorScanHits} author scans`,
    });
  }

  // LOG-DIST: >50 distinct attacker IPs
  if (distinctIps > 50) {
    signals.push({
      id: 'LOG-DIST', severity: 'high', category: 'active-compromise',
      title: `Distributed attack campaign: ${distinctIps} distinct attacker IPs observed`,
    });
  }

  // Hardcoded L2 escalation — LOG-AUTH critical (>500) or LOG-DIST critical (>200)
  if (totalAuthAttacks > 500 || distinctIps > 200) {
    const dominantPath = totalLoginPosts >= totalXmlrpcPosts ? '/wp-login.php' : '/xmlrpc.php';
    const pathFilter   = totalAuthAttacks > 500 ? { pathContains: dominantPath } : {};
    try {
      await tools.invoke('fetch_log_window', { siteId, from, to: today, ...pathFilter, confirm: true });
      log.info(`[LOG] Forensic fetch_log_window completed for ${siteId} (critical threshold exceeded)`);
    } catch (err) {
      log.warn(`[LOG] fetch_log_window escalation failed for ${siteId}: ${err.message}`);
    }
  }

  // Build attack summary string for the Tier 2 synthesizer
  const summaryLines = [
    `Log corroboration (last 30 days, ${aggregates.length}/${aggregates.length} days):`,
    totalAuthAttacks > 0
      ? `- Auth attacks: ${totalLoginPosts} login POSTs, ${totalXmlrpcPosts} xmlrpc POSTs`
      : null,
    topProbes.length > 0
      ? `- Top probe paths: ${topProbes.map(([p, h]) => `${p} (${h} hits)`).join(', ')}`
      : null,
    totalEnum > 0
      ? `- Enumeration: user REST API (${userRestApiHits} hits), author scan (${authorScanHits} hits)`
      : null,
    `- Distinct attacker IPs (peak day): ${distinctIps}`,
  ].filter(Boolean);

  const attackSummary = signals.length > 0 ? summaryLines.join('\n') : null;
  return { signals, attackSummary };
}
```

- [ ] **Step 2: Call `runLogChecks` in the per-install loop in `run()`**

In the `run()` method, find the line `signals.push(...runRelativeChecks(install, baseline));` (around line 353). After it, add:

```javascript
      // Log-backed checks (LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST)
      let attackSummary = null;
      try {
        const logResult = await runLogChecks(install.name, tools, log);
        signals.push(...logResult.signals);
        attackSummary = logResult.attackSummary;
      } catch (err) {
        log.warn(`security-sentinel: log checks failed for ${install.name}: ${err.message} (skipping)`);
      }
```

- [ ] **Step 3: Thread `attackSummary` into `tier2Investigate`**

Find the `tier2Investigate` call in `run()` (around line 377):
```javascript
const plan = await tier2Investigate(install, signals, tools, ai, log, state, 20000, autonomy);
```

Replace with:
```javascript
const plan = await tier2Investigate(install, signals, tools, ai, log, state, 20000, autonomy, attackSummary);
```

Find the `tier2Investigate` function declaration (line 1405):
```javascript
async function tier2Investigate(install, tier1Signals, tools, ai, log, state, _pollIntervalMs = 20000, autonomy = 'auto') {
```

Replace with:
```javascript
async function tier2Investigate(install, tier1Signals, tools, ai, log, state, _pollIntervalMs = 20000, autonomy = 'auto', attackSummary = null) {
```

- [ ] **Step 4: Pass `attackSummary` to `synthesizerSpec.buildPrompt`**

Find the `synthesizerSpec.buildPrompt({...})` call in `tier2Investigate` (around line 2269). It currently ends with `behavioralResult,`. Add `logCorroboration: attackSummary` as the last property:

```javascript
      prompt: synthesizerSpec.buildPrompt({
        installName: install.name,
        environment: install.environment,
        postCount: install.postCount,
        siteCreatedAt: install.sshLastSyncAt ?? 'unknown',
        lastSyncAt: install.sshLastSyncAt ?? 'unknown',
        tier1Signals: tier1Signals.map(s => `[${s.severity.toUpperCase()}] ${s.id}: ${s.title}`).join('\n'),
        enumeratorResult,
        integrityResult,
        patternResult,
        databaseResult,
        behavioralResult,
        logCorroboration: attackSummary,   // <-- add this
      }),
```

Also update the `_test` export at the bottom of the file to include `runLogChecks`:
```javascript
_test: { parseSqlResult, getScanScope, collectFleetData, runAbsoluteChecks, llmUserAudit, runExposureChecks, loadBaseline, storeBaseline, runRelativeChecks, runFleetCorrelation, runLogChecks, tier2Investigate, llmSynthesis, tier3Remediate, buildRemediationChecklist, executeChecklist, collectSpecialistData, runContentExamination, runRootFileAnalysis, runObfuscationDecoder, runCoreDiff, runElfStrings, runNetworkIndicators },
```

- [ ] **Step 5: Verify the agent parses without syntax errors**

```bash
node --check ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/agent.js
```

Expected: no output (clean parse).

- [ ] **Step 6: Commit**

```bash
git add ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/agent.js
git commit -m "feat(sentinel): runLogChecks — LOG-AUTH/PROBE/ENUM/DIST + thread attackSummary to synthesizer"
```

---

### Task 2: Security Sentinel — Synthesizer Prompt Extension

**Files:**
- Modify: `~/Library/Application Support/Local/nexus-ai/agents/security-sentinel/specialists/synthesizer.js`

**Interfaces:**
- Consumes: `logCorroboration: string | null` from Task 1 (passed in `data` object to `buildPrompt`)
- Produces: updated prompt template that includes the log corroboration block when present

- [ ] **Step 1: Update `buildPrompt` in synthesizer.js**

Find `buildPrompt(data)` function (line 57). The prompt string currently ends with the BLIND SPOTS block. Add a log corroboration section between the Behavioral findings and the SYNTHESIS RULES:

```javascript
function buildPrompt(data) {
  return `You are a senior WordPress security analyst synthesizing findings from five specialist agents.
Your job: correlate, elevate, and produce a remediation plan. You must also explicitly disclose blind spots.

SITE: ${data.installName} (${data.environment}, ${data.postCount} posts, created: ${data.siteCreatedAt})
LAST WPE SSH SYNC: ${data.lastSyncAt}

## Tier 1 signals (static analysis)
${data.tier1Signals}

## Enumerator findings
${JSON.stringify(data.enumeratorResult, null, 2)}

## Integrity findings
${JSON.stringify(data.integrityResult, null, 2)}

## Pattern scanner findings (includes temporal cluster analysis)
${JSON.stringify(data.patternResult, null, 2)}

## Database findings
${JSON.stringify(data.databaseResult, null, 2)}

## Behavioral findings
${JSON.stringify(data.behavioralResult, null, 2)}
${data.logCorroboration ? `
## Access log corroboration (30-day aggregate from log-processor)
${data.logCorroboration}
` : ''}
SYNTHESIS RULES:
1. CRITICAL from any specialist leads the report — do not bury it.
2. Temporal cluster from the pattern scanner IS the attack session boundary. All items within the
   cluster window are suspect regardless of whether their name matches a known-bad list.
3. Cross-agent correlation: a file flagged by pattern scanner AND in the temporal cluster window
   becomes CONFIRMED. A file flagged by only one agent is PROBABLE.
4. Always name the entry point — how did the attacker first get in? This is the most important
   question for preventing recurrence.
5. If access log data is present: use auth attack volume and IP cardinality to calibrate severity.
   A brute-force campaign that succeeded (new admin account + high login volume) is more urgent
   than a static signal alone. Corroborate — don't just repeat.
6. Remediation steps must be ordered: stop active exfiltration first, then remove persistence,
   then close entry point, then verify clean.
7. BLIND SPOTS — always include these unless the specialist explicitly covered them:
   - Premium plugins (no checksums available from WordPress.org)
   - Runtime-assembled payloads (encrypted DB fragments assembled in memory at request time)
   - Time-triggered or IP-conditional code
   - Image EXIF data
   - Binary files (detected but not decompiled)
   - Any network-fetched payload (code that downloads its payload at runtime leaves no local trace)
   - wp_comments table if >10k rows (sampled only)
   Add any other gaps specific to this site that the specialists flagged.`;
}
```

The only structural changes are:
- Conditional `## Access log corroboration` block between Behavioral findings and SYNTHESIS RULES
- New SYNTHESIS RULE 5 about using log data to calibrate severity (old rules 5-7 become 6-7)

- [ ] **Step 2: Verify**

```bash
node --check ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/specialists/synthesizer.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/specialists/synthesizer.js
git commit -m "feat(sentinel): inject log corroboration block into synthesizer prompt"
```

---

### Task 3: SEO Insights — `getLogInsights()` + `run()` Traffic Intelligence

**Files:**
- Modify: `~/Library/Application Support/Local/nexus-ai/agents/seo-insights/agent.ts`

**Interfaces:**
- Produces: `async function getLogInsights(siteId: string, tools: ToolInvoker, log: any): Promise<string | null>`
- Returns a formatted markdown block (string) or `null` when no data
- Consumed by `run()` — appended to `reportLines` before returning `{ summary: reportLines }`

- [ ] **Step 1: Add `ToolInvoker` type alias and `getLogInsights` function**

After the `utcToday()` function definition (around line 61) and before the `ok()` helper, insert:

```typescript
type ToolInvoker = { invoke(name: string, args: unknown): Promise<unknown> };

async function getLogInsights(siteId: string, tools: ToolInvoker, log: any): Promise<string | null> {
  const today = utcToday();
  const from = addDays(today, -30);

  let rawResult: unknown;
  try {
    rawResult = await tools.invoke('get_log_aggregates', { siteId, from, to: today });
  } catch {
    log.info(`[LOG] get_log_aggregates unavailable for ${siteId} — skipping traffic intelligence`);
    return null;
  }

  const text = (rawResult as any)?.content?.[0]?.text as string | undefined;
  if (!text) return null;

  let parsed: { aggregates?: Record<string, DayAggregate>; missingDays?: string[] };
  try { parsed = JSON.parse(text); } catch { return null; }

  const aggregates = Object.values(parsed.aggregates ?? {});
  const coverage = aggregates.length;
  if (coverage === 0) {
    return `\n## Traffic Intelligence\n\nNo access log data for **${siteId}** — connect this site via the Log Processor agent for traffic insights.\n`;
  }

  const missingNote = parsed.missingDays?.length
    ? ` *(based on ${coverage} of 30 days — ${parsed.missingDays.length} days not yet ingested)*`
    : '';

  // Fold 30-day totals
  let totalRequests = 0;
  let totalHuman = 0;
  const aiTrainingTotals: Record<string, number> = {};
  const aiRetrievalTotals: Record<string, number> = {};
  const notFoundPaths: Record<string, number> = {};
  let searchRef = 0, aiRef = 0, otherRef = 0, directRef = 0;
  let totalAuthAttacks = 0;

  for (const agg of aggregates) {
    totalRequests += agg.requests ?? 0;
    totalHuman    += agg.byClass?.human_plausible ?? 0;

    for (const [bot, data] of Object.entries(agg.aiTraining ?? {})) {
      aiTrainingTotals[bot] = (aiTrainingTotals[bot] ?? 0) + data.hits;
    }
    for (const [bot, data] of Object.entries(agg.aiRetrieval ?? {})) {
      aiRetrievalTotals[bot] = (aiRetrievalTotals[bot] ?? 0) + data.hits;
    }
    for (const [path, hits] of Object.entries(agg.notFound?.contentLike ?? {})) {
      notFoundPaths[path] = (notFoundPaths[path] ?? 0) + hits;
    }
    searchRef += Object.values(agg.referrals?.search ?? {}).reduce((s, n) => s + n, 0);
    aiRef     += Object.values(agg.referrals?.ai    ?? {}).reduce((s, n) => s + n, 0);
    otherRef  += (agg.referrals?.other    ?? 0) + (agg.referrals?.spoofed ?? 0);
    directRef += agg.referrals?.internal  ?? 0;

    for (const hourData of Object.values(agg.attack?.authAttack ?? {})) {
      totalAuthAttacks += Object.values((hourData as any).loginPosts  ?? {}).reduce((s: number, n: unknown) => s + (n as number), 0);
      totalAuthAttacks += Object.values((hourData as any).xmlrpcPosts ?? {}).reduce((s: number, n: unknown) => s + (n as number), 0);
    }
  }

  // Compute ratios
  const humanPct   = totalRequests > 0 ? Math.round((totalHuman / totalRequests) * 100) : 0;
  const totalRef   = searchRef + aiRef + otherRef + directRef;
  const pct = (n: number) => totalRef > 0 ? `${Math.round((n / totalRef) * 100)}%` : '—';

  // Top AI crawlers (training + retrieval combined, sorted by hits)
  const allAiBots = { ...aiTrainingTotals };
  for (const [bot, hits] of Object.entries(aiRetrievalTotals)) {
    allAiBots[bot] = (allAiBots[bot] ?? 0) + hits;
  }
  const topAiBots = Object.entries(allAiBots).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Top 404 demand paths
  const top404 = Object.entries(notFoundPaths).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const lines: string[] = [
    ``,
    `## Traffic Intelligence${missingNote}`,
    ``,
    `**Traffic quality:** ${humanPct}% of requests appear human${totalRequests > 0 ? ` (${totalRequests.toLocaleString()} total requests)` : ''}`,
  ];

  if (topAiBots.length > 0) {
    lines.push(`**AI crawlers:** ${topAiBots.map(([b, h]) => `${b} (${h.toLocaleString()} hits)`).join(', ')}`);
  } else {
    lines.push(`**AI crawlers:** None detected in log data`);
  }

  if (top404.length > 0) {
    lines.push(`**404 demand signals:** ${top404.map(([p, h]) => `\`${p}\` (${h} hits)`).join(', ')}`);
  }

  if (totalRef > 0) {
    lines.push(`**Referral mix:** ${pct(searchRef)} search · ${pct(aiRef)} AI · ${pct(directRef)} direct · ${pct(otherRef)} other`);
  }

  if (totalAuthAttacks > 100) {
    lines.push(`**⚠ Attack exposure:** ${totalAuthAttacks.toLocaleString()} auth probes in 30 days — consider running Security Sentinel on this site`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Call `getLogInsights` in `run()` and append to reportLines**

Find the `reportLines` construction in `run()` (around line 1623). It currently builds the array and ends with `Next:` line. After the `analyzeContent` call and before `return { summary: reportLines }`, add the log insights call:

```typescript
      // Traffic Intelligence from log-processor (graceful skip if no data)
      let logSection: string | null = null;
      try {
        logSection = await getLogInsights(siteName, tools, log);
      } catch (err: unknown) {
        log.warn(`[LOG] getLogInsights failed: ${(err as Error).message}`);
      }

      const reportLines = [
        `# Site Content Report: ${siteName}`,
        ``,
        `**Posts analyzed:** ${posts.length}`,
        `**Orphaned (no inbound links):** ${orphans.length}${orphans.length > 0 ? ` — ${orphans.slice(0, 3).map(p => p.post_title).join(', ')}${orphans.length > 3 ? ` +${orphans.length - 3} more` : ''}` : ''}`,
        `**Stale (>365 days old):** ${stale.length}${stale.length > 0 ? ` — ${stale.slice(0, 3).map(p => p.post_title).join(', ')}${stale.length > 3 ? ` +${stale.length - 3} more` : ''}` : ''}`,
        createdSandbox ? `**Analyzed via sandbox:** ${analysisSite}` : '',
        ``,
        `**Topical map:** Not available — platform dependency pending (IVectorStore.getAllDocuments)`,
        `**Next:** Connect Google Search Console to unlock demand-weighted gap analysis (T1)`,
        logSection ?? '',
      ].filter(Boolean).join('\n');
```

Note: this replaces the existing `reportLines` block at lines 1623–1633 — remove the old one and use only the new one above.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add ~/Library/Application\ Support/Local/nexus-ai/agents/seo-insights/agent.ts
git commit -m "feat(seo-insights): getLogInsights — Traffic Intelligence section in weekly run() report"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| LOG-AUTH check (>100 auth POSTs) | Task 1 |
| LOG-PROBE check (>50 hits on single path) | Task 1 |
| LOG-ENUM check (>20 enumeration hits) | Task 1 |
| LOG-DIST check (>50 distinct IPs) | Task 1 |
| Hardcoded L2 escalation >500 POSTs or >200 IPs | Task 1 |
| `fetch_log_window` called with `confirm: true` directly | Task 1 |
| `attackSummary` threaded to `tier2Investigate` | Task 1 |
| `synthesizerSpec.buildPrompt` receives `logCorroboration` | Task 1 + Task 2 |
| Synthesizer prompt includes log block when present | Task 2 |
| New synthesis rule using log data for severity calibration | Task 2 |
| Graceful skip when no log data (both agents) | Task 1, Task 3 |
| `getLogInsights` for seo-insights | Task 3 |
| Traffic quality, AI crawlers, 404 demand, referral mix, attack exposure in report | Task 3 |
| Attack exposure row recommends Sentinel (no action taken) | Task 3 |
| Coverage note when missingDays present | Task 3 |
| No `nexus.agent.yaml` changes | All tasks ✓ |

### Placeholder Scan

None found.

### Type Consistency

- `runLogChecks` returns `{ signals: Signal[], attackSummary: string|null }` — `tier2Investigate` receives it as `attackSummary = null` (optional 9th arg) — `buildPrompt` receives `data.logCorroboration` (same value, same type). Consistent throughout.
- `getLogInsights` returns `string | null` — `run()` handles both cases before including in `reportLines`. Consistent.
- `DayAggregate.attack.authAttack` is `Record<string, { loginPosts: Record<string, number>; xmlrpcPosts: Record<string, number> }>` — both implementations loop with `Object.values(...authAttack)` and access `.loginPosts`/`.xmlrpcPosts`. Consistent.
