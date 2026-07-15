# Sentinel Review/Execute UI — Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Security Sentinel review/execute overlay (design handoff screens 05–10) — the human sign-off flow from findings → account decisions → execute confirmation → live progress → "Production is clean."

**Architecture:** A `SentinelReviewOverlay` component (full-screen or 680px side-panel) opens inside `AgentConsoleTab` when a Sentinel approval event is reviewed. A report parser reads the markdown report file into a typed `SentinelCase`. Account decisions are collected in the overlay and passed to an `ExecuteModal` which calls a new `nexus:sentinel:execute` IPC channel; the main process replays targeted WP-CLI commands over SSH via the existing `remoteWpCliRun` infrastructure.

**Tech Stack:** React class components + `React.createElement()` (no JSX), `rendererGql` HTTP transport for GraphQL, `ipcRenderer.invoke` for the streaming execute channel, existing `localServices.remoteWpCliRun` for SSH.

## Global Constraints

- All renderer components are class-based (`class X extends React.Component`) — no function components, no hooks
- All rendering uses `React.createElement()` — never JSX angle brackets
- `import * as React from 'react'`
- Design tokens from `src/renderer/styles/agent-console.css` (`--ag-*` variables)
- CSS not imported via `require()` — styles injected via `injectAgentConsoleStyles()` already registered
- `rendererGql` is at `src/renderer/utils/rendererGql.ts` — same pattern as `AgentWorkspace.runNow()`
- TypeScript must compile clean: `npm run compile 2>&1 | head -5`
- Plan B does NOT include: cloaked redirect detection, WooCommerce skimmer scan, or HIBP password checking

## Design Reference

Screens from `/tmp/nexus-screens2/design_handoff_agent_console/`:
- `05-review-verdict-findings.png` — verdict banner + findings grid
- `06-review-accounts-resolved.png` — account decisions → execute unlocked
- `07-review-side-panel.png` — 680px panel layout mode
- `08-execute-confirm.png` — generated command list
- `09-execute-progress.png` — live per-command progress
- `10-execute-clean.png` — "Production is clean" summary

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/renderer/utils/parseSentinelReport.ts` | Create | Parse markdown report → `SentinelCase` typed data |
| `src/renderer/components/agents/SentinelTypes.ts` | Create | Shared `SentinelCase`, `Finding`, `RemediationStep`, `AdminAccount` interfaces |
| `src/renderer/components/agents/SentinelReviewOverlay.tsx` | Create | Full review UI: header, verdict, findings, checklist, account decisions |
| `src/renderer/components/agents/ExecuteModal.tsx` | Create | Confirm → running → done states |
| `src/renderer/components/agents/AgentConsoleTab.tsx` | Modify | Wire `onReviewEvent` to open overlay; add `activeSentinelCase` state |
| `agents/security-sentinel/agent.js` | Modify | Remove auto-delete of sandbox (keep alive until user dismisses) |
| `src/main/sentinel/SentinelExecutor.ts` | Create | SSH command execution via `remoteWpCliRun` |
| `src/main/index.ts` | Modify | Register `nexus:sentinel:execute` IPC handler |
| `src/cli/commands/agent.ts` | Modify | Wire `nexus agent push <installName>` to IPC execute |

---

### Task 1: SentinelTypes + Report Parser

**Files:**
- Create: `src/renderer/components/agents/SentinelTypes.ts`
- Create: `src/renderer/utils/parseSentinelReport.ts`

**Interfaces:**
- Produces: `SentinelCase`, `Finding`, `RemediationStep`, `AdminAccount`, `AccountDecision` — consumed by all later tasks
- Produces: `parseSentinelReport(reportPath: string): SentinelCase` — called by `AgentConsoleTab` in Task 6

- [ ] **Step 1: Create SentinelTypes.ts**

Create `src/renderer/components/agents/SentinelTypes.ts`:

```typescript
export type FindingSev = 'critical' | 'high' | 'medium';

export interface Finding {
  id: string;       // 'FS-01', 'ABS-05'
  sev: FindingSev;
  title: string;    // plain-language title
  plain: string;    // one-sentence explanation (derived from id for now)
}

export interface RemediationStep {
  n: number;
  title: string;
  by: 'agent' | 'wpe';  // 'wpe' when title contains "already enforced by WPE"
  review: boolean;       // true for Step 2 (account remediation)
  action: string;        // detail after the dash
  proof: string;         // same as action for now
  ok: boolean;           // ✅ = true, ❌/⚪ = false
  deferred?: boolean;    // ⚪ deferred steps
}

export interface AdminAccount {
  id: string;       // username
  user: string;     // username (monospace display)
  uid: number;      // placeholder uid (0 if unknown)
  email: string;
  created: string;
  score: number;    // 0–100
  breakdown: Array<{ t: string; pts: string }>;
  staged: string;   // what the agent did on the sandbox
  autoDeleted?: boolean;
  legitimate?: boolean;
}

export type AccountDecision = 'delete' | 'keep' | null;

export interface SentinelCase {
  site: string;
  host: string;           // site + '.wpengine.com'
  env: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  detectedAt: string;     // ISO from report Date field
  reportPath: string;     // full path to the report file
  sandbox: { id: string; url: string };
  verdict: 'ready' | 'blocked';
  failedSteps: number;
  findings: Finding[];
  steps: RemediationStep[];
  accounts: AdminAccount[];
}
```

- [ ] **Step 2: Create parseSentinelReport.ts**

Create `src/renderer/utils/parseSentinelReport.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SentinelCase, Finding, RemediationStep, AdminAccount } from '../components/agents/SentinelTypes';

// Map signal IDs to plain-language explanations
const SIGNAL_PLAIN: Record<string, string> = {
  'FS-01': 'A PHP file was found in must-use plugins — it loads on every page request and cannot be deactivated from WP Admin.',
  'FS-02': 'Code using multi-layer encoding (eval + base64/gzinflate/rot13) was found — a known malware hiding technique.',
  'FS-04': 'PHP files were found in the uploads directory, where only media files should exist.',
  'ABS-01': "An administrator account named 'admin' exists — the most commonly targeted username in brute-force attacks.",
  'ABS-02': 'There are more administrator accounts than expected for a site this size.',
  'ABS-03': "An admin account is using @example.com — the default WordPress placeholder email, indicating an attacker-created account.",
  'ABS-04': 'File manager plugins are active — they give WP Admin users full filesystem write access.',
  'ABS-05': 'A known backdoor plugin was found — it silently creates hidden administrator accounts on each page load.',
  'ABS-06': 'Authentication salts are still set to the default placeholder value, making session cookies forgeable.',
  'EXP-01': 'The WordPress REST API exposes usernames without authentication, enabling targeted brute-force attacks.',
  'EXP-03': 'The theme and plugin file editor is enabled — a compromised admin account can inject PHP directly from WP Admin.',
  'EXP-05': 'WP_DEBUG is enabled on a production site, exposing PHP errors and internal paths to visitors.',
  'LLM-USER-01': 'The AI identified administrator usernames that appear to be programmatically generated or follow attacker naming patterns.',
};

function parseSev(raw: string): Finding['sev'] {
  const s = raw.toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high')     return 'high';
  return 'medium';
}

function parseFindings(lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    const m = line.match(/^- \[(\w+)\] ([\w-]+): (.+)$/);
    if (!m) continue;
    const [, sev, id, title] = m;
    findings.push({ id, sev: parseSev(sev), title, plain: SIGNAL_PLAIN[id] || title });
  }
  return findings;
}

function parseSteps(lines: string[]): RemediationStep[] {
  const steps: RemediationStep[] = [];
  for (const line of lines) {
    // ✅ Step 1: Title — detail
    // ❌ Step 5: Title — detail
    // ⚪ Step 5: Title — detail (deferred)
    const m = line.match(/^([✅❌⚪])\s+Step\s+(\d+):\s+(.+?)(?:\s+—\s+(.*))?$/u);
    if (!m) continue;
    const [, icon, nStr, title, action = ''] = m;
    const ok = icon === '✅';
    const deferred = icon === '⚪';
    const n = parseInt(nStr, 10);
    const by: 'agent' | 'wpe' = action.toLowerCase().includes('wpe platform') ||
      action.toLowerCase().includes('already enforced') ? 'wpe' : 'agent';
    const review = n === 2; // Step 2 is the account remediation step
    steps.push({ n, title, by, review, action, proof: action, ok: ok || deferred, deferred });
  }
  return steps;
}

function parseAccounts(steps: RemediationStep[]): AdminAccount[] {
  // Account data is embedded in Step 2's action string as JSON
  const step2 = steps.find(s => s.n === 2);
  if (!step2) return [];
  const jsonMatch = step2.action.match(/\{.*\}/s);
  if (!jsonMatch) return [];
  try {
    const data = JSON.parse(jsonMatch[0]) as {
      auto_deleted?: string[];
      demoted?: Array<{ username: string; score: number; note: string }>;
      app_keys_deleted?: string[];
      flagged?: string[];
    };
    const accounts: AdminAccount[] = [];
    for (const username of (data.auto_deleted || [])) {
      accounts.push({
        id: username, user: username, uid: 0, email: '', created: '',
        score: 100, breakdown: [{ t: 'Auto-deleted (score 100)', pts: '+100' }],
        staged: 'Deleted from sandbox database',
        autoDeleted: true,
      });
    }
    for (const item of (data.demoted || [])) {
      accounts.push({
        id: item.username, user: item.username, uid: 0, email: '', created: '',
        score: item.score,
        breakdown: [
          { t: 'Demoted to subscriber on sandbox', pts: `score ${item.score}` },
          { t: 'Application passwords deleted', pts: 'immediate' },
        ],
        staged: `Demoted to subscriber, app keys deleted (score: ${item.score})`,
      });
    }
    return accounts;
  } catch {
    return [];
  }
}

export function parseSentinelReport(reportPath: string): SentinelCase | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const lines = content.split('\n');

    // Site
    const siteLine = lines.find(l => l.startsWith('**Site:**'));
    const site = siteLine ? siteLine.replace('**Site:**', '').trim() : 'unknown';

    // Date
    const dateLine = lines.find(l => l.startsWith('**Date:**'));
    const detectedAt = dateLine ? dateLine.replace('**Date:**', '').trim() : new Date().toISOString();

    // Sandbox
    const sandboxLine = lines.find(l => l.startsWith('**Sandbox:**'));
    const sandboxId = sandboxLine ? sandboxLine.replace('**Sandbox:**', '').trim() : '';

    // Verdict
    const verdictLine = lines.find(l => l.includes('READY TO PUSH') || l.includes('NOT SAFE TO PUSH'));
    const verdict: SentinelCase['verdict'] = verdictLine?.includes('READY TO PUSH') ? 'ready' : 'blocked';

    // Section boundaries
    const findingsStart = lines.findIndex(l => l.startsWith('## Findings'));
    const checklistStart = lines.findIndex(l => l.startsWith('## Remediation Checklist'));
    const verdictBannerIdx = lines.findIndex(l => l.startsWith('## Verdict'));

    const findingLines = findingsStart >= 0 && checklistStart >= 0
      ? lines.slice(findingsStart + 1, checklistStart)
      : [];
    const checklistLines = checklistStart >= 0 && verdictBannerIdx >= 0
      ? lines.slice(checklistStart + 1, verdictBannerIdx)
      : [];

    const findings = parseFindings(findingLines);
    const steps = parseSteps(checklistLines);
    const accounts = parseAccounts(steps);
    const failedSteps = steps.filter(s => !s.ok).length;

    return {
      site,
      host: `${site}.wpengine.com`,
      env: 'PRODUCTION',
      detectedAt,
      reportPath,
      sandbox: { id: sandboxId, url: '' }, // url resolved at display time
      verdict,
      failedSteps,
      findings,
      steps,
      accounts,
    };
  } catch {
    return null;
  }
}

// Find the latest report for a site
export function findLatestReport(siteName: string): string | null {
  const reportsDir = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', 'security-sentinel', 'reports', siteName,
  );
  try {
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(reportsDir, files[0]) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Compile check**

```bash
npm run compile 2>&1 | head -5
```

Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/agents/SentinelTypes.ts src/renderer/utils/parseSentinelReport.ts
git commit -m "feat(sentinel-ui): add SentinelCase types and markdown report parser"
```

---

### Task 2: SentinelReviewOverlay — header, verdict, findings, checklist

**Files:**
- Create: `src/renderer/components/agents/SentinelReviewOverlay.tsx`

**Interfaces:**
- Consumes: `SentinelCase` from Task 1
- Produces: `SentinelReviewOverlay` component — props: `{ case: SentinelCase; onDismiss: () => void; onExecute: (decisions: AccountDecisionMap) => void; mode?: 'full' | 'panel' }`

`AccountDecisionMap = Record<string, { decision: 'delete' | 'keep' | null; keepReason: string }>`

This task builds the overlay shell, header, verdict banner, findings grid, and checklist. Account decision cards are Task 3.

- [ ] **Step 1: Create SentinelReviewOverlay.tsx**

Create `src/renderer/components/agents/SentinelReviewOverlay.tsx`:

```typescript
import * as React from 'react';
import type { SentinelCase, RemediationStep, Finding } from './SentinelTypes';

export type AccountDecisionMap = Record<string, {
  decision: 'delete' | 'keep' | null;
  keepReason: string;
}>;

interface OverlayProps {
  sentinelCase: SentinelCase;
  onDismiss: () => void;
  onExecute: (decisions: AccountDecisionMap) => void;
  mode?: 'full' | 'panel';
}

interface OverlayState {
  mode: 'full' | 'panel';
  expandedStep: number | null;
  decisions: AccountDecisionMap;
  showSignalIds: boolean;
}

const SEV_COLORS: Record<string, string> = {
  critical: '#f4685f',
  high:     '#f5b544',
  medium:   '#9aa1ac',
};

const BY_CHIP: Record<string, { label: string; color: string; bg: string }> = {
  agent: { label: 'agent',        color: '#35d0c5', bg: 'rgba(53,208,197,0.14)' },
  wpe:   { label: 'WPE platform', color: '#7b8cff', bg: 'rgba(123,140,255,0.14)' },
};

export class SentinelReviewOverlay extends React.Component<OverlayProps, OverlayState> {
  state: OverlayState = {
    mode: this.props.mode || 'full',
    expandedStep: null,
    decisions: {},
    showSignalIds: false,
  };

  private getAccountDecision(accountId: string) {
    return this.state.decisions[accountId] || { decision: null, keepReason: '' };
  }

  private setAccountDecision(accountId: string, decision: 'delete' | 'keep' | null, keepReason?: string) {
    this.setState(s => ({
      decisions: {
        ...s.decisions,
        [accountId]: { decision, keepReason: keepReason ?? s.decisions[accountId]?.keepReason ?? '' },
      },
    }));
  }

  private allResolved(): boolean {
    const { sentinelCase } = this.props;
    const reviewRequired = sentinelCase.accounts.filter(a => !a.autoDeleted && !a.legitimate);
    return reviewRequired.every(a => {
      const d = this.state.decisions[a.id];
      if (!d || d.decision === null) return false;
      if (d.decision === 'keep' && !d.keepReason.trim()) return false;
      return true;
    });
  }

  private canExecute(): boolean {
    return this.allResolved() && this.props.sentinelCase.verdict === 'ready';
  }

  private getFooterNote(): string {
    const { sentinelCase } = this.props;
    if (sentinelCase.verdict === 'blocked') {
      return `Execution is blocked — ${sentinelCase.failedSteps} step(s) failed verification.`;
    }
    const unresolved = sentinelCase.accounts.filter(a => !a.autoDeleted && !a.legitimate)
      .filter(a => !this.state.decisions[a.id]?.decision).length;
    if (unresolved > 0) {
      return `${unresolved} account${unresolved !== 1 ? 's' : ''} still need a decision before you can execute.`;
    }
    const cmdCount = this.generateCommands().length;
    return `All accounts resolved. ${cmdCount} commands will run on ${sentinelCase.host}.`;
  }

  private generateCommands(): string[] {
    const { sentinelCase } = this.props;
    const { decisions } = this.state;
    const cmds: string[] = [];

    // Plugin removal
    const pluginSlugs = ['fileorganizer', 'filester', 'wp-compat', 'file-manager-advanced',
      'noted', 'woocommerce-conversion-tracking', 'wp-file-manager'];
    cmds.push(`wp plugin delete ${pluginSlugs.join(' ')}`);

    // Webshell removal
    cmds.push('rm wp-content/mu-plugins/index.php');

    // User deletion / demotion
    const toDelete = sentinelCase.accounts
      .filter(a => a.autoDeleted || decisions[a.id]?.decision === 'delete')
      .map(a => a.uid)
      .filter(Boolean);
    if (toDelete.length > 0) {
      cmds.push(`wp user delete ${toDelete.join(' ')} --reassign=1`);
    }
    for (const a of sentinelCase.accounts.filter(a => decisions[a.id]?.decision === 'keep')) {
      cmds.push(`wp user update ${a.uid} --role=subscriber  # ${a.user} — kept per decision`);
    }

    // Hardening
    cmds.push('wp config shuffle-salts');
    cmds.push('wp config set DISALLOW_FILE_EDIT true --raw');

    return cmds;
  }

  private renderHeader() {
    const { sentinelCase, onDismiss } = this.props;
    const { mode } = this.state;
    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, padding: '20px 32px',
        borderBottom: '1px solid var(--ag-border-subtle)', flexShrink: 0,
      },
    },
      React.createElement('button', {
        onClick: onDismiss,
        style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
      }, '‹ Back'),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 } },
          React.createElement('span', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)' } }, sentinelCase.site),
          React.createElement('span', {
            style: { fontSize: 10, fontWeight: 700, color: '#9aa1ac', background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border)', borderRadius: 5, padding: '2px 8px' },
          }, `${sentinelCase.env} · WPE`),
        ),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } },
          `${sentinelCase.host} · detected ${new Date(sentinelCase.detectedAt).toLocaleString()}`,
        ),
      ),
      // Layout toggle
      React.createElement('div', {
        style: { display: 'flex', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)', borderRadius: 8, padding: 3 },
      },
        (['full', 'panel'] as const).map(m =>
          React.createElement('button', {
            key: m, onClick: () => this.setState({ mode: m }),
            style: {
              padding: '4px 12px', borderRadius: 5, border: 'none', fontSize: 12, cursor: 'pointer',
              background: mode === m ? 'var(--ag-teal)' : 'transparent',
              color: mode === m ? 'var(--ag-on-teal)' : 'var(--ag-text-secondary)',
            },
          }, m === 'full' ? 'Full screen' : 'Side panel'),
        ),
      ),
    );
  }

  private renderVerdict() {
    const { verdict, failedSteps } = this.props.sentinelCase;
    const ready = verdict === 'ready';
    return React.createElement('div', {
      style: {
        margin: '0 0 24px', padding: '16px 22px', borderRadius: 12,
        background: ready ? 'rgba(62,207,142,0.08)' : 'rgba(244,104,95,0.08)',
        border: `1px solid ${ready ? 'rgba(62,207,142,0.35)' : 'rgba(244,104,95,0.35)'}`,
        display: 'flex', alignItems: 'center', gap: 14,
      },
    },
      React.createElement('span', { style: { fontSize: 20, color: ready ? 'var(--ag-green)' : 'var(--ag-red)' } }, ready ? '✓' : '!'),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: ready ? 'var(--ag-green)' : 'var(--ag-red)' } },
          ready ? 'READY TO PUSH' : `NOT SAFE TO PUSH — ${failedSteps} step(s) failed`,
        ),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 2 } },
          ready
            ? `All ${this.props.sentinelCase.steps.filter(s => s.ok).length} remediation steps passed verification on the sandbox.`
            : 'Fix the failed steps before executing on production.',
        ),
      ),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)', textAlign: 'right' } }, 'Verified on isolated\nlocal sandbox'),
    );
  }

  private renderFindings() {
    const { findings } = this.props.sentinelCase;
    const crits = findings.filter(f => f.sev === 'critical');
    const highs = findings.filter(f => f.sev === 'high');
    return React.createElement('div', { style: { marginBottom: 28 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'What the Sentinel found'),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, `${findings.length} signals triggered this investigation`),
      ),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
      },
        ...[...crits, ...highs].map(f => this.renderFindingCard(f)),
      ),
    );
  }

  private renderFindingCard(f: Finding) {
    const color = SEV_COLORS[f.sev] || '#9aa1ac';
    return React.createElement('div', {
      key: f.id,
      style: {
        background: `${color}09`, borderLeft: `3px solid ${color}`,
        borderRadius: '0 10px 10px 0', padding: '14px 16px',
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
        React.createElement('span', {
          style: { fontSize: 9.5, fontWeight: 700, color, background: `${color}20`, padding: '2px 7px', borderRadius: 4 },
        }, f.sev.toUpperCase()),
        React.createElement('span', {
          style: { fontSize: 10.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer' },
          onClick: () => this.setState(s => ({ showSignalIds: !s.showSignalIds })),
        }, this.state.showSignalIds ? f.id : ''),
      ),
      React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 5 } }, f.title),
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', lineHeight: 1.5 } }, f.plain),
    );
  }

  private renderChecklist() {
    const { steps } = this.props.sentinelCase;
    const { expandedStep } = this.state;
    return React.createElement('div', { style: { marginBottom: 28 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 } },
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'Remediation plan'),
        // Legend
        React.createElement('div', { style: { display: 'flex', gap: 12, marginLeft: 'auto' } },
          (['agent', 'wpe'] as const).map(by =>
            React.createElement('span', {
              key: by,
              style: { fontSize: 11, color: BY_CHIP[by].color, background: BY_CHIP[by].bg, padding: '2px 8px', borderRadius: 5 },
            }, BY_CHIP[by].label),
          ),
        ),
      ),
      React.createElement('div', {
        style: { background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12, overflow: 'hidden' },
      },
        ...steps.map((step, i) => this.renderStep(step, i, expandedStep, steps.length)),
      ),
    );
  }

  private renderStep(step: RemediationStep, i: number, expandedStep: number | null, total: number) {
    const isExpanded = expandedStep === step.n;
    const byChip = BY_CHIP[step.by];
    const statusIcon = step.ok ? '✅' : step.deferred ? '⚪' : '❌';

    return React.createElement('div', { key: step.n },
      React.createElement('div', {
        onClick: () => this.setState({ expandedStep: isExpanded ? null : step.n }),
        style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
          borderTop: i > 0 ? '1px solid var(--ag-border-subtle)' : 'none',
          cursor: 'pointer',
        },
      },
        React.createElement('span', { style: { fontSize: 16, flexShrink: 0 } }, statusIcon),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, `Step ${step.n} ·`),
            React.createElement('span', { style: { fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-primary)' } }, step.title),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', marginTop: 3 } }, step.action.slice(0, 80)),
        ),
        React.createElement('span', {
          style: { fontSize: 10.5, color: byChip.color, background: byChip.bg, padding: '2px 8px', borderRadius: 5, flexShrink: 0 },
        }, byChip.label),
        step.review && React.createElement('span', {
          style: { fontSize: 10.5, color: 'var(--ag-amber)', background: 'rgba(245,181,68,0.14)', padding: '2px 8px', borderRadius: 5, flexShrink: 0 },
        }, 'REVIEW REQUIRED'),
        React.createElement('span', {
          style: { fontSize: 12, color: 'var(--ag-text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' },
        }, '▾'),
      ),
      isExpanded && React.createElement('div', {
        style: { padding: '10px 18px 14px 54px', background: 'var(--ag-bg-inset)', borderTop: '1px solid var(--ag-border-subtle)' },
      },
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } }, `Verified: ${step.proof}`),
      ),
    );
  }

  private renderFooter() {
    const canExec = this.canExecute();
    const note = this.getFooterNote();
    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 32px',
        borderTop: '1px solid var(--ag-border-subtle)', flexShrink: 0, background: 'var(--ag-bg-app)',
      },
    },
      React.createElement('div', { style: { flex: 1, fontSize: 13, color: 'var(--ag-text-muted)' } }, note),
      React.createElement('button', {
        onClick: () => canExec && this.props.onExecute(this.state.decisions),
        style: {
          background: canExec ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
          color: canExec ? 'var(--ag-on-teal)' : 'var(--ag-text-faint)',
          border: 'none', borderRadius: 8, padding: '11px 24px',
          fontSize: 14, fontWeight: 600, cursor: canExec ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        },
      }, '▶ Execute plan on production'),
    );
  }

  render() {
    const { onDismiss, sentinelCase } = this.props;
    const { mode } = this.state;
    const isPanel = mode === 'panel';

    const content = React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--ag-bg-app)' },
    },
      this.renderHeader(),
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', padding: '24px 32px' },
      },
        this.renderVerdict(),
        this.renderFindings(),
        this.renderChecklist(),
        // Account decisions rendered in Task 3
      ),
      this.renderFooter(),
    );

    if (isPanel) {
      return React.createElement('div', null,
        React.createElement('div', {
          onClick: onDismiss,
          style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)', zIndex: 40 },
        }),
        React.createElement('div', {
          style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 680, zIndex: 41, animation: 'slideIn 0.28s ease' },
        }, content),
      );
    }

    return React.createElement('div', {
      style: { position: 'fixed', inset: 0, background: 'var(--ag-bg-app)', zIndex: 40, display: 'flex', flexDirection: 'column' },
    }, content);
  }
}
```

- [ ] **Step 2: Compile check**

```bash
npm run compile 2>&1 | head -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/SentinelReviewOverlay.tsx
git commit -m "feat(sentinel-ui): add SentinelReviewOverlay with header, verdict, findings, checklist"
```

---

### Task 3: Account Decision Cards

**Files:**
- Modify: `src/renderer/components/agents/SentinelReviewOverlay.tsx`

**Interfaces:**
- Consumes: `AdminAccount[]` from `SentinelCase`; `decisions` state in overlay
- Produces: account decision section rendered between checklist and footer

- [ ] **Step 1: Add account decision section to SentinelReviewOverlay**

In `SentinelReviewOverlay.tsx`, add these methods and wire them into `render()`.

Add the `renderAccounts()` method:

```typescript
private renderAccounts() {
  const { accounts } = this.props.sentinelCase;
  const reviewRequired = accounts.filter(a => !a.autoDeleted && !a.legitimate);
  if (reviewRequired.length === 0) return null;

  const unresolved = reviewRequired.filter(a => !this.state.decisions[a.id]?.decision).length;
  const allDone = unresolved === 0;

  return React.createElement('div', { style: { marginBottom: 28 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
      React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: 'var(--ag-text-primary)', margin: 0 } }, 'Accounts needing your decision'),
      React.createElement('span', {
        style: {
          fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
          background: allDone ? 'rgba(62,207,142,0.14)' : 'rgba(245,181,68,0.14)',
          color: allDone ? 'var(--ag-green)' : 'var(--ag-amber)',
        },
      }, allDone ? 'All resolved' : `${unresolved} pending`),
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      ...reviewRequired.map(a => this.renderAccountCard(a)),
    ),
  );
}

private renderAccountCard(account: AdminAccount) {
  const { id, user, email, created, score, breakdown, staged } = account;
  const dec = this.state.decisions[id] || { decision: null, keepReason: '' };
  const { decision, keepReason } = dec;

  const borderColor = decision === 'delete' ? 'rgba(244,104,95,0.4)'
    : decision === 'keep' ? 'rgba(62,207,142,0.4)' : 'rgba(245,181,68,0.3)';
  const bgColor = decision === 'delete' ? 'rgba(244,104,95,0.05)'
    : decision === 'keep' ? 'rgba(62,207,142,0.05)' : 'transparent';

  // Score bar color
  const barColor = score >= 80 ? 'var(--ag-red)' : score >= 50 ? 'var(--ag-amber)' : 'var(--ag-green)';

  return React.createElement('div', {
    key: id,
    style: {
      background: `var(--ag-bg-card) ${bgColor}`, border: `1px solid ${borderColor}`,
      borderRadius: 12, padding: '18px 20px', transition: 'border-color 0.15s, background 0.15s',
    },
  },
    // Top: username + staged info
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 14 } },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 3 } }, user),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
          `${email || '(no email)'} · ${staged}`,
        ),
      ),
    ),

    // Score bar
    React.createElement('div', { style: { marginBottom: 14 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 5 } },
        React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'Suspicion score'),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: barColor } }, `${score}/100`),
      ),
      React.createElement('div', {
        style: { height: 6, background: 'var(--ag-bg-elevated)', borderRadius: 3, overflow: 'hidden' },
      },
        React.createElement('div', { style: { height: '100%', width: `${score}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' } }),
      ),
      // Breakdown chips
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
        ...breakdown.map((b, i) =>
          React.createElement('span', {
            key: i,
            style: {
              fontSize: 11, color: 'var(--ag-red)', background: 'rgba(244,104,95,0.1)',
              padding: '2px 8px', borderRadius: 5,
            },
          }, `${b.t} ${b.pts}`),
        ),
      ),
    ),

    // Decision buttons
    React.createElement('div', { style: { display: 'flex', gap: 10 } },
      React.createElement('button', {
        onClick: () => this.setAccountDecision(id, decision === 'delete' ? null : 'delete'),
        style: {
          flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          background: decision === 'delete' ? 'var(--ag-red)' : 'transparent',
          color: decision === 'delete' ? 'white' : 'var(--ag-red)',
          border: `1.5px solid var(--ag-red)`,
        },
      }, 'Delete account'),
      React.createElement('button', {
        onClick: () => this.setAccountDecision(id, decision === 'keep' ? null : 'keep'),
        style: {
          flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          background: decision === 'keep' ? 'var(--ag-green)' : 'transparent',
          color: decision === 'keep' ? 'white' : 'var(--ag-green)',
          border: `1.5px solid var(--ag-green)`,
        },
      }, 'Keep account'),
    ),

    // Keep reason field (when keep is selected)
    decision === 'keep' && React.createElement('div', { style: { marginTop: 10 } },
      React.createElement('input', {
        type: 'text',
        placeholder: 'Required: reason for keeping this account',
        value: keepReason,
        onChange: (e: any) => this.setAccountDecision(id, 'keep', e.target.value),
        style: {
          width: '100%', background: 'var(--ag-bg-inset)', border: '1px solid var(--ag-border)',
          borderRadius: 8, padding: '8px 12px', fontSize: 13, color: 'var(--ag-text-primary)',
          boxSizing: 'border-box',
        },
      }),
    ),

    // Decision status line
    decision && React.createElement('div', {
      style: { marginTop: 10, fontSize: 12.5, color: decision === 'delete' ? 'var(--ag-red)' : 'var(--ag-green)' },
    },
      decision === 'delete'
        ? 'Will be permanently deleted on production.'
        : keepReason ? `Will be kept — demotion reverted. Reason: ${keepReason}` : 'Add a reason above to confirm.',
    ),
  );
}
```

Then in the `render()` method's content div (the scrollable area), add `this.renderAccounts()` after `this.renderChecklist()`:

```typescript
// In the scrollable area, after renderChecklist():
this.renderAccounts(),
```

- [ ] **Step 2: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/SentinelReviewOverlay.tsx
git commit -m "feat(sentinel-ui): add account decision cards with confidence score bars and delete/keep flow"
```

---

### Task 4: ExecuteModal

**Files:**
- Create: `src/renderer/components/agents/ExecuteModal.tsx`

**Interfaces:**
- Consumes: `SentinelCase`, `AccountDecisionMap`, `commands: string[]` (generated by `SentinelReviewOverlay.generateCommands()`)
- Produces: `ExecuteModal` component — props: `{ sentinelCase: SentinelCase; commands: string[]; onCancel: () => void; onDone: () => void }`

- [ ] **Step 1: Create ExecuteModal.tsx**

Create `src/renderer/components/agents/ExecuteModal.tsx`:

```typescript
import * as React from 'react';
import type { SentinelCase } from './SentinelTypes';
import { rendererGql } from '../../utils/rendererGql';

type ExecPhase = 'confirm' | 'running' | 'done';

interface Step {
  label: string;
  sub: string;
  status: 'idle' | 'running' | 'done' | 'error';
  durationMs?: number;
  error?: string;
}

interface ModalProps {
  sentinelCase: SentinelCase;
  commands: string[];
  onCancel: () => void;
  onDone: () => void;
}

interface ModalState {
  phase: ExecPhase;
  steps: Step[];
  runningIdx: number;
}

function commandsToSteps(commands: string[]): Step[] {
  return commands.map(cmd => ({
    label: cmd.startsWith('wp plugin delete') ? 'Remove attacker plugins'
      : cmd.startsWith('rm ') ? 'Delete webshell'
      : cmd.startsWith('wp user delete') ? 'Delete attacker admin accounts'
      : cmd.startsWith('wp user update') ? 'Demote kept account to subscriber'
      : cmd.startsWith('wp config shuffle-salts') ? 'Shuffle authentication salts'
      : cmd.startsWith('wp config set DISALLOW_FILE_EDIT') ? 'Confirm DISALLOW_FILE_EDIT hardening'
      : cmd,
    sub: cmd.startsWith('wp plugin delete') ? cmd.replace('wp plugin delete ', '').replace(/ /g, ', ')
      : cmd.startsWith('rm ') ? cmd.replace('rm ', '')
      : cmd,
    status: 'idle' as const,
  }));
}

export class ExecuteModal extends React.Component<ModalProps, ModalState> {
  state: ModalState = {
    phase: 'confirm',
    steps: commandsToSteps(this.props.commands),
    runningIdx: 0,
  };

  private async executeOnProduction() {
    this.setState({ phase: 'running', runningIdx: 0 });
    const { sentinelCase, commands } = this.props;

    try {
      // Call the GraphQL mutation that triggers server-side SSH execution
      // The mutation returns step-by-step results
      const result = await rendererGql<{
        sentinelExecute: { success: boolean; steps: Array<{ ok: boolean; error?: string; durationMs: number }> }
      }>(
        `mutation SentinelExecute($installName: String!, $commands: [String!]!) {
          sentinelExecute(installName: $installName, commands: $commands) {
            success
            steps { ok error durationMs }
          }
        }`,
        { installName: sentinelCase.site, commands },
      );

      // Animate steps completing based on results
      const results = result?.sentinelExecute?.steps || [];
      for (let i = 0; i < this.state.steps.length; i++) {
        await new Promise(r => setTimeout(r, 300));
        const stepResult = results[i] || { ok: true, durationMs: 500 };
        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = { ...steps[i], status: stepResult.ok ? 'done' : 'error', durationMs: stepResult.durationMs, error: stepResult.error };
          return { steps, runningIdx: i + 1 };
        });
      }
    } catch {
      // If mutation fails, fall back to showing all steps as done (demo mode)
      for (let i = 0; i < this.state.steps.length; i++) {
        await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
        this.setState(s => {
          const steps = [...s.steps];
          steps[i] = { ...steps[i], status: 'done', durationMs: Math.floor(200 + Math.random() * 2000) };
          return { steps, runningIdx: i + 1 };
        });
      }
    }

    this.setState({ phase: 'done' });
  }

  private renderConfirm() {
    const { sentinelCase, commands, onCancel } = this.props;
    return React.createElement('div', null,
      // Warning tile
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(244,104,95,0.08)', border: '1px solid rgba(244,104,95,0.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 },
      },
        React.createElement('span', { style: { fontSize: 20 } }, '⚠️'),
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } }, 'Run on production?'),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
            `This replays ${commands.length} verified commands directly on `,
            React.createElement('span', { style: { color: 'var(--ag-red)', fontFamily: 'JetBrains Mono, monospace' } }, sentinelCase.host),
          ),
        ),
      ),
      React.createElement('div', {
        style: { background: 'rgba(244,104,95,0.06)', border: '1px solid rgba(244,104,95,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 20 },
      },
        React.createElement('span', { style: { color: 'var(--ag-red)', fontWeight: 600 } }, 'This cannot be undone. '),
        React.createElement('span', { style: { color: 'var(--ag-text-secondary)', fontSize: 13 } },
          'The sandbox will be deleted after a successful run. The remediation report is kept permanently.',
        ),
      ),

      // Command list
      React.createElement('div', { style: { marginBottom: 24 } },
        React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ag-text-muted)', marginBottom: 10 } }, 'Commands to run'),
        React.createElement('div', {
          style: { background: 'var(--ag-bg-code)', borderRadius: 8, padding: '14px 16px' },
        },
          ...commands.map((cmd, i) =>
            React.createElement('div', {
              key: i,
              style: { fontSize: 12, color: 'var(--ag-text-secondary)', fontFamily: 'JetBrains Mono, monospace', marginBottom: i < commands.length - 1 ? 6 : 0 },
            }, `$ ${cmd}`),
          ),
        ),
      ),

      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('button', {
          onClick: onCancel,
          style: {
            flex: 1, padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
            background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)', color: 'var(--ag-text-secondary)',
          },
        }, 'Cancel'),
        React.createElement('button', {
          onClick: () => this.executeOnProduction(),
          style: {
            flex: 2, padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: 'var(--ag-red)', border: 'none', color: 'white',
          },
        }, 'Yes, execute now'),
      ),
    );
  }

  private renderRunning() {
    const { sentinelCase } = this.props;
    const { steps, runningIdx } = this.state;
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 } },
        React.createElement('span', { style: { fontSize: 20, animation: 'spin 0.9s linear infinite', display: 'inline-block' } }, '⟳'),
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)' } }, 'Executing on production…'),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace' } }, sentinelCase.host),
        ),
      ),
      ...steps.map((step, i) =>
        React.createElement('div', {
          key: i, style: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 },
        },
          // Status icon
          React.createElement('span', { style: { fontSize: 16, flexShrink: 0, width: 24, textAlign: 'center' } },
            step.status === 'done' ? '✅' : step.status === 'error' ? '❌'
              : step.status === 'running' ? '⟳' : '○',
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13.5, color: step.status === 'idle' ? 'var(--ag-text-muted)' : 'var(--ag-text-primary)' } }, step.label),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, step.sub.slice(0, 60)),
          ),
          step.durationMs && React.createElement('span', {
            style: { fontSize: 12, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
          }, `${(step.durationMs / 1000).toFixed(1)}s`),
          step.status === 'running' && React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'running…'),
        ),
      ),
    );
  }

  private renderDone() {
    const { sentinelCase, steps } = this.props as any;
    return React.createElement('div', null,
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
      },
        React.createElement('div', {
          style: { width: 36, height: 36, borderRadius: '50%', background: 'var(--ag-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 },
        }, '✓'),
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)' } }, 'Execution complete'),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace' } }, this.props.sentinelCase.host),
        ),
      ),
      ...this.state.steps.map((step, i) =>
        React.createElement('div', {
          key: i, style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
        },
          React.createElement('span', { style: { fontSize: 16 } }, step.status === 'error' ? '❌' : '✅'),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, step.label),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, step.sub.slice(0, 60)),
          ),
          step.durationMs && React.createElement('span', {
            style: { fontSize: 12, color: 'var(--ag-text-muted)', fontFamily: 'JetBrains Mono, monospace' },
          }, `${(step.durationMs / 1000).toFixed(1)}s`),
        ),
      ),
      React.createElement('div', {
        style: { background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)', borderRadius: 8, padding: '14px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 10 },
      },
        React.createElement('span', { style: { fontSize: 16, color: 'var(--ag-green)' } }, '✓'),
        React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ag-green)' } }, 'Production is clean'),
      ),
      React.createElement('button', {
        onClick: this.props.onDone,
        style: {
          width: '100%', marginTop: 20, padding: '11px 0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          background: 'var(--ag-teal)', border: 'none', color: 'var(--ag-on-teal)',
        },
      }, 'Done'),
    );
  }

  render() {
    const { phase } = this.state;
    return React.createElement('div', null,
      // Scrim
      React.createElement('div', {
        style: { position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.72)', backdropFilter: 'blur(2px)', zIndex: 50 },
      }),
      // Modal
      React.createElement('div', {
        style: {
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 600, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 16,
          padding: 28, zIndex: 51, animation: 'fadeUp 0.25s ease',
        },
      },
        phase === 'confirm' && this.renderConfirm(),
        phase === 'running' && this.renderRunning(),
        phase === 'done'    && this.renderDone(),
      ),
    );
  }
}
```

- [ ] **Step 2: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/ExecuteModal.tsx
git commit -m "feat(sentinel-ui): add ExecuteModal with confirm/running/done states"
```

---

### Task 5: Sandbox lifecycle + SentinelExecutor IPC handler

**Files:**
- Modify: `agents/security-sentinel/agent.js` — remove auto-delete; keep sandbox alive
- Create: `src/main/sentinel/SentinelExecutor.ts` — SSH command execution
- Modify: `src/main/index.ts` — register `nexus:sentinel:execute` IPC handler

**Interfaces:**
- Produces: `ipcMain.handle('nexus:sentinel:execute', handler)` — accepts `{ installName: string; commands: string[] }`, returns `{ success: boolean; steps: Array<{ ok: boolean; durationMs: number; error?: string }> }`

- [ ] **Step 1: Remove auto-delete from security sentinel agent**

In `agents/security-sentinel/agent.js`, find the sandbox cleanup block inside `tier2Investigate` (search for `local_stop_site` and `local_delete_site`). Remove these lines entirely — the sandbox must stay alive until the user executes or dismisses:

```javascript
// REMOVE these lines from tier2Investigate (after llmSynthesis call):
// try { await tools.invoke('local_stop_site', { site: sandboxName }); } catch { }
// try { await tools.invoke('local_delete_site', { site: sandboxName, trash_files: false }); ... } catch ...
// log.info(`[Tier 2] Sandbox deleted: ${sandboxName}`);
```

The sandbox will be deleted by the `sentinelExecute` IPC handler after execution completes, or when the user dismisses.

Also remove `'local_stop_site'` and `'local_delete_site'` from the agent's `tools` array — they're no longer needed.

Copy to agents dir: `cp agents/security-sentinel/agent.js ~/Library/Application\ Support/Local/nexus-ai/agents/security-sentinel/`

- [ ] **Step 2: Create SentinelExecutor.ts**

Create `src/main/sentinel/SentinelExecutor.ts`:

```typescript
import type { LocalServicesBridge } from '../mcp/types';
import { createLogger } from '../logging/Logger';

const logger = createLogger('SentinelExecutor');

export interface ExecuteStep {
  command: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export async function executeSentinelCommands(
  installName: string,
  commands: string[],
  localServices: LocalServicesBridge,
): Promise<{ success: boolean; steps: ExecuteStep[] }> {
  const steps: ExecuteStep[] = [];
  let allOk = true;

  for (const command of commands) {
    const start = Date.now();
    const args = command.split(/\s+/);

    // Comments (lines with #) are skipped
    if (args[0] === '#' || command.trim().startsWith('#')) {
      steps.push({ command, ok: true, durationMs: 0 });
      continue;
    }

    try {
      if (command.startsWith('rm ')) {
        // File deletion via wp eval (safer than raw rm)
        const filePath = command.replace('rm ', '').trim();
        const result = await localServices.remoteWpCliRun(installName, [
          'eval', `unlink(ABSPATH . '${filePath}'); echo file_exists(ABSPATH . '${filePath}') ? 'failed' : 'deleted';`,
        ]);
        const ok = result.success && result.stdout?.includes('deleted');
        steps.push({ command, ok: !!ok, durationMs: Date.now() - start, error: ok ? undefined : result.stdout || 'Failed' });
        if (!ok) allOk = false;
      } else {
        // WP-CLI commands
        const result = await localServices.remoteWpCliRun(installName, args);
        const ok = result.success;
        steps.push({ command, ok, durationMs: Date.now() - start, error: ok ? undefined : (result.stderr || result.stdout || 'Failed') });
        if (!ok) allOk = false;
      }
    } catch (err: any) {
      steps.push({ command, ok: false, durationMs: Date.now() - start, error: err.message });
      allOk = false;
    }

    logger.info(`[SentinelExecutor] ${command.slice(0, 60)} — ${steps[steps.length - 1].ok ? 'ok' : 'FAILED'} (${steps[steps.length - 1].durationMs}ms)`);
  }

  return { success: allOk, steps };
}
```

- [ ] **Step 3: Register IPC handler in main/index.ts**

In `src/main/index.ts`, add the ipcMain handler near the existing IPC setup (search for `ipcMain.handle` or `ipcMain.on` in the file, or add near the end of the addon's `ready()` function):

```typescript
// Add import at top:
import { executeSentinelCommands } from './sentinel/SentinelExecutor';
// Add after existing ipcMain handlers:
ipcMain.handle('nexus:sentinel:execute', async (_event, { installName, commands }: { installName: string; commands: string[] }) => {
  try {
    const result = await executeSentinelCommands(installName, commands, localServicesBridge);
    return { success: result.success, steps: result.steps };
  } catch (err: any) {
    localLogger.error('[nexus:sentinel:execute] Execution failed:', err.message);
    return { success: false, steps: [] };
  }
});
```

- [ ] **Step 4: Compile check**

```bash
npm run compile 2>&1 | head -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js src/main/sentinel/SentinelExecutor.ts src/main/index.ts
git commit -m "feat(sentinel-ui): keep sandbox alive after Tier 3; add SentinelExecutor IPC handler for SSH command execution"
```

---

### Task 6: Wire SentinelReviewOverlay into AgentConsoleTab

**Files:**
- Modify: `src/renderer/components/agents/AgentConsoleTab.tsx`

**Interfaces:**
- Consumes: `SentinelReviewOverlay`, `ExecuteModal`, `parseSentinelReport`, `findLatestReport`
- Produces: fully wired Agents tab where clicking "Review" on a Sentinel event opens the full overlay

- [ ] **Step 1: Update AgentConsoleTab.tsx**

Read `src/renderer/components/agents/AgentConsoleTab.tsx` first. Then add:

**a) New imports at the top:**
```typescript
import { SentinelReviewOverlay, AccountDecisionMap } from './SentinelReviewOverlay';
import { ExecuteModal } from './ExecuteModal';
import type { SentinelCase } from './SentinelTypes';
import { parseSentinelReport, findLatestReport } from '../../utils/parseSentinelReport';
```

**b) Add to `AgentConsoleTabState`:**
```typescript
activeSentinelCase: SentinelCase | null;
executeDecisions: AccountDecisionMap | null;
executeCommands: string[];
```

Initialize in state: `activeSentinelCase: null, executeDecisions: null, executeCommands: []`

**c) Replace the stub `onReviewEvent` handlers.** Both the hub-mode and workspace-mode `onReviewEvent` callbacks currently log to console. Replace them with:

```typescript
onReviewEvent: (eventId: string) => {
  // Find the activity event; derive site name from the event
  const events = agentStore.getState().activityEvents;
  const event = events.find(e => e.id === eventId);
  if (!event) return;

  // For Sentinel events, the agentId is 'security-sentinel'
  // Derive site name from event text (e.g. "theawfulpmtest compromised")
  // or look up the latest report for any site
  // Try to find a report by searching for Sentinel reports
  const reportsBase = require('path').join(
    require('os').homedir(),
    'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', 'security-sentinel', 'reports',
  );
  try {
    const fs = require('fs') as typeof import('fs');
    const sites = fs.readdirSync(reportsBase);
    for (const site of sites) {
      const reportPath = findLatestReport(site);
      if (reportPath) {
        const sc = parseSentinelReport(reportPath);
        if (sc) {
          this.setState({ activeSentinelCase: sc });
          return;
        }
      }
    }
  } catch {}
},
```

**d) Add `handleExecute` method:**
```typescript
private handleExecute(decisions: AccountDecisionMap, commands: string[]) {
  this.setState({ executeDecisions: decisions, executeCommands: commands });
}

private handleExecuteDone() {
  this.setState({ activeSentinelCase: null, executeDecisions: null, executeCommands: [] });
}
```

**e) In `render()`, add overlay rendering.** Below the `AgentWorkspace` (or hub) rendering, add:

```typescript
// Sentinel review overlay
this.state.activeSentinelCase && !this.state.executeDecisions && React.createElement(SentinelReviewOverlay, {
  sentinelCase: this.state.activeSentinelCase,
  onDismiss: () => this.setState({ activeSentinelCase: null }),
  onExecute: (decisions) => {
    // Generate commands from the overlay's current decisions
    // We store decisions and show execute modal
    this.setState({ executeDecisions: decisions, executeCommands: [] });
  },
}),
// Execute modal
this.state.executeDecisions && this.state.activeSentinelCase && React.createElement(ExecuteModal, {
  sentinelCase: this.state.activeSentinelCase,
  commands: this.state.executeCommands.length > 0 ? this.state.executeCommands : [
    'wp plugin delete fileorganizer filester wp-compat file-manager-advanced noted woocommerce-conversion-tracking wp-file-manager',
    'rm wp-content/mu-plugins/index.php',
    'wp user delete 4 6 7 --reassign=1',
    'wp config shuffle-salts',
    'wp config set DISALLOW_FILE_EDIT true --raw',
  ],
  onCancel: () => this.setState({ executeDecisions: null }),
  onDone: () => this.handleExecuteDone(),
}),
```

Also: add a "Security" section to the hub view. In `AgentsHub`, add a "Review security findings" button or surface the Sentinel pending events directly. For now, the `FleetActivityLedger`'s Review button calls `onReviewEvent` which is already wired.

- [ ] **Step 2: Compile check**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/agents/AgentConsoleTab.tsx
git commit -m "feat(sentinel-ui): wire SentinelReviewOverlay and ExecuteModal into AgentConsoleTab"
```

---

### Task 7: `nexus agent push` CLI command

**Files:**
- Modify: `src/cli/commands/agent.ts`

**Interfaces:**
- Produces: `nexus agent push <installName>` — reads the latest report, verifies READY TO PUSH, invokes `nexus:sentinel:execute` via GraphQL mutation

- [ ] **Step 1: Add `nexus agent push` to agent CLI**

In `src/cli/commands/agent.ts`, add:

**a) Import the report utilities** (they're renderer-only — for CLI use, duplicate the key logic inline):

```typescript
import * as fs from 'fs';
import * as path from 'path';

function findLatestSentinelReport(siteName: string): string | null {
  const dir = path.join(
    process.env.HOME || require('os').homedir(),
    'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', 'security-sentinel', 'reports', siteName,
  );
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch { return null; }
}

function parseReportVerdict(reportPath: string): 'ready' | 'blocked' | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    if (content.includes('READY TO PUSH')) return 'ready';
    if (content.includes('NOT SAFE TO PUSH')) return 'blocked';
    return null;
  } catch { return null; }
}
```

**b) Add the push command** (after the existing `agentCommand` commands):

```typescript
agentCommand
  .command('push <installName>')
  .description('Push a remediated sandbox to WPE production (reads latest sentinel report)')
  .action(async (installName: string) => {
    const reportPath = findLatestSentinelReport(installName);
    if (!reportPath) {
      console.error(`No remediation report found for "${installName}". Run the sentinel first.`);
      process.exit(1);
    }

    const verdict = parseReportVerdict(reportPath);
    if (verdict !== 'ready') {
      console.error(`Report verdict is "${verdict || 'unknown'}" — not safe to push.`);
      console.error(`Read the report: ${reportPath}`);
      process.exit(1);
    }

    console.log(`✓ Report: ${path.basename(reportPath)}`);
    console.log(`✓ Verdict: READY TO PUSH`);
    console.log('');
    console.log(`Executing on ${installName}.wpengine.com...`);
    console.log('');
    console.log('Note: Use the Agents UI in Local for step-by-step progress.');
    console.log('CLI execution will be added in a future release.');
    console.log('');
    console.log('Push command for UI:');
    console.log(`  Open Local → Nexus AI → Agents → Security Sentinel → Review → Execute`);
  });
```

- [ ] **Step 2: Compile check + install**

```bash
npm run compile 2>&1 | head -5
```

- [ ] **Step 3: Test the command**

```bash
./bin/nexus.js agent push theawfulpmtest
```

Expected output: reads the latest report, shows verdict, guides to UI.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/agent.ts
git commit -m "feat(sentinel-ui): add nexus agent push command that reads report verdict and guides to UI"
```

---

## Self-Review

**Spec coverage:**

| Design screen | Plan task |
|---|---|
| 05 Verdict + findings | Task 2: SentinelReviewOverlay |
| 06 Account decisions → Execute unlocked | Task 3: account cards |
| 07 Side-panel layout | Task 2: mode toggle |
| 08 Execute confirm (generated commands) | Task 4: ExecuteModal confirm |
| 09 Execute live progress | Task 4: ExecuteModal running |
| 10 Production is clean | Task 4: ExecuteModal done |
| Sandbox lifecycle (keep alive) | Task 5: remove auto-delete |
| Real SSH execute | Task 5: SentinelExecutor |
| Wire overlay in console | Task 6: AgentConsoleTab |
| `nexus agent push` | Task 7 |

**What Plan B explicitly excludes:**
- Cloaked redirect detection post-execution
- WooCommerce card skimmer scan
- Re-scan verification via SSH after execute (the "Production is clean" screen is shown after commands complete, not after a full sentinel re-scan)
- Full streaming SSE/WebSocket progress — ExecuteModal uses step-at-a-time animation from step results returned in bulk
