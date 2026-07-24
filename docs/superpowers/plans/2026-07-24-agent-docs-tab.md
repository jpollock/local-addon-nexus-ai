# Agent Docs Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docs tab (last position) to each agent's workspace that renders the agent's README.md. Add README.md to the agent scaffolding template. Write READMEs for the three existing agents. Include a System Prompt section for agents that use an LLM.

**Architecture:** GQL `agentReadme` query reads the README.md file from the agents directory → renderer fetches on tab activation → inline markdown renderer displays it. Scaffolding adds a README.md template when `nexus agent create` runs. Agent READMEs live alongside `agent.ts` in the agents directory.

**Tech Stack:** TypeScript, React class components (no JSX, no hooks), GraphQL, Node.js `fs.readFileSync`.

## Global Constraints

- React.createElement() only — no JSX, no hooks.
- Docs tab is the last tab: Settings → Approvals → Activity → Tools → Docs.
- README.md lives at `~/Library/Application Support/Local/nexus-ai/agents/<agentName>/README.md` (runtime) and `agents/<agentName>/README.md` (repo, synced by npm run build).
- No external markdown library — inline renderer handles: `#`/`##`/`###` headers, `**bold**`, `- ` lists, `| table |` rows, ` ``` ` fenced code blocks, `---` dividers, plain paragraphs.
- System Prompt section only included in READMEs for agents that call an LLM (sentinel has one; log-processor does not).
- Agent files in `agents/` are synced to runtime on `npm run build`.

---

### Task 1: GQL `agentReadme` query + resolver

**Files:**
- Modify: `src/main/graphql/schema.ts`
- Modify: `src/main/graphql/resolvers.ts`

**Interfaces:**
- Produces: `agentReadme(agentName: String!): String` — returns file content or null if file doesn't exist

- [ ] **Step 1: Add to schema**

In `src/main/graphql/schema.ts`, find the `agentLogs` query (around line 1954). Add alongside it:

```graphql
"README.md content for an agent. Returns null when no README exists."
agentReadme(agentName: String!): String
```

- [ ] **Step 2: Add resolver**

In `src/main/graphql/resolvers.ts`, find the `agentLogs` resolver and add `agentReadme` alongside it in the Query resolver object:

```typescript
agentReadme: (_: unknown, { agentName }: { agentName: string }): string | null => {
  const _path = require('path') as typeof import('path');
  const _fs   = require('fs')   as typeof import('fs');
  const _os   = require('os')   as typeof import('os');
  const readmePath = _path.join(
    _os.homedir(), 'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', agentName, 'README.md',
  );
  try {
    return _fs.readFileSync(readmePath, 'utf-8');
  } catch {
    return null;
  }
},
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/main/graphql/schema.ts src/main/graphql/resolvers.ts
git commit -m "feat(graphql): add agentReadme query — reads README.md from agent directory"
```

---

### Task 2: Docs tab in AgentWorkspace + inline markdown renderer

**Files:**
- Modify: `src/renderer/components/agents/AgentWorkspace.tsx`

**Interfaces:**
- Consumes: `agentReadme(agentName: String!)` GQL query via `rendererGql`
- Produces: Docs tab (last position), markdown rendered as React elements

- [ ] **Step 1: Add WorkspaceTab 'docs' and state**

In `AgentWorkspace.tsx`, update the `WorkspaceTab` type (currently `'settings' | 'approvals' | 'activity' | 'tools'`):

```typescript
type WorkspaceTab = 'settings' | 'approvals' | 'activity' | 'tools' | 'docs';
```

Add to `WorkspaceState`:
```typescript
readme: string | null;    // null = not loaded, '' = no README exists
readmeLoading: boolean;
```

Add to initial state:
```typescript
readme: null,
readmeLoading: false,
```

- [ ] **Step 2: Add `loadReadme` method**

```typescript
private async loadReadme() {
  if (this.state.readme !== null || this.state.readmeLoading) return;
  this.setState({ readmeLoading: true });
  try {
    const result = await rendererGql<{ agentReadme: string | null }>(
      `query AgentReadme($agentName: String!) { agentReadme(agentName: $agentName) }`,
      { agentName: this.props.agentId },
    );
    this.setState({ readme: result?.agentReadme ?? '', readmeLoading: false });
  } catch {
    this.setState({ readme: '', readmeLoading: false });
  }
}
```

- [ ] **Step 3: Add Docs tab to `renderTabBar()`**

In `renderTabBar()`, extend the `tabs` array with:
```typescript
{ id: 'docs', label: 'Docs' },
```

Update the `onClick` for the tab click to trigger `loadReadme` when docs is selected:
```typescript
onClick: () => { this.setState({ activeTab: tab.id }); if (tab.id === 'tools') this.loadTools(); if (tab.id === 'docs') this.loadReadme(); },
```

- [ ] **Step 4: Add `renderDocsTab()` with inline markdown renderer**

Add this method to `AgentWorkspace`:

```typescript
private renderDocsTab() {
  const { readme, readmeLoading } = this.state;

  if (readmeLoading) {
    return React.createElement('div', { style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const } }, 'Loading…');
  }
  if (!readme) {
    return React.createElement('div', { style: { color: 'var(--ag-text-muted)', padding: '40px 0', textAlign: 'center' as const } },
      'No README.md found for this agent.',
    );
  }

  return React.createElement('div', {
    style: { maxWidth: 760, lineHeight: 1.7, fontSize: 14, color: 'var(--ag-text-secondary)' },
  }, ...renderMarkdown(readme));
}
```

Add the `renderMarkdown` helper function (module-level, outside the class):

```typescript
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      nodes.push(React.createElement('pre', {
        key: `code-${i}`,
        style: { background: 'var(--ag-bg-inset)', borderRadius: 8, padding: '12px 16px', overflowX: 'auto' as const, margin: '12px 0', fontSize: 12.5 },
      }, React.createElement('code', { style: { fontFamily: 'monospace', color: 'var(--ag-teal)' } }, codeLines.join('\n'))));
      i++; continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) {
      nodes.push(React.createElement('hr', { key: `hr-${i}`, style: { border: 'none', borderTop: '1px solid var(--ag-border)', margin: '24px 0' } }));
      i++; continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/); if (h3) { nodes.push(React.createElement('h3', { key: `h3-${i}`, style: { fontSize: 14, fontWeight: 700, color: 'var(--ag-text-primary)', margin: '20px 0 6px' } }, h3[1])); i++; continue; }
    const h2 = line.match(/^## (.+)/);  if (h2) { nodes.push(React.createElement('h2', { key: `h2-${i}`, style: { fontSize: 16, fontWeight: 700, color: 'var(--ag-text-primary)', margin: '28px 0 8px', borderBottom: '1px solid var(--ag-border)', paddingBottom: 6 } }, h2[1])); i++; continue; }
    const h1 = line.match(/^# (.+)/);   if (h1) { nodes.push(React.createElement('h1', { key: `h1-${i}`, style: { fontSize: 22, fontWeight: 800, color: 'var(--ag-text-primary)', margin: '0 0 20px' } }, h1[1])); i++; continue; }

    // Table
    if (line.startsWith('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^[\|\s\-:]+$/.test(lines[i])) {
          tableRows.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
        }
        i++;
      }
      if (tableRows.length > 0) {
        const [head, ...body] = tableRows;
        nodes.push(React.createElement('table', { key: `tbl-${i}`, style: { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0', fontSize: 13 } },
          React.createElement('thead', null, React.createElement('tr', null, ...(head ?? []).map((h, ci) =>
            React.createElement('th', { key: ci, style: { textAlign: 'left' as const, padding: '6px 12px', borderBottom: '2px solid var(--ag-border)', color: 'var(--ag-text-primary)', fontWeight: 700, fontSize: 12.5 } }, h),
          ))),
          React.createElement('tbody', null, ...body.map((row, ri) =>
            React.createElement('tr', { key: ri }, ...row.map((cell, ci) =>
              React.createElement('td', { key: ci, style: { padding: '6px 12px', borderBottom: '1px solid var(--ag-border-subtle)', verticalAlign: 'top' as const } }, inlineMarkdown(cell)),
            )),
          )),
        ));
      }
      continue;
    }

    // Bullet list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(React.createElement('ul', { key: `ul-${i}`, style: { margin: '8px 0 8px 20px', padding: 0 } },
        ...items.map((item, idx) => React.createElement('li', { key: idx, style: { marginBottom: 4 } }, inlineMarkdown(item))),
      ));
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      nodes.push(React.createElement('blockquote', { key: `bq-${i}`, style: { borderLeft: '3px solid var(--ag-teal)', paddingLeft: 14, margin: '12px 0', color: 'var(--ag-text-muted)', fontStyle: 'italic' } }, inlineMarkdown(line.slice(2))));
      i++; continue;
    }

    // Empty line
    if (!line.trim()) { nodes.push(React.createElement('div', { key: `br-${i}`, style: { height: 8 } })); i++; continue; }

    // Paragraph
    nodes.push(React.createElement('p', { key: `p-${i}`, style: { margin: '4px 0 8px' } }, inlineMarkdown(line)));
    i++;
  }

  return nodes;
}

function inlineMarkdown(text: string): React.ReactNode {
  // Handle **bold**, *italic*, and `code` inline
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  if (parts.length === 1) return text;
  return React.createElement(React.Fragment, null, ...parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return React.createElement('strong', { key: i }, p.slice(2, -2));
    if (p.startsWith('*') && p.endsWith('*')) return React.createElement('em', { key: i }, p.slice(1, -1));
    if (p.startsWith('`') && p.endsWith('`')) return React.createElement('code', { key: i, style: { fontFamily: 'monospace', background: 'var(--ag-bg-inset)', padding: '1px 5px', borderRadius: 4, fontSize: 12.5, color: 'var(--ag-teal)' } }, p.slice(1, -1));
    return p;
  }));
}
```

- [ ] **Step 5: Wire Docs tab to `render()`**

In `render()`, add after the tools tab:
```typescript
activeTab === 'docs' && this.renderDocsTab(),
```

- [ ] **Step 6: Build and verify**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -20
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/agents/AgentWorkspace.tsx
git commit -m "feat(ui): Docs tab — renders agent README.md with inline markdown; last tab position"
```

---

### Task 3: README.md template in agent scaffolding

**Files:**
- Modify: `src/cli/commands/agent.ts`

**Interfaces:**
- Produces: `README_TEMPLATE(name: string): string` — skeleton README written to `agentDir/README.md` on `nexus agent create`

- [ ] **Step 1: Add README template constant**

In `src/cli/commands/agent.ts`, after the `MANIFEST_TEMPLATE` constant (around line 414), add:

```typescript
const README_TEMPLATE = (name: string) => `# ${name}

> One-sentence description of what this agent does.

## How It Works

Describe the agent's pipeline in 2–3 short paragraphs. Cover what triggers
a run, what it checks (and in what order), and how it decides what to report
or escalate. Focus on the mental model a user needs — not a code tour.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| Nexus graph.db (fleet_sql) | Yes | WPE installs + plugin/user inventory |
| Log Processor aggregates | Optional | Needs connect_log_source configured |

## Output

- **Findings** — what surfaces in the Approvals tab and at what severity
- **Report** — what the Report file contains (key sections, format)
- **Log** — what each phase logs and at what verbosity
- **State** — anything persisted between runs (baselines, cooldowns, cache)

## Setup

Step-by-step for first-time use. List prerequisites, credentials required,
and any site-level configuration (e.g. connecting log sources, OAuth).

## Tips & Tricks

Write 3–5 practical tips: when to run on-demand vs scheduled, how to tune
scope, what to check if results seem off, how to pair with other agents.

## FAQ

**Q: Why did a finding fire / not fire?**  
A: Explain the threshold or condition.

**Q: How often should I run this?**  
A: Guidance on cadence.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Run completes instantly with no findings | No sites in scope | Check that sites are synced in Nexus |
| Tool unavailable error | Missing prerequisite agent | Install and configure the required agent |
`;
```

- [ ] **Step 2: Write README.md during scaffold**

Find the `fs.writeFileSync(path.join(agentDir, 'nexus.agent.yaml'), ...)` call (around line 565) and add immediately after:

```typescript
fs.writeFileSync(path.join(agentDir, 'README.md'), README_TEMPLATE(name), 'utf-8');
console.log(`Created: ${path.join(agentDir, 'README.md')}`);
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai && npm run build 2>&1 | grep -E "error TS" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/agent.ts
git commit -m "feat(scaffold): write README.md when nexus agent create runs"
```

---

### Task 4: Write READMEs for existing agents

**Files:**
- Create: `agents/log-processor/README.md`
- Create: `agents/security-sentinel/README.md`
- Create: `agents/seo-insights/README.md`

After creating each, also copy to the runtime directory:
```bash
cp agents/<name>/README.md ~/Library/Application\ Support/Local/nexus-ai/agents/<name>/README.md
```

---

#### log-processor/README.md

```markdown
# log-processor

> Streams WP Engine Apache-style access logs from S3, classifies every
> request, and folds the results into compact daily aggregates that
> security-sentinel and seo-insights consume.

## How It Works

Log-processor is a pure data pipeline — no LLM is involved at any stage.
On each nightly run (3 AM UTC) it loops through every enabled site, fetches
the access log files from S3 for any dates not yet processed, and streams
them line-by-line through a deterministic classifier. Raw bytes are never
written to disk; only the summarised aggregate for each site-day is stored.

The classifier assigns every request to one of nine traffic classes
(human_plausible, search_bot, ai_training, ai_retrieval, seo_tool,
monitoring, platform, attack, other_bot) using a priority-ordered set of
UA regex patterns and behavioral signals. Auth attacks, probe paths, and
enumeration attempts are detected by URL pattern and HTTP method alone —
UA spoofing does not affect these signals. The status code of every auth
attempt is recorded, allowing consumers (sentinel) to separate successful
logins (302) from failed attempts (200) and blocked requests (403/429).

The daily aggregate (`DayAggregate`) is the durable output: roughly 5–10 KB
per site-day, retained for 180 days by default. It powers the Traffic
Intelligence section in seo-insights reports and the log-backed checks in
security-sentinel sweeps.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| WP Engine S3 access logs | Yes | Configure via connect_log_source |
| AWS credentials | Yes | IAM key with s3:GetObject + s3:ListBucket on log bucket |

## Output

- **Findings** — none; log-processor produces no Approvals findings
- **Report** — none; it is a data infrastructure agent, not an analysis agent
- **Log** — per-site sync progress: date range, file count, request count, lines skipped
- **State** — `logs.sqlite` in the agent directory: sources table, ledger (processed dates), aggregates

## Setup

1. Obtain your WP Engine S3 log bucket name and prefix from the WPE portal
   (Account → Log Forwarding or contact WPE support).
2. Add your AWS IAM credentials in Nexus Preferences → Connected Accounts → AWS S3.
3. For each WPE install you want to monitor, run:
   `connect_log_source` → `set_log_processing enabled=true` → `sync_access_logs`
4. The nightly cron will keep new dates ingested automatically.

## Tips & Tricks

Use `log_storage_status` to confirm which sites are connected and how many
aggregate days are stored before running seo-insights or sentinel.

Sync a backfill with a generous `budgetMB` (512 is the default) on the first
run. If the date range is large, re-run `sync_access_logs` multiple times —
the ledger prevents duplicate processing.

`fetch_log_window` is a two-phase forensic tool: call it without `confirm`
first to see the cost estimate, then with `confirm: true` to stream filtered
raw lines. Use it when sentinel flags a specific IP or path and you need the
actual log evidence.

The taxonomy version is embedded in every aggregate (`taxonomyVersion`).
If the classifier is updated in a future release, older aggregates are still
readable but may not include new fields.

## FAQ

**Q: sync_access_logs succeeded but log_storage_status shows 0 days. Why?**  
A: Run `connect_log_source` first — `sync_access_logs` requires a source binding.
If you see "⚠ No log source bound", that is the issue.

**Q: Why does the nightly cron skip some days?**  
A: Days already in the ledger are skipped (idempotent). Missing days appear
in `get_log_aggregates` output as `missingDays` with the exact sync command
to fill them.

**Q: The S3 prefix looks right but no apachestyle files are found.**  
A: WPE log file names include the string "apachestyle". Check that log
forwarding is enabled for the install in the WPE portal and that the prefix
includes the trailing slash if logs are in a subfolder.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "⚠ No log source bound" | connect_log_source not run | Run connect_log_source with bucket and prefix |
| "AWS credentials are no longer valid" | IAM key rotated or revoked | Re-enter credentials in Preferences → AWS S3 |
| sync_access_logs succeeds but 0 requests found | Wrong S3 prefix | Verify prefix in WPE portal; check for trailing slash |
| Large sync budget exhausted, dates deferred | Log volume exceeds budget | Re-run with higher budgetMB, or sync date-by-date |
| Traffic Intelligence missing in seo-insights | Site not connected or no days synced | Run log_storage_status, then connect and sync |
```

---

#### security-sentinel/README.md

```markdown
# security-sentinel

> Fleet-wide WordPress security surveillance — detects active compromise,
> pre-breach exposure, and distributed attack campaigns across all WP Engine
> installs and linked local sites.

## How It Works

Sentinel runs on a 15-minute cron and on three events: WPE sync completed,
plugin activated, and user created. Each sweep checks every install in scope
through two tiers.

**Tier 1** runs entirely without an LLM and completes in seconds. It executes
a battery of absolute checks (ABS-01 through ABS-07): known backdoor plugin
slugs, default auth salts, "admin" username, low-entropy plugin directory
names used by attackers to hide tools, and more. It also runs exposure checks
(EXP) for misconfigurations that enable attacker access, and relative checks
(REL) that diff against a stored baseline to surface new admin accounts or
recently installed plugins. Finally it runs four log-backed checks (LOG-AUTH,
LOG-PROBE, LOG-ENUM, LOG-DIST) against 30 days of access log aggregates from
log-processor, counting failed login attempts, probe paths, enumeration hits,
and distinct attacker IPs — excluding successful logins.

**Tier 2** triggers when Tier 1 produces at least one critical finding or two
high active-compromise findings. It clones the site into a sandbox, then runs
five LLM-powered specialist modules: enumerator (filesystem inventory),
pattern scanner (PHP obfuscation, ELF binaries, temporal file clusters),
database scanner (injected scripts, rogue cron hooks, spam in posts),
behavioral prober (cloaking, xmlrpc, REST user enumeration via HTTP), and a
synthesizer that correlates all specialist results into a single verdict,
entry point hypothesis, and remediation plan.

**Fleet correlation** runs after all per-site checks and flags the same
suspicious plugin slug appearing on two or more installs (potential
account-level compromise) and shared new-admin email domains across installs.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| Nexus graph.db (fleet_sql) | Yes | Plugin inventory, user list, site metadata |
| wpe_site_deep_refresh (SSH WP-CLI) | Yes | Fresh plugin/user data for each install |
| Log Processor aggregates | Optional | 30-day auth/probe/enum/IP data via get_log_aggregates |
| wp_eval (sandbox only) | Tier 2 | Filesystem and DB inspection in a cloned sandbox |

## Output

- **Findings** — one finding per signal, in the Approvals tab with severity (critical/high/medium) and category (active-compromise/pre-breach/misconfiguration)
- **Report** — Tier 2 only: synthesizer narrative with verdict, entry point, attacker items, blind spots, and remediation steps
- **Log** — per-install sweep progress, Tier 1 signals found, Tier 2 phase labels, sandbox lifecycle
- **State** — per-install baseline: admin user list and plugin list at last scan, used by relative checks (REL-03 etc.)

## Setup

No additional setup is required beyond Nexus itself. For log-backed checks
(LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST) to work, you must also set up
log-processor for each install you want to monitor.

To enable Tier 2 deep investigation, the site must be start-able in Local
(for local sites) or pullable from WPE (for remote installs). The sandbox
is created automatically and deleted after the run.

## Tips & Tricks

Run sentinel on-demand via the Run Now button after any suspicious event —
a new admin account email, an unexpected plugin, or a spike in login failures
visible in the Traffic Intelligence section of an seo-insights report.

If a site is flagging ABS-07 (low-entropy plugin name) on a known legitimate
plugin, add the slug to the `ABS07_ALLOWLIST` set in `agent.js` and file a
note so it can be included in the next release.

The autonomy setting controls what happens when Tier 2 finds active compromise:
- **Suggest only** — findings reported, no remediation executed
- **Act, then ask** — sandbox cloned and scanned; you approve before any deletion
- **Fully autonomous** — full remediation in sandbox; requires your approval before production push

## FAQ

**Q: Why did sentinel escalate to Tier 2 on a site that seems clean?**  
A: Two high active-compromise signals trigger Tier 2 regardless of whether
they turn out to be false positives. Check the Tier 1 findings in the
Approvals tab — if ABS-07 or REL-03 fired incorrectly, update the allowlist
or baseline.

**Q: LOG-AUTH fired but users legitimately log in to the site.**  
A: LOG-AUTH counts only failed logins (HTTP 200, 403, 429 on the login POST).
Successful logins (302 redirects) are excluded. If it still fires, the site
is receiving genuine brute-force traffic.

**Q: Tier 2 is taking a long time.**  
A: Tier 2 pulls the full site into a sandbox — file copy plus database. For
large sites this can take 5–10 minutes. The 20-minute timeout is intentional.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No installs checked | WPE sync not run or auth expired | Run nexus doctor; re-authenticate WPE |
| LOG-* checks never fire | log-processor not configured | Set up log-processor for the install |
| ABS-07 false positive | Known-good short plugin slug | Add slug to ABS07_ALLOWLIST in agent.js |
| Tier 2 sandbox creation fails | Local not running or disk full | Start Local; check disk space |
| Synthesizer returns unavailable | AI provider not configured | Run nexus doctor; check API key |

## System Prompt

The Tier 2 synthesizer uses the following prompt template (data injected at runtime):

```
You are a senior WordPress security analyst synthesizing findings from five 
specialist agents. Your job: correlate, elevate, and produce a remediation 
plan. You must also explicitly disclose blind spots.

SITE: {installName} ({environment}, {postCount} posts)

## Tier 1 signals (static analysis)
{tier1Signals}

## Enumerator findings
{enumeratorResult}

## Integrity findings
{integrityResult}

## Pattern scanner findings (includes temporal cluster analysis)
{patternResult}

## Database findings
{databaseResult}

## Behavioral findings
{behavioralResult}

## Access log corroboration (30-day aggregate)
{logCorroboration}   ← only included when log data is available

SYNTHESIS RULES:
1. CRITICAL from any specialist leads the report.
2. Temporal cluster = attack session boundary. Items within the cluster 
   window are suspect regardless of name.
3. Cross-agent correlation: flagged by 2+ specialists = CONFIRMED.
   Flagged by 1 = PROBABLE.
4. Always name the entry point.
5. If access log data present: use auth attack volume and IP cardinality 
   to calibrate severity.
6. Remediation order: stop exfiltration → remove persistence → close 
   entry point → verify clean.
7. BLIND SPOTS: always disclose what was NOT checked.
```
```

---

#### seo-insights/README.md

```markdown
# seo-insights

> Content strategy agent — analyzes your WordPress site's content structure,
> topic clusters, traffic quality, and demand gaps to surface SEO opportunities.

## How It Works

Seo-insights runs weekly (Mondays at 7 AM) and on WPE sync events. Each run
produces a Site Content Report for the target site.

For WPE sites, the agent creates a temporary Local sandbox, pulls the site
from WPE (files + database), starts the sandbox, and triggers a reindex so
the Nexus content index is populated. Analysis runs against the sandbox;
the sandbox is cleaned up automatically.

**Content analysis** reads the Nexus content index (no PHP execution required
for indexed sites) and computes two signals: orphaned posts (posts with no
inbound internal links — invisible to crawlers following link graphs) and
stale posts (not updated in over a year).

**Topical map** calls `get_all_site_documents` with embeddings enabled and
runs k-means clustering (k=8) on the document vectors. Each cluster is labeled
by its centroid's nearest post title. This shows which semantic topic areas
the site's content concentrates in and reveals gaps.

**Traffic Intelligence** fetches 30 days of access log aggregates from
log-processor and computes: human traffic percentage, top AI crawlers by
hit count, 404 demand signals (content-like 404s = topics users want but
the site doesn't have), referral source mix, and failed auth probe count
(flag for sentinel review if above 100).

For local sites linked to a WPE install, the agent resolves the WPE install
name via `local_wpe_link` before fetching log data, so Traffic Intelligence
works whether you run against the WPE install directly or the linked local site.

The agent also exposes several on-demand contributed tools for deeper analysis:
Google Search Console demand gaps, cannibalization detection, intent
classification, and decay detection — all requiring OAuth connection to GSC.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| Nexus content index | Yes | Site must be indexed (or indexable) |
| Log Processor aggregates | Optional | Enables Traffic Intelligence section |
| Google Search Console | Optional | Enables T1 demand analysis tools |
| WPE SSH (for WPE sites) | Yes | Used to pull sandbox |

## Output

- **Findings** — orphaned-content (HIGH if >30% of posts), stale-content (LOW), thin-corpus (LOW if <10 posts), stale-index (MEDIUM)
- **Report** — Site Content Report: post count, orphan/stale breakdowns, Topical Map (8 clusters), Traffic Intelligence (when log data available), next steps
- **Log** — site resolution, index status, content analysis count, log resolution, topic clustering progress
- **State** — last report text (for retrieval); per-site cooldown key

## Setup

1. For Traffic Intelligence: configure log-processor for each site you want
   to analyze (connect_log_source → set_log_processing → sync_access_logs).
2. For demand analysis (T1 tools): connect Google Search Console via
   `connect_gsc` and select your property.
3. For WPE sites: ensure the install is accessible via WPE SSH (SSH key
   registered in WPE portal).

## Tips & Tricks

Run on the local site (e.g. "NitroPack Production") rather than the WPE
install name when you want to avoid creating a sandbox — the local site
is already indexed and running. The agent resolves the linked WPE install
name automatically for log data.

The orphaned-content finding is often the highest-leverage SEO fix: posts
with no inbound links receive zero internal PageRank. Add internal links
from high-authority posts to your most important orphaned content.

The topical map uses k=8 clusters by default. If your site is large (500+
posts) or very specialized, run `build_topic_map` on-demand with a higher
cluster count (12–15) for finer granularity.

404 demand signals in the Traffic Intelligence section are the fastest content
gaps to act on — real users are already searching for this content and landing
on your site with a 404. Prioritize these over GSC-derived gaps.

## FAQ

**Q: Why does the report show 0 posts analyzed?**  
A: The sandbox was created but not yet indexed. This is now handled
automatically (the agent triggers a reindex after the pull), but if the
sandbox was created before this fix, delete it in Local and re-run.

**Q: Traffic Intelligence is missing from the report.**  
A: Log-processor is not configured for this site, or logs have not been
synced yet. Run `log_storage_status` to check, then `sync_access_logs`.

**Q: Topical map labels seem arbitrary.**  
A: The cluster label is the title of the post nearest the cluster centroid —
not a generated label. It is the most representative post in that topic area,
which gives you an anchor, not a summary. Read the sample posts to understand
what the cluster covers.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| "Site is not running" warning | Local site not started | Start the site in Local before running |
| Sandbox pull fails | WPE SSH not configured | Register SSH key in WPE portal |
| No Traffic Intelligence section | Log-processor not set up | Configure log-processor for this site |
| GSC tools return "not connected" | OAuth not completed | Run connect_gsc |
| Topical map skipped | Embeddings unavailable | Check index health; reindex the site |
```

---

**After writing each README:**

- [ ] Copy each to runtime:
```bash
cp agents/log-processor/README.md ~/Library/Application\ Support/Local/nexus-ai/agents/log-processor/README.md
cp agents/security-sentinel/README.md ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/README.md
cp agents/seo-insights/README.md ~/Library/Application\ Support/Local/nexus-ai/agents/seo-insights/README.md
```

- [ ] Commit:
```bash
git add agents/log-processor/README.md agents/security-sentinel/README.md agents/seo-insights/README.md
git commit -m "docs: agent READMEs for log-processor, security-sentinel, seo-insights"
```

---

## Self-Review

### Spec Coverage
- Docs tab last (after Tools) ✓
- Short prose paragraphs in How It Works ✓
- FAQ and Troubleshooting separate ✓
- System Prompt section in sentinel and seo-insights READMEs ✓
- System Prompt omitted from log-processor (no LLM) ✓
- README.md added to scaffolding ✓
- All three existing agents have READMEs ✓

### Gaps
- The `rendererGql` import is already in `AgentWorkspace.tsx` — verify before Task 2.
- `renderMarkdown` and `inlineMarkdown` are module-level functions placed before the class — no naming conflicts with existing code.

### Type Consistency
- `readme: string | null` — null = not fetched, `''` = fetched but no file. Consistent with `readmeLoading: boolean` gate.
